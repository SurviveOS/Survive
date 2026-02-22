import axios from 'axios';
import { Logger } from '../utils/logger';
import { TokenDataService } from './tokenData';

const BIRDEYE_API = 'https://public-api.birdeye.so';

export interface VolumeProfile {
  token: string;
  symbol: string;
  
  // Volume metrics
  volume24h: number;
  volume1h: number;
  volume5m: number;
  avgVolume: number;        // 7-day average
  volumeRatio: number;      // current vs average
  
  // Buy/Sell analysis
  buyVolume24h: number;
  sellVolume24h: number;
  buyCount24h: number;
  sellCount24h: number;
  buyPressure: number;      // 0-100 (100 = all buys)
  
  // Trade size analysis
  avgTradeSize: number;
  largeTradesCount: number;
  smallTradesCount: number;
  
  // Trend
  volumeTrend: 'surging' | 'increasing' | 'stable' | 'decreasing' | 'dying';
  pressureTrend: 'buy_dominant' | 'balanced' | 'sell_dominant';
  
  // Signal
  signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  confidence: number;
}

export interface TradeFlow {
  timestamp: Date;
  type: 'buy' | 'sell';
  amount: number;
  value: number;
  price: number;
  wallet: string;
  isLargeTrade: boolean;
  isSmartMoney: boolean;
}

export interface OrderFlowAnalysis {
  token: string;
  
  // Cumulative delta (buys - sells)
  cumulativeDelta: number;
  deltaTrend: 'bullish' | 'bearish' | 'neutral';
  
  // Large trade analysis
  largeBuyCount: number;
  largeSellCount: number;
  largeBuyValue: number;
  largeSellValue: number;
  
  // Imbalance detection
  imbalance: number;         // -100 to 100
  imbalanceSignal: 'absorption' | 'exhaustion' | 'neutral';
  
  // VWAP
  vwap: number;
  priceVsVwap: 'above' | 'below' | 'at';
}

/**
 * Volume Analysis Service
 * 
 * Analyzes trading volume to detect:
 * - Buy vs sell pressure
 * - Volume trends and anomalies
 * - Large trade detection
 * - Order flow imbalances
 * - VWAP analysis
 */
export class VolumeAnalyzer {
  private logger: Logger;
  private birdeyeApiKey: string | null;
  private tokenData: TokenDataService;
  
  // Thresholds
  private readonly LARGE_TRADE_USD = 5000;
  private readonly VOLUME_SURGE_RATIO = 3;
  private readonly PRESSURE_THRESHOLD = 60;

  constructor(tokenData: TokenDataService, birdeyeApiKey: string | null = null) {
    this.logger = new Logger('VolumeAnalyzer');
    this.birdeyeApiKey = birdeyeApiKey;
    this.tokenData = tokenData;
  }

  /**
   * Get full volume profile for a token
   */
  async getVolumeProfile(tokenAddress: string): Promise<VolumeProfile | null> {
    try {
      // Get token info
      const tokenInfo = await this.tokenData.getTokenInfo(tokenAddress);
      if (!tokenInfo) return null;

      // Get detailed volume data from Birdeye if available
      let buyVolume24h = 0;
      let sellVolume24h = 0;
      let buyCount24h = 0;
      let sellCount24h = 0;
      let avgVolume = tokenInfo.volume24h;
      let volume1h = tokenInfo.volume1h || tokenInfo.volume24h / 24;
      let volume5m = volume1h / 12;

      if (this.birdeyeApiKey) {
        const detailed = await this.getDetailedVolume(tokenAddress);
        if (detailed) {
          buyVolume24h = detailed.buyVolume;
          sellVolume24h = detailed.sellVolume;
          buyCount24h = detailed.buyCount;
          sellCount24h = detailed.sellCount;
          avgVolume = detailed.avgVolume || avgVolume;
          volume1h = detailed.volume1h || volume1h;
          volume5m = detailed.volume5m || volume5m;
        }
      }

      // Calculate metrics
      const volumeRatio = avgVolume > 0 ? tokenInfo.volume24h / avgVolume : 1;
      const totalTrades = buyCount24h + sellCount24h;
      const buyPressure = totalTrades > 0 ? (buyCount24h / totalTrades) * 100 : 50;
      
      // Determine volume trend
      let volumeTrend: VolumeProfile['volumeTrend'] = 'stable';
      if (volumeRatio >= this.VOLUME_SURGE_RATIO) {
        volumeTrend = 'surging';
      } else if (volumeRatio >= 1.5) {
        volumeTrend = 'increasing';
      } else if (volumeRatio <= 0.3) {
        volumeTrend = 'dying';
      } else if (volumeRatio <= 0.7) {
        volumeTrend = 'decreasing';
      }

      // Determine pressure trend
      let pressureTrend: VolumeProfile['pressureTrend'] = 'balanced';
      if (buyPressure >= this.PRESSURE_THRESHOLD) {
        pressureTrend = 'buy_dominant';
      } else if (buyPressure <= 100 - this.PRESSURE_THRESHOLD) {
        pressureTrend = 'sell_dominant';
      }

      // Calculate signal
      const { signal, confidence } = this.calculateVolumeSignal(
        volumeTrend, 
        pressureTrend, 
        volumeRatio,
        buyPressure
      );

      return {
        token: tokenAddress,
        symbol: tokenInfo.symbol,
        volume24h: tokenInfo.volume24h,
        volume1h,
        volume5m,
        avgVolume,
        volumeRatio,
        buyVolume24h,
        sellVolume24h,
        buyCount24h,
        sellCount24h,
        buyPressure,
        avgTradeSize: totalTrades > 0 ? tokenInfo.volume24h / totalTrades : 0,
        largeTradesCount: 0, // Would need trade-level data
        smallTradesCount: 0,
        volumeTrend,
        pressureTrend,
        signal,
        confidence,
      };
    } catch (error: any) {
      this.logger.error(`Volume profile failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get detailed volume from Birdeye
   */
  private async getDetailedVolume(tokenAddress: string): Promise<{
    buyVolume: number;
    sellVolume: number;
    buyCount: number;
    sellCount: number;
    avgVolume: number;
    volume1h: number;
    volume5m: number;
  } | null> {
    if (!this.birdeyeApiKey) return null;

    try {
      const response = await axios.get(`${BIRDEYE_API}/defi/token_overview`, {
        headers: { 'X-API-KEY': this.birdeyeApiKey },
        params: { address: tokenAddress },
      });

      const data = response.data.data;
      if (!data) return null;

      return {
        buyVolume: data.buy24hUSD || 0,
        sellVolume: data.sell24hUSD || 0,
        buyCount: data.buy24h || 0,
        sellCount: data.sell24h || 0,
        avgVolume: data.v24hUSD || 0, // Would ideally be 7-day average
        volume1h: data.v1hUSD || 0,
        volume5m: data.v5mUSD || 0,
      };
    } catch (error: any) {
      this.logger.debug(`Detailed volume fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Analyze order flow (requires trade-level data)
   */
  async analyzeOrderFlow(tokenAddress: string, trades: TradeFlow[]): Promise<OrderFlowAnalysis> {
    let cumulativeDelta = 0;
    let largeBuyCount = 0;
    let largeSellCount = 0;
    let largeBuyValue = 0;
    let largeSellValue = 0;
    let totalBuyValue = 0;
    let totalSellValue = 0;
    let volumeWeightedPrice = 0;
    let totalVolume = 0;

    for (const trade of trades) {
      // Cumulative delta
      if (trade.type === 'buy') {
        cumulativeDelta += trade.value;
        totalBuyValue += trade.value;
        
        if (trade.isLargeTrade || trade.value >= this.LARGE_TRADE_USD) {
          largeBuyCount++;
          largeBuyValue += trade.value;
        }
      } else {
        cumulativeDelta -= trade.value;
        totalSellValue += trade.value;
        
        if (trade.isLargeTrade || trade.value >= this.LARGE_TRADE_USD) {
          largeSellCount++;
          largeSellValue += trade.value;
        }
      }

      // VWAP calculation
      volumeWeightedPrice += trade.price * trade.value;
      totalVolume += trade.value;
    }

    const vwap = totalVolume > 0 ? volumeWeightedPrice / totalVolume : 0;
    const currentPrice = trades.length > 0 ? trades[trades.length - 1].price : vwap;

    // Determine delta trend
    let deltaTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    const totalValue = totalBuyValue + totalSellValue;
    if (totalValue > 0) {
      const deltaPercent = (cumulativeDelta / totalValue) * 100;
      if (deltaPercent > 20) deltaTrend = 'bullish';
      else if (deltaPercent < -20) deltaTrend = 'bearish';
    }

    // Calculate imbalance (-100 to 100)
    const largeNetValue = largeBuyValue - largeSellValue;
    const largeTotalValue = largeBuyValue + largeSellValue;
    const imbalance = largeTotalValue > 0 
      ? (largeNetValue / largeTotalValue) * 100 
      : 0;

    // Detect absorption/exhaustion
    let imbalanceSignal: 'absorption' | 'exhaustion' | 'neutral' = 'neutral';
    if (Math.abs(imbalance) > 50) {
      // High imbalance with price not moving much = absorption
      // High imbalance with price moving = exhaustion
      imbalanceSignal = 'absorption'; // Simplified - would need price comparison
    }

    // Price vs VWAP
    let priceVsVwap: 'above' | 'below' | 'at' = 'at';
    if (vwap > 0) {
      const diff = ((currentPrice - vwap) / vwap) * 100;
      if (diff > 2) priceVsVwap = 'above';
      else if (diff < -2) priceVsVwap = 'below';
    }

    return {
      token: tokenAddress,
      cumulativeDelta,
      deltaTrend,
      largeBuyCount,
      largeSellCount,
      largeBuyValue,
      largeSellValue,
      imbalance,
      imbalanceSignal,
      vwap,
      priceVsVwap,
    };
  }

  /**
   * Calculate volume-based signal
   */
  private calculateVolumeSignal(
    volumeTrend: VolumeProfile['volumeTrend'],
    pressureTrend: VolumeProfile['pressureTrend'],
    volumeRatio: number,
    buyPressure: number
  ): { signal: VolumeProfile['signal']; confidence: number } {
    let score = 0;

    // Volume trend contribution (-30 to +30)
    switch (volumeTrend) {
      case 'surging': score += 30; break;
      case 'increasing': score += 15; break;
      case 'stable': score += 0; break;
      case 'decreasing': score -= 15; break;
      case 'dying': score -= 30; break;
    }

    // Pressure trend contribution (-40 to +40)
    switch (pressureTrend) {
      case 'buy_dominant': score += 40; break;
      case 'balanced': score += 0; break;
      case 'sell_dominant': score -= 40; break;
    }

    // Buy pressure fine-tuning
    if (buyPressure > 70) score += 20;
    else if (buyPressure > 60) score += 10;
    else if (buyPressure < 30) score -= 20;
    else if (buyPressure < 40) score -= 10;

    // Clamp score
    score = Math.max(-100, Math.min(100, score));

    // Determine signal
    let signal: VolumeProfile['signal'];
    if (score >= 50) signal = 'strong_buy';
    else if (score >= 20) signal = 'buy';
    else if (score <= -50) signal = 'strong_sell';
    else if (score <= -20) signal = 'sell';
    else signal = 'neutral';

    // Confidence based on volume ratio (more volume = more confident)
    const confidence = Math.min(90, 40 + Math.abs(score) * 0.3 + (volumeRatio > 1 ? volumeRatio * 10 : 0));

    return { signal, confidence };
  }

  /**
   * Detect unusual volume activity
   */
  async detectVolumeAnomaly(tokenAddress: string): Promise<{
    isAnomaly: boolean;
    type: 'surge' | 'spike' | 'drop' | 'none';
    magnitude: number;
    description: string;
  }> {
    const profile = await this.getVolumeProfile(tokenAddress);
    
    if (!profile) {
      return { isAnomaly: false, type: 'none', magnitude: 0, description: 'Could not fetch data' };
    }

    const ratio = profile.volumeRatio;

    if (ratio >= 5) {
      return {
        isAnomaly: true,
        type: 'surge',
        magnitude: ratio,
        description: `Volume surge: ${ratio.toFixed(1)}x normal`,
      };
    }

    if (ratio >= 3) {
      return {
        isAnomaly: true,
        type: 'spike',
        magnitude: ratio,
        description: `Volume spike: ${ratio.toFixed(1)}x normal`,
      };
    }

    if (ratio <= 0.2) {
      return {
        isAnomaly: true,
        type: 'drop',
        magnitude: ratio,
        description: `Volume drop: only ${(ratio * 100).toFixed(0)}% of normal`,
      };
    }

    return { isAnomaly: false, type: 'none', magnitude: ratio, description: 'Normal volume' };
  }

  /**
   * Get volume summary for logging
   */
  summarize(profile: VolumeProfile): string {
    const trendEmoji = {
      surging: '🚀',
      increasing: '📈',
      stable: '➡️',
      decreasing: '📉',
      dying: '💀',
    }[profile.volumeTrend];

    const pressureEmoji = {
      buy_dominant: '🟢',
      balanced: '⚪',
      sell_dominant: '🔴',
    }[profile.pressureTrend];

    return `${trendEmoji} Vol: ${profile.volumeRatio.toFixed(1)}x | ${pressureEmoji} Buy: ${profile.buyPressure.toFixed(0)}% | Signal: ${profile.signal}`;
  }
}
