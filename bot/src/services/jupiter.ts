import axios from 'axios';
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { WalletService } from './wallet';
import { Logger } from '../utils/logger';

const JUPITER_API = 'https://quote-api.jup.ag/v6';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: any[];
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  inputAmount: number;
  outputAmount: number;
  error?: string;
}

export class JupiterService {
  private wallet: WalletService;
  private logger: Logger;

  constructor(wallet: WalletService) {
    this.wallet = wallet;
    this.logger = new Logger('Jupiter');
  }

  /**
   * Get a swap quote
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 100 // 1% default slippage
  ): Promise<SwapQuote | null> {
    try {
      const response = await axios.get(`${JUPITER_API}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount: Math.floor(amount).toString(),
          slippageBps,
        },
      });
      return response.data;
    } catch (error: any) {
      this.logger.error(`Quote failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Execute a swap
   */
  async swap(quote: SwapQuote): Promise<SwapResult> {
    try {
      // Get serialized transaction
      const { data } = await axios.post(`${JUPITER_API}/swap`, {
        quoteResponse: quote,
        userPublicKey: this.wallet.address,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      });

      // Deserialize and sign
      const swapTransaction = VersionedTransaction.deserialize(
        Buffer.from(data.swapTransaction, 'base64')
      );
      
      swapTransaction.sign([this.wallet.getKeypair()]);

      // Send transaction
      const connection = this.wallet.getConnection();
      const signature = await connection.sendTransaction(swapTransaction, {
        maxRetries: 3,
      });

      // Confirm
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, 'confirmed');

      this.logger.info(`Swap successful: ${signature}`);

      return {
        success: true,
        signature,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: parseInt(quote.outAmount),
      };
    } catch (error: any) {
      this.logger.error(`Swap failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: 0,
      };
    }
  }

  /**
   * Buy a token with SOL
   */
  async buyWithSol(
    tokenMint: string,
    solAmount: number,
    slippageBps: number = 100
  ): Promise<SwapResult> {
    const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
    this.logger.info(`Buying ${tokenMint} with ${solAmount} SOL`);

    const quote = await this.getQuote(SOL_MINT, tokenMint, lamports, slippageBps);
    if (!quote) {
      return { success: false, error: 'Failed to get quote', inputAmount: lamports, outputAmount: 0 };
    }

    return await this.swap(quote);
  }

  /**
   * Sell a token for SOL
   */
  async sellForSol(
    tokenMint: string,
    tokenAmount: number,
    slippageBps: number = 100
  ): Promise<SwapResult> {
    this.logger.info(`Selling ${tokenAmount} of ${tokenMint} for SOL`);

    const quote = await this.getQuote(tokenMint, SOL_MINT, tokenAmount, slippageBps);
    if (!quote) {
      return { success: false, error: 'Failed to get quote', inputAmount: tokenAmount, outputAmount: 0 };
    }

    return await this.swap(quote);
  }

  /**
   * Get token price in SOL
   */
  async getTokenPrice(tokenMint: string): Promise<number | null> {
    try {
      // Get quote for 1 SOL worth of the token
      const quote = await this.getQuote(
        SOL_MINT,
        tokenMint,
        LAMPORTS_PER_SOL,
        50
      );
      
      if (!quote) return null;
      
      // Price = 1 SOL / tokens received
      const tokensPerSol = parseInt(quote.outAmount);
      return 1 / tokensPerSol;
    } catch {
      return null;
    }
  }
}
