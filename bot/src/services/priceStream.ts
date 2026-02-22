import WebSocket from 'ws';
import { Logger } from '../utils/logger';
import { EventEmitter } from 'events';

const BIRDEYE_WS = 'wss://public-api.birdeye.so/socket';
const PYTH_WS = 'wss://hermes.pyth.network/ws';

export interface PriceUpdate {
  address: string;
  price: number;
  priceChange: number;
  timestamp: number;
}

export interface TradeUpdate {
  address: string;
  type: 'buy' | 'sell';
  price: number;
  amount: number;
  value: number;
  txHash: string;
  timestamp: number;
}

type PriceCallback = (update: PriceUpdate) => void;
type TradeCallback = (update: TradeUpdate) => void;

/**
 * Real-time Price Streaming Service
 * 
 * Provides live price updates via WebSocket connections to:
 * - Birdeye (token prices + trades)
 * - Pyth Network (major token prices)
 * 
 * Falls back to polling if WebSocket not available
 */
export class PriceStreamService extends EventEmitter {
  private birdeyeApiKey: string | null;
  private logger: Logger;
  
  // WebSocket connections
  private birdeyeWs: WebSocket | null = null;
  private pythWs: WebSocket | null = null;
  
  // Subscriptions
  private subscribedTokens: Set<string> = new Set();
  private priceCallbacks: Map<string, PriceCallback[]> = new Map();
  private tradeCallbacks: Map<string, TradeCallback[]> = new Map();
  
  // Latest prices cache
  private latestPrices: Map<string, PriceUpdate> = new Map();
  
  // Connection state
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000;
  
  // Heartbeat
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastPong: number = Date.now();

  constructor(birdeyeApiKey: string | null = null) {
    super();
    this.birdeyeApiKey = birdeyeApiKey;
    this.logger = new Logger('PriceStream');
  }

  /**
   * Connect to WebSocket streams
   */
  async connect(): Promise<boolean> {
    if (this.isConnected) {
      this.logger.warn('Already connected');
      return true;
    }

    if (!this.birdeyeApiKey) {
      this.logger.warn('Birdeye API key required for WebSocket streaming');
      return false;
    }

    try {
      await this.connectBirdeye();
      this.startHeartbeat();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.logger.info('WebSocket connected');
      this.emit('connected');
      return true;
    } catch (error: any) {
      this.logger.error(`Connection failed: ${error.message}`);
      this.scheduleReconnect();
      return false;
    }
  }

  /**
   * Connect to Birdeye WebSocket
   */
  private connectBirdeye(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.birdeyeWs = new WebSocket(BIRDEYE_WS, {
        headers: {
          'X-API-KEY': this.birdeyeApiKey!,
        },
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.birdeyeWs.on('open', () => {
        clearTimeout(timeout);
        this.logger.info('Birdeye WebSocket connected');
        
        // Resubscribe to existing tokens
        for (const token of this.subscribedTokens) {
          this.sendSubscribe(token);
        }
        
        resolve();
      });

      this.birdeyeWs.on('message', (data: WebSocket.Data) => {
        this.handleBirdeyeMessage(data);
      });

      this.birdeyeWs.on('error', (error) => {
        this.logger.error(`Birdeye WebSocket error: ${error.message}`);
        reject(error);
      });

      this.birdeyeWs.on('close', (code, reason) => {
        this.logger.warn(`Birdeye WebSocket closed: ${code} - ${reason}`);
        this.isConnected = false;
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      this.birdeyeWs.on('pong', () => {
        this.lastPong = Date.now();
      });
    });
  }

  /**
   * Handle incoming Birdeye messages
   */
  private handleBirdeyeMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'PRICE_DATA') {
        this.handlePriceUpdate(message.data);
      } else if (message.type === 'TXS_DATA') {
        this.handleTradeUpdate(message.data);
      } else if (message.type === 'SUBSCRIBE_RESULT') {
        this.logger.debug(`Subscribed to ${message.data.address}`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to parse message: ${error.message}`);
    }
  }

  /**
   * Handle price update from stream
   */
  private handlePriceUpdate(data: any): void {
    const update: PriceUpdate = {
      address: data.address,
      price: data.price || data.value,
      priceChange: data.priceChange24h || 0,
      timestamp: Date.now(),
    };

    // Update cache
    this.latestPrices.set(update.address, update);

    // Notify callbacks
    const callbacks = this.priceCallbacks.get(update.address) || [];
    for (const callback of callbacks) {
      try {
        callback(update);
      } catch (error: any) {
        this.logger.error(`Price callback error: ${error.message}`);
      }
    }

    // Emit event
    this.emit('price', update);
  }

  /**
   * Handle trade update from stream
   */
  private handleTradeUpdate(data: any): void {
    const update: TradeUpdate = {
      address: data.address,
      type: data.side === 'buy' ? 'buy' : 'sell',
      price: data.price,
      amount: data.tokenAmount,
      value: data.usdValue || data.solValue,
      txHash: data.txHash,
      timestamp: data.blockUnixTime * 1000 || Date.now(),
    };

    // Notify callbacks
    const callbacks = this.tradeCallbacks.get(update.address) || [];
    for (const callback of callbacks) {
      try {
        callback(update);
      } catch (error: any) {
        this.logger.error(`Trade callback error: ${error.message}`);
      }
    }

    // Emit event
    this.emit('trade', update);
  }

  /**
   * Subscribe to price updates for a token
   */
  subscribe(tokenAddress: string, onPrice?: PriceCallback, onTrade?: TradeCallback): void {
    this.subscribedTokens.add(tokenAddress);

    if (onPrice) {
      const callbacks = this.priceCallbacks.get(tokenAddress) || [];
      callbacks.push(onPrice);
      this.priceCallbacks.set(tokenAddress, callbacks);
    }

    if (onTrade) {
      const callbacks = this.tradeCallbacks.get(tokenAddress) || [];
      callbacks.push(onTrade);
      this.tradeCallbacks.set(tokenAddress, callbacks);
    }

    if (this.isConnected) {
      this.sendSubscribe(tokenAddress);
    }

    this.logger.info(`Subscribed to ${tokenAddress}`);
  }

  /**
   * Unsubscribe from a token
   */
  unsubscribe(tokenAddress: string): void {
    this.subscribedTokens.delete(tokenAddress);
    this.priceCallbacks.delete(tokenAddress);
    this.tradeCallbacks.delete(tokenAddress);
    this.latestPrices.delete(tokenAddress);

    if (this.isConnected) {
      this.sendUnsubscribe(tokenAddress);
    }

    this.logger.info(`Unsubscribed from ${tokenAddress}`);
  }

  /**
   * Send subscribe message to Birdeye
   */
  private sendSubscribe(tokenAddress: string): void {
    if (!this.birdeyeWs || this.birdeyeWs.readyState !== WebSocket.OPEN) {
      return;
    }

    // Subscribe to price updates
    this.birdeyeWs.send(JSON.stringify({
      type: 'SUBSCRIBE_PRICE',
      data: {
        address: tokenAddress,
        type: 'TOKEN',
      },
    }));

    // Subscribe to transaction updates
    this.birdeyeWs.send(JSON.stringify({
      type: 'SUBSCRIBE_TXS',
      data: {
        address: tokenAddress,
      },
    }));
  }

  /**
   * Send unsubscribe message
   */
  private sendUnsubscribe(tokenAddress: string): void {
    if (!this.birdeyeWs || this.birdeyeWs.readyState !== WebSocket.OPEN) {
      return;
    }

    this.birdeyeWs.send(JSON.stringify({
      type: 'UNSUBSCRIBE_PRICE',
      data: {
        address: tokenAddress,
      },
    }));

    this.birdeyeWs.send(JSON.stringify({
      type: 'UNSUBSCRIBE_TXS',
      data: {
        address: tokenAddress,
      },
    }));
  }

  /**
   * Get latest cached price
   */
  getLatestPrice(tokenAddress: string): PriceUpdate | null {
    return this.latestPrices.get(tokenAddress) || null;
  }

  /**
   * Get all subscribed tokens
   */
  getSubscribedTokens(): string[] {
    return Array.from(this.subscribedTokens);
  }

  /**
   * Check if connected
   */
  isStreamConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.birdeyeWs && this.birdeyeWs.readyState === WebSocket.OPEN) {
        this.birdeyeWs.ping();
        
        // Check if we've received a pong recently
        if (Date.now() - this.lastPong > 60000) {
          this.logger.warn('No pong received, reconnecting...');
          this.disconnect();
          this.connect();
        }
      }
    }, 30000);
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    
    this.logger.info(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Disconnect all streams
   */
  disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.birdeyeWs) {
      this.birdeyeWs.close();
      this.birdeyeWs = null;
    }

    if (this.pythWs) {
      this.pythWs.close();
      this.pythWs = null;
    }

    this.isConnected = false;
    this.logger.info('Disconnected');
  }
}

/**
 * Singleton instance for easy access
 */
let priceStreamInstance: PriceStreamService | null = null;

export function getPriceStream(birdeyeApiKey?: string | null): PriceStreamService {
  if (!priceStreamInstance) {
    priceStreamInstance = new PriceStreamService(birdeyeApiKey);
  }
  return priceStreamInstance;
}
