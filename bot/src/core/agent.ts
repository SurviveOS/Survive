import { Config } from '../config';
import { WalletService } from '../services/wallet';
import { JupiterService } from '../services/jupiter';
import { TokenDataService } from '../services/tokenData';
import { StorageService, Trade } from '../utils/storage';
import { Logger } from '../utils/logger';
import { BaseStrategy, TradeSignal } from '../strategies/base';
import { MomentumStrategy } from '../strategies/momentum';
import { ProfitAllocator, OperatingState } from './profitAllocator';
import { RiskManager, RiskCheckResult } from './riskManager';
import { PositionManager, PositionSignal, EnhancedPosition } from './positionManager';
import { v4 as uuidv4 } from 'uuid';

export class SurviveAgent {
  private config: Config;
  private wallet: WalletService;
  private jupiter: JupiterService;
  private tokenData: TokenDataService;
  private storage: StorageService;
  private strategy: BaseStrategy;
  private profitAllocator: ProfitAllocator;
  private riskManager: RiskManager;
  private positionManager: PositionManager;
  private logger: Logger;
  private isRunning: boolean = false;
  
  // Operating state
  private operatingReserve: number = 0;
  private pendingBuyback: number = 0;
  
  // Stats
  private tickCount: number = 0;
  private lastTickTime: Date | null = null;

  constructor(config: Config) {
    this.config = config;
    this.logger = new Logger('Agent');
    
    // Initialize services
    this.wallet = new WalletService(config);
    this.jupiter = new JupiterService(this.wallet);
    this.tokenData = new TokenDataService(config.birdeyeApiKey);
    this.storage = new StorageService();
    
    // Initialize managers
    this.riskManager = new RiskManager(this.storage, config);
    this.positionManager = new PositionManager(this.storage, this.tokenData, config);
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
    this.logger.info('');
    this.logger.info('═'.repeat(60));
    this.logger.info('🦎 SURVIVE Agent Starting');
    this.logger.info('   Goal: Just Fucking Survive');
    this.logger.info('═'.repeat(60));
    this.logger.info('');
    
    // Log wallet info
    await this.wallet.logStatus();
    const balance = await this.wallet.getBalance();
    
    // Initialize risk manager with current balance
    this.riskManager.updatePeakBalance(balance);
    
    // Log current state
    const stats = this.storage.getStats();
    const riskState = this.riskManager.getState();
    const positionSummary = this.positionManager.getSummary();
    
    this.logger.info('');
    this.logger.info('📊 Current State:');
    this.logger.info(`  Balance: ${balance.toFixed(4)} SOL`);
    this.logger.info(`  Total Profit: ${stats.totalProfit.toFixed(4)} SOL`);
    this.logger.info(`  Token Buybacks: ${stats.totalTokenBuybacks.toFixed(4)} SOL`);
    this.logger.info(`  Operating Reserve: ${this.operatingReserve.toFixed(4)} SOL`);
    this.logger.info('');
    this.logger.info('📈 Positions:');
    this.logger.info(`  Active: ${positionSummary.totalPositions}`);
    this.logger.info(`  Exposure: ${positionSummary.totalExposure.toFixed(4)} SOL`);
    this.logger.info('');
    this.logger.info('⚠️  Risk State:');
    this.logger.info(`  Daily P&L: ${riskState.dailyPnL.toFixed(4)} SOL`);
    this.logger.info(`  Consecutive Losses: ${riskState.consecutiveLosses}`);
    this.logger.info(`  Drawdown: ${riskState.currentDrawdown.toFixed(1)}%`);
    this.logger.info(`  Mode: ${this.riskManager.getSuggestedAction()}`);
    this.logger.info('');
    this.logger.info(`$SURVIVE Token: ${this.config.surviveTokenMint || 'Not launched yet'}`);
    this.logger.info('');
    this.logger.info('═'.repeat(60));
    
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
        this.logger.error(error.stack);
      }
      
      // Wait before next tick (30 seconds)
      await this.sleep(30000);
    }
  }

  private async tick(): Promise<void> {
    this.tickCount++;
    this.lastTickTime = new Date();
    
    this.logger.info('');
    this.logger.info(`─── Tick #${this.tickCount} @ ${this.lastTickTime.toISOString()} ───`);
    
    const balance = await this.wallet.getBalance();
    this.riskManager.updatePeakBalance(balance);
    
    // Check risk mode
    const riskMode = this.riskManager.getSuggestedAction();
    if (riskMode === 'stop') {
      this.logger.warn('🛑 STOPPED: Daily loss limit reached. No trading until tomorrow.');
      await this.logStatus();
      return;
    }
    if (riskMode === 'pause') {
      this.logger.warn('⏸️  PAUSED: In cooldown after consecutive losses.');
      // Still check positions for exits
      await this.managePositions();
      await this.logStatus();
      return;
    }

    // 1. Manage existing positions (exits)
    await this.managePositions();

    // 2. Get signals from strategy (new entries)
    if (riskMode !== 'conservative') {
      const signals = await this.strategy.analyze();
      const buySignals = signals.filter(s => s.type === 'buy');
      
      this.logger.info(`Got ${buySignals.length} buy signals`);

      // Execute buy signals
      for (const signal of buySignals) {
        await this.executeBuy(signal, balance);
      }
    } else {
      this.logger.info('⚡ Conservative mode: Skipping new entries');
    }

    // 3. Execute pending buybacks
    await this.executeBuybackIfReady();

    // 4. Log status
    await this.logStatus();
  }

  /**
   * Manage existing positions using PositionManager
   */
  private async managePositions(): Promise<void> {
    const positionSignals = await this.positionManager.checkAllPositions();
    
    for (const signal of positionSignals) {
      if (signal.type === 'full_sell') {
        this.logger.info(`🔴 EXIT: ${signal.position.symbol} - ${signal.reason}`);
        await this.executeSell(signal.position, 100);
      } else if (signal.type === 'partial_sell' && signal.sellPercent) {
        this.logger.info(`🟡 PARTIAL: ${signal.position.symbol} - ${signal.reason}`);
        await this.executePartialSell(signal.position, signal.sellPercent);
      } else if (signal.type === 'hold') {
        this.logger.debug(`⏳ HOLD: ${signal.position.symbol} - ${signal.reason}`);
      }
    }
  }

  /**
   * Execute a buy signal with risk checks
   */
  private async executeBuy(signal: TradeSignal, currentBalance: number): Promise<Trade | null> {
    // Calculate position size with risk adjustment
    const baseAmount = signal.suggestedAmount || this.config.maxTradeSizeSol * 0.2;
    const adjustedAmount = this.riskManager.calculatePositionSize(
      baseAmount,
      currentBalance,
      signal.confidence
    );

    // Risk check
    const riskCheck = this.riskManager.canOpenPosition(adjustedAmount, currentBalance);
    if (!riskCheck.canTrade) {
      this.logger.warn(`❌ Risk blocked: ${riskCheck.reason}`);
      return null;
    }
    if (riskCheck.severity === 'warning') {
      this.logger.warn(`⚠️  Warning: ${riskCheck.reason}`);
    }

    this.logger.info(`🟢 BUY: ${signal.symbol} for ${adjustedAmount.toFixed(3)} SOL`);

    // Execute the trade
    const trade = await this.strategy.executeBuy(signal, adjustedAmount);
    
    if (trade) {
      // Register with position manager
      const tokenInfo = await this.tokenData.getTokenInfo(signal.tokenMint);
      if (tokenInfo) {
        const position = this.storage.getPosition(signal.tokenMint);
        if (position) {
          this.positionManager.addPosition(position, tokenInfo);
        }
      }
      this.logger.info(`✅ Bought ${trade.amount} ${trade.symbol}`);
    }

    return trade;
  }

  /**
   * Execute a full sell
   */
  private async executeSell(position: EnhancedPosition, sellPercent: number): Promise<Trade | null> {
    const signal: TradeSignal = {
      type: 'sell',
      tokenMint: position.tokenMint,
      symbol: position.symbol,
      reason: 'Position exit',
      confidence: 100,
    };

    const trade = await this.strategy.executeSell(signal);
    
    if (trade) {
      // Update risk manager
      this.riskManager.recordTradeResult(trade);
      
      // Remove from position manager
      this.positionManager.removePosition(position.tokenMint);
      
      // Handle profit
      if (trade.profit && trade.profit > 0) {
        await this.handleProfit(trade.profit);
      }

      const emoji = trade.profit && trade.profit > 0 ? '💰' : '📉';
      this.logger.info(
        `${emoji} Sold ${position.symbol}: ${trade.profit?.toFixed(4) || 0} SOL profit`
      );
    }

    return trade;
  }

  /**
   * Execute a partial sell
   */
  private async executePartialSell(position: EnhancedPosition, sellPercent: number): Promise<void> {
    const sellAmount = position.amount * (sellPercent / 100);
    
    this.logger.info(`Partial sell: ${sellPercent}% of ${position.symbol} (${sellAmount} tokens)`);

    // Get current price
    const tokenInfo = await this.tokenData.getTokenInfo(position.tokenMint);
    if (!tokenInfo) {
      this.logger.error('Could not get token info for partial sell');
      return;
    }

    // Execute partial swap
    const result = await this.jupiter.sellForSol(
      position.tokenMint, 
      sellAmount, 
      150
    );

    if (result.success) {
      const solReceived = result.outputAmount / 1e9;
      const profit = solReceived - (position.entrySolValue * (sellPercent / 100));
      
      // Record trade
      const trade: Trade = {
        id: uuidv4(),
        timestamp: new Date(),
        type: 'sell',
        tokenMint: position.tokenMint,
        symbol: position.symbol,
        amount: sellAmount,
        solValue: solReceived,
        price: tokenInfo.price,
        txHash: result.signature!,
        profit,
      };
      this.storage.addTrade(trade);
      this.riskManager.recordTradeResult(trade);
      
      // Update position manager
      this.positionManager.recordPartialSell(
        position.tokenMint, 
        sellAmount, 
        position.entrySolValue * (sellPercent / 100)
      );

      if (profit > 0) {
        await this.handleProfit(profit);
      }

      this.logger.info(`✅ Partial sell complete: ${solReceived.toFixed(4)} SOL`);
    } else {
      this.logger.error(`❌ Partial sell failed: ${result.error}`);
    }
  }

  /**
   * Handle profit with dynamic allocation
   */
  private async handleProfit(profit: number): Promise<void> {
    if (profit <= 0) return;

    this.logger.info(`💰 Profit received: ${profit.toFixed(4)} SOL`);

    const balance = await this.wallet.getBalance();
    
    const state: OperatingState = {
      currentBalance: balance,
      monthlyOperatingCost: this.config.monthlyOperatingCostSol,
      operatingReserve: this.operatingReserve,
      capitalTarget: this.config.capitalTargetSol,
      surviveTokenMint: this.config.surviveTokenMint,
      recentProfitability: this.calculateWinRate(),
    };

    const decision = this.profitAllocator.allocate(profit, state);

    this.operatingReserve += decision.operatingCosts;
    this.pendingBuyback += decision.tokenBuyback;

    this.logger.info(`📊 Allocation: ${decision.reasoning}`);
  }

  /**
   * Calculate recent win rate
   */
  private calculateWinRate(): number {
    const trades = this.storage.getRecentTrades(20);
    const sells = trades.filter(t => t.type === 'sell' && t.profit !== undefined);
    
    if (sells.length === 0) return 0.5;
    
    const wins = sells.filter(t => (t.profit || 0) > 0).length;
    return wins / sells.length;
  }

  /**
   * Execute token buyback when accumulated amount is sufficient
   */
  private async executeBuybackIfReady(): Promise<void> {
    if (!this.config.surviveTokenMint) {
      if (this.pendingBuyback > 0) {
        this.logger.debug(`$SURVIVE not launched - ${this.pendingBuyback.toFixed(4)} SOL pending`);
      }
      return;
    }

    if (this.pendingBuyback < 0.05) {
      return;
    }

    this.logger.info(`🦎 Executing buyback: ${this.pendingBuyback.toFixed(4)} SOL → $SURVIVE`);

    const result = await this.jupiter.buyWithSol(
      this.config.surviveTokenMint,
      this.pendingBuyback,
      200
    );

    if (result.success) {
      const tokenInfo = await this.tokenData.getTokenInfo(this.config.surviveTokenMint);
      
      const trade: Trade = {
        id: uuidv4(),
        timestamp: new Date(),
        type: 'buyback',
        tokenMint: this.config.surviveTokenMint,
        symbol: '$SURVIVE',
        amount: result.outputAmount,
        solValue: this.pendingBuyback,
        price: tokenInfo?.price || 0,
        txHash: result.signature!,
      };
      this.storage.addTrade(trade);
      
      this.logger.info(`✅ Buyback complete: ${result.outputAmount} $SURVIVE`);
      this.pendingBuyback = 0;
    } else {
      this.logger.error(`❌ Buyback failed: ${result.error}`);
    }
  }

  /**
   * Withdraw from operating reserve
   */
  async withdrawOperatingCosts(amount: number, destination: string): Promise<boolean> {
    if (amount > this.operatingReserve) {
      this.logger.error(`Cannot withdraw ${amount} SOL - only ${this.operatingReserve} in reserve`);
      return false;
    }

    this.logger.info(`Withdrawing ${amount} SOL for operating costs to ${destination}`);
    this.operatingReserve -= amount;
    return true;
  }

  private async logStatus(): Promise<void> {
    const balance = await this.wallet.getBalance();
    const stats = this.storage.getStats();
    const riskState = this.riskManager.getState();
    const positions = this.positionManager.getAllPositions();
    
    this.logger.info('');
    this.logger.info(
      `📊 Balance: ${balance.toFixed(4)} SOL | ` +
      `Profit: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(4)} SOL | ` +
      `Positions: ${positions.length}`
    );
    this.logger.info(
      `⚠️  Daily P&L: ${riskState.dailyPnL >= 0 ? '+' : ''}${riskState.dailyPnL.toFixed(4)} SOL | ` +
      `Losses: ${riskState.consecutiveLosses} | ` +
      `Mode: ${this.riskManager.getSuggestedAction()}`
    );

    // Log positions
    if (positions.length > 0) {
      this.logger.info('📈 Positions:');
      for (const pos of positions) {
        const tokenInfo = await this.tokenData.getTokenInfo(pos.tokenMint);
        const currentPrice = tokenInfo?.price || pos.entryPrice;
        const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        
        this.logger.info(
          `   ${pos.symbol}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}% | ` +
          `${pos.status} | ` +
          (pos.trailingStopPrice ? `TS: ${pos.trailingStopPrice.toFixed(6)}` : 'No TS')
        );
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Set token address
   */
  setTokenMint(mintAddress: string): void {
    this.logger.info(`🦎 $SURVIVE token set: ${mintAddress}`);
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
      riskState: this.riskManager.getState(),
      riskLimits: this.riskManager.getLimits(),
      positions: this.positionManager.getAllPositions(),
      ...this.storage.exportForDashboard(),
    };
  }

  /**
   * Emergency stop
   */
  async emergencyExit(): Promise<void> {
    this.logger.warn('🚨 EMERGENCY EXIT TRIGGERED');
    
    const signals = this.positionManager.getEmergencyExitSignals();
    for (const signal of signals) {
      await this.executeSell(signal.position, 100);
    }
    
    this.isRunning = false;
    this.logger.warn('All positions closed. Agent stopped.');
  }

  /**
   * Clear cooldown (admin)
   */
  clearCooldown(): void {
    this.riskManager.clearCooldown();
    this.logger.info('Cooldown cleared by admin');
  }
}
