/**
 * Create $SURVIVE Token
 * 
 * This script creates the $SURVIVE SPL token on Solana.
 * Run this when you're ready to launch the token.
 * 
 * Usage: npx ts-node src/scripts/createToken.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createInitializeMintInstruction,
  createMint,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createMintToInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const TOKEN_CONFIG = {
  name: 'SURVIVE',
  symbol: 'SURVIVE',
  decimals: 9,
  initialSupply: 1_000_000_000, // 1 billion tokens
};

async function createSurvToken() {
  console.log('🦎 Creating $SURVIVE Token');
  console.log('========================');
  console.log('');

  // Load wallet
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not set in .env');
  }

  const payer = Keypair.fromSecretKey(bs58.decode(privateKey));
  console.log(`Wallet: ${payer.publicKey.toBase58()}`);

  // Connect to Solana
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);

  if (balance < 0.1 * 1e9) {
    throw new Error('Insufficient balance. Need at least 0.1 SOL for token creation.');
  }

  console.log('');
  console.log('Creating mint...');

  // Create the token mint
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey, // Mint authority
    payer.publicKey, // Freeze authority (optional)
    TOKEN_CONFIG.decimals
  );

  console.log(`✓ Mint created: ${mint.toBase58()}`);

  // Create associated token account for the wallet
  console.log('Creating token account...');
  const ata = await getAssociatedTokenAddress(mint, payer.publicKey);
  
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      payer.publicKey,
      mint
    )
  );

  await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`✓ Token account: ${ata.toBase58()}`);

  // Mint initial supply
  console.log('Minting initial supply...');
  const mintAmount = BigInt(TOKEN_CONFIG.initialSupply) * BigInt(10 ** TOKEN_CONFIG.decimals);
  
  const mintTx = new Transaction().add(
    createMintToInstruction(
      mint,
      ata,
      payer.publicKey,
      mintAmount
    )
  );

  await sendAndConfirmTransaction(connection, mintTx, [payer]);
  console.log(`✓ Minted ${TOKEN_CONFIG.initialSupply.toLocaleString()} ${TOKEN_CONFIG.symbol}`);

  console.log('');
  console.log('='.repeat(50));
  console.log('🎉 $SURVIVE Token Created Successfully!');
  console.log('='.repeat(50));
  console.log('');
  console.log('Token Details:');
  console.log(`  Name: ${TOKEN_CONFIG.name}`);
  console.log(`  Symbol: ${TOKEN_CONFIG.symbol}`);
  console.log(`  Decimals: ${TOKEN_CONFIG.decimals}`);
  console.log(`  Mint Address: ${mint.toBase58()}`);
  console.log(`  Initial Supply: ${TOKEN_CONFIG.initialSupply.toLocaleString()}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Add mint address to .env: SURVIVE_TOKEN_MINT=' + mint.toBase58());
  console.log('2. Create liquidity pool on Raydium/Orca');
  console.log('3. Verify token on Solscan');
  console.log('');
}

createSurvToken().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
