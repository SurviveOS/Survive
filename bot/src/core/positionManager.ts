import { Logger } from '../utils/logger';
import { StorageService, Position, Trade } from '../utils/storage';
import { TokenDataService, TokenInfo } from '../services/tokenData';
import { PriceStreamService, PriceUpdate } from '../services/priceStream';
import { Config } from '../config';

export interface PositionConfig {
  // Stop Loss
  stopLossPercent: number;         // Initial stop loss %
  trailingStopPercent: number;     // Trailing stop % (from high)
  trailingActivationPercent: number; // Activate trailing after this gain
  
  // Take Profit
  takeProfitPercent: number;       // Full exit target
  partialTakePercent: number;      // Partial take profit level
  partialTakeSize: number;         // % of position to sell at partial take
  
  // Time-based
  maxHoldTimeHours: number;        // Force exit after this time
  minHoldTimeMinutes: number;      // Don't sell before this (avoid wash)
  
  // Price action
  exitOnVolumeDropPercent: number; // Exit if volume drops this much
}

export interface EnhancedPosition extends Position {
  highestPrice: number;           // Highest price since entry
  lowestPrice: number;            // Lowest price since entry
  trailingStopPrice: number | null; // Current trailing stop price
  partialTakeDone: boolean;       // Whether partial take was executed
  lastChecked: Date;              // Last time we checked this position
  checkCount: number;             // Number of times checked
  status: 'active' | 'trailing' | 'exiting';
}

export interface PositionSignal {
  type: 'hold' | 'partial_sell' | 'full_sell';
  position: EnhancedPosition;
  reason: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  sellPercent?: number;           // What % of position to sell
}

/**
 * Position Manager
 * 
 * Advanced position management with:
 * - Trailing stop losses
 * - Partial profit taking
 * - Time-based exits
 * - Dynamic stop adjustment
 */
export class PositionManager {
  private logger: Logger;
  private storage: StorageService;
  private tokenData: TokenDataService;
  private priceStream: PriceStreamService | null;
  private config: PositionConfig;
  private positions: Map<string, EnhancedPosition>;
  private streamPrices: Map<string, number>; // Real-time prices from stream

  constructor(
    storage: StorageService,
    tokenData: TokenDataService,
    tradingConfig: Config,
    priceStream?: PriceStreamService,
    customConfig?: Partial<PositionConfig>
  ) {
    this.logger = new Logger('PositionManager');
    this.storage = storage;
    this.tokenData = tokenData;
    this.priceStream = priceStream || null;
    this.streamPrices = new Map();
    
    // Default position management config
    this.config = {
      stopLossPercent: tradingConfig.stopLossPercent || 20,
      trailingStopPercent: 15,           // 15% trailing stop
      trailingActivationPercent: 30,     // Activate after 30% gain
      takeProfitPercent: tradingConfig.takeProfitPercent || 100,
      partialTakePercent: 50,            // Take partial at 50%
      partialTakeSize: 50,               // Sell 50% of position
      maxHoldTimeHours: 24,              // Max 24h hold
      minHoldTimeMinutes: 5,             // Min 5 min hold
      exitOnVolumeDropPercent: 70,       // Exit if volume drops 70%
      ...customConfig,
    };

    this.positions = new Map();
    this.loadPositions();
    
    // Subscribe to price stream for existing positions
    if (this.priceStream) {
      this.setupPriceStreamListeners();
    }
    
    this.logger.info('Position Manager initialized');
  }

  /**
   * Setup price stream listeners for real-time updates
   */
  private setupPriceStreamListeners(): void {
    if (!this.priceStream) return;

    // Listen for price updates
    this.priceStream.on('price', (update: PriceUpdate) => {
      this.handlePriceUpdate(update);
    });

    // Subscribe to all existing positions
    for (const [mint, position] of this.positions) {
      this.priceStream.subscribe(mint, (update) => {
        this.streamPrices.set(mint, update.price);
      });
      this.logger.info(`Subscribed to price stream for ${position.symbol}`);
    }
  }

  /**
   * Handle real-time price update
   */
  private handlePriceUpdate(update: PriceUpdate): void {
    const position = this.positions.get(update.address);
    if (!position) return;

    this.streamPrices.set(update.address, update.price);
    
    // Update high/low
    if (update.price > position.highestPrice) {
      position.highestPrice = update.price;
    }
    if (update.price < position.lowestPrice) {
      position.lowestPrice = update.price;
    }

    // Update trailing stop
    this.updateTrailingStopFromStream(position, update.price);

    // Check for urgent exits (stop loss hit)
    const pnlPercent = ((update.price - position.entryPrice) / position.entryPrice) * 100;
    
    if (pnlPercent <= -this.config.stopLossPercent) {
      this.logger.warn(`🚨 STOP LOSS HIT: ${position.symbol} at ${pnlPercent.toFixed(1)}%`);
      // Emit urgent exit signal
      this.emit('urgent_exit', {
        position,
        reason: `Stop loss hit: ${pnlPercent.toFixed(1)}%`,
        price: update.price,
      });
    }

    if (position.trailingStopPrice && update.price <= position.trailingStopPrice) {
      this.logger.warn(`🚨 TRAILING STOP HIT: ${position.symbol}`);
      this.emit('urgent_exit', {
        position,
        reason: 'Trailing stop hit',
        price: update.price,
      });
    }
  }

  /**
   * Emit events (simple implementation)
   */
  private eventListeners: Map<string, Function[]> = new Map();
  
  on(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(callback);
    this.eventListeners.set(event, listeners);
  }

  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event) || [];
    for (const listener of listeners) {
      try {
        listener(data);
      } catch (e) {
        this.logger.error(`Event listener error: ${e}`);
      }
    }
  }

  /**
   * Update trailing stop from stream price
   */
  private updateTrailingStopFromStream(position: EnhancedPosition, currentPrice: number): void {
    const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    if (pnlPercent >= this.config.trailingActivationPercent) {
      const newTrailingStop = position.highestPrice * (1 - this.config.trailingStopPercent / 100);
      
      if (!position.trailingStopPrice || newTrailingStop > position.trailingStopPrice) {
        position.trailingStopPrice = newTrailingStop;
        position.status = 'trailing';
        this.logger.debug(
          `${position.symbol} trailing stop: ${newTrailingStop.toFixed(6)}`
        );
      }
    }
  }

  /**
   * Get real-time price (stream first, then API fallback)
   */
  private async getPrice(tokenMint: string): Promise<number | null> {
    // Try stream price first (faster)
    const streamPrice = this.streamPrices.get(tokenMint);
    if (streamPrice) {
      return streamPrice;
    }

    // Fallback to API
    const tokenInfo = await this.tokenData.getTokenInfo(tokenMint);
    return tokenInfo?.price || null;
  }

  /**
   * Register a new position
   */
  addPosition(position: Position, tokenInfo: TokenInfo): EnhancedPosition {
    const enhanced: EnhancedPosition = {
      ...position,
      highestPrice: position.entryPrice,
      lowestPrice: position.entryPrice,
      trailingStopPrice: null,
      partialTakeDone: false,
      lastChecked: new Date(),
      checkCount: 0,
      status: 'active',
    };

    this.positions.set(position.tokenMint, enhanced);
    
    // Subscribe to price stream for real-time monitoring
    if (this.priceStream) {
      this.priceStream.subscribe(position.tokenMint, (update) => {
        this.streamPrices.set(position.tokenMint, update.price);
      });
      this.logger.info(`Position added: ${position.symbol} @ ${position.entryPrice} (streaming)`);
    } else {
      this.logger.info(`Position added: ${position.symbol} @ ${position.entryPrice}`);
    }
    
    return enhanced;
  }

  /**
   * Check all positions and return signals
   */
  async checkAllPositions(): Promise<PositionSignal[]> {
    const signals: PositionSignal[] = [];

    for (const [mint, position] of this.positions) {
      // Try stream price first, fall back to API
      let currentPrice = this.streamPrices.get(mint);
      let tokenInfo: TokenInfo | null = null;
      
      if (!currentPrice) {
        tokenInfo = await this.tokenData.getTokenInfo(mint);
        if (!tokenInfo) {
          this.logger.warn(`Could not get price for ${position.symbol}`);
          continue;
        }
        currentPrice = tokenInfo.price;
      }

      const signal = this.evaluatePositionWithPrice(position, currentPrice);
      signals.push(signal);

      // Update position tracking
      position.lastChecked = new Date();
      position.checkCount++;
      
      // Update high/low (also updated in stream handler)
      if (currentPrice > position.highestPrice) {
        position.highestPrice = currentPrice;
        this.logger.debug(`${position.symbol} new high: ${currentPrice}`);
      }
      if (currentPrice < position.lowestPrice) {
        position.lowestPrice = currentPrice;
      }

      // Update trailing stop if activated
      if (tokenInfo) {
        this.updateTrailingStop(position, tokenInfo);
      }
    }

    return signals;
  }

  /**
   * Evaluate position with just price (for stream updates)
   */
  private evaluatePositionWithPrice(position: EnhancedPosition, currentPrice: number): PositionSignal {
    // Create a minimal TokenInfo for evaluation
    const tokenInfo: TokenInfo = {
      address: position.tokenMint,
      symbol: position.symbol,
      name: position.symbol,
      decimals: 9,
      price: currentPrice,
      priceChange24h: 0,
      volume24h: 0,
      liquidity: 0,
      marketCap: 0,
    };
    return this.evaluatePosition(position, tokenInfo);
  }

  /**
   * Evaluate a single position
   */
  private evaluatePosition(position: EnhancedPosition, tokenInfo: TokenInfo): PositionSignal {
    const currentPrice = tokenInfo.price;
    const entryPrice = position.entryPrice;
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const holdTimeMs = Date.now() - position.entryTimestamp.getTime();
    const holdTimeHours = holdTimeMs / (1000 * 60 * 60);
    const holdTimeMinutes = holdTimeMs / (1000 * 60);

    // === CRITICAL: Hard Stop Loss ===
    if (pnlPercent <= -this.config.stopLossPercent) {
      return {
        type: 'full_sell',
        position,
        reason: `Stop loss hit: ${pnlPercent.toFixed(1)}%`,
        urgency: 'critical',
        sellPercent: 100,
      };
    }

    // === CRITICAL: Trailing Stop Hit ===
    if (position.trailingStopPrice && currentPrice <= position.trailingStopPrice) {
      return {
        type: 'full_sell',
        position,
        reason: `Trailing stop hit: ${currentPrice} <= ${position.trailingStopPrice.toFixed(6)}`,
        urgency: 'critical',
        sellPercent: 100,
      };
    }

    // === HIGH: Take Profit Target ===
    if (pnlPercent >= this.config.takeProfitPercent) {
      return {
        type: 'full_sell',
        position,
        reason: `Take profit target hit: +${pnlPercent.toFixed(1)}%`,
        urgency: 'high',
        sellPercent: 100,
      };
    }

    // === MEDIUM: Partial Take Profit ===
    if (
      !position.partialTakeDone &&
      pnlPercent >= this.config.partialTakePercent
    ) {
      position.partialTakeDone = true; // Mark it
      return {
        type: 'partial_sell',
        position,
        reason: `Partial take profit: +${pnlPercent.toFixed(1)}%`,
        urgency: 'medium',
        sellPercent: this.config.partialTakeSize,
      };
    }

    // === MEDIUM: Max Hold Time ===
    if (holdTimeHours >= this.config.maxHoldTimeHours) {
      return {
        type: 'full_sell',
        position,
        reason: `Max hold time exceeded: ${holdTimeHours.toFixed(1)}h`,
        urgency: 'medium',
        sellPercent: 100,
      };
    }

    // === LOW: Min Hold Time Not Met ===
    if (holdTimeMinutes < this.config.minHoldTimeMinutes) {
      return {
        type: 'hold',
        position,
        reason: `Min hold time not met: ${holdTimeMinutes.toFixed(1)}m / ${this.config.minHoldTimeMinutes}m`,
        urgency: 'low',
      };
    }

    // === MEDIUM: Volume Drop Check ===
    // If volume dropped significantly, might want to exit
    // (This would need baseline volume from entry - simplified here)

    // === Default: Hold ===
    const status = position.trailingStopPrice ? 'trailing' : 'active';
    position.status = status;
    
    return {
      type: 'hold',
      position,
      reason: `Holding: PnL ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% | ${holdTimeMinutes.toFixed(0)}m | ${status}`,
      urgency: 'low',
    };
  }

  /**
   * Update trailing stop if conditions met
   */
  private updateTrailingStop(position: EnhancedPosition, tokenInfo: TokenInfo): void {
    const currentPrice = tokenInfo.price;
    const entryPrice = position.entryPrice;
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // Activate trailing stop after threshold gain
    if (pnlPercent >= this.config.trailingActivationPercent) {
      const newTrailingStop = position.highestPrice * (1 - this.config.trailingStopPercent / 100);
      
      // Only update if it raises the stop
      if (!position.trailingStopPrice || newTrailingStop > position.trailingStopPrice) {
        position.trailingStopPrice = newTrailingStop;
        position.status = 'trailing';
        this.logger.info(
          `${position.symbol} trailing stop updated: ${newTrailingStop.toFixed(6)} ` +
          `(high: ${position.highestPrice.toFixed(6)}, current: ${currentPrice.toFixed(6)})`
        );
      }
    }
  }

  /**
   * Record partial sell (reduce position)
   */
  recordPartialSell(tokenMint: string, soldAmount: number, soldValue: number): void {
    const position = this.positions.get(tokenMint);
    if (!position) return;

    position.amount -= soldAmount;
    position.entrySolValue -= soldValue;
    
    this.logger.info(`Partial sell recorded for ${position.symbol}: ${soldAmount} tokens`);
  }

  /**
   * Remove position after full exit
   */
  removePosition(tokenMint: string): EnhancedPosition | null {
    const position = this.positions.get(tokenMint);
    if (!position) return null;

    this.positions.delete(tokenMint);
    this.streamPrices.delete(tokenMint);
    
    // Unsubscribe from price stream
    if (this.priceStream) {
      this.priceStream.unsubscribe(tokenMint);
    }
    
    this.logger.info(`Position removed: ${position.symbol}`);
    
    return position;
  }

  /**
   * Get position by mint
   */
  getPosition(tokenMint: string): EnhancedPosition | null {
    return this.positions.get(tokenMint) || null;
  }

  /**
   * Get all positions
   */
  getAllPositions(): EnhancedPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position summary
   */
  getSummary(): {
    totalPositions: number;
    totalExposure: number;
    avgPnlPercent: number;
    positionsInProfit: number;
    positionsInLoss: number;
  } {
    const positions = this.getAllPositions();
    let totalExposure = 0;
    let totalPnlPercent = 0;
    let inProfit = 0;
    let inLoss = 0;

    for (const pos of positions) {
      totalExposure += pos.entrySolValue;
      // Note: Would need current prices for accurate PnL
      // This is a simplified version
    }

    return {
      totalPositions: positions.length,
      totalExposure,
      avgPnlPercent: positions.length > 0 ? totalPnlPercent / positions.length : 0,
      positionsInProfit: inProfit,
      positionsInLoss: inLoss,
    };
  }

  /**
   * Adjust stops for all positions (e.g., tighten in volatile market)
   */
  tightenStops(multiplier: number = 0.8): void {
    for (const position of this.positions.values()) {
      if (position.trailingStopPrice) {
        const currentStop = position.trailingStopPrice;
        const entryPrice = position.entryPrice;
        const gap = currentStop - entryPrice;
        position.trailingStopPrice = entryPrice + (gap * multiplier);
        this.logger.info(`Tightened stop for ${position.symbol}: ${position.trailingStopPrice.toFixed(6)}`);
      }
    }
  }

  /**
   * Force close all positions (emergency)
   */
  getEmergencyExitSignals(): PositionSignal[] {
    return Array.from(this.positions.values()).map(position => ({
      type: 'full_sell' as const,
      position,
      reason: 'Emergency exit triggered',
      urgency: 'critical' as const,
      sellPercent: 100,
    }));
  }

  // Private methods

  private loadPositions(): void {
    // Load existing positions from storage and enhance them
    const storedPositions = this.storage.getState().positions;
    
    for (const pos of storedPositions) {
      const enhanced: EnhancedPosition = {
        ...pos,
        highestPrice: pos.entryPrice,
        lowestPrice: pos.entryPrice,
        trailingStopPrice: null,
        partialTakeDone: false,
        lastChecked: new Date(),
        checkCount: 0,
        status: 'active',
      };
      this.positions.set(pos.tokenMint, enhanced);
    }
    
    if (storedPositions.length > 0) {
      this.logger.info(`Loaded ${storedPositions.length} existing positions`);
    }
  }
}
