import { Logger } from '../utils/logger';
import { TechnicalIndicators, TechnicalSignals, OHLCVCandle } from './indicators';
import { VolumeAnalyzer, VolumeProfile } from './volumeAnalyzer';
import { RugDetector, RugCheckResult } from './rugDetector';
import { SmartMoneyTracker, TokenSmartMoneyActivity } from './smartMoney';
import { TokenDataService, TokenInfo } from './tokenData';

export interface EntryAnalysis {
  token: string;
  symbol: string;
  
  // Should we enter?
  recommendation: 'enter' | 'wait' | 'skip';
  confidence: number;         // 0-100
  
  // Timing
  entryType: 'immediate' | 'pullback' | 'breakout' | 'dip';
  idealEntryPrice?: number;
  currentPrice: number;
  
  // Risk assessment
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  riskScore: number;          // 0-100 (100 = highest risk)
  
  // Position sizing suggestion
  suggestedSizeMultiplier: number; // 0.5-1.5x normal size
  
  // Analysis components
  technicalScore: number;     // -100 to 100
  volumeScore: number;        // -100 to 100
  safetyScore: number;        // 0-100
  smartMoneyScore: number;    // -100 to 100
  
  // Reasons
  bullishReasons: string[];
  bearishReasons: string[];
  warnings: string[];
  
  // Suggested actions
  stopLossPercent: number;
  takeProfitPercent: number;
}

export interface MarketContext {
  solPrice: number;
  solChange24h: number;
  marketTrend: 'bullish' | 'neutral' | 'bearish';
  volatility: 'low' | 'medium' | 'high';
  fearGreedIndex?: number;
}

/**
 * Smart Entry Timing Service
 * 
 * Combines all analysis to determine optimal entry:
 * - Technical indicators (RSI, MACD, EMAs)
 * - Volume analysis (buy/sell pressure)
 * - Rug detection (safety checks)
 * - Smart money tracking
 * - Market context
 * 
 * Provides timing recommendations to avoid:
 * - Buying overbought tokens
 * - Chasing pumps (FOMO)
 * - Entering during distribution
 * - Buying unsafe tokens
 */
export class EntryTimingAnalyzer {
  private logger: Logger;
  private indicators: TechnicalIndicators;
  private volumeAnalyzer: VolumeAnalyzer;
  private rugDetector: RugDetector;
  private smartMoney: SmartMoneyTracker;
  private tokenData: TokenDataService;
  
  // Thresholds
  private readonly RSI_OVERBOUGHT = 70;
  private readonly RSI_OVERSOLD = 30;
  private readonly MIN_SAFETY_SCORE = 50;
  private readonly MIN_CONFIDENCE = 55;

  constructor(
    tokenData: TokenDataService,
    rugDetector: RugDetector,
    volumeAnalyzer: VolumeAnalyzer,
    smartMoney: SmartMoneyTracker
  ) {
    this.logger = new Logger('EntryTiming');
    this.tokenData = tokenData;
    this.rugDetector = rugDetector;
    this.volumeAnalyzer = volumeAnalyzer;
    this.smartMoney = smartMoney;
    this.indicators = new TechnicalIndicators();
  }

  /**
   * Full entry analysis for a token
   */
  async analyzeEntry(
    tokenAddress: string,
    candles?: OHLCVCandle[],
    marketContext?: MarketContext
  ): Promise<EntryAnalysis> {
    const bullishReasons: string[] = [];
    const bearishReasons: string[] = [];
    const warnings: string[] = [];

    // Get token info
    const tokenInfo = await this.tokenData.getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      return this.createSkipAnalysis(tokenAddress, 'UNKNOWN', 0, 'Token not found');
    }

    const currentPrice = tokenInfo.price;

    // 1. Safety check (rug detection)
    const safetyResult = await this.rugDetector.checkToken(tokenAddress);
    const safetyScore = safetyResult.score;
    
    if (!safetyResult.safe) {
      warnings.push(...safetyResult.risks.map(r => `${r.type.toUpperCase()}: ${r.name}`));
      
      if (safetyResult.details.isHoneypot) {
        return this.createSkipAnalysis(tokenAddress, tokenInfo.symbol, currentPrice, 'HONEYPOT DETECTED');
      }
      
      if (safetyScore < 30) {
        return this.createSkipAnalysis(tokenAddress, tokenInfo.symbol, currentPrice, 'Too risky - failed safety checks');
      }
    }

    // 2. Technical analysis
    let technicalScore = 0;
    let technicalSignals: TechnicalSignals | null = null;
    
    if (candles && candles.length >= 20) {
      technicalSignals = this.indicators.analyzeOHLCV(candles);
      technicalScore = technicalSignals.overall.score;
      
      // RSI analysis
      if (technicalSignals.rsi.signal === 'overbought') {
        bearishReasons.push(`RSI overbought: ${technicalSignals.rsi.value.toFixed(0)}`);
      } else if (technicalSignals.rsi.signal === 'oversold') {
        bullishReasons.push(`RSI oversold: ${technicalSignals.rsi.value.toFixed(0)}`);
      }
      
      // MACD analysis
      if (technicalSignals.macd.crossover === 'bullish_cross') {
        bullishReasons.push('MACD bullish crossover');
      } else if (technicalSignals.macd.crossover === 'bearish_cross') {
        bearishReasons.push('MACD bearish crossover');
      }
      
      // EMA trend
      if (technicalSignals.ema.trend === 'bullish') {
        bullishReasons.push('EMAs aligned bullish');
      } else if (technicalSignals.ema.trend === 'bearish') {
        bearishReasons.push('EMAs aligned bearish');
      }
    } else {
      // Quick analysis from price only
      const prices = candles?.map(c => c.close) || [currentPrice];
      const quick = this.indicators.quickAnalysis(prices);
      
      if (quick.rsi.signal === 'overbought') {
        bearishReasons.push(`RSI overbought: ${quick.rsi.value.toFixed(0)}`);
        technicalScore = -30;
      } else if (quick.rsi.signal === 'oversold') {
        bullishReasons.push(`RSI oversold: ${quick.rsi.value.toFixed(0)}`);
        technicalScore = 30;
      }
    }

    // 3. Volume analysis
    const volumeProfile = await this.volumeAnalyzer.getVolumeProfile(tokenAddress);
    let volumeScore = 0;
    
    if (volumeProfile) {
      volumeScore = this.volumeToScore(volumeProfile);
      
      if (volumeProfile.pressureTrend === 'buy_dominant') {
        bullishReasons.push(`Buy pressure: ${volumeProfile.buyPressure.toFixed(0)}%`);
      } else if (volumeProfile.pressureTrend === 'sell_dominant') {
        bearishReasons.push(`Sell pressure: ${(100 - volumeProfile.buyPressure).toFixed(0)}%`);
      }
      
      if (volumeProfile.volumeTrend === 'surging') {
        bullishReasons.push('Volume surging');
      } else if (volumeProfile.volumeTrend === 'dying') {
        bearishReasons.push('Volume dying');
      }
    }

    // 4. Smart money analysis
    let smartMoneyScore = 0;
    const smartMoneyActivity = await this.smartMoney.analyzeTokenActivity(tokenAddress);
    
    if (smartMoneyActivity) {
      if (smartMoneyActivity.signal === 'bullish') {
        smartMoneyScore = smartMoneyActivity.confidence * 0.5;
        bullishReasons.push(`${smartMoneyActivity.smartBuyers24h} smart wallets buying`);
      } else if (smartMoneyActivity.signal === 'bearish') {
        smartMoneyScore = -smartMoneyActivity.confidence * 0.5;
        bearishReasons.push(`${smartMoneyActivity.smartSellers24h} smart wallets selling`);
      }
    }

    // 5. Market context adjustment
    let marketAdjustment = 0;
    if (marketContext) {
      if (marketContext.marketTrend === 'bearish') {
        marketAdjustment = -15;
        warnings.push('Overall market is bearish');
      } else if (marketContext.marketTrend === 'bullish') {
        marketAdjustment = 10;
      }
      
      if (marketContext.volatility === 'high') {
        warnings.push('High market volatility');
      }
    }

    // Calculate composite scores
    const compositeScore = (
      technicalScore * 0.3 +
      volumeScore * 0.25 +
      (safetyScore - 50) * 0.25 +
      smartMoneyScore * 0.2 +
      marketAdjustment
    );

    // Determine entry recommendation
    const { recommendation, entryType, confidence } = this.determineEntry(
      compositeScore,
      technicalSignals,
      volumeProfile,
      safetyScore
    );

    // Calculate risk level
    const riskScore = this.calculateRiskScore(safetyScore, technicalSignals, volumeProfile);
    const riskLevel = this.riskScoreToLevel(riskScore);

    // Position sizing
    const suggestedSizeMultiplier = this.calculateSizeMultiplier(
      confidence,
      riskScore,
      smartMoneyScore
    );

    // Dynamic stop-loss and take-profit
    const { stopLoss, takeProfit } = this.calculateTargets(
      riskScore,
      technicalSignals,
      tokenInfo.priceChange24h
    );

    // Calculate ideal entry price (for limit orders)
    let idealEntryPrice: number | undefined;
    if (entryType === 'pullback' && technicalSignals) {
      // Suggest entry at EMA21 or lower Bollinger band
      idealEntryPrice = Math.min(
        technicalSignals.ema.ema21,
        technicalSignals.bollinger.lower
      );
    } else if (entryType === 'dip') {
      idealEntryPrice = currentPrice * 0.95; // 5% dip
    }

    return {
      token: tokenAddress,
      symbol: tokenInfo.symbol,
      recommendation,
      confidence,
      entryType,
      idealEntryPrice,
      currentPrice,
      riskLevel,
      riskScore,
      suggestedSizeMultiplier,
      technicalScore,
      volumeScore,
      safetyScore,
      smartMoneyScore,
      bullishReasons,
      bearishReasons,
      warnings,
      stopLossPercent: stopLoss,
      takeProfitPercent: takeProfit,
    };
  }

  /**
   * Quick check if we should even consider this token
   */
  async quickFilter(tokenAddress: string): Promise<{
    pass: boolean;
    reason: string;
  }> {
    // Quick honeypot check
    const honeypot = await this.rugDetector.quickHoneypotCheck(tokenAddress);
    if (honeypot.isHoneypot) {
      return { pass: false, reason: 'Honeypot detected' };
    }
    if (honeypot.sellTax > 10) {
      return { pass: false, reason: `High sell tax: ${honeypot.sellTax}%` };
    }

    // Quick token info check
    const tokenInfo = await this.tokenData.getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      return { pass: false, reason: 'Token not found' };
    }
    if (tokenInfo.liquidity < 5000) {
      return { pass: false, reason: 'Insufficient liquidity' };
    }
    if (tokenInfo.priceChange24h > 300) {
      return { pass: false, reason: 'Too pumped - high risk of dump' };
    }
    if (tokenInfo.priceChange24h < -50) {
      return { pass: false, reason: 'Dumping hard' };
    }

    return { pass: true, reason: 'Passed quick filter' };
  }

  /**
   * Convert volume profile to score
   */
  private volumeToScore(profile: VolumeProfile): number {
    let score = 0;
    
    // Volume trend
    switch (profile.volumeTrend) {
      case 'surging': score += 40; break;
      case 'increasing': score += 20; break;
      case 'decreasing': score -= 20; break;
      case 'dying': score -= 40; break;
    }
    
    // Buy pressure
    if (profile.buyPressure > 70) score += 30;
    else if (profile.buyPressure > 60) score += 15;
    else if (profile.buyPressure < 30) score -= 30;
    else if (profile.buyPressure < 40) score -= 15;
    
    return Math.max(-100, Math.min(100, score));
  }

  /**
   * Determine entry recommendation
   */
  private determineEntry(
    compositeScore: number,
    technicals: TechnicalSignals | null,
    volume: VolumeProfile | null,
    safetyScore: number
  ): {
    recommendation: 'enter' | 'wait' | 'skip';
    entryType: 'immediate' | 'pullback' | 'breakout' | 'dip';
    confidence: number;
  } {
    // Skip if too risky
    if (safetyScore < this.MIN_SAFETY_SCORE) {
      return { recommendation: 'skip', entryType: 'immediate', confidence: 0 };
    }

    // Check for overbought condition
    if (technicals?.rsi.signal === 'overbought') {
      if (compositeScore > 30) {
        // Strong momentum but overbought - wait for pullback
        return { 
          recommendation: 'wait', 
          entryType: 'pullback', 
          confidence: Math.min(80, 40 + compositeScore * 0.4) 
        };
      }
      return { recommendation: 'skip', entryType: 'immediate', confidence: 30 };
    }

    // Check for oversold bounce opportunity
    if (technicals?.rsi.signal === 'oversold' && compositeScore > 0) {
      return { 
        recommendation: 'enter', 
        entryType: 'dip', 
        confidence: Math.min(85, 50 + compositeScore * 0.35) 
      };
    }

    // Strong bullish signals
    if (compositeScore >= 40) {
      return { 
        recommendation: 'enter', 
        entryType: 'immediate', 
        confidence: Math.min(90, 50 + compositeScore * 0.4) 
      };
    }

    // Moderate bullish
    if (compositeScore >= 20) {
      return { 
        recommendation: 'enter', 
        entryType: 'breakout', 
        confidence: Math.min(70, 45 + compositeScore * 0.3) 
      };
    }

    // Weak/neutral
    if (compositeScore >= 0) {
      return { 
        recommendation: 'wait', 
        entryType: 'pullback', 
        confidence: Math.min(60, 40 + compositeScore * 0.2) 
      };
    }

    // Bearish
    return { 
      recommendation: 'skip', 
      entryType: 'immediate', 
      confidence: 20 
    };
  }

  /**
   * Calculate risk score
   */
  private calculateRiskScore(
    safetyScore: number,
    technicals: TechnicalSignals | null,
    volume: VolumeProfile | null
  ): number {
    let risk = 100 - safetyScore;

    // Add technical risk
    if (technicals) {
      if (technicals.rsi.value > 80) risk += 20;
      else if (technicals.rsi.value > 70) risk += 10;
      
      if (technicals.bollinger.percentB > 0.95) risk += 15;
    }

    // Add volume risk
    if (volume) {
      if (volume.volumeTrend === 'dying') risk += 20;
      if (volume.pressureTrend === 'sell_dominant') risk += 15;
    }

    return Math.max(0, Math.min(100, risk));
  }

  /**
   * Convert risk score to level
   */
  private riskScoreToLevel(score: number): 'low' | 'medium' | 'high' | 'extreme' {
    if (score >= 70) return 'extreme';
    if (score >= 50) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }

  /**
   * Calculate position size multiplier
   */
  private calculateSizeMultiplier(
    confidence: number,
    riskScore: number,
    smartMoneyScore: number
  ): number {
    let multiplier = 1;

    // Adjust by confidence
    if (confidence >= 80) multiplier += 0.3;
    else if (confidence >= 70) multiplier += 0.15;
    else if (confidence < 50) multiplier -= 0.3;

    // Adjust by risk
    if (riskScore >= 60) multiplier -= 0.3;
    else if (riskScore >= 40) multiplier -= 0.15;
    else if (riskScore < 20) multiplier += 0.15;

    // Boost if smart money agrees
    if (smartMoneyScore > 30) multiplier += 0.2;

    return Math.max(0.3, Math.min(1.5, multiplier));
  }

  /**
   * Calculate dynamic stop-loss and take-profit
   */
  private calculateTargets(
    riskScore: number,
    technicals: TechnicalSignals | null,
    priceChange24h: number
  ): { stopLoss: number; takeProfit: number } {
    // Base values
    let stopLoss = 15;
    let takeProfit = 50;

    // Tighter stops for higher risk
    if (riskScore >= 60) {
      stopLoss = 10;
      takeProfit = 30;
    } else if (riskScore >= 40) {
      stopLoss = 12;
      takeProfit = 40;
    }

    // Adjust based on volatility (from Bollinger bandwidth)
    if (technicals && technicals.bollinger.bandwidth > 0.1) {
      stopLoss += 5;
      takeProfit += 20;
    }

    // Adjust based on existing momentum
    if (priceChange24h > 50) {
      // Already pumped - expect smaller moves
      takeProfit = Math.min(takeProfit, 30);
    }

    return { stopLoss, takeProfit };
  }

  /**
   * Create skip analysis result
   */
  private createSkipAnalysis(
    token: string,
    symbol: string,
    price: number,
    reason: string
  ): EntryAnalysis {
    return {
      token,
      symbol,
      recommendation: 'skip',
      confidence: 0,
      entryType: 'immediate',
      currentPrice: price,
      riskLevel: 'extreme',
      riskScore: 100,
      suggestedSizeMultiplier: 0,
      technicalScore: 0,
      volumeScore: 0,
      safetyScore: 0,
      smartMoneyScore: 0,
      bullishReasons: [],
      bearishReasons: [reason],
      warnings: [reason],
      stopLossPercent: 0,
      takeProfitPercent: 0,
    };
  }

  /**
   * Get summary for logging
   */
  summarize(analysis: EntryAnalysis): string {
    const emoji = {
      enter: '✅',
      wait: '⏳',
      skip: '❌',
    }[analysis.recommendation];

    const riskEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      extreme: '🔴',
    }[analysis.riskLevel];

    return (
      `${emoji} ${analysis.symbol}: ${analysis.recommendation.toUpperCase()} ` +
      `(${analysis.confidence}% conf) | ${riskEmoji} Risk: ${analysis.riskLevel} | ` +
      `Size: ${analysis.suggestedSizeMultiplier.toFixed(1)}x | ` +
      `SL: ${analysis.stopLossPercent}% TP: ${analysis.takeProfitPercent}%`
    );
  }
}
