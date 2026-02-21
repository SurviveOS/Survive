# 🦎 SURVIVE Trading Bot

Autonomous AI trading agent for Solana meme coins.

## Features

- **Momentum Trading**: Automatically finds and trades tokens with strong upward momentum
- **Risk Management**: Built-in stop-loss and take-profit
- **Profit Split**: 70% reinvested, 30% used for $SURVIVE buybacks
- **Dashboard API**: Real-time data for the website dashboard
- **Open Source**: Fork it, customize it, make it your own

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
PRIVATE_KEY=your_base58_private_key_here
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

⚠️ **Never share your private key!**

### 3. Run the Bot

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REINVEST_PERCENTAGE` | 70 | % of profits to reinvest |
| `MAX_TRADE_SIZE_SOL` | 1.0 | Maximum SOL per trade |
| `STOP_LOSS_PERCENT` | 20 | Sell if down this % |
| `TAKE_PROFIT_PERCENT` | 50 | Sell if up this % |
| `MIN_PROFIT_FOR_BUYBACK` | 0.1 | Min profit before buyback |

## Project Structure

```
src/
├── config/          # Configuration management
├── core/            # Main agent logic
├── services/        # External service integrations
│   ├── wallet.ts    # Solana wallet management
│   ├── jupiter.ts   # DEX swaps via Jupiter
│   └── tokenData.ts # Token data from DexScreener/Birdeye
├── strategies/      # Trading strategies
│   ├── base.ts      # Base strategy class
│   └── momentum.ts  # Momentum trading strategy
├── utils/           # Utilities
│   ├── logger.ts    # Logging
│   └── storage.ts   # State persistence
├── api/             # Dashboard API server
└── scripts/         # Utility scripts
    └── createToken.ts  # Create $SURVIVE token
```

## Trading Strategy

The default momentum strategy:

1. **Scan** trending tokens on Solana
2. **Filter** by liquidity ($10k+), volume ($5k+), and momentum (10-200%)
3. **Score** tokens based on multiple factors
4. **Execute** trades for high-confidence signals
5. **Monitor** positions for stop-loss/take-profit

### Customizing

Create your own strategy by extending `BaseStrategy`:

```typescript
import { BaseStrategy, TradeSignal } from './base';

export class MyStrategy extends BaseStrategy {
  async analyze(): Promise<TradeSignal[]> {
    // Your logic here
  }
}
```

## API Endpoints

When running, the bot exposes:

- `GET /api/status` - Current agent status, positions, trades
- `GET /api/health` - Health check

## Creating $SURVIVE Token

When ready to launch the token:

```bash
npx ts-node src/scripts/createToken.ts
```

This will:
1. Create the SPL token mint
2. Create your token account
3. Mint initial supply
4. Output the mint address to add to `.env`

## Security Notes

- Private keys are stored locally only
- Never commit `.env` to git
- Use a dedicated wallet for the bot
- Start with small amounts to test
- Monitor regularly

## Disclaimer

Trading cryptocurrency is risky. This bot is provided as-is with no guarantees. Only trade what you can afford to lose. Do your own research.

## License

MIT - Do whatever you want with it.

---

Built with 🦎 by Hamoon & Mamad
