import { WalletService } from '../services/wallet';
import { JupiterService } from '../services/jupiter';
import { TokenDataService, TokenInfo } from '../services/tokenData';
import { StorageService, Trade, Position } from '../utils/storage';
import { Logger } from '../utils/logger';
import { Config } from '../config';
import { v4 as uuidv4 } from 'uuid';

export interface TradeSignal {
  type: 'buy' | 'sell';
  tokenMint: string;
  symbol: string;
  reason: string;
  confidence: number; // 0-100
  suggestedAmount?: number;
}

export abstract class BaseStrategy {
  protected wallet: WalletService;
  protected jupiter: JupiterService;
  protected tokenData: TokenDataService;
  protected storage: StorageService;
  protected config: Config;
  protected logger: Logger;

  constructor(
    wallet: WalletService,
    jupiter: JupiterService,
    tokenData: TokenDataService,
    storage: StorageService,
    config: Config
  ) {
    this.wallet = wallet;
    this.jupiter = jupiter;
    this.tokenData = tokenData;
    this.storage = storage;
    this.config = config;
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Analyze market and return trade signals
   */
  abstract analyze(): Promise<TradeSignal[]>;

  /**
   * Execute a buy signal
   */
  async executeBuy(signal: TradeSignal, solAmount: number): Promise<Trade | null> {
    this.logger.info(`Executing BUY: ${signal.symbol} for ${solAmount} SOL`);

    // Safety check
    const safetyCheck = await this.tokenData.isTokenSafe(signal.tokenMint);
    if (!safetyCheck.safe) {
      this.logger.warn(`Token failed safety check: ${safetyCheck.reasons.join(', ')}`);
      return null;
    }

    // Get current price for recording
    const tokenInfo = await this.tokenData.getTokenInfo(signal.tokenMint);
    if (!tokenInfo) {
      this.logger.error('Could not get token info');
      return null;
    }

    // Execute swap
    const result = await this.jupiter.buyWithSol(signal.tokenMint, solAmount, 150);
    if (!result.success) {
      this.logger.error(`Buy failed: ${result.error}`);
      return null;
    }

    // Record position
    const position: Position = {
      tokenMint: signal.tokenMint,
      symbol: signal.symbol,
      entryPrice: tokenInfo.price,
      amount: result.outputAmount,
      entryTimestamp: new Date(),
      entrySolValue: solAmount,
    };
    this.storage.addPosition(position);

    // Record trade
    const trade: Trade = {
      id: uuidv4(),
      timestamp: new Date(),
      type: 'buy',
      tokenMint: signal.tokenMint,
      symbol: signal.symbol,
      amount: result.outputAmount,
      solValue: solAmount,
      price: tokenInfo.price,
      txHash: result.signature!,
    };
    this.storage.addTrade(trade);

    return trade;
  }

  /**
   * Execute a sell signal
   */
  async executeSell(signal: TradeSignal): Promise<Trade | null> {
    const position = this.storage.getPosition(signal.tokenMint);
    if (!position) {
      this.logger.warn(`No position found for ${signal.symbol}`);
      return null;
    }

    this.logger.info(`Executing SELL: ${signal.symbol} (${position.amount} tokens)`);

    // Get current price
    const tokenInfo = await this.tokenData.getTokenInfo(signal.tokenMint);
    if (!tokenInfo) {
      this.logger.error('Could not get token info');
      return null;
    }

    // Execute swap
    const result = await this.jupiter.sellForSol(signal.tokenMint, position.amount, 150);
    if (!result.success) {
      this.logger.error(`Sell failed: ${result.error}`);
      return null;
    }

    const solReceived = result.outputAmount / 1e9; // Convert lamports to SOL
    const profit = solReceived - position.entrySolValue;

    // Remove position
    this.storage.removePosition(signal.tokenMint);

    // Record trade
    const trade: Trade = {
      id: uuidv4(),
      timestamp: new Date(),
      type: 'sell',
      tokenMint: signal.tokenMint,
      symbol: signal.symbol,
      amount: position.amount,
      solValue: solReceived,
      price: tokenInfo.price,
      txHash: result.signature!,
      profit,
    };
    this.storage.addTrade(trade);

    return trade;
  }

  /**
   * Check existing positions for stop-loss/take-profit
   */
  async checkPositions(): Promise<TradeSignal[]> {
    const signals: TradeSignal[] = [];
    const positions = this.storage.getState().positions;

    for (const position of positions) {
      const tokenInfo = await this.tokenData.getTokenInfo(position.tokenMint);
      if (!tokenInfo) continue;

      const priceChange = ((tokenInfo.price - position.entryPrice) / position.entryPrice) * 100;

      // Stop loss
      if (priceChange <= -this.config.stopLossPercent) {
        signals.push({
          type: 'sell',
          tokenMint: position.tokenMint,
          symbol: position.symbol,
          reason: `Stop loss triggered (${priceChange.toFixed(2)}%)`,
          confidence: 100,
        });
      }
      // Take profit
      else if (priceChange >= this.config.takeProfitPercent) {
        signals.push({
          type: 'sell',
          tokenMint: position.tokenMint,
          symbol: position.symbol,
          reason: `Take profit triggered (${priceChange.toFixed(2)}%)`,
          confidence: 100,
        });
      }
    }

    return signals;
  }
}
