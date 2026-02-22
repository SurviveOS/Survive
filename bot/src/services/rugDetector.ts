import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { Logger } from '../utils/logger';

const RUGCHECK_API = 'https://api.rugcheck.xyz/v1';
const GOPLUS_API = 'https://api.gopluslabs.io/api/v1';

export interface RugCheckResult {
  safe: boolean;
  score: number; // 0-100 (100 = safest)
  risks: RiskItem[];
  warnings: string[];
  details: {
    mintAuthority: 'revoked' | 'active' | 'unknown';
    freezeAuthority: 'revoked' | 'active' | 'unknown';
    lpLocked: boolean;
    lpLockedPercent: number;
    topHolderPercent: number;
    isHoneypot: boolean;
    hasHiddenOwner: boolean;
    canMint: boolean;
    canFreeze: boolean;
    transferFee: number;
    buyTax: number;
    sellTax: number;
  };
}

export interface RiskItem {
  type: 'critical' | 'high' | 'medium' | 'low';
  name: string;
  description: string;
}

export interface HolderAnalysis {
  totalHolders: number;
  top10Percent: number;
  top1Holder: number;
  devHolding: number;
  distribution: 'healthy' | 'concentrated' | 'risky';
  whaleCount: number;
  recentLargeTransfers: number;
}

/**
 * Rug & Honeypot Detection Service
 * 
 * Checks for:
 * - Mint authority status (can they print more tokens?)
 * - Freeze authority (can they freeze your tokens?)
 * - LP lock status (can they pull liquidity?)
 * - Honeypot detection (can you sell?)
 * - Hidden owner functions
 * - Tax/fee analysis
 * - Holder concentration
 */
export class RugDetector {
  private logger: Logger;
  private connection: Connection;
  private cache: Map<string, { result: RugCheckResult; timestamp: number }>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(rpcUrl: string) {
    this.logger = new Logger('RugDetector');
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.cache = new Map();
  }

  /**
   * Full rug check for a token
   */
  async checkToken(mintAddress: string): Promise<RugCheckResult> {
    // Check cache
    const cached = this.cache.get(mintAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.result;
    }

    const risks: RiskItem[] = [];
    const warnings: string[] = [];
    let score = 100;

    // Initialize details
    const details: RugCheckResult['details'] = {
      mintAuthority: 'unknown',
      freezeAuthority: 'unknown',
      lpLocked: false,
      lpLockedPercent: 0,
      topHolderPercent: 0,
      isHoneypot: false,
      hasHiddenOwner: false,
      canMint: false,
      canFreeze: false,
      transferFee: 0,
      buyTax: 0,
      sellTax: 0,
    };

    try {
      // 1. Check RugCheck API
      const rugcheckData = await this.checkRugCheckAPI(mintAddress);
      if (rugcheckData) {
        this.processRugCheckData(rugcheckData, details, risks, warnings);
      }

      // 2. Check GoPlus API (additional honeypot detection)
      const goplusData = await this.checkGoPlusAPI(mintAddress);
      if (goplusData) {
        this.processGoPlusData(goplusData, details, risks, warnings);
      }

      // 3. On-chain mint authority check
      const onChainData = await this.checkOnChain(mintAddress);
      if (onChainData) {
        this.processOnChainData(onChainData, details, risks, warnings);
      }

      // Calculate score based on risks
      for (const risk of risks) {
        switch (risk.type) {
          case 'critical': score -= 40; break;
          case 'high': score -= 25; break;
          case 'medium': score -= 10; break;
          case 'low': score -= 5; break;
        }
      }

      score = Math.max(0, score);

    } catch (error: any) {
      this.logger.error(`Rug check failed: ${error.message}`);
      warnings.push(`Could not complete full rug check: ${error.message}`);
      score = 50; // Uncertain
    }

    const result: RugCheckResult = {
      safe: score >= 60 && !risks.some(r => r.type === 'critical'),
      score,
      risks,
      warnings,
      details,
    };

    // Cache result
    this.cache.set(mintAddress, { result, timestamp: Date.now() });

    return result;
  }

  /**
   * Check RugCheck.xyz API
   */
  private async checkRugCheckAPI(mintAddress: string): Promise<any> {
    try {
      const response = await axios.get(`${RUGCHECK_API}/tokens/${mintAddress}/report`, {
        timeout: 10000,
      });
      return response.data;
    } catch (error: any) {
      this.logger.debug(`RugCheck API error: ${error.message}`);
      return null;
    }
  }

  /**
   * Check GoPlus Security API
   */
  private async checkGoPlusAPI(mintAddress: string): Promise<any> {
    try {
      const response = await axios.get(`${GOPLUS_API}/solana/token_security`, {
        params: { contract_addresses: mintAddress },
        timeout: 10000,
      });
      return response.data?.result?.[mintAddress.toLowerCase()];
    } catch (error: any) {
      this.logger.debug(`GoPlus API error: ${error.message}`);
      return null;
    }
  }

  /**
   * On-chain checks via Solana RPC
   */
  private async checkOnChain(mintAddress: string): Promise<any> {
    try {
      const mint = new PublicKey(mintAddress);
      const accountInfo = await this.connection.getParsedAccountInfo(mint);
      
      if (!accountInfo.value) return null;

      const data = (accountInfo.value.data as any).parsed?.info;
      return data;
    } catch (error: any) {
      this.logger.debug(`On-chain check error: ${error.message}`);
      return null;
    }
  }

  /**
   * Process RugCheck API data
   */
  private processRugCheckData(
    data: any,
    details: RugCheckResult['details'],
    risks: RiskItem[],
    warnings: string[]
  ): void {
    if (!data) return;

    // Check risks from API
    if (data.risks) {
      for (const risk of data.risks) {
        const level = risk.level?.toLowerCase();
        if (level === 'critical' || level === 'danger') {
          risks.push({
            type: 'critical',
            name: risk.name || 'Unknown Risk',
            description: risk.description || 'Critical risk detected',
          });
        } else if (level === 'high' || level === 'warn') {
          risks.push({
            type: 'high',
            name: risk.name || 'Unknown Risk',
            description: risk.description || 'High risk detected',
          });
        } else if (level === 'medium') {
          risks.push({
            type: 'medium',
            name: risk.name || 'Unknown Risk',
            description: risk.description || 'Medium risk detected',
          });
        }
      }
    }

    // LP status
    if (data.markets?.[0]) {
      const market = data.markets[0];
      details.lpLocked = market.lp?.locked || false;
      details.lpLockedPercent = market.lp?.lockedPercent || 0;
      
      if (!details.lpLocked || details.lpLockedPercent < 80) {
        risks.push({
          type: 'high',
          name: 'LP Not Locked',
          description: `Only ${details.lpLockedPercent.toFixed(0)}% of LP is locked`,
        });
      }
    }

    // Top holder concentration
    if (data.topHolders) {
      const top10 = data.topHolders.slice(0, 10);
      details.topHolderPercent = top10.reduce((sum: number, h: any) => sum + (h.percentage || 0), 0);
      
      if (details.topHolderPercent > 50) {
        risks.push({
          type: 'high',
          name: 'High Concentration',
          description: `Top 10 holders own ${details.topHolderPercent.toFixed(0)}%`,
        });
      } else if (details.topHolderPercent > 30) {
        warnings.push(`Top 10 holders own ${details.topHolderPercent.toFixed(0)}%`);
      }
    }

    // Mint authority
    if (data.mintAuthority) {
      details.mintAuthority = data.mintAuthority === null ? 'revoked' : 'active';
      details.canMint = data.mintAuthority !== null;
      
      if (details.canMint) {
        risks.push({
          type: 'critical',
          name: 'Mint Authority Active',
          description: 'Token supply can be increased (potential infinite mint)',
        });
      }
    }

    // Freeze authority
    if (data.freezeAuthority !== undefined) {
      details.freezeAuthority = data.freezeAuthority === null ? 'revoked' : 'active';
      details.canFreeze = data.freezeAuthority !== null;
      
      if (details.canFreeze) {
        risks.push({
          type: 'high',
          name: 'Freeze Authority Active',
          description: 'Your tokens can be frozen',
        });
      }
    }
  }

  /**
   * Process GoPlus API data
   */
  private processGoPlusData(
    data: any,
    details: RugCheckResult['details'],
    risks: RiskItem[],
    warnings: string[]
  ): void {
    if (!data) return;

    // Honeypot check
    if (data.is_honeypot === '1') {
      details.isHoneypot = true;
      risks.push({
        type: 'critical',
        name: 'HONEYPOT DETECTED',
        description: 'This token cannot be sold - DO NOT BUY',
      });
    }

    // Buy/sell tax
    if (data.buy_tax) {
      details.buyTax = parseFloat(data.buy_tax) * 100;
      if (details.buyTax > 10) {
        risks.push({
          type: 'high',
          name: 'High Buy Tax',
          description: `${details.buyTax.toFixed(0)}% buy tax`,
        });
      } else if (details.buyTax > 5) {
        warnings.push(`${details.buyTax.toFixed(0)}% buy tax`);
      }
    }

    if (data.sell_tax) {
      details.sellTax = parseFloat(data.sell_tax) * 100;
      if (details.sellTax > 10) {
        risks.push({
          type: 'high',
          name: 'High Sell Tax',
          description: `${details.sellTax.toFixed(0)}% sell tax`,
        });
      } else if (details.sellTax > 5) {
        warnings.push(`${details.sellTax.toFixed(0)}% sell tax`);
      }
    }

    // Hidden owner
    if (data.hidden_owner === '1') {
      details.hasHiddenOwner = true;
      risks.push({
        type: 'high',
        name: 'Hidden Owner',
        description: 'Contract has hidden owner functions',
      });
    }

    // Transfer pausable
    if (data.transfer_pausable === '1') {
      risks.push({
        type: 'medium',
        name: 'Transfer Pausable',
        description: 'Transfers can be paused by owner',
      });
    }
  }

  /**
   * Process on-chain data
   */
  private processOnChainData(
    data: any,
    details: RugCheckResult['details'],
    risks: RiskItem[],
    warnings: string[]
  ): void {
    if (!data) return;

    // Mint authority from on-chain
    if (data.mintAuthority === null) {
      details.mintAuthority = 'revoked';
      details.canMint = false;
    } else if (data.mintAuthority) {
      details.mintAuthority = 'active';
      details.canMint = true;
      
      // Only add risk if not already added
      if (!risks.some(r => r.name === 'Mint Authority Active')) {
        risks.push({
          type: 'critical',
          name: 'Mint Authority Active',
          description: 'Token supply can be increased',
        });
      }
    }

    // Freeze authority from on-chain
    if (data.freezeAuthority === null) {
      details.freezeAuthority = 'revoked';
      details.canFreeze = false;
    } else if (data.freezeAuthority) {
      details.freezeAuthority = 'active';
      details.canFreeze = true;
    }
  }

  /**
   * Quick honeypot check (fast, just checks if sellable)
   */
  async quickHoneypotCheck(mintAddress: string): Promise<{
    isHoneypot: boolean;
    sellTax: number;
    buyTax: number;
  }> {
    try {
      const goplus = await this.checkGoPlusAPI(mintAddress);
      
      return {
        isHoneypot: goplus?.is_honeypot === '1',
        sellTax: parseFloat(goplus?.sell_tax || '0') * 100,
        buyTax: parseFloat(goplus?.buy_tax || '0') * 100,
      };
    } catch {
      return { isHoneypot: false, sellTax: 0, buyTax: 0 };
    }
  }

  /**
   * Analyze holder distribution
   */
  async analyzeHolders(mintAddress: string): Promise<HolderAnalysis | null> {
    try {
      const response = await axios.get(`${RUGCHECK_API}/tokens/${mintAddress}/report`);
      const data = response.data;

      if (!data.topHolders) return null;

      const holders = data.topHolders;
      const top10Percent = holders.slice(0, 10).reduce((sum: number, h: any) => sum + (h.percentage || 0), 0);
      const top1Holder = holders[0]?.percentage || 0;
      
      // Find dev wallet (usually first non-LP holder)
      const devHolding = holders.find((h: any) => !h.isLP)?.percentage || 0;
      
      // Count whales (>2% holders)
      const whaleCount = holders.filter((h: any) => h.percentage > 2).length;

      // Determine distribution health
      let distribution: 'healthy' | 'concentrated' | 'risky' = 'healthy';
      if (top1Holder > 20 || top10Percent > 60) {
        distribution = 'risky';
      } else if (top1Holder > 10 || top10Percent > 40) {
        distribution = 'concentrated';
      }

      return {
        totalHolders: data.holderCount || 0,
        top10Percent,
        top1Holder,
        devHolding,
        distribution,
        whaleCount,
        recentLargeTransfers: 0, // Would need transaction history
      };
    } catch (error: any) {
      this.logger.error(`Holder analysis failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get a summary string for logging
   */
  summarize(result: RugCheckResult): string {
    const emoji = result.safe ? '✅' : '🚨';
    const criticalCount = result.risks.filter(r => r.type === 'critical').length;
    const highCount = result.risks.filter(r => r.type === 'high').length;
    
    let summary = `${emoji} Score: ${result.score}/100`;
    
    if (criticalCount > 0) summary += ` | ${criticalCount} CRITICAL`;
    if (highCount > 0) summary += ` | ${highCount} HIGH`;
    
    if (result.details.isHoneypot) summary += ' | ⚠️ HONEYPOT';
    if (result.details.canMint) summary += ' | ⚠️ CAN MINT';
    if (!result.details.lpLocked) summary += ' | ⚠️ LP UNLOCKED';
    
    return summary;
  }
}
