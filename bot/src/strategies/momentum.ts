import { BaseStrategy, TradeSignal } from './base';
import { TokenInfo } from '../services/tokenData';

/**
 * Momentum Strategy
 * 
 * Looks for tokens with strong upward momentum:
 * - Positive price change in last 24h
 * - Good volume relative to market cap
 * - Sufficient liquidity
 * 
 * This is a simple strategy - feel free to customize!
 */
export class MomentumStrategy extends BaseStrategy {
  // Configurable thresholds
  private readonly MIN_LIQUIDITY = 10000; // $10k minimum liquidity
  private readonly MIN_VOLUME = 5000;     // $5k minimum 24h volume
  private readonly MIN_PRICE_CHANGE = 10; // Minimum 10% gain to consider
  private readonly MAX_PRICE_CHANGE = 200; // Don't chase pumps over 200%
  private readonly MAX_POSITIONS = 5;     // Max concurrent positions

  async analyze(): Promise<TradeSignal[]> {
    const signals: TradeSignal[] = [];
    
    // Check existing positions first
    const positionSignals = await this.checkPositions();
    signals.push(...positionSignals);

    // Don't look for new buys if we have max positions
    const currentPositions = this.storage.getState().positions.length;
    if (currentPositions >= this.MAX_POSITIONS) {
      this.logger.info(`Max positions (${this.MAX_POSITIONS}) reached, skipping new buys`);
      return signals;
    }

    // Get trending tokens
    const trending = await this.tokenData.getTrendingTokens(50);
    this.logger.info(`Analyzing ${trending.length} trending tokens`);

    for (const token of trending) {
      // Skip if we already have a position
      if (this.storage.getPosition(token.address)) {
        continue;
      }

      const score = this.scoreToken(token);
      if (score.confidence >= 60) {
        signals.push({
          type: 'buy',
          tokenMint: token.address,
          symbol: token.symbol,
          reason: score.reasons.join(', '),
          confidence: score.confidence,
          suggestedAmount: this.calculatePositionSize(token),
        });
      }
    }

    // Sort by confidence and take top opportunities
    const buySignals = signals
      .filter(s => s.type === 'buy')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.MAX_POSITIONS - currentPositions);

    const sellSignals = signals.filter(s => s.type === 'sell');
    
    return [...sellSignals, ...buySignals];
  }

  private scoreToken(token: TokenInfo): { confidence: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Liquidity check
    if (token.liquidity < this.MIN_LIQUIDITY) {
      return { confidence: 0, reasons: ['Insufficient liquidity'] };
    }
    score += 20;
    reasons.push(`Liquidity: $${(token.liquidity / 1000).toFixed(1)}k`);

    // Volume check
    if (token.volume24h < this.MIN_VOLUME) {
      return { confidence: 0, reasons: ['Insufficient volume'] };
    }
    score += 20;
    reasons.push(`Volume: $${(token.volume24h / 1000).toFixed(1)}k`);

    // Price momentum
    if (token.priceChange24h < this.MIN_PRICE_CHANGE) {
      return { confidence: 0, reasons: ['Not enough momentum'] };
    }
    if (token.priceChange24h > this.MAX_PRICE_CHANGE) {
      return { confidence: 0, reasons: ['Too risky - massive pump'] };
    }
    
    // Scale score based on price change (sweet spot is 20-100%)
    if (token.priceChange24h >= 20 && token.priceChange24h <= 100) {
      score += 40;
      reasons.push(`Strong momentum: +${token.priceChange24h.toFixed(1)}%`);
    } else {
      score += 20;
      reasons.push(`Momentum: +${token.priceChange24h.toFixed(1)}%`);
    }

    // Volume to market cap ratio (higher is better)
    if (token.marketCap > 0) {
      const volumeRatio = token.volume24h / token.marketCap;
      if (volumeRatio > 0.5) {
        score += 20;
        reasons.push(`High volume ratio: ${(volumeRatio * 100).toFixed(0)}%`);
      }
    }

    return { confidence: Math.min(score, 100), reasons };
  }

  private calculatePositionSize(token: TokenInfo): number {
    // Conservative: use max 20% of max trade size for newer tokens
    // More liquid tokens can get larger positions
    const liquidityMultiplier = Math.min(token.liquidity / 50000, 1);
    const baseSize = this.config.maxTradeSizeSol;
    
    return baseSize * 0.2 * (0.5 + 0.5 * liquidityMultiplier);
  }
}
