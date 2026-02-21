import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { Config } from '../config';
import { Logger } from '../utils/logger';

export class WalletService {
  private connection: Connection;
  private keypair: Keypair;
  private logger: Logger;
  
  public readonly publicKey: PublicKey;
  public readonly address: string;

  constructor(config: Config) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.keypair = Keypair.fromSecretKey(bs58.decode(config.privateKey));
    this.publicKey = this.keypair.publicKey;
    this.address = this.publicKey.toBase58();
    this.logger = new Logger('Wallet');
  }

  /**
   * Get SOL balance in lamports
   */
  async getBalanceLamports(): Promise<number> {
    return await this.connection.getBalance(this.publicKey);
  }

  /**
   * Get SOL balance
   */
  async getBalance(): Promise<number> {
    const lamports = await this.getBalanceLamports();
    return lamports / LAMPORTS_PER_SOL;
  }

  /**
   * Get token balance for a specific mint
   */
  async getTokenBalance(mintAddress: string): Promise<number> {
    try {
      const mint = new PublicKey(mintAddress);
      const ata = await getAssociatedTokenAddress(mint, this.publicKey);
      const account = await getAccount(this.connection, ata);
      return Number(account.amount);
    } catch (error) {
      // Account doesn't exist = 0 balance
      return 0;
    }
  }

  /**
   * Get or create associated token account
   */
  async getOrCreateTokenAccount(mintAddress: string): Promise<PublicKey> {
    const mint = new PublicKey(mintAddress);
    const ata = await getAssociatedTokenAddress(mint, this.publicKey);
    
    try {
      await getAccount(this.connection, ata);
      return ata;
    } catch {
      // Create the account
      this.logger.info(`Creating token account for ${mintAddress}`);
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          this.publicKey,
          ata,
          this.publicKey,
          mint
        )
      );
      await sendAndConfirmTransaction(this.connection, tx, [this.keypair]);
      return ata;
    }
  }

  /**
   * Sign and send a transaction
   */
  async signAndSend(transaction: Transaction): Promise<string> {
    transaction.feePayer = this.publicKey;
    const latestBlockhash = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = latestBlockhash.blockhash;
    
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.keypair],
      { commitment: 'confirmed' }
    );
    
    return signature;
  }

  /**
   * Get the keypair (use carefully!)
   */
  getKeypair(): Keypair {
    return this.keypair;
  }

  /**
   * Get connection instance
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Log wallet status
   */
  async logStatus(): Promise<void> {
    const balance = await this.getBalance();
    this.logger.info(`Address: ${this.address}`);
    this.logger.info(`Balance: ${balance.toFixed(4)} SOL`);
  }
}
