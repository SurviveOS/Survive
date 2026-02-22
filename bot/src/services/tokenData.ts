import axios from 'axios';
import { Logger } from '../utils/logger';

const BIRDEYE_API = 'https://public-api.birdeye.so';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest';
const JUPITER_PRICE_API = 'https://price.jup.ag/v6';

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  priceChange24h: number;
  priceChange1h?: number;
  priceChange5m?: number;
  volume24h: number;
  volume1h?: number;
  liquidity: number;
  marketCap: number;
  holders?: number;
  createdAt?: Date;
  lastTradeTime?: Date;
  buyCount24h?: number;
  sellCount24h?: number;
  uniqueWallets24h?: number;
}

export interface NewToken {
  address: string;
  symbol: string;
  name: string;
  liquidity: number;
  createdAt: Date;
  price: number;
  priceChange: number;
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

export interface SafetyCheck {
  safe: boolean;
  score: number; // 0-100
  reasons: string[];
  warnings: string[];
}

export class TokenDataService {
  private birdeyeApiKey: string | null;
  private logger: Logger;
  private priceCache: Map<string, { price: number; timestamp: number }>;
  private readonly CACHE_TTL = 5000; // 5 seconds

  constructor(birdeyeApiKey: string | null = null) {
    this.birdeyeApiKey = birdeyeApiKey;
    this.logger = new Logger('TokenData');
    this.priceCache = new Map();
    
    if (this.birdeyeApiKey) {
      this.logger.info('Birdeye API enabled');
    } else {
      this.logger.warn('Birdeye API not configured, using DexScreener fallback');
    }
  }

  /**
   * Get token info - uses Birdeye if available, falls back to DexScreener
   */
  async getTokenInfo(mintAddress: string): Promise<TokenInfo | null> {
    if (this.birdeyeApiKey) {
      return this.getTokenInfoBirdeye(mintAddress);
    }
    return this.getTokenInfoDexScreener(mintAddress);
  }

  /**
   * Get token info from Birdeye (more detailed)
   */
  private async getTokenInfoBirdeye(mintAddress: string): Promise<TokenInfo | null> {
    try {
      // Get token overview
      const [overviewRes, securityRes] = await Promise.all([
        axios.get(`${BIRDEYE_API}/defi/token_overview`, {
          headers: { 'X-API-KEY': this.birdeyeApiKey! },
          params: { address: mintAddress },
        }),
        axios.get(`${BIRDEYE_API}/defi/token_security`, {
          headers: { 'X-API-KEY': this.birdeyeApiKey! },
          params: { address: mintAddress },
        }).catch(() => null),
      ]);

      const data = overviewRes.data.data;
      if (!data) return null;

      return {
        address: mintAddress,
        symbol: data.symbol || 'UNKNOWN',
        name: data.name || 'Unknown Token',
        decimals: data.decimals || 9,
        price: data.price || 0,
        priceChange24h: data.priceChange24hPercent || 0,
        priceChange1h: data.priceChange1hPercent,
        priceChange5m: data.priceChange5mPercent,
        volume24h: data.v24hUSD || 0,
        volume1h: data.v1hUSD,
        liquidity: data.liquidity || 0,
        marketCap: data.mc || 0,
        holders: data.holder,
        lastTradeTime: data.lastTradeUnixTime ? new Date(data.lastTradeUnixTime * 1000) : undefined,
        buyCount24h: data.buy24h,
        sellCount24h: data.sell24h,
        uniqueWallets24h: data.uniqueWallet24h,
      };
    } catch (error: any) {
      this.logger.error(`Birdeye getTokenInfo failed: ${error.message}`);
      // Fallback to DexScreener
      return this.getTokenInfoDexScreener(mintAddress);
    }
  }

  /**
   * Get token info from DexScreener (free, no API key)
   */
  private async getTokenInfoDexScreener(mintAddress: string): Promise<TokenInfo | null> {
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
        decimals: 9,
        price: parseFloat(pair.priceUsd) || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        priceChange1h: pair.priceChange?.h1,
        priceChange5m: pair.priceChange?.m5,
        volume24h: pair.volume?.h24 || 0,
        volume1h: pair.volume?.h1,
        liquidity: pair.liquidity?.usd || 0,
        marketCap: pair.marketCap || 0,
      };
    } catch (error: any) {
      this.logger.error(`DexScreener getTokenInfo failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get trending/hot tokens - prioritizes Birdeye for quality
   */
  async getTrendingTokens(limit: number = 50): Promise<TokenInfo[]> {
    if (this.birdeyeApiKey) {
      const birdeye = await this.getTrendingBirdeye(limit);
      if (birdeye.length > 0) return birdeye;
    }
    return this.getTrendingDexScreener(limit);
  }

  /**
   * Get trending tokens from Birdeye
   */
  private async getTrendingBirdeye(limit: number): Promise<TokenInfo[]> {
    try {
      // Get tokens sorted by 24h volume
      const response = await axios.get(`${BIRDEYE_API}/defi/tokenlist`, {
        headers: { 'X-API-KEY': this.birdeyeApiKey! },
        params: {
          sort_by: 'v24hUSD',
          sort_type: 'desc',
          offset: 0,
          limit: limit,
        },
      });

      const tokens = response.data.data?.tokens || [];
      
      return tokens.map((t: any) => ({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals || 9,
        price: t.price || 0,
        priceChange24h: t.priceChange24hPercent || 0,
        volume24h: t.v24hUSD || 0,
        liquidity: t.liquidity || 0,
        marketCap: t.mc || 0,
      }));
    } catch (error: any) {
      this.logger.error(`Birdeye trending failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get trending tokens from DexScreener
   */
  private async getTrendingDexScreener(limit: number): Promise<TokenInfo[]> {
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
        priceChange1h: pair.priceChange?.h1,
        volume24h: pair.volume?.h24 || 0,
        volume1h: pair.volume?.h1,
        liquidity: pair.liquidity?.usd || 0,
        marketCap: pair.marketCap || 0,
      }));
    } catch (error: any) {
      this.logger.error(`DexScreener trending failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get newly launched tokens (last 24h) - Birdeye only
   */
  async getNewTokens(minLiquidity: number = 5000, maxAgeHours: number = 24): Promise<NewToken[]> {
    if (!this.birdeyeApiKey) {
      this.logger.warn('New token discovery requires Birdeye API key');
      return [];
    }

    try {
      const response = await axios.get(`${BIRDEYE_API}/defi/tokenlist`, {
        headers: { 'X-API-KEY': this.birdeyeApiKey },
        params: {
          sort_by: 'lastTradeUnixTime',
          sort_type: 'desc',
          offset: 0,
          limit: 100,
        },
      });

      const tokens = response.data.data?.tokens || [];
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);

      return tokens
        .filter((t: any) => {
          const createdTime = t.lastTradeUnixTime ? t.lastTradeUnixTime * 1000 : 0;
          return (
            t.liquidity >= minLiquidity &&
            createdTime >= cutoffTime
          );
        })
        .map((t: any) => ({
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          liquidity: t.liquidity,
          createdAt: new Date(t.lastTradeUnixTime * 1000),
          price: t.price,
          priceChange: t.priceChange24hPercent || 0,
        }));
    } catch (error: any) {
      this.logger.error(`New tokens fetch failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get gainers (tokens with biggest gains)
   */
  async getTopGainers(limit: number = 20, timeframe: '5m' | '1h' | '24h' = '24h'): Promise<TokenInfo[]> {
    if (!this.birdeyeApiKey) {
      // DexScreener doesn't have a gainers endpoint, use trending
      return this.getTrendingDexScreener(limit);
    }

    try {
      const sortField = {
        '5m': 'priceChange5mPercent',
        '1h': 'priceChange1hPercent',
        '24h': 'priceChange24hPercent',
      }[timeframe];

      const response = await axios.get(`${BIRDEYE_API}/defi/tokenlist`, {
        headers: { 'X-API-KEY': this.birdeyeApiKey },
        params: {
          sort_by: sortField,
          sort_type: 'desc',
          offset: 0,
          limit: limit,
        },
      });

      const tokens = response.data.data?.tokens || [];
      
      return tokens.map((t: any) => ({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals || 9,
        price: t.price || 0,
        priceChange24h: t.priceChange24hPercent || 0,
        priceChange1h: t.priceChange1hPercent,
        priceChange5m: t.priceChange5mPercent,
        volume24h: t.v24hUSD || 0,
        liquidity: t.liquidity || 0,
        marketCap: t.mc || 0,
      }));
    } catch (error: any) {
      this.logger.error(`Top gainers fetch failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get token price from Jupiter (fast, reliable)
   */
  async getPrice(mintAddress: string): Promise<number | null> {
    // Check cache first
    const cached = this.priceCache.get(mintAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    try {
      const response = await axios.get(`${JUPITER_PRICE_API}/price`, {
        params: { ids: mintAddress },
      });

      const priceData = response.data.data?.[mintAddress];
      if (!priceData) return null;

      const price = priceData.price;
      this.priceCache.set(mintAddress, { price, timestamp: Date.now() });
      
      return price;
    } catch (error: any) {
      this.logger.error(`Jupiter price fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get multiple token prices at once
   */
  async getPrices(mintAddresses: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    
    try {
      const response = await axios.get(`${JUPITER_PRICE_API}/price`, {
        params: { ids: mintAddresses.join(',') },
      });

      const data = response.data.data || {};
      for (const [address, priceData] of Object.entries(data)) {
        const price = (priceData as any).price;
        if (price) {
          prices.set(address, price);
          this.priceCache.set(address, { price, timestamp: Date.now() });
        }
      }
    } catch (error: any) {
      this.logger.error(`Batch price fetch failed: ${error.message}`);
    }

    return prices;
  }

  /**
   * Comprehensive token safety check
   */
  async isTokenSafe(mintAddress: string): Promise<SafetyCheck> {
    const warnings: string[] = [];
    const reasons: string[] = [];
    let score = 100;

    const info = await this.getTokenInfo(mintAddress);
    if (!info) {
      return { safe: false, score: 0, reasons: ['Token not found'], warnings: [] };
    }

    // Liquidity checks
    if (info.liquidity < 5000) {
      reasons.push(`Very low liquidity: $${info.liquidity.toLocaleString()}`);
      score -= 50;
    } else if (info.liquidity < 10000) {
      warnings.push(`Low liquidity: $${info.liquidity.toLocaleString()}`);
      score -= 20;
    } else if (info.liquidity < 25000) {
      warnings.push(`Moderate liquidity: $${info.liquidity.toLocaleString()}`);
      score -= 10;
    }

    // Volume checks
    if (info.volume24h < 1000) {
      reasons.push(`Very low volume: $${info.volume24h.toLocaleString()}`);
      score -= 30;
    } else if (info.volume24h < 5000) {
      warnings.push(`Low volume: $${info.volume24h.toLocaleString()}`);
      score -= 15;
    }

    // Price movement checks
    if (Math.abs(info.priceChange24h) > 500) {
      reasons.push(`Extreme price change: ${info.priceChange24h.toFixed(0)}%`);
      score -= 40;
    } else if (Math.abs(info.priceChange24h) > 300) {
      warnings.push(`Large price swing: ${info.priceChange24h.toFixed(0)}%`);
      score -= 20;
    }

    // Dump detection
    if (info.priceChange24h < -50) {
      reasons.push(`Token dumping: ${info.priceChange24h.toFixed(0)}%`);
      score -= 30;
    }

    // Short-term volatility (if available)
    if (info.priceChange5m && Math.abs(info.priceChange5m) > 20) {
      warnings.push(`High 5m volatility: ${info.priceChange5m.toFixed(1)}%`);
      score -= 10;
    }

    // Buy/sell ratio (if available from Birdeye)
    if (info.buyCount24h && info.sellCount24h) {
      const ratio = info.sellCount24h / info.buyCount24h;
      if (ratio > 2) {
        warnings.push(`High sell pressure: ${ratio.toFixed(1)}x more sells than buys`);
        score -= 15;
      }
    }

    score = Math.max(0, score);
    
    return {
      safe: score >= 50 && reasons.length === 0,
      score,
      reasons,
      warnings,
    };
  }

  /**
   * Get OHLCV data for a token (Birdeye only)
   */
  async getOHLCV(
    mintAddress: string, 
    interval: '1m' | '5m' | '15m' | '1H' | '4H' | '1D' = '15m',
    limit: number = 100
  ): Promise<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]> {
    if (!this.birdeyeApiKey) {
      this.logger.warn('OHLCV data requires Birdeye API key');
      return [];
    }

    try {
      const response = await axios.get(`${BIRDEYE_API}/defi/ohlcv`, {
        headers: { 'X-API-KEY': this.birdeyeApiKey },
        params: {
          address: mintAddress,
          type: interval,
          time_from: Math.floor((Date.now() - limit * 15 * 60 * 1000) / 1000),
          time_to: Math.floor(Date.now() / 1000),
        },
      });

      const items = response.data.data?.items || [];
      return items.map((item: any) => ({
        time: item.unixTime * 1000,
        open: item.o,
        high: item.h,
        low: item.l,
        close: item.c,
        volume: item.v,
      }));
    } catch (error: any) {
      this.logger.error(`OHLCV fetch failed: ${error.message}`);
      return [];
    }
  }
}
