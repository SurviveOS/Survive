import { Logger } from '../utils/logger';

/**
 * Technical Analysis Indicators
 * 
 * Provides standard TA indicators:
 * - RSI (Relative Strength Index)
 * - MACD (Moving Average Convergence Divergence)
 * - EMA (Exponential Moving Average)
 * - SMA (Simple Moving Average)
 * - Bollinger Bands
 * - Volume indicators
 */

export interface OHLCVCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RSIResult {
  value: number;
  signal: 'oversold' | 'neutral' | 'overbought';
  strength: number; // 0-100, how strong the signal is
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  crossover: 'bullish_cross' | 'bearish_cross' | 'none';
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number; // Where price is within bands (0-1)
}

export interface TechnicalSignals {
  rsi: RSIResult;
  macd: MACDResult;
  ema: {
    ema9: number;
    ema21: number;
    ema50: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  };
  bollinger: BollingerBands;
  volume: {
    current: number;
    average: number;
    ratio: number; // current / average
    trend: 'increasing' | 'decreasing' | 'stable';
  };
  momentum: {
    roc: number; // Rate of change
    momentum: number;
  };
  overall: {
    score: number; // -100 to 100
    signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
    confidence: number;
  };
}

export class TechnicalIndicators {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('Indicators');
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  calculateRSI(prices: number[], period: number = 14): RSIResult {
    if (prices.length < period + 1) {
      return { value: 50, signal: 'neutral', strength: 0 };
    }

    let gains = 0;
    let losses = 0;

    // Calculate initial average gain/loss
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate smoothed RSI for remaining prices
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    // Determine signal
    let signal: 'oversold' | 'neutral' | 'overbought' = 'neutral';
    let strength = 0;

    if (rsi <= 30) {
      signal = 'oversold';
      strength = Math.min(100, (30 - rsi) * 3.33); // 0-30 maps to 0-100
    } else if (rsi >= 70) {
      signal = 'overbought';
      strength = Math.min(100, (rsi - 70) * 3.33);
    } else {
      strength = 50 - Math.abs(50 - rsi); // Strongest at 50
    }

    return { value: rsi, signal, strength };
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   */
  calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length < period) return this.calculateSMA(prices, prices.length);

    const multiplier = 2 / (period + 1);
    let ema = this.calculateSMA(prices.slice(0, period), period);

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate SMA (Simple Moving Average)
   */
  calculateSMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    const slice = prices.slice(-period);
    return slice.reduce((sum, p) => sum + p, 0) / slice.length;
  }

  /**
   * Calculate MACD
   */
  calculateMACD(
    prices: number[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): MACDResult {
    if (prices.length < slowPeriod + signalPeriod) {
      return {
        macd: 0,
        signal: 0,
        histogram: 0,
        trend: 'neutral',
        crossover: 'none',
      };
    }

    // Calculate MACD line (fast EMA - slow EMA)
    const macdLine: number[] = [];
    
    for (let i = slowPeriod; i <= prices.length; i++) {
      const slice = prices.slice(0, i);
      const fastEMA = this.calculateEMA(slice, fastPeriod);
      const slowEMA = this.calculateEMA(slice, slowPeriod);
      macdLine.push(fastEMA - slowEMA);
    }

    // Calculate signal line (EMA of MACD)
    const signalLine = this.calculateEMA(macdLine, signalPeriod);
    const currentMACD = macdLine[macdLine.length - 1];
    const histogram = currentMACD - signalLine;

    // Determine trend
    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (histogram > 0 && currentMACD > 0) {
      trend = 'bullish';
    } else if (histogram < 0 && currentMACD < 0) {
      trend = 'bearish';
    }

    // Detect crossovers
    let crossover: 'bullish_cross' | 'bearish_cross' | 'none' = 'none';
    if (macdLine.length >= 2) {
      const prevMACD = macdLine[macdLine.length - 2];
      const prevSignal = this.calculateEMA(macdLine.slice(0, -1), signalPeriod);
      
      // Bullish crossover: MACD crosses above signal
      if (prevMACD <= prevSignal && currentMACD > signalLine) {
        crossover = 'bullish_cross';
      }
      // Bearish crossover: MACD crosses below signal
      else if (prevMACD >= prevSignal && currentMACD < signalLine) {
        crossover = 'bearish_cross';
      }
    }

    return {
      macd: currentMACD,
      signal: signalLine,
      histogram,
      trend,
      crossover,
    };
  }

  /**
   * Calculate Bollinger Bands
   */
  calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDev: number = 2
  ): BollingerBands {
    if (prices.length < period) {
      const currentPrice = prices[prices.length - 1] || 0;
      return {
        upper: currentPrice,
        middle: currentPrice,
        lower: currentPrice,
        bandwidth: 0,
        percentB: 0.5,
      };
    }

    const slice = prices.slice(-period);
    const middle = this.calculateSMA(slice, period);
    
    // Calculate standard deviation
    const squaredDiffs = slice.map(p => Math.pow(p - middle, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / period;
    const standardDeviation = Math.sqrt(variance);

    const upper = middle + (stdDev * standardDeviation);
    const lower = middle - (stdDev * standardDeviation);
    const bandwidth = (upper - lower) / middle;
    
    const currentPrice = prices[prices.length - 1];
    const percentB = (currentPrice - lower) / (upper - lower);

    return { upper, middle, lower, bandwidth, percentB };
  }

  /**
   * Calculate Rate of Change (ROC)
   */
  calculateROC(prices: number[], period: number = 10): number {
    if (prices.length <= period) return 0;
    
    const currentPrice = prices[prices.length - 1];
    const pastPrice = prices[prices.length - 1 - period];
    
    return ((currentPrice - pastPrice) / pastPrice) * 100;
  }

  /**
   * Calculate Momentum
   */
  calculateMomentum(prices: number[], period: number = 10): number {
    if (prices.length <= period) return 0;
    
    return prices[prices.length - 1] - prices[prices.length - 1 - period];
  }

  /**
   * Analyze volume trend
   */
  analyzeVolume(volumes: number[], period: number = 20): {
    current: number;
    average: number;
    ratio: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  } {
    if (volumes.length === 0) {
      return { current: 0, average: 0, ratio: 1, trend: 'stable' };
    }

    const current = volumes[volumes.length - 1];
    const average = this.calculateSMA(volumes, Math.min(period, volumes.length));
    const ratio = average > 0 ? current / average : 1;

    // Determine trend by comparing recent vs older volume
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (volumes.length >= 10) {
      const recentAvg = this.calculateSMA(volumes.slice(-5), 5);
      const olderAvg = this.calculateSMA(volumes.slice(-10, -5), 5);
      
      if (recentAvg > olderAvg * 1.2) {
        trend = 'increasing';
      } else if (recentAvg < olderAvg * 0.8) {
        trend = 'decreasing';
      }
    }

    return { current, average, ratio, trend };
  }

  /**
   * Calculate all technical signals from OHLCV data
   */
  analyzeOHLCV(candles: OHLCVCandle[]): TechnicalSignals {
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const currentPrice = closes[closes.length - 1] || 0;

    // Calculate all indicators
    const rsi = this.calculateRSI(closes);
    const macd = this.calculateMACD(closes);
    const bollinger = this.calculateBollingerBands(closes);
    const volume = this.analyzeVolume(volumes);
    
    const ema9 = this.calculateEMA(closes, 9);
    const ema21 = this.calculateEMA(closes, 21);
    const ema50 = this.calculateEMA(closes, 50);

    // Determine EMA trend
    let emaTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (currentPrice > ema9 && ema9 > ema21 && ema21 > ema50) {
      emaTrend = 'bullish';
    } else if (currentPrice < ema9 && ema9 < ema21 && ema21 < ema50) {
      emaTrend = 'bearish';
    }

    const roc = this.calculateROC(closes);
    const momentum = this.calculateMomentum(closes);

    // Calculate overall signal
    const overall = this.calculateOverallSignal(rsi, macd, emaTrend, bollinger, volume);

    return {
      rsi,
      macd,
      ema: { ema9, ema21, ema50, trend: emaTrend },
      bollinger,
      volume,
      momentum: { roc, momentum },
      overall,
    };
  }

  /**
   * Calculate overall trading signal
   */
  private calculateOverallSignal(
    rsi: RSIResult,
    macd: MACDResult,
    emaTrend: 'bullish' | 'bearish' | 'neutral',
    bollinger: BollingerBands,
    volume: { ratio: number; trend: string }
  ): { score: number; signal: string; confidence: number } {
    let score = 0;

    // RSI contribution (-30 to +30)
    if (rsi.signal === 'oversold') {
      score += 20 + (rsi.strength * 0.1); // Buy signal
    } else if (rsi.signal === 'overbought') {
      score -= 20 + (rsi.strength * 0.1); // Sell signal
    }

    // MACD contribution (-25 to +25)
    if (macd.trend === 'bullish') score += 15;
    else if (macd.trend === 'bearish') score -= 15;
    
    if (macd.crossover === 'bullish_cross') score += 10;
    else if (macd.crossover === 'bearish_cross') score -= 10;

    // EMA trend contribution (-20 to +20)
    if (emaTrend === 'bullish') score += 20;
    else if (emaTrend === 'bearish') score -= 20;

    // Bollinger Bands contribution (-15 to +15)
    if (bollinger.percentB < 0.2) {
      score += 15; // Near lower band = potential buy
    } else if (bollinger.percentB > 0.8) {
      score -= 15; // Near upper band = potential sell
    }

    // Volume confirmation (-10 to +10)
    if (volume.trend === 'increasing' && volume.ratio > 1.5) {
      score += score > 0 ? 10 : -10; // Confirms the direction
    }

    // Clamp score
    score = Math.max(-100, Math.min(100, score));

    // Determine signal
    let signal: string;
    if (score >= 50) signal = 'strong_buy';
    else if (score >= 20) signal = 'buy';
    else if (score <= -50) signal = 'strong_sell';
    else if (score <= -20) signal = 'sell';
    else signal = 'neutral';

    // Calculate confidence based on indicator agreement
    const confidence = Math.min(100, Math.abs(score) + (volume.ratio > 1.2 ? 10 : 0));

    return { score, signal, confidence };
  }

  /**
   * Quick analysis from just prices (no full OHLCV)
   */
  quickAnalysis(prices: number[]): {
    rsi: RSIResult;
    trend: 'bullish' | 'bearish' | 'neutral';
    recommendation: 'buy' | 'sell' | 'hold';
  } {
    const rsi = this.calculateRSI(prices);
    
    const ema9 = this.calculateEMA(prices, 9);
    const ema21 = this.calculateEMA(prices, 21);
    const currentPrice = prices[prices.length - 1];

    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (currentPrice > ema9 && ema9 > ema21) {
      trend = 'bullish';
    } else if (currentPrice < ema9 && ema9 < ema21) {
      trend = 'bearish';
    }

    let recommendation: 'buy' | 'sell' | 'hold' = 'hold';
    if (rsi.signal === 'oversold' && trend !== 'bearish') {
      recommendation = 'buy';
    } else if (rsi.signal === 'overbought' && trend !== 'bullish') {
      recommendation = 'sell';
    }

    return { rsi, trend, recommendation };
  }
}
