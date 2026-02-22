import { Logger } from '../utils/logger';
import { StorageService, Position, Trade } from '../utils/storage';
import { TokenDataService, TokenInfo } from '../services/tokenData';
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
  private config: PositionConfig;
  private positions: Map<string, EnhancedPosition>;

  constructor(
    storage: StorageService,
    tokenData: TokenDataService,
    tradingConfig: Config,
    customConfig?: Partial<PositionConfig>
  ) {
    this.logger = new Logger('PositionManager');
    this.storage = storage;
    this.tokenData = tokenData;
    
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
    
    this.logger.info('Position Manager initialized');
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
    this.logger.info(`Position added: ${position.symbol} @ ${position.entryPrice}`);
    
    return enhanced;
  }

  /**
   * Check all positions and return signals
   */
  async checkAllPositions(): Promise<PositionSignal[]> {
    const signals: PositionSignal[] = [];

    for (const [mint, position] of this.positions) {
      const tokenInfo = await this.tokenData.getTokenInfo(mint);
      if (!tokenInfo) {
        this.logger.warn(`Could not get price for ${position.symbol}`);
        continue;
      }

      const signal = this.evaluatePosition(position, tokenInfo);
      signals.push(signal);

      // Update position tracking
      position.lastChecked = new Date();
      position.checkCount++;
      
      // Update high/low
      if (tokenInfo.price > position.highestPrice) {
        position.highestPrice = tokenInfo.price;
        this.logger.debug(`${position.symbol} new high: ${tokenInfo.price}`);
      }
      if (tokenInfo.price < position.lowestPrice) {
        position.lowestPrice = tokenInfo.price;
      }

      // Update trailing stop if activated
      this.updateTrailingStop(position, tokenInfo);
    }

    return signals;
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
