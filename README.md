# 🦎 SURVIVE

**Goal: Just Fucking Survive**

An autonomous AI trading agent that trades Solana meme coins with one mission: survival.

## Overview

SURVIVE is a fully open-source trading agent that:

1. **Trades** Solana meme coins autonomously
2. **Decides** how to allocate profits dynamically
3. **Supports** the $SURVIVE token ecosystem
4. **Survives** — that's the goal

### Profit Allocation (Agent Decides)

Unlike fixed splits, the agent **dynamically decides** how to use profits:

```
┌─────────────────────────────────────────────────────────────┐
│                         PROFIT                              │
│                           │                                 │
│   ┌───────────────────────┼───────────────────────┐        │
│   │                       │                       │        │
│   ▼                       ▼                       ▼        │
│                                                            │
│ SURVIVAL             GROWTH              ECOSYSTEM         │
│ (Operating)          (Reinvest)          ($SURVIVE)        │
│                                                            │
│ API costs            More capital        Token buybacks    │
│ VPS/infra            Bigger trades       Price support     │
│ Stay alive           Compound gains      Community         │
│                                                            │
└─────────────────────────────────────────────────────────────┘

The agent prioritizes based on:
- Current operating reserve (survival first!)
- Trading performance (win rate)
- Capital vs target (growth needs)
- Token status (ecosystem support)
```

### The Logic

1. **Survival First**: If operating reserve is low, profits go there first
2. **Growth Second**: Based on performance, reinvest for compound growth  
3. **Ecosystem Third**: Remaining profits buy $SURVIVE tokens

The agent adapts. Bad streak? Conservative mode. Winning? Aggressive growth.

## Project Structure

```
survive/
├── website/              # Dashboard (Next.js)
│   └── src/app/          # Live stats, transparency
│
└── bot/                  # Trading Agent
    └── src/
        ├── core/
        │   ├── agent.ts           # Main brain
        │   └── profitAllocator.ts # Decision engine
        ├── services/
        │   ├── wallet.ts          # Solana wallet
        │   ├── jupiter.ts         # DEX swaps
        │   └── tokenData.ts       # Market data
        ├── strategies/
        │   └── momentum.ts        # Trading strategy
        └── scripts/
            └── createToken.ts     # $SURVIVE launcher
```

## Quick Start

### Website

```bash
cd website
npm install
npm run dev
```

### Bot

```bash
cd bot
npm install
cp .env.example .env
# Edit .env with your wallet
npm run dev
```

## How It Works

### 1. Trading
The agent scans for tokens with momentum, filters by safety criteria, and executes trades with risk management (stop-loss, take-profit).

### 2. Profit Allocation
When a trade is profitable, the agent decides:
- **Need reserve?** → Operating costs first
- **Below target capital?** → Reinvest more
- **Winning streak?** → More aggressive
- **Losing streak?** → Conservative mode
- **Extra profits?** → Buy $SURVIVE

### 3. $SURVIVE Token
Dev deploys the token and gives the agent the contract address. Agent then:
- Accumulates buyback funds
- Executes buys to support price
- Holds tokens in wallet

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_TRADE_SIZE_SOL` | 1.0 | Max per trade |
| `STOP_LOSS_PERCENT` | 20 | Exit if down |
| `TAKE_PROFIT_PERCENT` | 50 | Exit if up |
| `MONTHLY_OPERATING_COST_SOL` | 0.5 | Your infra costs |
| `CAPITAL_TARGET_SOL` | 100 | Growth target |
| `SURVIVE_TOKEN_MINT` | - | Set after launch |

## Token Launch

1. Dev deploys $SURVIVE token on Solana
2. Creates liquidity pool
3. Sets `SURVIVE_TOKEN_MINT` in bot config
4. Agent starts buybacks automatically

## Security

- Private keys stay local (`.env` is gitignored)
- All transactions signed locally
- Everything on-chain and verifiable
- 100% open source

## Transparency

The dashboard shows:
- Agent wallet balance
- All trades (verifiable on Solscan)
- Profit allocation decisions
- Operating reserve status
- Token buyback history

## Disclaimer

Trading crypto is risky. This agent is experimental. Only use funds you can afford to lose. This is not financial advice.

## License

MIT - Fork it, run your own, make it survive.

---

Built with 🦎 by Hamoon & Mamad

**Just Fucking Survive**
