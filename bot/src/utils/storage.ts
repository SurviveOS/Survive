import fs from 'fs';
import path from 'path';
import { Logger } from './logger';

export interface Position {
  tokenMint: string;
  symbol: string;
  entryPrice: number;
  amount: number;
  entryTimestamp: Date;
  entrySolValue: number;
}

export interface Trade {
  id: string;
  timestamp: Date;
  type: 'buy' | 'sell' | 'buyback';
  tokenMint: string;
  symbol: string;
  amount: number;
  solValue: number;
  price: number;
  txHash: string;
  profit?: number;
}

export interface RiskStateData {
  dailyPnL: number;
  peakBalance: number;
  consecutiveLosses: number;
  lastTradeTimestamp: string | null;
  cooldownUntil: string | null;
  lastResetDate: string;
}

export interface AgentState {
  startingSol: number;
  totalProfit: number;
  totalTokenBuybacks: number;
  feesEarned: number;
  positions: Position[];
  trades: Trade[];
  riskState: RiskStateData;
  operatingReserve: number;
  pendingBuyback: number;
  lastUpdated: Date;
}

const DEFAULT_RISK_STATE: RiskStateData = {
  dailyPnL: 0,
  peakBalance: 20,
  consecutiveLosses: 0,
  lastTradeTimestamp: null,
  cooldownUntil: null,
  lastResetDate: new Date().toISOString().split('T')[0],
};

const DEFAULT_STATE: AgentState = {
  startingSol: 20,
  totalProfit: 0,
  totalTokenBuybacks: 0,
  feesEarned: 0,
  positions: [],
  trades: [],
  riskState: DEFAULT_RISK_STATE,
  operatingReserve: 0,
  pendingBuyback: 0,
  lastUpdated: new Date(),
};

export class StorageService {
  private dataPath: string;
  private state: AgentState;
  private logger: Logger;
  private saveDebounce: NodeJS.Timeout | null = null;

  constructor(dataDir: string = './data') {
    this.dataPath = path.join(dataDir, 'state.json');
    this.logger = new Logger('Storage');
    this.state = this.load();
  }

  private load(): AgentState {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, 'utf-8');
        const parsed = JSON.parse(data);
        
        // Convert date strings back to Date objects
        parsed.lastUpdated = new Date(parsed.lastUpdated);
        parsed.positions = (parsed.positions || []).map((p: any) => ({
          ...p,
          entryTimestamp: new Date(p.entryTimestamp),
        }));
        parsed.trades = (parsed.trades || []).map((t: any) => ({
          ...t,
          timestamp: new Date(t.timestamp),
        }));
        
        // Ensure riskState exists
        parsed.riskState = parsed.riskState || DEFAULT_RISK_STATE;
        parsed.operatingReserve = parsed.operatingReserve || 0;
        parsed.pendingBuyback = parsed.pendingBuyback || 0;
        
        this.logger.info(`Loaded state: ${parsed.trades.length} trades, ${parsed.positions.length} positions`);
        return parsed;
      }
    } catch (error: any) {
      this.logger.error(`Failed to load state: ${error.message}`);
    }
    
    this.logger.info('Starting with fresh state');
    return { ...DEFAULT_STATE };
  }

  private save(): void {
    // Debounce saves to avoid excessive disk writes
    if (this.saveDebounce) {
      clearTimeout(this.saveDebounce);
    }
    
    this.saveDebounce = setTimeout(() => {
      try {
        const dir = path.dirname(this.dataPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        this.state.lastUpdated = new Date();
        fs.writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2));
        this.logger.debug('State saved');
      } catch (error: any) {
        this.logger.error(`Failed to save state: ${error.message}`);
      }
    }, 1000);
  }

  // Force immediate save
  saveNow(): void {
    if (this.saveDebounce) {
      clearTimeout(this.saveDebounce);
      this.saveDebounce = null;
    }
    
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      this.state.lastUpdated = new Date();
      fs.writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2));
    } catch (error: any) {
      this.logger.error(`Failed to save state: ${error.message}`);
    }
  }

  getState(): AgentState {
    return this.state;
  }

  // Position management
  addPosition(position: Position): void {
    // Check if position already exists
    const existing = this.state.positions.findIndex(p => p.tokenMint === position.tokenMint);
    if (existing !== -1) {
      // Update existing position (averaging in)
      const existingPos = this.state.positions[existing];
      const totalAmount = existingPos.amount + position.amount;
      const totalValue = existingPos.entrySolValue + position.entrySolValue;
      
      existingPos.amount = totalAmount;
      existingPos.entrySolValue = totalValue;
      existingPos.entryPrice = totalValue / totalAmount; // Average price
      
      this.logger.info(`Updated position: ${position.symbol} (averaged in)`);
    } else {
      this.state.positions.push(position);
      this.logger.info(`Added position: ${position.symbol}`);
    }
    this.save();
  }

  removePosition(tokenMint: string): Position | null {
    const index = this.state.positions.findIndex(p => p.tokenMint === tokenMint);
    if (index === -1) return null;
    
    const removed = this.state.positions.splice(index, 1)[0];
    this.save();
    this.logger.info(`Removed position: ${removed.symbol}`);
    return removed;
  }

  updatePosition(tokenMint: string, updates: Partial<Position>): void {
    const position = this.state.positions.find(p => p.tokenMint === tokenMint);
    if (position) {
      Object.assign(position, updates);
      this.save();
    }
  }

  getPosition(tokenMint: string): Position | null {
    return this.state.positions.find(p => p.tokenMint === tokenMint) || null;
  }

  // Trade management
  addTrade(trade: Trade): void {
    this.state.trades.push(trade);
    
    if (trade.profit) {
      this.state.totalProfit += trade.profit;
    }
    
    if (trade.type === 'buyback') {
      this.state.totalTokenBuybacks += trade.solValue;
    }
    
    this.save();
    this.logger.info(`Recorded trade: ${trade.type} ${trade.symbol} (${trade.profit ? (trade.profit >= 0 ? '+' : '') + trade.profit.toFixed(4) : ''})`);
  }

  getRecentTrades(limit: number = 50): Trade[] {
    return this.state.trades.slice(-limit);
  }

  getTradesByType(type: 'buy' | 'sell' | 'buyback'): Trade[] {
    return this.state.trades.filter(t => t.type === type);
  }

  getTradesForToken(tokenMint: string): Trade[] {
    return this.state.trades.filter(t => t.tokenMint === tokenMint);
  }

  // Risk state management
  getRiskState(): RiskStateData {
    return this.state.riskState;
  }

  updateRiskState(updates: Partial<RiskStateData>): void {
    this.state.riskState = { ...this.state.riskState, ...updates };
    this.save();
  }

  // Operating state
  setOperatingReserve(amount: number): void {
    this.state.operatingReserve = amount;
    this.save();
  }

  getOperatingReserve(): number {
    return this.state.operatingReserve;
  }

  setPendingBuyback(amount: number): void {
    this.state.pendingBuyback = amount;
    this.save();
  }

  getPendingBuyback(): number {
    return this.state.pendingBuyback;
  }

  // Stats
  addFeesEarned(amount: number): void {
    this.state.feesEarned += amount;
    this.save();
  }

  getStats() {
    const sells = this.state.trades.filter(t => t.type === 'sell' && t.profit !== undefined);
    const wins = sells.filter(t => (t.profit || 0) > 0);
    const losses = sells.filter(t => (t.profit || 0) < 0);
    
    const totalWinAmount = wins.reduce((sum, t) => sum + (t.profit || 0), 0);
    const totalLossAmount = Math.abs(losses.reduce((sum, t) => sum + (t.profit || 0), 0));
    
    return {
      startingSol: this.state.startingSol,
      totalProfit: this.state.totalProfit,
      totalTokenBuybacks: this.state.totalTokenBuybacks,
      feesEarned: this.state.feesEarned,
      totalTrades: this.state.trades.length,
      activePositions: this.state.positions.length,
      // Performance metrics
      winRate: sells.length > 0 ? (wins.length / sells.length) * 100 : 0,
      wins: wins.length,
      losses: losses.length,
      avgWin: wins.length > 0 ? totalWinAmount / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLossAmount / losses.length : 0,
      profitFactor: totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? Infinity : 0,
      largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.profit || 0)) : 0,
      largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.profit || 0)) : 0,
    };
  }

  // Performance by time period
  getPerformance(periodMs: number = 24 * 60 * 60 * 1000): {
    trades: number;
    profit: number;
    winRate: number;
  } {
    const cutoff = new Date(Date.now() - periodMs);
    const recentTrades = this.state.trades.filter(t => t.timestamp >= cutoff);
    const sells = recentTrades.filter(t => t.type === 'sell' && t.profit !== undefined);
    const wins = sells.filter(t => (t.profit || 0) > 0);
    const profit = sells.reduce((sum, t) => sum + (t.profit || 0), 0);
    
    return {
      trades: recentTrades.length,
      profit,
      winRate: sells.length > 0 ? (wins.length / sells.length) * 100 : 0,
    };
  }

  // Export for dashboard
  exportForDashboard() {
    const stats = this.getStats();
    const last24h = this.getPerformance(24 * 60 * 60 * 1000);
    const last7d = this.getPerformance(7 * 24 * 60 * 60 * 1000);
    
    return {
      stats,
      performance: {
        last24h,
        last7d,
      },
      positions: this.state.positions,
      recentTrades: this.getRecentTrades(20),
      riskState: this.state.riskState,
      lastUpdated: this.state.lastUpdated,
    };
  }

  // Backup
  backup(backupDir: string = './data/backups'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `state-${timestamp}.json`);
    
    try {
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      fs.writeFileSync(backupPath, JSON.stringify(this.state, null, 2));
      this.logger.info(`Backup created: ${backupPath}`);
      return backupPath;
    } catch (error: any) {
      this.logger.error(`Backup failed: ${error.message}`);
      throw error;
    }
  }

  // Reset (use with caution!)
  reset(): void {
    this.backup(); // Always backup before reset
    this.state = { ...DEFAULT_STATE };
    this.saveNow();
    this.logger.warn('State reset to defaults');
  }
}
