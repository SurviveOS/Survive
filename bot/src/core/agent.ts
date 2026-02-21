import { Config } from '../config';
import { WalletService } from '../services/wallet';
import { JupiterService } from '../services/jupiter';
import { TokenDataService } from '../services/tokenData';
import { StorageService, Trade } from '../utils/storage';
import { Logger } from '../utils/logger';
import { BaseStrategy, TradeSignal } from '../strategies/base';
import { MomentumStrategy } from '../strategies/momentum';
import { ProfitAllocator, OperatingState } from './profitAllocator';
import { v4 as uuidv4 } from 'uuid';

export class SurviveAgent {
  private config: Config;
  private wallet: WalletService;
  private jupiter: JupiterService;
  private tokenData: TokenDataService;
  private storage: StorageService;
  private strategy: BaseStrategy;
  private profitAllocator: ProfitAllocator;
  private logger: Logger;
  private isRunning: boolean = false;
  
  // Operating state
  private operatingReserve: number = 0;
  private pendingBuyback: number = 0;

  constructor(config: Config) {
    this.config = config;
    this.logger = new Logger('Agent');
    
    // Initialize services
    this.wallet = new WalletService(config);
    this.jupiter = new JupiterService(this.wallet);
    this.tokenData = new TokenDataService(config.birdeyeApiKey);
    this.storage = new StorageService();
    this.profitAllocator = new ProfitAllocator(this.storage);
    
    // Initialize strategy
    this.strategy = new MomentumStrategy(
      this.wallet,
      this.jupiter,
      this.tokenData,
      this.storage,
      config
    );
  }

  async start(): Promise<void> {
    this.logger.info('='.repeat(50));
    this.logger.info('🦎 SURVIVE Agent Starting');
    this.logger.info('   Goal: Just Fucking Survive');
    this.logger.info('='.repeat(50));
    
    await this.wallet.logStatus();
    
    const stats = this.storage.getStats();
    this.logger.info('');
    this.logger.info('Current State:');
    this.logger.info(`  Total Profit: ${stats.totalProfit.toFixed(4)} SOL`);
    this.logger.info(`  Token Buybacks: ${stats.totalTokenBuybacks.toFixed(4)} SOL`);
    this.logger.info(`  Operating Reserve: ${this.operatingReserve.toFixed(4)} SOL`);
    this.logger.info(`  Active Positions: ${stats.activePositions}`);
    this.logger.info('');
    this.logger.info(`$SURVIVEIVE Token: ${this.config.surviveTokenMint || 'Not launched yet'}`);
    this.logger.info('');
    
    this.isRunning = true;
    this.runLoop();
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping agent...');
    this.isRunning = false;
  }

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.tick();
      } catch (error: any) {
        this.logger.error(`Tick error: ${error.message}`);
      }
      
      // Wait before next tick (30 seconds)
      await this.sleep(30000);
    }
  }

  private async tick(): Promise<void> {
    this.logger.info('--- Tick ---');
    
    // Get signals from strategy
    const signals = await this.strategy.analyze();
    this.logger.info(`Got ${signals.length} signals`);

    // Execute signals
    for (const signal of signals) {
      if (signal.type === 'sell') {
        const trade = await this.strategy.executeSell(signal);
        if (trade && trade.profit && trade.profit > 0) {
          await this.handleProfit(trade.profit);
        }
      } else if (signal.type === 'buy') {
        const amount = signal.suggestedAmount || this.config.maxTradeSizeSol * 0.2;
        await this.strategy.executeBuy(signal, amount);
      }
    }

    // Execute pending buybacks
    await this.executeBuybackIfReady();

    // Log status
    await this.logStatus();
  }

  /**
   * Handle profit with dynamic allocation
   * The agent DECIDES how to split based on survival needs
   */
  private async handleProfit(profit: number): Promise<void> {
    if (profit <= 0) return;

    this.logger.info(`💰 Profit received: ${profit.toFixed(4)} SOL`);

    // Get current state for decision making
    const balance = await this.wallet.getBalance();
    const stats = this.storage.getStats();
    
    const state: OperatingState = {
      currentBalance: balance,
      monthlyOperatingCost: this.config.monthlyOperatingCostSol,
      operatingReserve: this.operatingReserve,
      capitalTarget: this.config.capitalTargetSol,
      surviveTokenMint: this.config.surviveTokenMint,
      recentProfitability: this.calculateWinRate(),
    };

    // Let the agent decide allocation
    const decision = this.profitAllocator.allocate(profit, state);

    // Apply the decision
    this.operatingReserve += decision.operatingCosts;
    // Reinvest stays in wallet (no action needed)
    this.pendingBuyback += decision.tokenBuyback;

    this.logger.info(`Decision applied: ${decision.reasoning}`);
  }

  /**
   * Calculate recent win rate
   */
  private calculateWinRate(): number {
    const trades = this.storage.getRecentTrades(20);
    const sells = trades.filter(t => t.type === 'sell' && t.profit !== undefined);
    
    if (sells.length === 0) return 0.5; // Default
    
    const wins = sells.filter(t => (t.profit || 0) > 0).length;
    return wins / sells.length;
  }

  /**
   * Execute token buyback when accumulated amount is sufficient
   */
  private async executeBuybackIfReady(): Promise<void> {
    if (!this.config.surviveTokenMint) {
      this.logger.debug('$SURVIVEIVE token not launched yet, holding buyback funds');
      return;
    }

    if (this.pendingBuyback < 0.05) {
      return;
    }

    this.logger.info(`🦎 Executing buyback: ${this.pendingBuyback.toFixed(4)} SOL → $SURVIVEIVE`);

    const result = await this.jupiter.buyWithSol(
      this.config.surviveTokenMint,
      this.pendingBuyback,
      200 // 2% slippage
    );

    if (result.success) {
      const tokenInfo = await this.tokenData.getTokenInfo(this.config.surviveTokenMint);
      
      const trade: Trade = {
        id: uuidv4(),
        timestamp: new Date(),
        type: 'buyback',
        tokenMint: this.config.surviveTokenMint,
        symbol: '$SURVIVEIVE',
        amount: result.outputAmount,
        solValue: this.pendingBuyback,
        price: tokenInfo?.price || 0,
        txHash: result.signature!,
      };
      this.storage.addTrade(trade);
      
      this.logger.info(`✅ Buyback complete: ${result.outputAmount} $SURVIVEIVE`);
      this.pendingBuyback = 0;
    } else {
      this.logger.error(`❌ Buyback failed: ${result.error}`);
    }
  }

  /**
   * Withdraw from operating reserve (for paying bills)
   */
  async withdrawOperatingCosts(amount: number, destination: string): Promise<boolean> {
    if (amount > this.operatingReserve) {
      this.logger.error(`Cannot withdraw ${amount} SOL - only ${this.operatingReserve} in reserve`);
      return false;
    }

    // Implement actual transfer here
    this.logger.info(`Withdrawing ${amount} SOL for operating costs to ${destination}`);
    this.operatingReserve -= amount;
    return true;
  }

  private async logStatus(): Promise<void> {
    const balance = await this.wallet.getBalance();
    const stats = this.storage.getStats();
    
    this.logger.info(
      `Balance: ${balance.toFixed(4)} SOL | ` +
      `Profit: ${stats.totalProfit.toFixed(4)} SOL | ` +
      `Reserve: ${this.operatingReserve.toFixed(4)} SOL | ` +
      `Positions: ${stats.activePositions}`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Set token address (called by dev after deploying $SURVIVEIVE)
   */
  setTokenMint(mintAddress: string): void {
    this.logger.info(`🦎 $SURVIVEIVE token set: ${mintAddress}`);
    // This would need to update config/env - for now just log
  }

  /**
   * Export data for dashboard
   */
  getDashboardData() {
    return {
      wallet: this.wallet.address,
      surviveToken: this.config.surviveTokenMint,
      operatingReserve: this.operatingReserve,
      pendingBuyback: this.pendingBuyback,
      ...this.storage.exportForDashboard(),
    };
  }
}
