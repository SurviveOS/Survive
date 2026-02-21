import { config } from './config';
import { SurviveAgent } from './core/agent';
import { Logger } from './utils/logger';

const logger = new Logger('Main');

async function main() {
  logger.info('🦎 SURVIVE - Autonomous Trading Agent');
  logger.info('=====================================');
  logger.info('');
  logger.info('Configuration:');
  logger.info(`  RPC: ${config.rpcUrl}`);
  logger.info(`  Max Trade: ${config.maxTradeSizeSol} SOL`);
  logger.info(`  Stop Loss: ${config.stopLossPercent}%`);
  logger.info(`  Take Profit: ${config.takeProfitPercent}%`);
  logger.info(`  Monthly Operating Cost: ${config.monthlyOperatingCostSol} SOL`);
  logger.info(`  Capital Target: ${config.capitalTargetSol} SOL`);
  logger.info(`  $SURVIVE Token: ${config.surviveTokenMint || 'Not set yet'}`);
  logger.info('');

  const agent = new SurviveAgent(config);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await agent.stop();
    process.exit(0);
  });

  // Start the agent
  await agent.start();
}

main().catch((error) => {
  logger.error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
