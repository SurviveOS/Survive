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
  maxPositions: number;
  
  // Risk Management
  maxDailyLossPercent: number;
  maxDrawdownPercent: number;
  maxExposurePercent: number;
  maxConsecutiveLosses: number;
  cooldownMinutes: number;
  
  // Position Management
  trailingStopPercent: number;
  trailingActivationPercent: number;
  partialTakeProfitPercent: number;
  partialTakeSize: number;
  maxHoldTimeHours: number;
  
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
  
  // Behavior
  tickIntervalMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
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
    takeProfitPercent: getEnvNumber('TAKE_PROFIT_PERCENT', 100),
    maxPositions: getEnvNumber('MAX_POSITIONS', 5),
    
    // Risk Management
    maxDailyLossPercent: getEnvNumber('MAX_DAILY_LOSS_PERCENT', 10),
    maxDrawdownPercent: getEnvNumber('MAX_DRAWDOWN_PERCENT', 25),
    maxExposurePercent: getEnvNumber('MAX_EXPOSURE_PERCENT', 60),
    maxConsecutiveLosses: getEnvNumber('MAX_CONSECUTIVE_LOSSES', 3),
    cooldownMinutes: getEnvNumber('COOLDOWN_MINUTES', 30),
    
    // Position Management
    trailingStopPercent: getEnvNumber('TRAILING_STOP_PERCENT', 15),
    trailingActivationPercent: getEnvNumber('TRAILING_ACTIVATION_PERCENT', 30),
    partialTakeProfitPercent: getEnvNumber('PARTIAL_TAKE_PROFIT_PERCENT', 50),
    partialTakeSize: getEnvNumber('PARTIAL_TAKE_SIZE', 50),
    maxHoldTimeHours: getEnvNumber('MAX_HOLD_TIME_HOURS', 24),
    
    // Operating Costs (estimate your monthly API/VPS costs in SOL)
    monthlyOperatingCostSol: getEnvNumber('MONTHLY_OPERATING_COST_SOL', 0.5),
    
    // Capital
    initialCapitalSol: getEnvNumber('INITIAL_CAPITAL_SOL', 20),
    capitalTargetSol: getEnvNumber('CAPITAL_TARGET_SOL', 100),
    
    // Token (dev sets this after deploying $SURVIVE)
    surviveTokenMint: process.env.SURVIVE_TOKEN_MINT || null,
    
    // APIs
    birdeyeApiKey: process.env.BIRDEYE_API_KEY || null,
    heliusApiKey: process.env.HELIUS_API_KEY || null,
    
    // Behavior
    tickIntervalMs: getEnvNumber('TICK_INTERVAL_MS', 30000),
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
  };
}

export const config = loadConfig();

// Log config on startup (excluding sensitive values)
export function logConfig(config: Config): void {
  console.log('');
  console.log('Configuration:');
  console.log('─'.repeat(40));
  console.log(`  Max Trade Size: ${config.maxTradeSizeSol} SOL`);
  console.log(`  Stop Loss: ${config.stopLossPercent}%`);
  console.log(`  Take Profit: ${config.takeProfitPercent}%`);
  console.log(`  Max Positions: ${config.maxPositions}`);
  console.log('');
  console.log('Risk Limits:');
  console.log(`  Max Daily Loss: ${config.maxDailyLossPercent}%`);
  console.log(`  Max Drawdown: ${config.maxDrawdownPercent}%`);
  console.log(`  Max Exposure: ${config.maxExposurePercent}%`);
  console.log(`  Cooldown After: ${config.maxConsecutiveLosses} losses`);
  console.log('');
  console.log('Position Management:');
  console.log(`  Trailing Stop: ${config.trailingStopPercent}% (activates at +${config.trailingActivationPercent}%)`);
  console.log(`  Partial Take: ${config.partialTakeSize}% at +${config.partialTakeProfitPercent}%`);
  console.log(`  Max Hold: ${config.maxHoldTimeHours}h`);
  console.log('');
  console.log('APIs:');
  console.log(`  Birdeye: ${config.birdeyeApiKey ? '✓' : '✗'}`);
  console.log(`  Helius: ${config.heliusApiKey ? '✓' : '✗'}`);
  console.log('─'.repeat(40));
}
