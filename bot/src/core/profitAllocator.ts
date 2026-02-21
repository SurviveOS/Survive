import { Logger } from '../utils/logger';
import { StorageService } from '../utils/storage';

export interface AllocationDecision {
  operatingCosts: number;    // SOL for API, VPS, etc.
  reinvest: number;          // SOL back into trading capital
  tokenBuyback: number;      // SOL to buy $SURVIVEIVE
  reasoning: string;         // Why the agent made this decision
}

export interface OperatingState {
  currentBalance: number;
  monthlyOperatingCost: number;
  operatingReserve: number;
  capitalTarget: number;
  surviveTokenMint: string | null;
  recentProfitability: number;  // Win rate or profit factor
}

/**
 * Dynamic Profit Allocator
 * 
 * The agent decides how to split profits based on survival priorities:
 * 1. Operating costs (API, VPS, infra) - SURVIVAL FIRST
 * 2. Reinvest to grow capital - GROWTH
 * 3. Buyback $SURVIVEIVE token - ECOSYSTEM SUPPORT
 * 
 * The split is NOT fixed - it's decided by the agent based on:
 * - Current operating reserve
 * - Trading performance
 * - Market conditions
 * - Capital needs
 */
export class ProfitAllocator {
  private logger: Logger;
  private storage: StorageService;
  
  // Configurable thresholds
  private readonly MIN_OPERATING_RESERVE_MONTHS = 2;  // Keep 2 months of costs
  private readonly IDEAL_OPERATING_RESERVE_MONTHS = 3;
  private readonly MIN_BUYBACK_THRESHOLD = 0.05;      // Min SOL for buyback

  constructor(storage: StorageService) {
    this.logger = new Logger('ProfitAllocator');
    this.storage = storage;
  }

  /**
   * Decide how to allocate profits
   * This is where the agent "thinks" about survival
   */
  allocate(profit: number, state: OperatingState): AllocationDecision {
    this.logger.info(`Allocating profit: ${profit.toFixed(4)} SOL`);
    
    let operatingCosts = 0;
    let reinvest = 0;
    let tokenBuyback = 0;
    const reasons: string[] = [];

    // ========================================
    // PRIORITY 1: SURVIVAL (Operating Reserve)
    // ========================================
    const idealReserve = state.monthlyOperatingCost * this.IDEAL_OPERATING_RESERVE_MONTHS;
    const minReserve = state.monthlyOperatingCost * this.MIN_OPERATING_RESERVE_MONTHS;
    const reserveDeficit = Math.max(0, minReserve - state.operatingReserve);
    
    if (reserveDeficit > 0) {
      // We're below minimum reserve - survival mode!
      operatingCosts = Math.min(profit, reserveDeficit);
      reasons.push(`SURVIVAL: Reserve below minimum, adding ${operatingCosts.toFixed(4)} SOL`);
      profit -= operatingCosts;
    } else if (state.operatingReserve < idealReserve) {
      // Below ideal but above minimum - allocate 20% to build reserve
      operatingCosts = Math.min(profit * 0.2, idealReserve - state.operatingReserve);
      reasons.push(`Building reserve: ${operatingCosts.toFixed(4)} SOL`);
      profit -= operatingCosts;
    }

    if (profit <= 0) {
      return { operatingCosts, reinvest, tokenBuyback, reasoning: reasons.join(' | ') };
    }

    // ========================================
    // PRIORITY 2: GROWTH (Reinvestment)
    // ========================================
    // Adjust reinvestment based on performance
    let reinvestRatio = 0.6; // Default 60%
    
    if (state.recentProfitability > 0.6) {
      // Winning more - reinvest more aggressively
      reinvestRatio = 0.7;
      reasons.push('High win rate: aggressive reinvest (70%)');
    } else if (state.recentProfitability < 0.4) {
      // Losing more - be conservative
      reinvestRatio = 0.4;
      reasons.push('Low win rate: conservative reinvest (40%)');
    } else {
      reasons.push('Normal reinvest (60%)');
    }

    // Check if we're below capital target
    if (state.currentBalance < state.capitalTarget * 0.5) {
      // Way below target - prioritize growth
      reinvestRatio = Math.min(0.8, reinvestRatio + 0.2);
      reasons.push('Below capital target: boosting reinvest');
    }

    reinvest = profit * reinvestRatio;
    profit -= reinvest;

    // ========================================
    // PRIORITY 3: ECOSYSTEM ($SURVIVEIVE Buyback)
    // ========================================
    if (state.surviveTokenMint && profit >= this.MIN_BUYBACK_THRESHOLD) {
      tokenBuyback = profit;
      reasons.push(`Buyback: ${tokenBuyback.toFixed(4)} SOL → $SURVIVEIVE`);
    } else if (!state.surviveTokenMint) {
      // Token not launched yet - add to reinvest
      reinvest += profit;
      reasons.push('Token not launched: added to reinvest');
    } else {
      // Below threshold - add to reinvest
      reinvest += profit;
      reasons.push('Below buyback threshold: added to reinvest');
    }

    const decision: AllocationDecision = {
      operatingCosts,
      reinvest,
      tokenBuyback,
      reasoning: reasons.join(' | '),
    };

    this.logDecision(decision);
    return decision;
  }

  /**
   * Emergency allocation - survival mode
   * Use when operating costs are due and reserve is low
   */
  emergencyAllocation(profit: number, urgentCost: number): AllocationDecision {
    this.logger.warn(`EMERGENCY: Need ${urgentCost} SOL for operating costs`);
    
    const operatingCosts = Math.min(profit, urgentCost);
    const remaining = profit - operatingCosts;
    
    return {
      operatingCosts,
      reinvest: remaining,
      tokenBuyback: 0,
      reasoning: `EMERGENCY: Allocated ${operatingCosts.toFixed(4)} SOL to survival`,
    };
  }

  private logDecision(decision: AllocationDecision): void {
    this.logger.info('Allocation Decision:');
    this.logger.info(`  Operating: ${decision.operatingCosts.toFixed(4)} SOL`);
    this.logger.info(`  Reinvest:  ${decision.reinvest.toFixed(4)} SOL`);
    this.logger.info(`  Buyback:   ${decision.tokenBuyback.toFixed(4)} SOL`);
    this.logger.info(`  Reason:    ${decision.reasoning}`);
  }
}
