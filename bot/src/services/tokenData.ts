import axios from 'axios';
import { Logger } from '../utils/logger';

const BIRDEYE_API = 'https://public-api.birdeye.so';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest';

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  holders?: number;
  createdAt?: Date;
}

export interface TokenTrade {
  txHash: string;
  timestamp: Date;
  type: 'buy' | 'sell';
  tokenAmount: number;
  solAmount: number;
  pricePerToken: number;
  wallet: string;
}

export class TokenDataService {
  private birdeyeApiKey: string | null;
  private logger: Logger;

  constructor(birdeyeApiKey: string | null = null) {
    this.birdeyeApiKey = birdeyeApiKey;
    this.logger = new Logger('TokenData');
  }

  /**
   * Get token info from DexScreener (no API key needed)
   */
  async getTokenInfo(mintAddress: string): Promise<TokenInfo | null> {
    try {
      const response = await axios.get(
        `${DEXSCREENER_API}/dex/tokens/${mintAddress}`
      );
      
      const pairs = response.data.pairs;
      if (!pairs || pairs.length === 0) return null;

      // Use the pair with highest liquidity
      const pair = pairs.reduce((best: any, current: any) => 
        (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best
      );

      return {
        address: mintAddress,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        decimals: 9, // Default for most Solana tokens
        price: parseFloat(pair.priceUsd) || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        volume24h: pair.volume?.h24 || 0,
        liquidity: pair.liquidity?.usd || 0,
        marketCap: pair.marketCap || 0,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get token info: ${error.message}`);
      return null;
    }
  }

  /**
   * Get trending tokens from DexScreener
   */
  async getTrendingTokens(limit: number = 20): Promise<TokenInfo[]> {
    try {
      const response = await axios.get(
        `${DEXSCREENER_API}/dex/search?q=solana`
      );
      
      const pairs = response.data.pairs || [];
      const solanaPairs = pairs
        .filter((p: any) => p.chainId === 'solana')
        .slice(0, limit);

      return solanaPairs.map((pair: any) => ({
        address: pair.baseToken.address,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        decimals: 9,
        price: parseFloat(pair.priceUsd) || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        volume24h: pair.volume?.h24 || 0,
        liquidity: pair.liquidity?.usd || 0,
        marketCap: pair.marketCap || 0,
      }));
    } catch (error: any) {
      this.logger.error(`Failed to get trending tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Get new token launches (using Birdeye if available)
   */
  async getNewTokens(minLiquidity: number = 1000): Promise<TokenInfo[]> {
    if (!this.birdeyeApiKey) {
      this.logger.warn('Birdeye API key not set, using DexScreener fallback');
      return this.getTrendingTokens(10);
    }

    try {
      const response = await axios.get(
        `${BIRDEYE_API}/defi/tokenlist`,
        {
          headers: { 'X-API-KEY': this.birdeyeApiKey },
          params: {
            sort_by: 'v24hUSD',
            sort_type: 'desc',
            offset: 0,
            limit: 50,
          },
        }
      );

      return response.data.data.tokens
        .filter((t: any) => t.liquidity >= minLiquidity)
        .map((t: any) => ({
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          price: t.price,
          priceChange24h: t.priceChange24h,
          volume24h: t.v24hUSD,
          liquidity: t.liquidity,
          marketCap: t.mc,
        }));
    } catch (error: any) {
      this.logger.error(`Failed to get new tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if a token is safe to trade (basic checks)
   */
  async isTokenSafe(mintAddress: string): Promise<{ safe: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    
    const info = await this.getTokenInfo(mintAddress);
    if (!info) {
      return { safe: false, reasons: ['Token not found'] };
    }

    // Check liquidity
    if (info.liquidity < 5000) {
      reasons.push(`Low liquidity: $${info.liquidity}`);
    }

    // Check volume
    if (info.volume24h < 1000) {
      reasons.push(`Low volume: $${info.volume24h}`);
    }

    // Extreme price change could indicate manipulation
    if (Math.abs(info.priceChange24h) > 500) {
      reasons.push(`Extreme price change: ${info.priceChange24h}%`);
    }

    return {
      safe: reasons.length === 0,
      reasons,
    };
  }
}
