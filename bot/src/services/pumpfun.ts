import axios from 'axios';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Logger } from '../utils/logger';
import { WalletService } from './wallet';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const PUMPFUN_API = 'https://pumpportal.fun/api';
const PUMPFUN_TRADE_API = 'https://pumpportal.fun/api/trade-local';

export interface TokenMetadata {
  name: string;
  symbol: string;
  description: string;
  image?: string;        // URL or file path
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface LaunchResult {
  success: boolean;
  mintAddress?: string;
  txSignature?: string;
  error?: string;
  metadata?: {
    name: string;
    symbol: string;
    uri: string;
  };
}

export interface TradeResult {
  success: boolean;
  signature?: string;
  inputAmount: number;
  outputAmount: number;
  error?: string;
}

export interface TokenBondingCurve {
  mintAddress: string;
  bondingCurve: string;
  virtualSolReserves: number;
  virtualTokenReserves: number;
  realSolReserves: number;
  realTokenReserves: number;
  tokenTotalSupply: number;
  complete: boolean;      // If true, graduated to Raydium
}

/**
 * Pump.fun Integration Service
 * 
 * Handles:
 * - Token creation on Pump.fun bonding curve
 * - Buying/selling on the bonding curve
 * - Tracking token status
 */
export class PumpFunService {
  private logger: Logger;
  private wallet: WalletService;
  private connection: Connection;

  constructor(wallet: WalletService) {
    this.logger = new Logger('PumpFun');
    this.wallet = wallet;
    this.connection = wallet.getConnection();
  }

  /**
   * Create and launch a new token on Pump.fun
   */
  async launchToken(metadata: TokenMetadata, initialBuySOL: number = 0): Promise<LaunchResult> {
    this.logger.info(`Launching token: ${metadata.name} (${metadata.symbol})`);

    try {
      // 1. Create IPFS metadata if image provided
      let metadataUri: string | undefined;
      
      if (metadata.image) {
        metadataUri = await this.uploadMetadata(metadata);
        if (!metadataUri) {
          return { success: false, error: 'Failed to upload metadata' };
        }
      }

      // 2. Generate mint keypair for the new token
      const mintKeypair = Keypair.generate();
      this.logger.info(`Mint address will be: ${mintKeypair.publicKey.toBase58()}`);

      // 3. Create the token via Pump.fun API
      const response = await axios.post(`${PUMPFUN_API}/create`, {
        name: metadata.name,
        symbol: metadata.symbol,
        description: metadata.description,
        twitter: metadata.twitter || '',
        telegram: metadata.telegram || '',
        website: metadata.website || '',
        metadataUri: metadataUri,
        mint: mintKeypair.publicKey.toBase58(),
        initialBuyAmount: initialBuySOL > 0 ? initialBuySOL * LAMPORTS_PER_SOL : 0,
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.data.success) {
        return { success: false, error: response.data.error || 'API error' };
      }

      // 4. Sign and send the transaction
      const txData = response.data.transaction;
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(txData, 'base64')
      );

      // Sign with both wallet and mint keypair
      transaction.sign([this.wallet.getKeypair(), mintKeypair]);

      const signature = await this.connection.sendTransaction(transaction, {
        maxRetries: 3,
      });

      // 5. Confirm transaction
      const latestBlockhash = await this.connection.getLatestBlockhash();
      await this.connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, 'confirmed');

      this.logger.info(`✅ Token launched: ${mintKeypair.publicKey.toBase58()}`);
      this.logger.info(`   TX: ${signature}`);

      return {
        success: true,
        mintAddress: mintKeypair.publicKey.toBase58(),
        txSignature: signature,
        metadata: {
          name: metadata.name,
          symbol: metadata.symbol,
          uri: metadataUri || '',
        },
      };
    } catch (error: any) {
      this.logger.error(`Token launch failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Alternative: Launch via local transaction building
   */
  async launchTokenLocal(metadata: TokenMetadata, initialBuySOL: number = 0): Promise<LaunchResult> {
    try {
      // Generate mint keypair
      const mintKeypair = Keypair.generate();
      
      // Build form data
      const formData = new FormData();
      formData.append('publicKey', this.wallet.address);
      formData.append('action', 'create');
      formData.append('tokenMetadata', JSON.stringify({
        name: metadata.name,
        symbol: metadata.symbol,
        description: metadata.description,
      }));
      formData.append('mint', mintKeypair.publicKey.toBase58());
      
      if (initialBuySOL > 0) {
        formData.append('denominatedInSol', 'true');
        formData.append('amount', initialBuySOL.toString());
        formData.append('slippage', '10');
        formData.append('priorityFee', '0.0005');
        formData.append('pool', 'pump');
      }

      // Get transaction from API
      const response = await axios.post(PUMPFUN_TRADE_API, formData, {
        headers: formData.getHeaders(),
      });

      if (response.status !== 200) {
        return { success: false, error: 'Failed to get transaction' };
      }

      // Deserialize and sign
      const transaction = VersionedTransaction.deserialize(
        new Uint8Array(response.data)
      );
      transaction.sign([this.wallet.getKeypair(), mintKeypair]);

      // Send
      const signature = await this.connection.sendTransaction(transaction, {
        maxRetries: 3,
      });

      await this.connection.confirmTransaction(signature, 'confirmed');

      this.logger.info(`✅ Token launched: ${mintKeypair.publicKey.toBase58()}`);
      
      return {
        success: true,
        mintAddress: mintKeypair.publicKey.toBase58(),
        txSignature: signature,
        metadata: {
          name: metadata.name,
          symbol: metadata.symbol,
          uri: '',
        },
      };
    } catch (error: any) {
      this.logger.error(`Local launch failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Buy tokens on Pump.fun bonding curve
   */
  async buy(mintAddress: string, solAmount: number, slippageBps: number = 1000): Promise<TradeResult> {
    this.logger.info(`Buying ${solAmount} SOL worth of ${mintAddress}`);

    try {
      const formData = new FormData();
      formData.append('publicKey', this.wallet.address);
      formData.append('action', 'buy');
      formData.append('mint', mintAddress);
      formData.append('denominatedInSol', 'true');
      formData.append('amount', solAmount.toString());
      formData.append('slippage', (slippageBps / 100).toString());
      formData.append('priorityFee', '0.0005');
      formData.append('pool', 'pump');

      const response = await axios.post(PUMPFUN_TRADE_API, formData, {
        headers: formData.getHeaders(),
        responseType: 'arraybuffer',
      });

      const transaction = VersionedTransaction.deserialize(
        new Uint8Array(response.data)
      );
      transaction.sign([this.wallet.getKeypair()]);

      const signature = await this.connection.sendTransaction(transaction, {
        maxRetries: 3,
      });

      await this.connection.confirmTransaction(signature, 'confirmed');

      this.logger.info(`✅ Buy successful: ${signature}`);

      return {
        success: true,
        signature,
        inputAmount: solAmount * LAMPORTS_PER_SOL,
        outputAmount: 0, // Would need to parse transaction result
      };
    } catch (error: any) {
      this.logger.error(`Buy failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        inputAmount: solAmount * LAMPORTS_PER_SOL,
        outputAmount: 0,
      };
    }
  }

  /**
   * Sell tokens on Pump.fun bonding curve
   */
  async sell(mintAddress: string, tokenAmount: number, slippageBps: number = 1000): Promise<TradeResult> {
    this.logger.info(`Selling ${tokenAmount} tokens of ${mintAddress}`);

    try {
      const formData = new FormData();
      formData.append('publicKey', this.wallet.address);
      formData.append('action', 'sell');
      formData.append('mint', mintAddress);
      formData.append('denominatedInSol', 'false');
      formData.append('amount', tokenAmount.toString());
      formData.append('slippage', (slippageBps / 100).toString());
      formData.append('priorityFee', '0.0005');
      formData.append('pool', 'pump');

      const response = await axios.post(PUMPFUN_TRADE_API, formData, {
        headers: formData.getHeaders(),
        responseType: 'arraybuffer',
      });

      const transaction = VersionedTransaction.deserialize(
        new Uint8Array(response.data)
      );
      transaction.sign([this.wallet.getKeypair()]);

      const signature = await this.connection.sendTransaction(transaction, {
        maxRetries: 3,
      });

      await this.connection.confirmTransaction(signature, 'confirmed');

      this.logger.info(`✅ Sell successful: ${signature}`);

      return {
        success: true,
        signature,
        inputAmount: tokenAmount,
        outputAmount: 0, // Would need to parse transaction result
      };
    } catch (error: any) {
      this.logger.error(`Sell failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        inputAmount: tokenAmount,
        outputAmount: 0,
      };
    }
  }

  /**
   * Sell a percentage of holdings
   */
  async sellPercent(mintAddress: string, percent: number, slippageBps: number = 1000): Promise<TradeResult> {
    const balance = await this.wallet.getTokenBalance(mintAddress);
    
    if (balance === 0) {
      return { success: false, error: 'No tokens to sell', inputAmount: 0, outputAmount: 0 };
    }

    const sellAmount = Math.floor(balance * (percent / 100));
    return this.sell(mintAddress, sellAmount, slippageBps);
  }

  /**
   * Get bonding curve info for a token
   */
  async getBondingCurve(mintAddress: string): Promise<TokenBondingCurve | null> {
    try {
      const response = await axios.get(`${PUMPFUN_API}/bonding-curve/${mintAddress}`);
      
      if (!response.data) return null;

      return {
        mintAddress,
        bondingCurve: response.data.bondingCurve,
        virtualSolReserves: response.data.virtualSolReserves / LAMPORTS_PER_SOL,
        virtualTokenReserves: response.data.virtualTokenReserves,
        realSolReserves: response.data.realSolReserves / LAMPORTS_PER_SOL,
        realTokenReserves: response.data.realTokenReserves,
        tokenTotalSupply: response.data.tokenTotalSupply,
        complete: response.data.complete || false,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get bonding curve: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate token price from bonding curve
   */
  async getTokenPrice(mintAddress: string): Promise<number | null> {
    const curve = await this.getBondingCurve(mintAddress);
    if (!curve) return null;

    // Price = virtualSOL / virtualTokens
    if (curve.virtualTokenReserves === 0) return 0;
    return curve.virtualSolReserves / curve.virtualTokenReserves;
  }

  /**
   * Check if token has graduated to Raydium
   */
  async isGraduated(mintAddress: string): Promise<boolean> {
    const curve = await this.getBondingCurve(mintAddress);
    return curve?.complete || false;
  }

  /**
   * Upload metadata to IPFS (via Pump.fun)
   */
  private async uploadMetadata(metadata: TokenMetadata): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append('name', metadata.name);
      formData.append('symbol', metadata.symbol);
      formData.append('description', metadata.description);
      
      if (metadata.twitter) formData.append('twitter', metadata.twitter);
      if (metadata.telegram) formData.append('telegram', metadata.telegram);
      if (metadata.website) formData.append('website', metadata.website);

      // If image is a file path, read it
      if (metadata.image) {
        if (metadata.image.startsWith('http')) {
          // Download and attach
          const imageResponse = await axios.get(metadata.image, { responseType: 'arraybuffer' });
          formData.append('file', Buffer.from(imageResponse.data), 'image.png');
        } else if (fs.existsSync(metadata.image)) {
          // Local file
          formData.append('file', fs.createReadStream(metadata.image));
        }
      }

      const response = await axios.post(`${PUMPFUN_API}/ipfs`, formData, {
        headers: formData.getHeaders(),
      });

      return response.data.metadataUri || null;
    } catch (error: any) {
      this.logger.error(`Metadata upload failed: ${error.message}`);
      return null;
    }
  }
}
