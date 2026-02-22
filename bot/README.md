# 🦎 SURVIVE Bot

The autonomous trading agent that powers SURVIVE.

## Overview

This bot:
1. **Trades** Solana meme coins using technical analysis, volume analysis, and smart money tracking
2. **Manages** risk with stop-losses, position limits, and drawdown protection
3. **Survives** by buying $SURVIVE with profits and selling when capital is low

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AGENT                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Core Modules                       │   │
│  │  • SurvivalManager  - $SURVIVE token & survival     │   │
│  │  • RiskManager      - Loss limits, drawdown         │   │
│  │  • PositionManager  - Trailing stops, exits         │   │
│  │  • ProfitAllocator  - Profit distribution           │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Services                           │   │
│  │  • Jupiter      - DEX swaps                         │   │
│  │  • PumpFun      - Token launch, bonding curve       │   │
│  │  • TokenData    - Prices, trending tokens           │   │
│  │  • PriceStream  - Real-time WebSocket prices        │   │
│  │  • Indicators   - RSI, MACD, EMAs, Bollinger        │   │
│  │  • RugDetector  - Safety checks                     │   │
│  │  • SmartMoney   - Wallet tracking                   │   │
│  │  • VolumeAnalyzer - Buy/sell pressure               │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Strategy                           │   │
│  │  • MomentumStrategy - Multi-factor entry/exit       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your private key

# Run
npm run dev
```

## Configuration

### Required

```env
PRIVATE_KEY=your_base58_private_key
```

### Trading

```env
MAX_TRADE_SIZE_SOL=1.0        # Max SOL per trade
STOP_LOSS_PERCENT=20          # Stop loss %
TAKE_PROFIT_PERCENT=100       # Take profit %
MAX_POSITIONS=5               # Max concurrent positions
```

### Risk Management

```env
MAX_DAILY_LOSS_PERCENT=10     # Daily loss limit
MAX_DRAWDOWN_PERCENT=25       # Max drawdown
MAX_EXPOSURE_PERCENT=60       # Max in positions
MAX_CONSECUTIVE_LOSSES=3      # Cooldown trigger
COOLDOWN_MINUTES=30           # Cooldown time
```

### Position Management

```env
TRAILING_STOP_PERCENT=15      # Trailing stop
TRAILING_ACTIVATION_PERCENT=30 # Activate after X% gain
PARTIAL_TAKE_PROFIT_PERCENT=50 # Partial take level
PARTIAL_TAKE_SIZE=50          # % to sell at partial
MAX_HOLD_TIME_HOURS=24        # Force exit time
```

### APIs (Optional but Recommended)

```env
BIRDEYE_API_KEY=xxx           # Better data, real-time streaming
HELIUS_API_KEY=xxx            # Transaction parsing
```

## Usage

### Basic

```typescript
import { SurviveAgent } from './core/agent';
import { loadConfig } from './config';

const config = loadConfig();
const agent = new SurviveAgent(config);

// Start trading
await agent.start();

// Launch $SURVIVE token (first time)
await agent.launchSurviveToken(1); // 1 SOL initial

// Check status
const state = agent.getSurvivalState();
console.log(state.status); // 'healthy' | 'low' | 'critical' | 'emergency'

// Stop
await agent.stop();
```

### Emergency

```typescript
// Emergency exit all positions
await agent.emergencyExit();

// Clear cooldown manually
agent.clearCooldown();
```

## Services

### TokenData

Fetches token information from Birdeye/DexScreener:

```typescript
const tokenData = new TokenDataService(birdeyeApiKey);

// Get token info
const info = await tokenData.getTokenInfo(mintAddress);

// Get trending tokens
const trending = await tokenData.getTrendingTokens(50);

// Get top gainers
const gainers = await tokenData.getTopGainers(20, '1h');

// Safety check
const safety = await tokenData.isTokenSafe(mintAddress);
```

### Technical Indicators

```typescript
const indicators = new TechnicalIndicators();

// Full analysis from OHLCV candles
const signals = indicators.analyzeOHLCV(candles);
console.log(signals.rsi);      // { value, signal, strength }
console.log(signals.macd);     // { macd, signal, histogram, trend, crossover }
console.log(signals.ema);      // { ema9, ema21, ema50, trend }
console.log(signals.overall);  // { score, signal, confidence }

// Quick analysis from prices only
const quick = indicators.quickAnalysis(prices);
```

### Rug Detection

```typescript
const rugDetector = new RugDetector(rpcUrl);

// Full check
const result = await rugDetector.checkToken(mintAddress);
console.log(result.safe);      // boolean
console.log(result.score);     // 0-100
console.log(result.details);   // { mintAuthority, lpLocked, isHoneypot, ... }

// Quick honeypot check
const honeypot = await rugDetector.quickHoneypotCheck(mintAddress);
```

### Smart Money

```typescript
const smartMoney = new SmartMoneyTracker(birdeyeApiKey);

// Discover profitable wallets
const wallets = await smartMoney.discoverSmartWallets(tokenAddress);

// Analyze token activity
const activity = await smartMoney.analyzeTokenActivity(tokenAddress);
console.log(activity.signal);       // 'bullish' | 'bearish' | 'neutral'
console.log(activity.smartBuyers24h); // count
```

### Volume Analysis

```typescript
const volumeAnalyzer = new VolumeAnalyzer(tokenData, birdeyeApiKey);

// Get volume profile
const profile = await volumeAnalyzer.getVolumeProfile(tokenAddress);
console.log(profile.buyPressure);   // 0-100
console.log(profile.volumeTrend);   // 'surging' | 'increasing' | 'stable' | 'decreasing' | 'dying'
console.log(profile.signal);        // 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell'
```

### Pump.fun

```typescript
const pumpfun = new PumpFunService(wallet);

// Launch token
const result = await pumpfun.launchTokenLocal({
  name: 'My Token',
  symbol: 'TOKEN',
  description: 'Description here',
}, 1); // 1 SOL initial buy

// Buy on bonding curve
await pumpfun.buy(mintAddress, 0.5); // 0.5 SOL

// Sell on bonding curve
await pumpfun.sell(mintAddress, 1000000); // token amount

// Check if graduated to Raydium
const graduated = await pumpfun.isGraduated(mintAddress);
```

## File Structure

```
src/
├── index.ts                 # Entry point
├── config/
│   └── index.ts            # Configuration loader
├── core/
│   ├── agent.ts            # Main agent
│   ├── survivalManager.ts  # $SURVIVE management
│   ├── riskManager.ts      # Risk controls
│   ├── positionManager.ts  # Position tracking
│   ├── profitAllocator.ts  # Profit distribution
│   └── priceWatcher.ts     # Real-time alerts
├── services/
│   ├── wallet.ts           # Solana wallet
│   ├── jupiter.ts          # Jupiter swaps
│   ├── pumpfun.ts          # Pump.fun integration
│   ├── tokenData.ts        # Token data
│   ├── priceStream.ts      # WebSocket prices
│   ├── indicators.ts       # Technical indicators
│   ├── rugDetector.ts      # Safety checks
│   ├── smartMoney.ts       # Wallet tracking
│   ├── volumeAnalyzer.ts   # Volume analysis
│   └── entryTiming.ts      # Entry optimization
├── strategies/
│   ├── base.ts             # Strategy interface
│   └── momentum.ts         # Main strategy
└── utils/
    ├── storage.ts          # State persistence
    └── logger.ts           # Logging
```

## Scripts

```bash
npm run dev      # Run with ts-node (development)
npm run build    # Compile TypeScript
npm start        # Run compiled JS (production)
npm run watch    # Watch mode compilation
```

## State Persistence

The bot saves state to `data/state.json`:

```json
{
  "positions": [...],
  "trades": [...],
  "totalProfit": 0,
  "riskState": {...},
  "survivalState": {...}
}
```

State is automatically loaded on restart.

## Logging

Logs are structured with timestamps and module names:

```
[2024-01-15 12:00:00] [Agent] 🦎 SURVIVE Agent Starting
[2024-01-15 12:00:01] [Strategy] Analyzing 100 tokens...
[2024-01-15 12:00:02] [RiskManager] Risk checks passed
[2024-01-15 12:00:03] [Jupiter] Buying TOKEN for 0.5 SOL
```

## Safety Features

1. **Never trades honeypots** - Checked via GoPlus API
2. **Avoids rugs** - Mint authority, LP lock checks
3. **Respects daily limits** - Stops after max loss
4. **Cooldown on losses** - Prevents revenge trading
5. **Position limits** - Never over-exposes
6. **Trailing stops** - Locks in profits
7. **Time exits** - Doesn't hold forever

## License

MIT
