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

export interface AgentState {
  startingSol: number;
  totalProfit: number;
  totalTokenBuybacks: number;
  feesEarned: number;
  positions: Position[];
  trades: Trade[];
  lastUpdated: Date;
}

const DEFAULT_STATE: AgentState = {
  startingSol: 20,
  totalProfit: 0,
  totalTokenBuybacks: 0,
  feesEarned: 0,
  positions: [],
  trades: [],
  lastUpdated: new Date(),
};

export class StorageService {
  private dataPath: string;
  private state: AgentState;
  private logger: Logger;

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
        parsed.positions = parsed.positions.map((p: any) => ({
          ...p,
          entryTimestamp: new Date(p.entryTimestamp),
        }));
        parsed.trades = parsed.trades.map((t: any) => ({
          ...t,
          timestamp: new Date(t.timestamp),
        }));
        
        this.logger.info('Loaded existing state');
        return parsed;
      }
    } catch (error: any) {
      this.logger.error(`Failed to load state: ${error.message}`);
    }
    
    this.logger.info('Starting with fresh state');
    return { ...DEFAULT_STATE };
  }

  private save(): void {
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
    this.state.positions.push(position);
    this.save();
    this.logger.info(`Added position: ${position.symbol}`);
  }

  removePosition(tokenMint: string): Position | null {
    const index = this.state.positions.findIndex(p => p.tokenMint === tokenMint);
    if (index === -1) return null;
    
    const removed = this.state.positions.splice(index, 1)[0];
    this.save();
    this.logger.info(`Removed position: ${removed.symbol}`);
    return removed;
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
    this.logger.info(`Recorded trade: ${trade.type} ${trade.symbol}`);
  }

  getRecentTrades(limit: number = 50): Trade[] {
    return this.state.trades.slice(-limit);
  }

  // Stats
  addFeesEarned(amount: number): void {
    this.state.feesEarned += amount;
    this.save();
  }

  getStats() {
    return {
      startingSol: this.state.startingSol,
      totalProfit: this.state.totalProfit,
      totalTokenBuybacks: this.state.totalTokenBuybacks,
      feesEarned: this.state.feesEarned,
      totalTrades: this.state.trades.length,
      activePositions: this.state.positions.length,
    };
  }

  // Export for dashboard
  exportForDashboard() {
    return {
      stats: this.getStats(),
      positions: this.state.positions,
      recentTrades: this.getRecentTrades(20),
      lastUpdated: this.state.lastUpdated,
    };
  }
}
