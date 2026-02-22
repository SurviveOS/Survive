import axios from 'axios';
import { Logger } from '../utils/logger';

const BIRDEYE_API = 'https://public-api.birdeye.so';
const HELIUS_API = 'https://api.helius.xyz/v0';

export interface SmartWallet {
  address: string;
  label?: string;
  winRate: number;        // 0-100
  totalTrades: number;
  totalProfit: number;    // in USD
  avgHoldTime: number;    // in hours
  recentActivity: 'active' | 'moderate' | 'inactive';
  tags: string[];         // e.g., ['whale', 'sniper', 'degen']
  lastSeen: Date;
}

export interface WalletTrade {
  wallet: string;
  token: string;
  symbol: string;
  type: 'buy' | 'sell';
  amount: number;
  value: number;
  timestamp: Date;
  txHash: string;
  profit?: number;
}

export interface SmartMoneySignal {
  type: 'accumulation' | 'distribution' | 'new_entry' | 'whale_buy' | 'whale_sell';
  token: string;
  symbol: string;
  walletCount: number;
  totalValue: number;
  avgWinRate: number;
  confidence: number;     // 0-100
  description: string;
}

export interface TokenSmartMoneyActivity {
  token: string;
  symbol: string;
  smartBuyers24h: number;
  smartSellers24h: number;
  netFlow: number;        // Positive = accumulation
  topBuyers: SmartWallet[];
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
}

/**
 * Smart Money Tracking Service
 * 
 * Tracks and follows profitable wallets:
 * - Identifies wallets with high win rates
 * - Monitors their trades in real-time
 * - Generates signals when smart money moves
 * - Tracks whale accumulation/distribution
 */
export class SmartMoneyTracker {
  private logger: Logger;
  private birdeyeApiKey: string | null;
  private heliusApiKey: string | null;
  
  // Tracked wallets
  private smartWallets: Map<string, SmartWallet>;
  private walletTrades: Map<string, WalletTrade[]>;
  
  // Configuration
  private readonly MIN_WIN_RATE = 55;           // Minimum win rate to track
  private readonly MIN_TRADES = 20;             // Minimum trades to qualify
  private readonly MIN_PROFIT = 1000;           // Minimum profit in USD
  private readonly WHALE_THRESHOLD = 10000;     // USD value for whale trades
  private readonly SMART_MONEY_COUNT = 3;       // Min smart wallets for signal

  constructor(birdeyeApiKey: string | null = null, heliusApiKey: string | null = null) {
    this.logger = new Logger('SmartMoney');
    this.birdeyeApiKey = birdeyeApiKey;
    this.heliusApiKey = heliusApiKey;
    this.smartWallets = new Map();
    this.walletTrades = new Map();

    if (!birdeyeApiKey) {
      this.logger.warn('Birdeye API key required for smart money tracking');
    }
  }

  /**
   * Discover profitable wallets from recent token trades
   */
  async discoverSmartWallets(tokenAddress: string): Promise<SmartWallet[]> {
    if (!this.birdeyeApiKey) return [];

    try {
      // Get recent traders of the token
      const response = await axios.get(`${BIRDEYE_API}/defi/v2/tokens/${tokenAddress}/traders`, {
        headers: { 'X-API-KEY': this.birdeyeApiKey },
        params: {
          time_frame: '24h',
          sort_type: 'desc',
          sort_by: 'profit',
          limit: 100,
        },
      });

      const traders = response.data.data?.items || [];
      const smartWallets: SmartWallet[] = [];

      for (const trader of traders) {
        // Filter for smart money criteria
        if (
          trader.winRate >= this.MIN_WIN_RATE &&
          trader.totalTrades >= this.MIN_TRADES &&
          trader.totalProfitUSD >= this.MIN_PROFIT
        ) {
          const wallet: SmartWallet = {
            address: trader.wallet,
            winRate: trader.winRate,
            totalTrades: trader.totalTrades,
            totalProfit: trader.totalProfitUSD,
            avgHoldTime: trader.avgHoldTimeHours || 0,
            recentActivity: this.categorizeActivity(trader.lastTradeTime),
            tags: this.generateTags(trader),
            lastSeen: new Date(trader.lastTradeTime * 1000),
          };

          smartWallets.push(wallet);
          this.smartWallets.set(wallet.address, wallet);
        }
      }

      this.logger.info(`Discovered ${smartWallets.length} smart wallets for ${tokenAddress}`);
      return smartWallets;
    } catch (error: any) {
      this.logger.error(`Smart wallet discovery failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get recent trades by smart wallets for a token
   */
  async getSmartMoneyTrades(tokenAddress: string, hours: number = 24): Promise<WalletTrade[]> {
    if (!this.birdeyeApiKey) return [];

    try {
      const response = await axios.get(`${BIRDEYE_API}/defi/txs/token`, {
        headers: { 'X-API-KEY': this.birdeyeApiKey },
        params: {
          address: tokenAddress,
          tx_type: 'swap',
          limit: 100,
        },
      });

      const txs = response.data.data?.items || [];
      const trades: WalletTrade[] = [];
      const cutoff = Date.now() - hours * 60 * 60 * 1000;

      for (const tx of txs) {
        const timestamp = tx.blockUnixTime * 1000;
        if (timestamp < cutoff) continue;

        const wallet = tx.owner;
        const smartWallet = this.smartWallets.get(wallet);

        // Only track if it's a known smart wallet
        if (smartWallet) {
          trades.push({
            wallet,
            token: tokenAddress,
            symbol: tx.tokenSymbol || 'UNKNOWN',
            type: tx.side === 'buy' ? 'buy' : 'sell',
            amount: tx.tokenAmount,
            value: tx.usdValue || 0,
            timestamp: new Date(timestamp),
            txHash: tx.txHash,
          });
        }
      }

      return trades;
    } catch (error: any) {
      this.logger.error(`Smart money trades fetch failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Analyze smart money activity for a token
   */
  async analyzeTokenActivity(tokenAddress: string): Promise<TokenSmartMoneyActivity | null> {
    if (!this.birdeyeApiKey) return null;

    try {
      // First discover smart wallets if not already done
      if (this.smartWallets.size < 10) {
        await this.discoverSmartWallets(tokenAddress);
      }

      // Get recent trades
      const trades = await this.getSmartMoneyTrades(tokenAddress, 24);

      if (trades.length === 0) {
        return null;
      }

      // Analyze buy/sell activity
      const buyers = new Set<string>();
      const sellers = new Set<string>();
      let buyValue = 0;
      let sellValue = 0;

      for (const trade of trades) {
        if (trade.type === 'buy') {
          buyers.add(trade.wallet);
          buyValue += trade.value;
        } else {
          sellers.add(trade.wallet);
          sellValue += trade.value;
        }
      }

      const netFlow = buyValue - sellValue;
      
      // Determine signal
      let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      let confidence = 50;

      if (buyers.size >= this.SMART_MONEY_COUNT && netFlow > 0) {
        signal = 'bullish';
        confidence = Math.min(90, 50 + (buyers.size * 5) + (netFlow / 1000));
      } else if (sellers.size >= this.SMART_MONEY_COUNT && netFlow < 0) {
        signal = 'bearish';
        confidence = Math.min(90, 50 + (sellers.size * 5) + (Math.abs(netFlow) / 1000));
      }

      // Get top buyers
      const topBuyers = Array.from(buyers)
        .map(addr => this.smartWallets.get(addr)!)
        .filter(Boolean)
        .sort((a, b) => b.winRate - a.winRate)
        .slice(0, 5);

      return {
        token: tokenAddress,
        symbol: trades[0]?.symbol || 'UNKNOWN',
        smartBuyers24h: buyers.size,
        smartSellers24h: sellers.size,
        netFlow,
        topBuyers,
        signal,
        confidence,
      };
    } catch (error: any) {
      this.logger.error(`Token activity analysis failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get signals from all tracked smart wallets
   */
  async getSmartMoneySignals(): Promise<SmartMoneySignal[]> {
    if (!this.birdeyeApiKey) return [];

    const signals: SmartMoneySignal[] = [];

    try {
      // Get recent trades from all tracked wallets
      const recentTrades = new Map<string, WalletTrade[]>();

      // Group trades by token
      for (const [walletAddr, wallet] of this.smartWallets) {
        const walletTrades = this.walletTrades.get(walletAddr) || [];
        
        for (const trade of walletTrades) {
          const tokenTrades = recentTrades.get(trade.token) || [];
          tokenTrades.push(trade);
          recentTrades.set(trade.token, tokenTrades);
        }
      }

      // Generate signals for each token with significant activity
      for (const [token, trades] of recentTrades) {
        const buyTrades = trades.filter(t => t.type === 'buy');
        const sellTrades = trades.filter(t => t.type === 'sell');

        const buyWallets = new Set(buyTrades.map(t => t.wallet));
        const sellWallets = new Set(sellTrades.map(t => t.wallet));

        const totalBuyValue = buyTrades.reduce((sum, t) => sum + t.value, 0);
        const totalSellValue = sellTrades.reduce((sum, t) => sum + t.value, 0);

        // Accumulation signal
        if (buyWallets.size >= this.SMART_MONEY_COUNT && totalBuyValue > totalSellValue * 1.5) {
          const avgWinRate = Array.from(buyWallets)
            .map(w => this.smartWallets.get(w)?.winRate || 0)
            .reduce((sum, wr) => sum + wr, 0) / buyWallets.size;

          signals.push({
            type: 'accumulation',
            token,
            symbol: trades[0]?.symbol || 'UNKNOWN',
            walletCount: buyWallets.size,
            totalValue: totalBuyValue,
            avgWinRate,
            confidence: Math.min(90, 50 + buyWallets.size * 10),
            description: `${buyWallets.size} smart wallets accumulating, $${totalBuyValue.toLocaleString()} total`,
          });
        }

        // Distribution signal
        if (sellWallets.size >= this.SMART_MONEY_COUNT && totalSellValue > totalBuyValue * 1.5) {
          const avgWinRate = Array.from(sellWallets)
            .map(w => this.smartWallets.get(w)?.winRate || 0)
            .reduce((sum, wr) => sum + wr, 0) / sellWallets.size;

          signals.push({
            type: 'distribution',
            token,
            symbol: trades[0]?.symbol || 'UNKNOWN',
            walletCount: sellWallets.size,
            totalValue: totalSellValue,
            avgWinRate,
            confidence: Math.min(90, 50 + sellWallets.size * 10),
            description: `${sellWallets.size} smart wallets distributing, $${totalSellValue.toLocaleString()} total`,
          });
        }

        // Whale buy signal
        const whaleBuys = buyTrades.filter(t => t.value >= this.WHALE_THRESHOLD);
        if (whaleBuys.length > 0) {
          const totalWhaleValue = whaleBuys.reduce((sum, t) => sum + t.value, 0);
          signals.push({
            type: 'whale_buy',
            token,
            symbol: trades[0]?.symbol || 'UNKNOWN',
            walletCount: new Set(whaleBuys.map(t => t.wallet)).size,
            totalValue: totalWhaleValue,
            avgWinRate: 0,
            confidence: 70,
            description: `Whale buy detected: $${totalWhaleValue.toLocaleString()}`,
          });
        }
      }

      return signals;
    } catch (error: any) {
      this.logger.error(`Smart money signals fetch failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Track a specific wallet
   */
  addWallet(wallet: SmartWallet): void {
    this.smartWallets.set(wallet.address, wallet);
    this.logger.info(`Added smart wallet: ${wallet.address} (${wallet.winRate}% win rate)`);
  }

  /**
   * Remove a wallet from tracking
   */
  removeWallet(address: string): void {
    this.smartWallets.delete(address);
    this.walletTrades.delete(address);
  }

  /**
   * Get all tracked wallets
   */
  getTrackedWallets(): SmartWallet[] {
    return Array.from(this.smartWallets.values());
  }

  /**
   * Get wallet by address
   */
  getWallet(address: string): SmartWallet | undefined {
    return this.smartWallets.get(address);
  }

  /**
   * Check if a token has smart money interest
   */
  async hasSmartMoneyInterest(tokenAddress: string): Promise<{
    hasInterest: boolean;
    buyerCount: number;
    confidence: number;
  }> {
    const activity = await this.analyzeTokenActivity(tokenAddress);
    
    if (!activity) {
      return { hasInterest: false, buyerCount: 0, confidence: 0 };
    }

    return {
      hasInterest: activity.signal === 'bullish' && activity.smartBuyers24h >= 2,
      buyerCount: activity.smartBuyers24h,
      confidence: activity.confidence,
    };
  }

  /**
   * Generate tags for a wallet based on behavior
   */
  private generateTags(trader: any): string[] {
    const tags: string[] = [];

    if (trader.totalProfitUSD >= 100000) tags.push('whale');
    if (trader.avgHoldTimeHours && trader.avgHoldTimeHours < 1) tags.push('sniper');
    if (trader.winRate >= 70) tags.push('pro');
    if (trader.totalTrades >= 100) tags.push('active');
    if (trader.avgHoldTimeHours && trader.avgHoldTimeHours > 24) tags.push('holder');

    return tags;
  }

  /**
   * Categorize activity based on last trade time
   */
  private categorizeActivity(lastTradeTime: number): 'active' | 'moderate' | 'inactive' {
    const hoursSinceLastTrade = (Date.now() - lastTradeTime * 1000) / (1000 * 60 * 60);
    
    if (hoursSinceLastTrade < 24) return 'active';
    if (hoursSinceLastTrade < 72) return 'moderate';
    return 'inactive';
  }

  /**
   * Get summary for logging
   */
  getSummary(): string {
    const wallets = this.getTrackedWallets();
    const avgWinRate = wallets.length > 0 
      ? wallets.reduce((sum, w) => sum + w.winRate, 0) / wallets.length 
      : 0;
    
    return `Tracking ${wallets.length} smart wallets (avg ${avgWinRate.toFixed(0)}% win rate)`;
  }
}
