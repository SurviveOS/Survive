import { BaseStrategy, TradeSignal } from './base';
import { TokenInfo } from '../services/tokenData';

interface TokenScore {
  token: TokenInfo;
  score: number;
  confidence: number;
  reasons: string[];
  redFlags: string[];
}

interface MarketCondition {
  trend: 'bullish' | 'neutral' | 'bearish';
  volatility: 'low' | 'medium' | 'high';
  sentiment: number; // -100 to 100
}

/**
 * Enhanced Momentum Strategy
 * 
 * Multi-factor scoring system:
 * - Price momentum (short & medium term)
 * - Volume analysis
 * - Liquidity requirements
 * - Safety checks
 * - Market condition awareness
 */
export class MomentumStrategy extends BaseStrategy {
  // === THRESHOLDS ===
  
  // Liquidity & Volume
  private readonly MIN_LIQUIDITY = 10000;      // $10k minimum
  private readonly IDEAL_LIQUIDITY = 50000;    // $50k ideal
  private readonly MIN_VOLUME = 5000;          // $5k min 24h
  private readonly IDEAL_VOLUME_RATIO = 0.3;   // 30% volume/mcap ratio
  
  // Price Movement
  private readonly MIN_PRICE_CHANGE = 5;       // Min 5% to consider
  private readonly SWEET_SPOT_LOW = 15;        // Sweet spot: 15-80%
  private readonly SWEET_SPOT_HIGH = 80;
  private readonly MAX_PRICE_CHANGE = 200;     // Don't chase 200%+ pumps
  private readonly DUMP_THRESHOLD = -30;       // Avoid dumps
  
  // Position Management
  private readonly MAX_POSITIONS = 5;
  private readonly MIN_CONFIDENCE = 55;        // Minimum confidence to enter
  
  // Scoring Weights
  private readonly WEIGHTS = {
    liquidity: 15,
    volume: 15,
    momentum: 25,
    volumeRatio: 15,
    priceAction: 20,
    safety: 10,
  };

  async analyze(): Promise<TradeSignal[]> {
    const signals: TradeSignal[] = [];
    
    // 1. Check existing positions first (exits before entries)
    const positionSignals = await this.checkPositions();
    signals.push(...positionSignals);

    // 2. Check if we should look for new entries
    const currentPositions = this.storage.getState().positions.length;
    if (currentPositions >= this.MAX_POSITIONS) {
      this.logger.info(`Max positions (${this.MAX_POSITIONS}) reached, focusing on management`);
      return signals;
    }

    // 3. Assess market conditions
    const marketCondition = await this.assessMarketCondition();
    this.logger.info(`Market: ${marketCondition.trend} | Volatility: ${marketCondition.volatility}`);

    // 4. Get and score tokens
    const trending = await this.tokenData.getTrendingTokens(100);
    this.logger.info(`Analyzing ${trending.length} tokens...`);

    const scoredTokens: TokenScore[] = [];
    
    for (const token of trending) {
      // Skip if we already have a position
      if (this.storage.getPosition(token.address)) {
        continue;
      }

      const score = this.scoreToken(token, marketCondition);
      if (score.confidence >= this.MIN_CONFIDENCE && score.redFlags.length === 0) {
        scoredTokens.push(score);
      }
    }

    // 5. Sort by score and take top opportunities
    scoredTokens.sort((a, b) => b.score - a.score);
    
    const availableSlots = this.MAX_POSITIONS - currentPositions;
    const topPicks = scoredTokens.slice(0, Math.min(availableSlots, 3));

    for (const pick of topPicks) {
      const positionSize = this.calculatePositionSize(pick, marketCondition);
      
      signals.push({
        type: 'buy',
        tokenMint: pick.token.address,
        symbol: pick.token.symbol,
        reason: `Score: ${pick.score} | ${pick.reasons.slice(0, 3).join(', ')}`,
        confidence: pick.confidence,
        suggestedAmount: positionSize,
      });

      this.logger.info(
        `📈 BUY Signal: ${pick.token.symbol} | ` +
        `Score: ${pick.score} | Confidence: ${pick.confidence}% | ` +
        `Size: ${positionSize.toFixed(3)} SOL`
      );
    }

    // Log sell signals separately
    const sellSignals = signals.filter(s => s.type === 'sell');
    return [...sellSignals, ...signals.filter(s => s.type === 'buy')];
  }

  /**
   * Multi-factor token scoring
   */
  private scoreToken(token: TokenInfo, market: MarketCondition): TokenScore {
    let score = 0;
    const reasons: string[] = [];
    const redFlags: string[] = [];

    // === HARD FILTERS (Red Flags) ===
    
    if (token.liquidity < this.MIN_LIQUIDITY) {
      redFlags.push(`Liquidity too low: $${token.liquidity.toLocaleString()}`);
    }

    if (token.volume24h < this.MIN_VOLUME) {
      redFlags.push(`Volume too low: $${token.volume24h.toLocaleString()}`);
    }

    if (token.priceChange24h > this.MAX_PRICE_CHANGE) {
      redFlags.push(`Pump too extreme: +${token.priceChange24h.toFixed(0)}%`);
    }

    if (token.priceChange24h < this.DUMP_THRESHOLD) {
      redFlags.push(`Dumping: ${token.priceChange24h.toFixed(0)}%`);
    }

    // If any red flags, return early
    if (redFlags.length > 0) {
      return { token, score: 0, confidence: 0, reasons, redFlags };
    }

    // === SCORING ===

    // 1. Liquidity Score (0-15)
    if (token.liquidity >= this.IDEAL_LIQUIDITY) {
      score += this.WEIGHTS.liquidity;
      reasons.push(`Strong liquidity: $${(token.liquidity / 1000).toFixed(0)}k`);
    } else {
      const liquidityScore = (token.liquidity / this.IDEAL_LIQUIDITY) * this.WEIGHTS.liquidity;
      score += liquidityScore;
      reasons.push(`Liquidity: $${(token.liquidity / 1000).toFixed(0)}k`);
    }

    // 2. Volume Score (0-15)
    const volumeK = token.volume24h / 1000;
    if (volumeK >= 50) {
      score += this.WEIGHTS.volume;
      reasons.push(`High volume: $${volumeK.toFixed(0)}k`);
    } else if (volumeK >= 20) {
      score += this.WEIGHTS.volume * 0.8;
      reasons.push(`Good volume: $${volumeK.toFixed(0)}k`);
    } else {
      score += this.WEIGHTS.volume * 0.5;
    }

    // 3. Momentum Score (0-25)
    const change = token.priceChange24h;
    if (change >= this.SWEET_SPOT_LOW && change <= this.SWEET_SPOT_HIGH) {
      // Sweet spot - full points
      score += this.WEIGHTS.momentum;
      reasons.push(`🔥 Sweet spot momentum: +${change.toFixed(1)}%`);
    } else if (change >= this.MIN_PRICE_CHANGE && change < this.SWEET_SPOT_LOW) {
      // Early momentum
      score += this.WEIGHTS.momentum * 0.6;
      reasons.push(`Early momentum: +${change.toFixed(1)}%`);
    } else if (change > this.SWEET_SPOT_HIGH && change <= this.MAX_PRICE_CHANGE) {
      // Late momentum (more risky)
      score += this.WEIGHTS.momentum * 0.4;
      reasons.push(`Late momentum (risky): +${change.toFixed(1)}%`);
    }

    // 4. Volume/MCap Ratio (0-15) - indicates trading activity
    if (token.marketCap > 0) {
      const volumeRatio = token.volume24h / token.marketCap;
      if (volumeRatio >= this.IDEAL_VOLUME_RATIO) {
        score += this.WEIGHTS.volumeRatio;
        reasons.push(`High activity: ${(volumeRatio * 100).toFixed(0)}% vol/mc`);
      } else if (volumeRatio >= 0.15) {
        score += this.WEIGHTS.volumeRatio * 0.7;
        reasons.push(`Active: ${(volumeRatio * 100).toFixed(0)}% vol/mc`);
      } else {
        score += this.WEIGHTS.volumeRatio * 0.3;
      }
    }

    // 5. Price Action Quality (0-20)
    // Favor tokens with steady gains over explosive single candles
    // (Would need more data for proper implementation)
    const priceActionScore = this.evaluatePriceAction(token);
    score += priceActionScore.score;
    if (priceActionScore.reason) {
      reasons.push(priceActionScore.reason);
    }

    // 6. Safety Score (0-10)
    const safetyScore = this.evaluateSafety(token);
    score += safetyScore.score;
    if (safetyScore.reason) {
      reasons.push(safetyScore.reason);
    }

    // === MARKET CONDITION ADJUSTMENTS ===
    
    // Reduce confidence in bearish markets
    let confidenceMultiplier = 1;
    if (market.trend === 'bearish') {
      confidenceMultiplier = 0.8;
    } else if (market.trend === 'bullish') {
      confidenceMultiplier = 1.1;
    }

    // Reduce confidence in high volatility
    if (market.volatility === 'high') {
      confidenceMultiplier *= 0.9;
    }

    // Calculate final confidence
    const maxScore = Object.values(this.WEIGHTS).reduce((a, b) => a + b, 0);
    const rawConfidence = (score / maxScore) * 100;
    const confidence = Math.min(100, Math.round(rawConfidence * confidenceMultiplier));

    return {
      token,
      score: Math.round(score),
      confidence,
      reasons,
      redFlags,
    };
  }

  /**
   * Evaluate price action quality
   */
  private evaluatePriceAction(token: TokenInfo): { score: number; reason: string | null } {
    // Simplified - would need candle data for proper implementation
    // For now, base on 24h change distribution
    
    const change = token.priceChange24h;
    
    // Steady gains (20-60%) are preferred
    if (change >= 20 && change <= 60) {
      return { score: this.WEIGHTS.priceAction, reason: 'Steady price action' };
    }
    
    // Moderate gains
    if (change >= 10 && change < 20) {
      return { score: this.WEIGHTS.priceAction * 0.7, reason: 'Building momentum' };
    }
    
    // Extended gains (60-100%) - more risky
    if (change > 60 && change <= 100) {
      return { score: this.WEIGHTS.priceAction * 0.5, reason: 'Extended move' };
    }

    return { score: this.WEIGHTS.priceAction * 0.3, reason: null };
  }

  /**
   * Evaluate token safety
   */
  private evaluateSafety(token: TokenInfo): { score: number; reason: string | null } {
    let score = 0;
    
    // Higher liquidity = safer
    if (token.liquidity >= 100000) {
      score += this.WEIGHTS.safety * 0.5;
    } else if (token.liquidity >= 50000) {
      score += this.WEIGHTS.safety * 0.3;
    }

    // Reasonable market cap suggests established token
    if (token.marketCap >= 500000 && token.marketCap <= 50000000) {
      score += this.WEIGHTS.safety * 0.5;
    }

    const reason = score >= this.WEIGHTS.safety * 0.7 ? 'Good safety profile' : null;
    return { score, reason };
  }

  /**
   * Assess overall market conditions
   */
  private async assessMarketCondition(): Promise<MarketCondition> {
    // Simplified - would need SOL price, BTC correlation, etc.
    // For now, use aggregate of trending tokens
    
    try {
      const tokens = await this.tokenData.getTrendingTokens(20);
      
      let bullish = 0;
      let bearish = 0;
      let volatileCount = 0;

      for (const token of tokens) {
        if (token.priceChange24h > 10) bullish++;
        else if (token.priceChange24h < -10) bearish++;
        
        if (Math.abs(token.priceChange24h) > 50) volatileCount++;
      }

      const trend = bullish > bearish * 1.5 ? 'bullish' :
                    bearish > bullish * 1.5 ? 'bearish' : 'neutral';
      
      const volatility = volatileCount > tokens.length * 0.4 ? 'high' :
                        volatileCount > tokens.length * 0.2 ? 'medium' : 'low';

      const sentiment = ((bullish - bearish) / tokens.length) * 100;

      return { trend, volatility, sentiment };
    } catch {
      return { trend: 'neutral', volatility: 'medium', sentiment: 0 };
    }
  }

  /**
   * Calculate position size based on score and market
   */
  private calculatePositionSize(pick: TokenScore, market: MarketCondition): number {
    const baseSize = this.config.maxTradeSizeSol;
    
    // Scale by confidence (50-100% maps to 0.3-1.0x)
    const confidenceMultiplier = 0.3 + (pick.confidence / 100) * 0.7;
    
    // Scale by liquidity (safer with more liquidity)
    const liquidityMultiplier = Math.min(1, pick.token.liquidity / 100000);
    
    // Reduce in bearish/volatile markets
    let marketMultiplier = 1;
    if (market.trend === 'bearish') marketMultiplier *= 0.7;
    if (market.volatility === 'high') marketMultiplier *= 0.8;

    // Calculate final size
    let size = baseSize * 0.3 * confidenceMultiplier * (0.5 + liquidityMultiplier * 0.5) * marketMultiplier;
    
    // Clamp between min and max
    size = Math.max(0.02, Math.min(size, baseSize));
    
    return size;
  }
}
