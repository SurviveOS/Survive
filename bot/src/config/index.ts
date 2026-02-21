import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

export interface Config {
  // Wallet
  privateKey: string;
  
  // RPC
  rpcUrl: string;
  wsUrl: string;
  
  // Trading
  maxTradeSizeSol: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  
  // Operating Costs
  monthlyOperatingCostSol: number;
  
  // Capital
  initialCapitalSol: number;
  capitalTargetSol: number;
  
  // Token (set by dev after deployment)
  surviveTokenMint: string | null;
  
  // APIs
  birdeyeApiKey: string | null;
  heliusApiKey: string | null;
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return defaultValue;
  return parsed;
}

export function loadConfig(): Config {
  return {
    // Wallet
    privateKey: getEnvOrThrow('PRIVATE_KEY'),
    
    // RPC
    rpcUrl: getEnvOrDefault('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
    wsUrl: getEnvOrDefault('SOLANA_WS_URL', 'wss://api.mainnet-beta.solana.com'),
    
    // Trading
    maxTradeSizeSol: getEnvNumber('MAX_TRADE_SIZE_SOL', 1.0),
    stopLossPercent: getEnvNumber('STOP_LOSS_PERCENT', 20),
    takeProfitPercent: getEnvNumber('TAKE_PROFIT_PERCENT', 50),
    
    // Operating Costs (estimate your monthly API/VPS costs in SOL)
    monthlyOperatingCostSol: getEnvNumber('MONTHLY_OPERATING_COST_SOL', 0.5),
    
    // Capital
    initialCapitalSol: getEnvNumber('INITIAL_CAPITAL_SOL', 20),
    capitalTargetSol: getEnvNumber('CAPITAL_TARGET_SOL', 100),
    
    // Token (dev sets this after deploying $SURVIVEIVE)
    surviveTokenMint: process.env.SURVIVE_TOKEN_MINT || null,
    
    // APIs
    birdeyeApiKey: process.env.BIRDEYE_API_KEY || null,
    heliusApiKey: process.env.HELIUS_API_KEY || null,
  };
}

export const config = loadConfig();
