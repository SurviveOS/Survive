import { Logger } from '../utils/logger';
import { StorageService, Trade, Position } from '../utils/storage';
import { Config } from '../config';

export interface RiskLimits {
  maxDailyLossSol: number;       // Max SOL to lose per day
  maxDrawdownPercent: number;    // Max drawdown from peak
  maxExposurePercent: number;    // Max % of balance in positions
  maxSinglePositionPercent: number; // Max % of balance per position
  cooldownAfterLossesMs: number; // Cooldown after consecutive losses
  maxConsecutiveLosses: number;  // Trigger cooldown after this many
  minTimeBetweenTradesMs: number; // Minimum time between trades
}

export interface RiskState {
  dailyPnL: number;
  peakBalance: number;
  currentDrawdown: number;
  consecutiveLosses: number;
  lastTradeTimestamp: Date | null;
  cooldownUntil: Date | null;
  totalExposure: number;
}

export interface RiskCheckResult {
  canTrade: boolean;
  reason: string;
  severity: 'ok' | 'warning' | 'blocked';
}

/**
 * Risk Manager
 * 
 * Protects the agent from blowing up:
 * - Daily loss limits
 * - Maximum drawdown protection
 * - Position exposure limits
 * - Cooldown after consecutive losses
 * - Rate limiting
 */
export class RiskManager {
  private logger: Logger;
  private storage: StorageService;
  private config: Config;
  private limits: RiskLimits;
  private state: RiskState;
  private dailyResetDate: string;

  constructor(storage: StorageService, config: Config, customLimits?: Partial<RiskLimits>) {
    this.logger = new Logger('RiskManager');
    this.storage = storage;
    this.config = config;
    
    // Default limits (conservative for survival)
    this.limits = {
      maxDailyLossSol: config.initialCapitalSol * 0.1,  // 10% of capital per day
      maxDrawdownPercent: 25,                           // 25% max drawdown
      maxExposurePercent: 60,                           // 60% max in positions
      maxSinglePositionPercent: 20,                     // 20% max per position
      cooldownAfterLossesMs: 30 * 60 * 1000,           // 30 min cooldown
      maxConsecutiveLosses: 3,                          // After 3 losses
      minTimeBetweenTradesMs: 60 * 1000,               // 1 min between trades
      ...customLimits,
    };

    this.state = this.loadState();
    this.dailyResetDate = this.getTodayString();
    
    this.logger.info('Risk Manager initialized');
    this.logLimits();
  }

  /**
   * Check if a new trade is allowed
   */
  canOpenPosition(solAmount: number, currentBalance: number): RiskCheckResult {
    // Reset daily stats if new day
    this.checkDailyReset();

    // Check cooldown
    if (this.state.cooldownUntil && new Date() < this.state.cooldownUntil) {
      const remaining = Math.ceil((this.state.cooldownUntil.getTime() - Date.now()) / 60000);
      return {
        canTrade: false,
        reason: `In cooldown (${remaining} min remaining) after ${this.state.consecutiveLosses} consecutive losses`,
        severity: 'blocked',
      };
    }

    // Check daily loss limit
    if (this.state.dailyPnL <= -this.limits.maxDailyLossSol) {
      return {
        canTrade: false,
        reason: `Daily loss limit hit (${this.state.dailyPnL.toFixed(4)} SOL)`,
        severity: 'blocked',
      };
    }

    // Check drawdown
    const currentDrawdown = this.calculateDrawdown(currentBalance);
    if (currentDrawdown >= this.limits.maxDrawdownPercent) {
      return {
        canTrade: false,
        reason: `Max drawdown hit (${currentDrawdown.toFixed(1)}%)`,
        severity: 'blocked',
      };
    }

    // Check total exposure
    const positions = this.storage.getState().positions;
    const currentExposure = positions.reduce((sum, p) => sum + p.entrySolValue, 0);
    const exposurePercent = (currentExposure / currentBalance) * 100;
    
    if (exposurePercent >= this.limits.maxExposurePercent) {
      return {
        canTrade: false,
        reason: `Max exposure reached (${exposurePercent.toFixed(1)}%)`,
        severity: 'blocked',
      };
    }

    // Check single position size
    const positionPercent = (solAmount / currentBalance) * 100;
    if (positionPercent > this.limits.maxSinglePositionPercent) {
      return {
        canTrade: false,
        reason: `Position too large (${positionPercent.toFixed(1)}% > ${this.limits.maxSinglePositionPercent}% max)`,
        severity: 'blocked',
      };
    }

    // Check rate limiting
    if (this.state.lastTradeTimestamp) {
      const timeSinceLast = Date.now() - this.state.lastTradeTimestamp.getTime();
      if (timeSinceLast < this.limits.minTimeBetweenTradesMs) {
        const waitSec = Math.ceil((this.limits.minTimeBetweenTradesMs - timeSinceLast) / 1000);
        return {
          canTrade: false,
          reason: `Rate limit: wait ${waitSec}s`,
          severity: 'warning',
        };
      }
    }

    // Warning if approaching limits
    if (this.state.dailyPnL <= -this.limits.maxDailyLossSol * 0.7) {
      return {
        canTrade: true,
        reason: `Warning: Approaching daily loss limit (${this.state.dailyPnL.toFixed(4)} SOL)`,
        severity: 'warning',
      };
    }

    return {
      canTrade: true,
      reason: 'Risk checks passed',
      severity: 'ok',
    };
  }

  /**
   * Record trade result and update state
   */
  recordTradeResult(trade: Trade): void {
    this.checkDailyReset();

    if (trade.type === 'sell' && trade.profit !== undefined) {
      this.state.dailyPnL += trade.profit;
      
      if (trade.profit < 0) {
        this.state.consecutiveLosses++;
        this.logger.warn(`Loss recorded: ${trade.profit.toFixed(4)} SOL (${this.state.consecutiveLosses} consecutive)`);
        
        // Trigger cooldown if too many consecutive losses
        if (this.state.consecutiveLosses >= this.limits.maxConsecutiveLosses) {
          this.state.cooldownUntil = new Date(Date.now() + this.limits.cooldownAfterLossesMs);
          this.logger.warn(`Cooldown activated until ${this.state.cooldownUntil.toISOString()}`);
        }
      } else {
        // Reset consecutive losses on win
        if (this.state.consecutiveLosses > 0) {
          this.logger.info(`Win! Resetting consecutive loss counter (was ${this.state.consecutiveLosses})`);
        }
        this.state.consecutiveLosses = 0;
      }
    }

    this.state.lastTradeTimestamp = new Date();
    this.saveState();
  }

  /**
   * Update peak balance for drawdown calculation
   */
  updatePeakBalance(currentBalance: number): void {
    if (currentBalance > this.state.peakBalance) {
      this.state.peakBalance = currentBalance;
      this.saveState();
    }
    this.state.currentDrawdown = this.calculateDrawdown(currentBalance);
  }

  /**
   * Calculate position size based on risk
   */
  calculatePositionSize(
    baseAmount: number,
    currentBalance: number,
    confidence: number
  ): number {
    // Start with base amount
    let size = baseAmount;

    // Scale by confidence (60-100% maps to 0.5-1.0x)
    const confidenceMultiplier = 0.5 + (confidence / 100) * 0.5;
    size *= confidenceMultiplier;

    // Reduce size after losses
    if (this.state.consecutiveLosses > 0) {
      const lossMultiplier = Math.max(0.3, 1 - (this.state.consecutiveLosses * 0.2));
      size *= lossMultiplier;
      this.logger.info(`Reduced position size due to ${this.state.consecutiveLosses} consecutive losses`);
    }

    // Reduce size in drawdown
    if (this.state.currentDrawdown > 10) {
      const drawdownMultiplier = Math.max(0.5, 1 - (this.state.currentDrawdown / 100));
      size *= drawdownMultiplier;
    }

    // Cap at max single position
    const maxSize = currentBalance * (this.limits.maxSinglePositionPercent / 100);
    size = Math.min(size, maxSize);

    // Floor at minimum viable trade (0.01 SOL)
    size = Math.max(size, 0.01);

    return size;
  }

  /**
   * Get suggested action based on risk state
   */
  getSuggestedAction(): 'normal' | 'conservative' | 'pause' | 'stop' {
    if (this.state.dailyPnL <= -this.limits.maxDailyLossSol) {
      return 'stop';
    }
    if (this.state.cooldownUntil && new Date() < this.state.cooldownUntil) {
      return 'pause';
    }
    if (this.state.consecutiveLosses >= 2 || this.state.currentDrawdown > 15) {
      return 'conservative';
    }
    return 'normal';
  }

  /**
   * Get risk state summary
   */
  getState(): RiskState {
    return { ...this.state };
  }

  /**
   * Get current limits
   */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  /**
   * Manually clear cooldown (admin override)
   */
  clearCooldown(): void {
    this.state.cooldownUntil = null;
    this.state.consecutiveLosses = 0;
    this.saveState();
    this.logger.info('Cooldown cleared manually');
  }

  // Private methods

  private calculateDrawdown(currentBalance: number): number {
    if (this.state.peakBalance === 0) return 0;
    return ((this.state.peakBalance - currentBalance) / this.state.peakBalance) * 100;
  }

  private checkDailyReset(): void {
    const today = this.getTodayString();
    if (today !== this.dailyResetDate) {
      this.logger.info(`New day detected, resetting daily stats`);
      this.state.dailyPnL = 0;
      this.dailyResetDate = today;
      this.saveState();
    }
  }

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private loadState(): RiskState {
    // In a real implementation, this would load from storage
    // For now, return default state
    return {
      dailyPnL: 0,
      peakBalance: this.config.initialCapitalSol,
      currentDrawdown: 0,
      consecutiveLosses: 0,
      lastTradeTimestamp: null,
      cooldownUntil: null,
      totalExposure: 0,
    };
  }

  private saveState(): void {
    // In a real implementation, persist to storage
    // For now, state is in-memory only
  }

  private logLimits(): void {
    this.logger.info('Risk Limits:');
    this.logger.info(`  Max Daily Loss: ${this.limits.maxDailyLossSol} SOL`);
    this.logger.info(`  Max Drawdown: ${this.limits.maxDrawdownPercent}%`);
    this.logger.info(`  Max Exposure: ${this.limits.maxExposurePercent}%`);
    this.logger.info(`  Max Position: ${this.limits.maxSinglePositionPercent}%`);
    this.logger.info(`  Cooldown After: ${this.limits.maxConsecutiveLosses} losses`);
  }
}
