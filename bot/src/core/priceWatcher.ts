import { Logger } from '../utils/logger';
import { PriceStreamService, PriceUpdate, TradeUpdate } from '../services/priceStream';
import { EventEmitter } from 'events';

export interface PriceAlert {
  type: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'large_move' | 'whale_trade';
  tokenMint: string;
  symbol: string;
  currentPrice: number;
  triggerPrice?: number;
  percentChange?: number;
  message: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface WatchedToken {
  tokenMint: string;
  symbol: string;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  trailingStopPrice?: number;
  lastPrice: number;
  highestPrice: number;
}

/**
 * Real-time Price Watcher
 * 
 * Monitors price stream and emits alerts for:
 * - Stop loss triggers
 * - Take profit triggers  
 * - Trailing stop triggers
 * - Large price movements
 * - Whale trades
 * 
 * This provides sub-second reaction time compared to 30s tick intervals
 */
export class PriceWatcher extends EventEmitter {
  private logger: Logger;
  private priceStream: PriceStreamService;
  private watchedTokens: Map<string, WatchedToken>;
  
  // Alert thresholds
  private readonly LARGE_MOVE_PERCENT = 10; // Alert on 10%+ moves
  private readonly WHALE_TRADE_USD = 10000; // Alert on $10k+ trades

  constructor(priceStream: PriceStreamService) {
    super();
    this.logger = new Logger('PriceWatcher');
    this.priceStream = priceStream;
    this.watchedTokens = new Map();
    
    this.setupStreamListeners();
  }

  /**
   * Setup listeners for price stream
   */
  private setupStreamListeners(): void {
    // Listen for price updates
    this.priceStream.on('price', (update: PriceUpdate) => {
      this.handlePriceUpdate(update);
    });

    // Listen for trade updates (whale detection)
    this.priceStream.on('trade', (update: TradeUpdate) => {
      this.handleTradeUpdate(update);
    });

    this.priceStream.on('connected', () => {
      this.logger.info('Price watcher connected to stream');
    });

    this.priceStream.on('disconnected', () => {
      this.logger.warn('Price watcher disconnected from stream');
    });
  }

  /**
   * Watch a token with price alerts
   */
  watch(
    tokenMint: string,
    symbol: string,
    entryPrice: number,
    stopLossPercent: number,
    takeProfitPercent?: number
  ): void {
    const stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
    const takeProfitPrice = takeProfitPercent 
      ? entryPrice * (1 + takeProfitPercent / 100) 
      : undefined;

    const watched: WatchedToken = {
      tokenMint,
      symbol,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      trailingStopPrice: undefined,
      lastPrice: entryPrice,
      highestPrice: entryPrice,
    };

    this.watchedTokens.set(tokenMint, watched);
    
    // Subscribe to price stream
    this.priceStream.subscribe(tokenMint);
    
    this.logger.info(
      `Watching ${symbol}: entry=${entryPrice.toFixed(6)} ` +
      `SL=${stopLossPrice.toFixed(6)} TP=${takeProfitPrice?.toFixed(6) || 'N/A'}`
    );
  }

  /**
   * Update stop loss for a watched token
   */
  updateStopLoss(tokenMint: string, newStopPrice: number): void {
    const watched = this.watchedTokens.get(tokenMint);
    if (!watched) return;

    watched.stopLossPrice = newStopPrice;
    this.logger.debug(`${watched.symbol} stop loss updated: ${newStopPrice.toFixed(6)}`);
  }

  /**
   * Update trailing stop
   */
  updateTrailingStop(tokenMint: string, trailingStopPrice: number): void {
    const watched = this.watchedTokens.get(tokenMint);
    if (!watched) return;

    watched.trailingStopPrice = trailingStopPrice;
    this.logger.debug(`${watched.symbol} trailing stop: ${trailingStopPrice.toFixed(6)}`);
  }

  /**
   * Stop watching a token
   */
  unwatch(tokenMint: string): void {
    const watched = this.watchedTokens.get(tokenMint);
    if (!watched) return;

    this.watchedTokens.delete(tokenMint);
    this.priceStream.unsubscribe(tokenMint);
    
    this.logger.info(`Stopped watching ${watched.symbol}`);
  }

  /**
   * Handle incoming price update
   */
  private handlePriceUpdate(update: PriceUpdate): void {
    const watched = this.watchedTokens.get(update.address);
    if (!watched) return;

    const currentPrice = update.price;
    const previousPrice = watched.lastPrice;
    
    // Update tracking
    watched.lastPrice = currentPrice;
    if (currentPrice > watched.highestPrice) {
      watched.highestPrice = currentPrice;
    }

    // Check stop loss
    if (currentPrice <= watched.stopLossPrice) {
      const pnl = ((currentPrice - watched.entryPrice) / watched.entryPrice) * 100;
      this.emitAlert({
        type: 'stop_loss',
        tokenMint: watched.tokenMint,
        symbol: watched.symbol,
        currentPrice,
        triggerPrice: watched.stopLossPrice,
        percentChange: pnl,
        message: `Stop loss hit at ${pnl.toFixed(1)}%`,
        urgency: 'critical',
      });
    }

    // Check trailing stop
    if (watched.trailingStopPrice && currentPrice <= watched.trailingStopPrice) {
      const pnl = ((currentPrice - watched.entryPrice) / watched.entryPrice) * 100;
      this.emitAlert({
        type: 'trailing_stop',
        tokenMint: watched.tokenMint,
        symbol: watched.symbol,
        currentPrice,
        triggerPrice: watched.trailingStopPrice,
        percentChange: pnl,
        message: `Trailing stop hit at ${pnl.toFixed(1)}%`,
        urgency: 'critical',
      });
    }

    // Check take profit
    if (watched.takeProfitPrice && currentPrice >= watched.takeProfitPrice) {
      const pnl = ((currentPrice - watched.entryPrice) / watched.entryPrice) * 100;
      this.emitAlert({
        type: 'take_profit',
        tokenMint: watched.tokenMint,
        symbol: watched.symbol,
        currentPrice,
        triggerPrice: watched.takeProfitPrice,
        percentChange: pnl,
        message: `Take profit target hit at +${pnl.toFixed(1)}%`,
        urgency: 'high',
      });
    }

    // Check large moves (between updates)
    if (previousPrice > 0) {
      const movePercent = ((currentPrice - previousPrice) / previousPrice) * 100;
      
      if (Math.abs(movePercent) >= this.LARGE_MOVE_PERCENT) {
        const direction = movePercent > 0 ? '📈' : '📉';
        this.emitAlert({
          type: 'large_move',
          tokenMint: watched.tokenMint,
          symbol: watched.symbol,
          currentPrice,
          percentChange: movePercent,
          message: `${direction} Large move: ${movePercent > 0 ? '+' : ''}${movePercent.toFixed(1)}%`,
          urgency: movePercent < -this.LARGE_MOVE_PERCENT ? 'high' : 'medium',
        });
      }
    }
  }

  /**
   * Handle incoming trade update (whale detection)
   */
  private handleTradeUpdate(update: TradeUpdate): void {
    const watched = this.watchedTokens.get(update.address);
    if (!watched) return;

    // Check for whale trades
    if (update.value >= this.WHALE_TRADE_USD) {
      const emoji = update.type === 'buy' ? '🐋📈' : '🐋📉';
      this.emitAlert({
        type: 'whale_trade',
        tokenMint: watched.tokenMint,
        symbol: watched.symbol,
        currentPrice: update.price,
        message: `${emoji} Whale ${update.type}: $${update.value.toLocaleString()}`,
        urgency: update.type === 'sell' ? 'high' : 'medium',
      });
    }
  }

  /**
   * Emit alert and log
   */
  private emitAlert(alert: PriceAlert): void {
    const urgencyEmoji = {
      low: 'ℹ️',
      medium: '⚠️',
      high: '🔔',
      critical: '🚨',
    }[alert.urgency];

    this.logger.info(`${urgencyEmoji} ${alert.symbol}: ${alert.message}`);
    this.emit('alert', alert);
  }

  /**
   * Get all watched tokens
   */
  getWatchedTokens(): WatchedToken[] {
    return Array.from(this.watchedTokens.values());
  }

  /**
   * Check if token is being watched
   */
  isWatching(tokenMint: string): boolean {
    return this.watchedTokens.has(tokenMint);
  }
}
