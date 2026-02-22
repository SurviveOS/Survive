# 🦎 SURVIVE

**An autonomous AI trading agent with one goal: Just Fucking Survive.**

SURVIVE is a fully transparent, open-source trading bot that trades Solana meme coins, manages its own token, and fights to survive. When it profits, it buys $SURVIVE. When it's low on funds, it sells $SURVIVE to stay alive.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-purple)](https://solana.com)

---

## 🎯 The Concept

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   SURVIVE creates its own token on Pump.fun                     │
│                        │                                        │
│                        ▼                                        │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │                   TRADING LOOP                           │  │
│   │                                                          │  │
│   │   Trade meme coins autonomously                          │  │
│   │            │                                             │  │
│   │      ┌─────┴─────┐                                       │  │
│   │      │           │                                       │  │
│   │   PROFIT       LOSS                                      │  │
│   │      │           │                                       │  │
│   │      ▼           ▼                                       │  │
│   │   Buy more    Low on capital?                            │  │
│   │   $SURVIVE       │                                       │  │
│   │   & HOLD     ┌───┴───┐                                   │  │
│   │              │       │                                   │  │
│   │             YES     NO                                   │  │
│   │              │       │                                   │  │
│   │              ▼       ▼                                   │  │
│   │          Sell some  Keep                                 │  │
│   │          $SURVIVE   trading                              │  │
│   │          to SURVIVE                                      │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   Goal: JUST FUCKING SURVIVE                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The agent's $SURVIVE token becomes its **store of value**. Good times? Accumulate. Bad times? Liquidate to survive.

---

## ✨ Features

### 🤖 Autonomous Trading
- Scans for trending Solana meme coins
- Multi-factor analysis before entry
- Automatic position management
- Stop-loss, take-profit, trailing stops

### 🛡️ Risk Management
- Daily loss limits (stops trading if exceeded)
- Maximum drawdown protection
- Position exposure limits
- Cooldown after consecutive losses
- Dynamic position sizing

### 📊 Technical Analysis
- RSI (Relative Strength Index)
- MACD (Moving Average Convergence Divergence)
- EMA (9, 21, 50 periods)
- Bollinger Bands
- Volume trend analysis

### 🔍 Safety Checks
- Honeypot detection (GoPlus API)
- Rug pull detection (RugCheck API)
- Mint authority verification
- LP lock status
- Buy/sell tax analysis
- Holder concentration analysis

### 🧠 Smart Money Tracking
- Identifies wallets with >55% win rate
- Tracks profitable trader activity
- Accumulation/distribution signals
- Whale trade detection

### 📈 Volume Analysis
- Buy vs sell pressure
- Volume trend detection
- Large trade detection
- Order flow analysis

### 🔴 Real-time Price Streaming
- WebSocket connection to Birdeye
- Sub-second price updates
- Instant stop-loss execution
- Whale trade alerts

### 🦎 Survival Mechanism
- Launches $SURVIVE on Pump.fun
- Buys $SURVIVE with 30% of profits
- Sells $SURVIVE when capital is critical
- Tracks survival metrics

---

## 📁 Project Structure

```
survive/
├── website/                    # Dashboard (Next.js)
│   └── src/app/
│       ├── page.tsx           # Main dashboard
│       ├── layout.tsx         # Layout
│       └── globals.css        # Styles
│
└── bot/                        # Trading Agent
    └── src/
        ├── index.ts           # Entry point
        │
        ├── core/
        │   ├── agent.ts           # Main agent brain
        │   ├── survivalManager.ts # $SURVIVE token management
        │   ├── riskManager.ts     # Risk limits & controls
        │   ├── positionManager.ts # Position tracking
        │   ├── profitAllocator.ts # Profit distribution
        │   └── priceWatcher.ts    # Real-time alerts
        │
        ├── services/
        │   ├── wallet.ts          # Solana wallet
        │   ├── jupiter.ts         # Jupiter DEX swaps
        │   ├── pumpfun.ts         # Pump.fun integration
        │   ├── tokenData.ts       # Token data (Birdeye/DexScreener)
        │   ├── priceStream.ts     # WebSocket price feeds
        │   ├── indicators.ts      # Technical indicators
        │   ├── rugDetector.ts     # Rug/honeypot detection
        │   ├── smartMoney.ts      # Smart wallet tracking
        │   ├── volumeAnalyzer.ts  # Volume analysis
        │   └── entryTiming.ts     # Entry optimization
        │
        ├── strategies/
        │   ├── base.ts            # Strategy interface
        │   └── momentum.ts        # Momentum strategy
        │
        ├── utils/
        │   ├── storage.ts         # State persistence
        │   └── logger.ts          # Logging
        │
        └── config/
            └── index.ts           # Configuration
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- A Solana wallet with SOL
- (Optional) Birdeye API key for better data

### Installation

```bash
# Clone the repo
git clone https://github.com/SurviveOS/Survive.git
cd Survive

# Install bot dependencies
cd bot
npm install

# Copy environment file
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

```env
# Required
PRIVATE_KEY=your_wallet_private_key_base58

# RPC (use a paid RPC for production)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Trading
MAX_TRADE_SIZE_SOL=1.0
STOP_LOSS_PERCENT=20
TAKE_PROFIT_PERCENT=100

# Risk Management
MAX_DAILY_LOSS_PERCENT=10
MAX_DRAWDOWN_PERCENT=25
MAX_CONSECUTIVE_LOSSES=3

# APIs (optional but recommended)
BIRDEYE_API_KEY=your_birdeye_key
```

### Running

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Launching $SURVIVE Token

On first run, launch your token:

```typescript
// In your code or via CLI
await agent.launchSurviveToken(1); // 1 SOL initial buy
```

---

## ⚙️ Configuration Reference

### Trading Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_TRADE_SIZE_SOL` | 1.0 | Maximum SOL per trade |
| `STOP_LOSS_PERCENT` | 20 | Stop loss percentage |
| `TAKE_PROFIT_PERCENT` | 100 | Take profit percentage |
| `MAX_POSITIONS` | 5 | Maximum concurrent positions |

### Risk Management

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_DAILY_LOSS_PERCENT` | 10 | Stop trading after X% daily loss |
| `MAX_DRAWDOWN_PERCENT` | 25 | Maximum drawdown from peak |
| `MAX_EXPOSURE_PERCENT` | 60 | Max % of balance in positions |
| `MAX_CONSECUTIVE_LOSSES` | 3 | Cooldown trigger |
| `COOLDOWN_MINUTES` | 30 | Cooldown duration |

### Position Management

| Parameter | Default | Description |
|-----------|---------|-------------|
| `TRAILING_STOP_PERCENT` | 15 | Trailing stop distance |
| `TRAILING_ACTIVATION_PERCENT` | 30 | Activate trailing at X% gain |
| `PARTIAL_TAKE_PROFIT_PERCENT` | 50 | Take partial at X% |
| `PARTIAL_TAKE_SIZE` | 50 | Sell X% at partial take |
| `MAX_HOLD_TIME_HOURS` | 24 | Force exit after X hours |

---

## 📊 How the Strategy Works

### Entry Criteria

The bot uses a multi-factor scoring system:

```
Token Discovery (DexScreener/Birdeye)
         │
         ▼
┌─────────────────────────────────────┐
│ QUICK FILTER                        │
│ • Honeypot? → SKIP                  │
│ • Liquidity < $5k? → SKIP           │
│ • Pumped > 300%? → SKIP             │
│ • Dumping > -30%? → SKIP            │
└─────────────────────────────────────┘
         │ Pass
         ▼
┌─────────────────────────────────────┐
│ RUG DETECTION                       │
│ • Safety score < 50? → SKIP         │
│ • Mint authority active? → SKIP     │
│ • LP not locked? → WARNING          │
└─────────────────────────────────────┘
         │ Pass
         ▼
┌─────────────────────────────────────┐
│ TECHNICAL ANALYSIS                  │
│ • RSI > 75? → SKIP (overbought)     │
│ • RSI < 30? → BONUS (oversold)      │
│ • MACD bullish cross? → BONUS       │
│ • EMAs aligned? → BONUS             │
└─────────────────────────────────────┘
         │ Pass
         ▼
┌─────────────────────────────────────┐
│ VOLUME ANALYSIS                     │
│ • Volume surging? → BONUS           │
│ • Buy pressure > 65%? → BONUS       │
│ • Sell pressure dominant? → SKIP    │
└─────────────────────────────────────┘
         │ Pass
         ▼
┌─────────────────────────────────────┐
│ SMART MONEY CHECK                   │
│ • Smart wallets buying? → BONUS     │
│ • Smart wallets selling? → SKIP     │
└─────────────────────────────────────┘
         │ Pass
         ▼
       BUY SIGNAL
```

### Exit Criteria

- **Stop Loss**: Price drops X% from entry
- **Take Profit**: Price rises X% from entry
- **Trailing Stop**: Locks in profits as price rises
- **Partial Take**: Sells 50% at halfway to target
- **Time Exit**: Forces close after max hold time

---

## 🦎 Survival Mechanism

### Status Levels

| Status | Capital Level | Action |
|--------|---------------|--------|
| 💚 Healthy | > 50% | Normal trading |
| 🟡 Low | 25-50% | Warning, continue |
| 🟠 Critical | 10-25% | Sell 10% of $SURVIVE |
| 🔴 Emergency | < 10% | Sell 20% of $SURVIVE |

### Profit Allocation

When the bot makes profit:
- **30%** → Buy $SURVIVE (stored value)
- **70%** → Back to trading capital

### Survival Sell

When capital is critical:
1. Sell portion of $SURVIVE holdings
2. Convert to SOL
3. Continue trading
4. Fight to survive another day

---

## 🌐 Dashboard

The website displays real-time stats:

- Wallet balance
- Total profit/loss
- Active positions
- $SURVIVE holdings
- Trade history
- Survival status

### Running the Dashboard

```bash
cd website
npm install
npm run dev
```

Open http://localhost:3000

---

## 🔌 API Integration

### Data Sources

| Service | Purpose | API Key Required |
|---------|---------|------------------|
| DexScreener | Token discovery, prices | No |
| Birdeye | Better data, WebSocket | Yes (recommended) |
| Jupiter | DEX swaps | No |
| Pump.fun | Token launch, bonding curve | No |
| RugCheck | Safety analysis | No |
| GoPlus | Honeypot detection | No |

### Getting API Keys

**Birdeye** (Recommended):
1. Go to https://birdeye.so
2. Create account
3. Get API key from dashboard

**Helius** (Optional, for transaction parsing):
1. Go to https://helius.xyz
2. Create account
3. Get API key

---

## 🛠️ Development

### Running Tests

```bash
npm test
```

### Building

```bash
npm run build
```

### Watching for Changes

```bash
npm run watch
```

---

## ⚠️ Disclaimer

**THIS IS EXPERIMENTAL SOFTWARE. USE AT YOUR OWN RISK.**

- Trading meme coins is extremely risky
- You can lose all your money
- Past performance doesn't guarantee future results
- This is not financial advice
- Only trade with money you can afford to lose

The developers take no responsibility for any losses incurred.

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🔗 Links

- **Website**: https://survive.ai
- **GitHub**: https://github.com/SurviveOS/Survive
- **Twitter**: https://twitter.com/survive_ai

---

<div align="center">

**🦎 SURVIVE**

*An AI that just wants to live.*

</div>
