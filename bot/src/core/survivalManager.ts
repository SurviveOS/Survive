import { Logger } from '../utils/logger';
import { StorageService } from '../utils/storage';
import { WalletService } from '../services/wallet';
import { PumpFunService, TokenMetadata, LaunchResult } from '../services/pumpfun';
import { JupiterService } from '../services/jupiter';
import { TokenDataService } from '../services/tokenData';
import { Config } from '../config';

export interface SurvivalState {
  // Token info
  tokenLaunched: boolean;
  tokenMint: string | null;
  tokenSymbol: string;
  tokenName: string;
  launchTxHash: string | null;
  launchTimestamp: Date | null;

  // Holdings
  tokenBalance: number;           // How much $SURVIVE we hold
  tokenValueSOL: number;          // Current value in SOL
  
  // Survival metrics
  capitalSOL: number;             // Trading capital
  minCapitalSOL: number;          // Minimum to keep trading
  criticalCapitalSOL: number;     // Emergency level
  
  // History
  totalTokenBought: number;       // Total $SURVIVE bought
  totalTokenSold: number;         // Total $SURVIVE sold for survival
  survivalSellCount: number;      // How many times we had to sell to survive
  
  // Status
  status: 'healthy' | 'low' | 'critical' | 'emergency';
  lastChecked: Date;
}

export interface SurvivalDecision {
  action: 'none' | 'buy_token' | 'sell_token_partial' | 'sell_token_emergency';
  amount: number;
  reason: string;
}

const DEFAULT_STATE: SurvivalState = {
  tokenLaunched: false,
  tokenMint: null,
  tokenSymbol: '$SURVIVE',
  tokenName: 'SURVIVE',
  launchTxHash: null,
  launchTimestamp: null,
  tokenBalance: 0,
  tokenValueSOL: 0,
  capitalSOL: 0,
  minCapitalSOL: 5,
  criticalCapitalSOL: 2,
  totalTokenBought: 0,
  totalTokenSold: 0,
  survivalSellCount: 0,
  status: 'healthy',
  lastChecked: new Date(),
};

/**
 * Survival Manager
 * 
 * The core survival logic:
 * 
 * 1. LAUNCH: Agent creates $SURVIVE on Pump.fun
 * 2. PROFIT: When trading profits come in → Buy $SURVIVE, hold it
 * 3. SURVIVE: When capital gets low → Sell $SURVIVE to stay alive
 * 
 * The agent's goal is to SURVIVE and grow the $SURVIVE token.
 * The token becomes a store of value for the agent.
 */
export class SurvivalManager {
  private logger: Logger;
  private storage: StorageService;
  private wallet: WalletService;
  private pumpfun: PumpFunService;
  private jupiter: JupiterService;
  private tokenData: TokenDataService;
  private config: Config;
  private state: SurvivalState;

  // Thresholds (percentage of initial capital)
  private readonly PROFIT_TO_BUY_PERCENT = 30;     // Use 30% of profits to buy $SURVIVE
  private readonly LOW_CAPITAL_PERCENT = 25;       // Below 25% = low
  private readonly CRITICAL_CAPITAL_PERCENT = 10;  // Below 10% = critical
  private readonly EMERGENCY_SELL_PERCENT = 20;    // Sell 20% of $SURVIVE in emergency
  private readonly PARTIAL_SELL_PERCENT = 10;      // Sell 10% in low state

  constructor(
    storage: StorageService,
    wallet: WalletService,
    jupiter: JupiterService,
    tokenData: TokenDataService,
    config: Config
  ) {
    this.logger = new Logger('SurvivalManager');
    this.storage = storage;
    this.wallet = wallet;
    this.pumpfun = new PumpFunService(wallet);
    this.jupiter = jupiter;
    this.tokenData = tokenData;
    this.config = config;
    this.state = this.loadState();

    // Calculate capital thresholds
    this.state.minCapitalSOL = config.initialCapitalSol * (this.LOW_CAPITAL_PERCENT / 100);
    this.state.criticalCapitalSOL = config.initialCapitalSol * (this.CRITICAL_CAPITAL_PERCENT / 100);
  }

  /**
   * Launch the $SURVIVE token on Pump.fun
   */
  async launchToken(metadata?: Partial<TokenMetadata>, initialBuySOL: number = 1): Promise<LaunchResult> {
    if (this.state.tokenLaunched) {
      this.logger.warn('Token already launched!');
      return { 
        success: false, 
        error: 'Token already launched',
        mintAddress: this.state.tokenMint || undefined,
      };
    }

    const defaultMetadata: TokenMetadata = {
      name: 'SURVIVE',
      symbol: 'SURVIVE',
      description: '🦎 SURVIVE - An autonomous AI trading agent that just wants to survive. Watch it trade, adapt, and grow. 100% transparent, 100% autonomous.',
      twitter: 'https://twitter.com/survive_ai',
      website: 'https://survive.ai',
      ...metadata,
    };

    this.logger.info('═'.repeat(50));
    this.logger.info('🦎 LAUNCHING $SURVIVE TOKEN');
    this.logger.info('═'.repeat(50));
    this.logger.info(`Name: ${defaultMetadata.name}`);
    this.logger.info(`Symbol: ${defaultMetadata.symbol}`);
    this.logger.info(`Initial buy: ${initialBuySOL} SOL`);

    const result = await this.pumpfun.launchTokenLocal(defaultMetadata, initialBuySOL);

    if (result.success && result.mintAddress) {
      this.state.tokenLaunched = true;
      this.state.tokenMint = result.mintAddress;
      this.state.tokenSymbol = defaultMetadata.symbol;
      this.state.tokenName = defaultMetadata.name;
      this.state.launchTxHash = result.txSignature || null;
      this.state.launchTimestamp = new Date();
      
      // Update token balance
      await this.updateTokenBalance();
      
      this.saveState();

      this.logger.info('═'.repeat(50));
      this.logger.info('🎉 TOKEN LAUNCHED SUCCESSFULLY!');
      this.logger.info(`Mint: ${result.mintAddress}`);
      this.logger.info(`TX: ${result.txSignature}`);
      this.logger.info('═'.repeat(50));
    }

    return result;
  }

  /**
   * Check survival status and decide action
   */
  async checkSurvival(): Promise<SurvivalDecision> {
    // Update current state
    const balance = await this.wallet.getBalance();
    this.state.capitalSOL = balance;
    await this.updateTokenBalance();
    this.state.lastChecked = new Date();

    // Determine status
    const previousStatus = this.state.status;
    this.state.status = this.determineStatus(balance);

    if (this.state.status !== previousStatus) {
      this.logger.warn(`Status changed: ${previousStatus} → ${this.state.status}`);
    }

    // Make survival decision
    const decision = this.makeSurvivalDecision(balance);
    
    this.saveState();
    return decision;
  }

  /**
   * Handle profit - buy $SURVIVE with a portion
   */
  async handleProfit(profitSOL: number): Promise<void> {
    if (profitSOL <= 0) return;
    if (!this.state.tokenLaunched || !this.state.tokenMint) {
      this.logger.debug('Token not launched yet, skipping buyback');
      return;
    }

    const buyAmount = profitSOL * (this.PROFIT_TO_BUY_PERCENT / 100);
    
    if (buyAmount < 0.01) {
      this.logger.debug('Profit too small for buyback');
      return;
    }

    this.logger.info(`🦎 Buying $SURVIVE with ${buyAmount.toFixed(4)} SOL (${this.PROFIT_TO_BUY_PERCENT}% of profit)`);

    // Check if token is still on Pump.fun or graduated
    const isGraduated = await this.pumpfun.isGraduated(this.state.tokenMint);

    let result;
    if (isGraduated) {
      // Use Jupiter for Raydium trading
      result = await this.jupiter.buyWithSol(this.state.tokenMint, buyAmount, 200);
    } else {
      // Use Pump.fun bonding curve
      result = await this.pumpfun.buy(this.state.tokenMint, buyAmount, 1000);
    }

    if (result.success) {
      this.state.totalTokenBought += buyAmount;
      await this.updateTokenBalance();
      this.logger.info(`✅ Bought $SURVIVE - Balance: ${this.state.tokenBalance}`);
    } else {
      this.logger.error(`❌ Failed to buy $SURVIVE: ${result.error}`);
    }

    this.saveState();
  }

  /**
   * Emergency/survival sell - sell $SURVIVE to get SOL
   */
  async sellForSurvival(percent: number): Promise<boolean> {
    if (!this.state.tokenLaunched || !this.state.tokenMint) {
      this.logger.error('No token to sell');
      return false;
    }

    if (this.state.tokenBalance === 0) {
      this.logger.error('No $SURVIVE balance to sell');
      return false;
    }

    this.logger.warn(`🆘 SURVIVAL SELL: Selling ${percent}% of $SURVIVE holdings`);
    this.state.survivalSellCount++;

    // Check if graduated
    const isGraduated = await this.pumpfun.isGraduated(this.state.tokenMint);

    let result;
    if (isGraduated) {
      const sellAmount = this.state.tokenBalance * (percent / 100);
      result = await this.jupiter.sellForSol(this.state.tokenMint, sellAmount, 200);
    } else {
      result = await this.pumpfun.sellPercent(this.state.tokenMint, percent, 1000);
    }

    if (result.success) {
      const soldAmount = this.state.tokenBalance * (percent / 100);
      this.state.totalTokenSold += soldAmount;
      await this.updateTokenBalance();
      
      this.logger.info(`✅ Sold $SURVIVE for survival`);
      this.logger.info(`   Remaining balance: ${this.state.tokenBalance}`);
      this.logger.info(`   Total survival sells: ${this.state.survivalSellCount}`);
      
      this.saveState();
      return true;
    } else {
      this.logger.error(`❌ Survival sell failed: ${result.error}`);
      return false;
    }
  }

  /**
   * Get current survival state
   */
  getState(): SurvivalState {
    return { ...this.state };
  }

  /**
   * Get survival summary for display
   */
  getSummary(): string {
    const statusEmoji = {
      healthy: '💚',
      low: '🟡',
      critical: '🟠',
      emergency: '🔴',
    }[this.state.status];

    return (
      `${statusEmoji} Status: ${this.state.status.toUpperCase()} | ` +
      `Capital: ${this.state.capitalSOL.toFixed(2)} SOL | ` +
      `$SURVIVE: ${this.state.tokenBalance.toLocaleString()} (${this.state.tokenValueSOL.toFixed(2)} SOL) | ` +
      `Survival sells: ${this.state.survivalSellCount}`
    );
  }

  /**
   * Check if we need to launch the token
   */
  needsTokenLaunch(): boolean {
    return !this.state.tokenLaunched;
  }

  /**
   * Get token mint address
   */
  getTokenMint(): string | null {
    return this.state.tokenMint;
  }

  // === Private Methods ===

  private determineStatus(capitalSOL: number): SurvivalState['status'] {
    if (capitalSOL >= this.state.minCapitalSOL * 2) {
      return 'healthy';
    } else if (capitalSOL >= this.state.minCapitalSOL) {
      return 'low';
    } else if (capitalSOL >= this.state.criticalCapitalSOL) {
      return 'critical';
    } else {
      return 'emergency';
    }
  }

  private makeSurvivalDecision(capitalSOL: number): SurvivalDecision {
    // Emergency: Very low capital, sell more $SURVIVE
    if (this.state.status === 'emergency' && this.state.tokenBalance > 0) {
      return {
        action: 'sell_token_emergency',
        amount: this.EMERGENCY_SELL_PERCENT,
        reason: `EMERGENCY: Capital at ${capitalSOL.toFixed(2)} SOL, selling ${this.EMERGENCY_SELL_PERCENT}% of $SURVIVE`,
      };
    }

    // Critical: Low capital, sell some $SURVIVE
    if (this.state.status === 'critical' && this.state.tokenBalance > 0) {
      return {
        action: 'sell_token_partial',
        amount: this.PARTIAL_SELL_PERCENT,
        reason: `CRITICAL: Capital at ${capitalSOL.toFixed(2)} SOL, selling ${this.PARTIAL_SELL_PERCENT}% of $SURVIVE`,
      };
    }

    // Low: Warning but no action yet
    if (this.state.status === 'low') {
      return {
        action: 'none',
        amount: 0,
        reason: `LOW: Capital at ${capitalSOL.toFixed(2)} SOL, monitoring closely`,
      };
    }

    // Healthy: No action needed
    return {
      action: 'none',
      amount: 0,
      reason: `HEALTHY: Capital at ${capitalSOL.toFixed(2)} SOL`,
    };
  }

  private async updateTokenBalance(): Promise<void> {
    if (!this.state.tokenMint) {
      this.state.tokenBalance = 0;
      this.state.tokenValueSOL = 0;
      return;
    }

    try {
      this.state.tokenBalance = await this.wallet.getTokenBalance(this.state.tokenMint);
      
      // Get token price
      const price = await this.pumpfun.getTokenPrice(this.state.tokenMint);
      if (price) {
        this.state.tokenValueSOL = this.state.tokenBalance * price;
      }
    } catch (error: any) {
      this.logger.error(`Failed to update token balance: ${error.message}`);
    }
  }

  private loadState(): SurvivalState {
    // Load from storage if exists
    const stored = this.storage.getState();
    if ((stored as any).survivalState) {
      return {
        ...DEFAULT_STATE,
        ...(stored as any).survivalState,
        lastChecked: new Date((stored as any).survivalState.lastChecked),
        launchTimestamp: (stored as any).survivalState.launchTimestamp 
          ? new Date((stored as any).survivalState.launchTimestamp) 
          : null,
      };
    }
    return { ...DEFAULT_STATE };
  }

  private saveState(): void {
    // Save to storage
    const stored = this.storage.getState() as any;
    stored.survivalState = this.state;
    // Would need to extend StorageService to handle this
  }
}
