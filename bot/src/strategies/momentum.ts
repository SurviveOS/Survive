import { BaseStrategy, TradeSignal } from './base';
import { TokenInfo } from '../services/tokenData';
import { TechnicalIndicators, OHLCVCandle } from '../services/indicators';
import { RugDetector } from '../services/rugDetector';
import { VolumeAnalyzer } from '../services/volumeAnalyzer';
import { SmartMoneyTracker } from '../services/smartMoney';
import { EntryTimingAnalyzer, EntryAnalysis } from '../services/entryTiming';

interface TokenScore {
  token: TokenInfo;
  score: number;
  confidence: number;
  reasons: string[];
  redFlags: string[];
  entryAnalysis?: EntryAnalysis;
}

interface MarketCondition {
  trend: 'bullish' | 'neutral' | 'bearish';
  volatility: 'low' | 'medium' | 'high';
  sentiment: number; // -100 to 100
}

/**
 * Enhanced Momentum Strategy v2
 * 
 * Multi-factor analysis with:
 * - Technical indicators (RSI, MACD, EMAs)
 * - Rug/honeypot detection
 * - Smart money tracking
 * - Volume analysis
 * - Entry timing optimization
 */
export class MomentumStrategy extends BaseStrategy {
  // Services
  private indicators: TechnicalIndicators;
  private rugDetector: RugDetector | null = null;
  private volumeAnalyzer: VolumeAnalyzer | null = null;
  private smartMoney: SmartMoneyTracker | null = null;
  private entryAnalyzer: EntryTimingAnalyzer | null = null;
  
  // === THRESHOLDS ===
  private readonly MIN_LIQUIDITY = 10000;
  private readonly IDEAL_LIQUIDITY = 50000;
  private readonly MIN_VOLUME = 5000;
  private readonly MIN_PRICE_CHANGE = 5;
  private readonly SWEET_SPOT_LOW = 15;
  private readonly SWEET_SPOT_HIGH = 80;
  private readonly MAX_PRICE_CHANGE = 200;
  private readonly DUMP_THRESHOLD = -30;
  private readonly MAX_POSITIONS = 5;
  private readonly MIN_CONFIDENCE = 55;
  private readonly MIN_SAFETY_SCORE = 50;
  
  // Advanced filters
  private readonly MIN_ENTRY_CONFIDENCE = 60;
  private readonly RSI_OVERBOUGHT_SKIP = 75;

  /**
   * Initialize advanced services
   */
  async initialize(): Promise<void> {
    this.indicators = new TechnicalIndicators();
    
    // Initialize rug detector
    this.rugDetector = new RugDetector(this.config.rpcUrl);
    
    // Initialize volume analyzer
    this.volumeAnalyzer = new VolumeAnalyzer(this.tokenData, this.config.birdeyeApiKey);
    
    // Initialize smart money tracker
    this.smartMoney = new SmartMoneyTracker(this.config.birdeyeApiKey, this.config.heliusApiKey);
    
    // Initialize entry analyzer
    if (this.rugDetector && this.volumeAnalyzer && this.smartMoney) {
      this.entryAnalyzer = new EntryTimingAnalyzer(
        this.tokenData,
        this.rugDetector,
        this.volumeAnalyzer,
        this.smartMoney
      );
    }
    
    this.logger.info('Strategy initialized with advanced analysis');
  }

  async analyze(): Promise<TradeSignal[]> {
    // Ensure services are initialized
    if (!this.indicators) {
      await this.initialize();
    }
    
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

    // Skip new entries in very bearish market
    if (marketCondition.trend === 'bearish' && marketCondition.sentiment < -50) {
      this.logger.warn('Market too bearish, skipping new entries');
      return signals;
    }

    // 4. Get candidate tokens
    const trending = await this.tokenData.getTrendingTokens(100);
    this.logger.info(`Analyzing ${trending.length} tokens...`);

    // 5. Score and filter tokens
    const scoredTokens: TokenScore[] = [];
    
    for (const token of trending) {
      // Skip if we already have a position
      if (this.storage.getPosition(token.address)) {
        continue;
      }

      // Quick filter first (fast rejection)
      if (this.entryAnalyzer) {
        const quickCheck = await this.entryAnalyzer.quickFilter(token.address);
        if (!quickCheck.pass) {
          this.logger.debug(`${token.symbol} quick filter failed: ${quickCheck.reason}`);
          continue;
        }
      }

      // Full analysis
      const score = await this.scoreToken(token, marketCondition);
      
      if (score.redFlags.length === 0 && score.confidence >= this.MIN_CONFIDENCE) {
        // Deep entry analysis for passing tokens
        if (this.entryAnalyzer) {
          const candles = await this.getCandles(token.address);
          score.entryAnalysis = await this.entryAnalyzer.analyzeEntry(
            token.address,
            candles,
            {
              solPrice: 100, // Would need real SOL price
              solChange24h: 0,
              marketTrend: marketCondition.trend,
              volatility: marketCondition.volatility,
            }
          );
          
          // Apply entry analysis to score
          if (score.entryAnalysis.recommendation === 'skip') {
            this.logger.debug(`${token.symbol} entry analysis: SKIP - ${score.entryAnalysis.bearishReasons[0]}`);
            continue;
          }
          
          if (score.entryAnalysis.recommendation === 'wait') {
            this.logger.info(`${token.symbol} entry analysis: WAIT for better entry`);
            continue;
          }
          
          // Adjust confidence based on entry analysis
          score.confidence = Math.min(
            score.confidence,
            score.entryAnalysis.confidence
          );
        }
        
        scoredTokens.push(score);
      }
    }

    // 6. Sort by score and take top opportunities
    scoredTokens.sort((a, b) => b.score - a.score);
    
    const availableSlots = this.MAX_POSITIONS - currentPositions;
    const topPicks = scoredTokens.slice(0, Math.min(availableSlots, 3));

    // 7. Generate signals
    for (const pick of topPicks) {
      const positionSize = this.calculatePositionSize(pick, marketCondition);
      
      // Build detailed reason string
      const reasons = [
        `Score: ${pick.score}`,
        ...pick.reasons.slice(0, 2),
      ];
      
      if (pick.entryAnalysis) {
        reasons.push(`Entry: ${pick.entryAnalysis.entryType}`);
        reasons.push(`Risk: ${pick.entryAnalysis.riskLevel}`);
      }
      
      signals.push({
        type: 'buy',
        tokenMint: pick.token.address,
        symbol: pick.token.symbol,
        reason: reasons.join(' | '),
        confidence: pick.confidence,
        suggestedAmount: positionSize,
      });

      this.logger.info(
        `📈 BUY Signal: ${pick.token.symbol} | ` +
        `Score: ${pick.score} | Confidence: ${pick.confidence}% | ` +
        `Size: ${positionSize.toFixed(3)} SOL | ` +
        `Entry: ${pick.entryAnalysis?.entryType || 'immediate'}`
      );
    }

    return [...signals.filter(s => s.type === 'sell'), ...signals.filter(s => s.type === 'buy')];
  }

  /**
   * Enhanced token scoring with all services
   */
  private async scoreToken(token: TokenInfo, market: MarketCondition): Promise<TokenScore> {
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

    if (redFlags.length > 0) {
      return { token, score: 0, confidence: 0, reasons, redFlags };
    }

    // === RUG DETECTION ===
    if (this.rugDetector) {
      const rugCheck = await this.rugDetector.checkToken(token.address);
      
      if (!rugCheck.safe || rugCheck.score < this.MIN_SAFETY_SCORE) {
        redFlags.push(`Safety score: ${rugCheck.score}/100`);
        for (const risk of rugCheck.risks.filter(r => r.type === 'critical' || r.type === 'high')) {
          redFlags.push(risk.name);
        }
        return { token, score: 0, confidence: 0, reasons, redFlags };
      }
      
      // Add safety bonus
      if (rugCheck.score >= 80) {
        score += 15;
        reasons.push(`Safe: ${rugCheck.score}/100`);
      } else if (rugCheck.score >= 60) {
        score += 5;
      }
    }

    // === TECHNICAL ANALYSIS ===
    const candles = await this.getCandles(token.address);
    if (candles.length >= 20) {
      const technicals = this.indicators.analyzeOHLCV(candles);
      
      // RSI filter - skip overbought
      if (technicals.rsi.value >= this.RSI_OVERBOUGHT_SKIP) {
        redFlags.push(`RSI overbought: ${technicals.rsi.value.toFixed(0)}`);
        return { token, score: 0, confidence: 0, reasons, redFlags };
      }
      
      // RSI oversold = opportunity
      if (technicals.rsi.signal === 'oversold') {
        score += 20;
        reasons.push(`RSI oversold: ${technicals.rsi.value.toFixed(0)}`);
      }
      
      // MACD signals
      if (technicals.macd.crossover === 'bullish_cross') {
        score += 15;
        reasons.push('MACD bullish cross');
      } else if (technicals.macd.trend === 'bullish') {
        score += 8;
      } else if (technicals.macd.crossover === 'bearish_cross') {
        score -= 10;
      }
      
      // EMA alignment
      if (technicals.ema.trend === 'bullish') {
        score += 12;
        reasons.push('EMAs bullish');
      } else if (technicals.ema.trend === 'bearish') {
        score -= 8;
      }
      
      // Bollinger position
      if (technicals.bollinger.percentB < 0.2) {
        score += 10;
        reasons.push('Near lower BB');
      } else if (technicals.bollinger.percentB > 0.9) {
        score -= 5;
      }
    }

    // === VOLUME ANALYSIS ===
    if (this.volumeAnalyzer) {
      const volume = await this.volumeAnalyzer.getVolumeProfile(token.address);
      
      if (volume) {
        // Volume trend
        if (volume.volumeTrend === 'surging') {
          score += 20;
          reasons.push(`Volume surging: ${volume.volumeRatio.toFixed(1)}x`);
        } else if (volume.volumeTrend === 'increasing') {
          score += 10;
          reasons.push(`Volume up: ${volume.volumeRatio.toFixed(1)}x`);
        } else if (volume.volumeTrend === 'dying') {
          score -= 15;
        }
        
        // Buy pressure
        if (volume.buyPressure >= 65) {
          score += 15;
          reasons.push(`Buy pressure: ${volume.buyPressure.toFixed(0)}%`);
        } else if (volume.buyPressure <= 35) {
          score -= 15;
          reasons.push(`Sell pressure dominant`);
        }
      }
    }

    // === SMART MONEY ===
    if (this.smartMoney) {
      const smartActivity = await this.smartMoney.analyzeTokenActivity(token.address);
      
      if (smartActivity) {
        if (smartActivity.signal === 'bullish' && smartActivity.smartBuyers24h >= 2) {
          score += 20;
          reasons.push(`${smartActivity.smartBuyers24h} smart wallets buying`);
        } else if (smartActivity.signal === 'bearish' && smartActivity.smartSellers24h >= 2) {
          score -= 15;
          reasons.push('Smart money selling');
        }
      }
    }

    // === BASIC MOMENTUM ===
    const change = token.priceChange24h;
    if (change >= this.SWEET_SPOT_LOW && change <= this.SWEET_SPOT_HIGH) {
      score += 15;
      reasons.push(`Momentum: +${change.toFixed(1)}%`);
    } else if (change >= this.MIN_PRICE_CHANGE && change < this.SWEET_SPOT_LOW) {
      score += 8;
      reasons.push(`Early momentum: +${change.toFixed(1)}%`);
    }

    // === LIQUIDITY BONUS ===
    if (token.liquidity >= this.IDEAL_LIQUIDITY) {
      score += 10;
      reasons.push(`Strong liquidity: $${(token.liquidity / 1000).toFixed(0)}k`);
    }

    // === MARKET ADJUSTMENT ===
    if (market.trend === 'bearish') {
      score *= 0.8;
    } else if (market.trend === 'bullish') {
      score *= 1.1;
    }

    // Calculate confidence
    const maxScore = 120; // Approximate max possible score
    const rawConfidence = (score / maxScore) * 100;
    const confidence = Math.min(95, Math.max(0, rawConfidence));

    return {
      token,
      score: Math.round(score),
      confidence: Math.round(confidence),
      reasons,
      redFlags,
    };
  }

  /**
   * Get OHLCV candles for technical analysis
   */
  private async getCandles(tokenAddress: string): Promise<OHLCVCandle[]> {
    try {
      const ohlcv = await this.tokenData.getOHLCV(tokenAddress, '15m', 100);
      return ohlcv;
    } catch {
      return [];
    }
  }

  /**
   * Assess overall market conditions
   */
  private async assessMarketCondition(): Promise<MarketCondition> {
    try {
      const tokens = await this.tokenData.getTrendingTokens(30);
      
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

      const sentiment = tokens.length > 0 
        ? ((bullish - bearish) / tokens.length) * 100 
        : 0;

      return { trend, volatility, sentiment };
    } catch {
      return { trend: 'neutral', volatility: 'medium', sentiment: 0 };
    }
  }

  /**
   * Calculate position size based on analysis
   */
  private calculatePositionSize(pick: TokenScore, market: MarketCondition): number {
    const baseSize = this.config.maxTradeSizeSol;
    
    // Start with entry analysis suggestion if available
    let multiplier = pick.entryAnalysis?.suggestedSizeMultiplier || 1;
    
    // Scale by confidence
    const confidenceMultiplier = 0.4 + (pick.confidence / 100) * 0.6;
    multiplier *= confidenceMultiplier;
    
    // Scale by liquidity (safer with more liquidity)
    const liquidityMultiplier = Math.min(1, pick.token.liquidity / 100000);
    multiplier *= (0.6 + liquidityMultiplier * 0.4);
    
    // Reduce in bearish/volatile markets
    if (market.trend === 'bearish') multiplier *= 0.7;
    if (market.volatility === 'high') multiplier *= 0.8;

    // Calculate final size
    let size = baseSize * 0.3 * multiplier;
    
    // Clamp between min and max
    size = Math.max(0.02, Math.min(size, baseSize));
    
    return size;
  }
}
