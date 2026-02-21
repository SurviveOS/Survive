"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// Placeholder data - will be replaced with real blockchain data
const MOCK_DATA = {
  walletAddress: "Not connected yet",
  solBalance: 20.0,
  tokenBalance: 0,
  totalProfit: 0,
  totalTokenBought: 0,
  feesEarned: 0,
  trades: [] as Trade[],
  tokenInfo: {
    name: "SURVIVE",
    symbol: "$SURVIVEIVE",
    launched: false,
  },
};

interface Trade {
  id: string;
  type: "buy" | "sell" | "buyback";
  token: string;
  amount: number;
  price: number;
  profit?: number;
  timestamp: Date;
  txHash: string;
}

export default function Home() {
  const [data, setData] = useState(MOCK_DATA);
  const [isLive, setIsLive] = useState(false);

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-900/20 via-black to-emerald-900/20" />
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
        
        <nav className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🦎</span>
            <span className="text-xl font-bold tracking-tight">SURVIVE</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="#how-it-works" className="text-gray-400 hover:text-white transition">
              How It Works
            </Link>
            <Link href="#stats" className="text-gray-400 hover:text-white transition">
              Stats
            </Link>
            <Link 
              href="https://github.com/justfuckingsurvive/Survive" 
              target="_blank"
              className="text-gray-400 hover:text-white transition"
            >
              GitHub
            </Link>
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
              isLive ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
              {isLive ? 'Live' : 'Pre-Launch'}
            </div>
          </div>
        </nav>

        <div className="relative z-10 max-w-7xl mx-auto px-6 py-24 text-center">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter mb-6">
            <span className="bg-gradient-to-r from-green-400 via-emerald-400 to-green-500 bg-clip-text text-transparent">
              SURVIVE
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-400 max-w-2xl mx-auto mb-8">
            An autonomous AI trading agent that supports its own token ecosystem.
            <br />
            <span className="text-green-400">Agent decides the split</span> · <span className="text-emerald-400">Survival first</span>
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link 
              href="#stats"
              className="px-8 py-4 bg-green-500 hover:bg-green-400 text-black font-bold rounded-lg transition transform hover:scale-105"
            >
              View Live Stats
            </Link>
            <Link 
              href="https://github.com/justfuckingsurvive/Survive"
              target="_blank" 
              className="px-8 py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition"
            >
              View Source Code
            </Link>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
            <StatCard label="SOL Balance" value={`${data.solBalance} SOL`} />
            <StatCard label="Total Profit" value={`${data.totalProfit} SOL`} />
            <StatCard label="Token Bought" value={`${data.totalTokenBought} $SURVIVE`} />
            <StatCard label="Fees Earned" value={`${data.feesEarned} SOL`} />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 bg-gradient-to-b from-black to-gray-900">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-4xl font-bold text-center mb-16">How It Works</h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon="🤖"
              title="AI Trading"
              description="The agent autonomously trades Solana meme coins using proven strategies, building profits over time."
            />
            <FeatureCard
              icon="💰"
              title="Dynamic Allocation"
              description="Agent decides the split: Operating costs first (survival), then reinvest for growth, then $SURVIVE buybacks."
            />
            <FeatureCard
              icon="🔄"
              title="Fee Flywheel"
              description="Token trading volume generates fees that flow back to the agent wallet, creating a self-sustaining ecosystem."
            />
          </div>

          {/* Flow Diagram */}
          <div className="mt-16 p-8 bg-black/50 rounded-2xl border border-white/10">
            <div className="flex flex-col md:flex-row items-center justify-center gap-4 text-center">
              <FlowStep emoji="💵" label="Trade Profits" />
              <Arrow />
              <FlowStep emoji="🛡️" label="1. Survival" highlight />
              <Arrow />
              <FlowStep emoji="📈" label="2. Growth" highlight />
              <Arrow />
              <FlowStep emoji="🦎" label="3. $SURVIVE" highlight />
              <Arrow />
              <FlowStep emoji="🔁" label="Repeat" />
            </div>
          </div>
        </div>
      </section>

      {/* Live Stats */}
      <section id="stats" className="py-24 bg-gray-900">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-4xl font-bold text-center mb-4">Live Stats</h2>
          <p className="text-gray-400 text-center mb-16">
            All data pulled directly from the Solana blockchain. 
            <Link href={`https://solscan.io/account/${data.walletAddress}`} target="_blank" className="text-green-400 hover:underline ml-1">
              Verify on Solscan →
            </Link>
          </p>

          {/* Wallet Info */}
          <div className="bg-black/50 rounded-2xl border border-white/10 p-6 mb-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <p className="text-gray-400 text-sm mb-1">Agent Wallet</p>
                <code className="text-green-400 font-mono text-lg break-all">{data.walletAddress}</code>
              </div>
              <div className="flex gap-4">
                <div className="text-right">
                  <p className="text-gray-400 text-sm">SOL Balance</p>
                  <p className="text-2xl font-bold">{data.solBalance} SOL</p>
                </div>
                <div className="text-right">
                  <p className="text-gray-400 text-sm">$SURVIVE Held</p>
                  <p className="text-2xl font-bold">{data.tokenBalance}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            <BigStatCard 
              label="Total Trades" 
              value={data.trades.length.toString()} 
              subtext="all time"
            />
            <BigStatCard 
              label="Total Profit" 
              value={`${data.totalProfit} SOL`} 
              subtext={`≈ $${(data.totalProfit * 75).toFixed(2)}`}
              positive
            />
            <BigStatCard 
              label="Token Buybacks" 
              value={`${data.totalTokenBought} $SURVIVE`} 
              subtext="agent decided"
            />
            <BigStatCard 
              label="Fees Earned" 
              value={`${data.feesEarned} SOL`} 
              subtext="from volume"
            />
          </div>

          {/* Recent Activity */}
          <div className="bg-black/50 rounded-2xl border border-white/10 overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <h3 className="text-xl font-bold">Recent Activity</h3>
            </div>
            {data.trades.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <p className="text-4xl mb-4">🚀</p>
                <p>No trades yet. Agent launching soon!</p>
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {data.trades.map((trade) => (
                  <TradeRow key={trade.id} trade={trade} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Token Section */}
      <section className="py-24 bg-black">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-4">$SURVIVE Token</h2>
          <p className="text-gray-400 mb-12 max-w-2xl mx-auto">
            The native token of the Survive ecosystem. Dev deploys it, agent supports it with buybacks.
          </p>

          {data.tokenInfo.launched ? (
            <div className="bg-gradient-to-r from-green-900/30 to-emerald-900/30 rounded-2xl border border-green-500/30 p-8 max-w-xl mx-auto">
              <p className="text-green-400 font-bold mb-2">Token Live!</p>
              {/* Token details will go here */}
            </div>
          ) : (
            <div className="bg-white/5 rounded-2xl border border-white/10 p-8 max-w-xl mx-auto">
              <p className="text-yellow-400 font-bold mb-2">Coming Soon</p>
              <p className="text-gray-400">
                Dev will deploy $SURVIVE and give the contract to the agent. 
                Then the buybacks begin.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Open Source */}
      <section className="py-24 bg-gradient-to-b from-black to-gray-900">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-4">100% Open Source</h2>
          <p className="text-gray-400 mb-8 max-w-2xl mx-auto">
            Every line of code is public. Verify the strategy, fork it, or run your own agent.
          </p>
          <Link 
            href="https://github.com/justfuckingsurvive/Survive"
            target="_blank"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-black font-bold rounded-lg hover:bg-gray-200 transition"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            View on GitHub
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-gray-900 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🦎</span>
              <span className="font-bold">SURVIVE</span>
              <span className="text-gray-500">· Built by AI, for transparency</span>
            </div>
            <div className="flex items-center gap-6 text-gray-400">
              <Link href="https://github.com/justfuckingsurvive/Survive" target="_blank" className="hover:text-white transition">
                GitHub
              </Link>
              <Link href={`https://solscan.io/account/${data.walletAddress}`} target="_blank" className="hover:text-white transition">
                Solscan
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function BigStatCard({ label, value, subtext, positive }: { label: string; value: string; subtext: string; positive?: boolean }) {
  return (
    <div className="bg-black/50 rounded-xl p-6 border border-white/10">
      <p className="text-gray-400 text-sm mb-2">{label}</p>
      <p className={`text-3xl font-bold mb-1 ${positive ? 'text-green-400' : ''}`}>{value}</p>
      <p className="text-gray-500 text-sm">{subtext}</p>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-white/5 rounded-2xl p-8 border border-white/10 hover:border-green-500/50 transition">
      <span className="text-4xl mb-4 block">{icon}</span>
      <h3 className="text-xl font-bold mb-2">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </div>
  );
}

function FlowStep({ emoji, label, highlight }: { emoji: string; label: string; highlight?: boolean }) {
  return (
    <div className={`px-4 py-3 rounded-lg ${highlight ? 'bg-green-500/20 border border-green-500/30' : 'bg-white/5'}`}>
      <span className="text-2xl block mb-1">{emoji}</span>
      <span className={`text-sm ${highlight ? 'text-green-400' : 'text-gray-400'}`}>{label}</span>
    </div>
  );
}

function Arrow() {
  return (
    <span className="text-gray-600 hidden md:block">→</span>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const typeColors = {
    buy: 'text-green-400',
    sell: 'text-red-400',
    buyback: 'text-emerald-400',
  };

  return (
    <div className="p-4 flex items-center justify-between hover:bg-white/5 transition">
      <div className="flex items-center gap-4">
        <span className={`font-mono uppercase font-bold ${typeColors[trade.type]}`}>
          {trade.type}
        </span>
        <span>{trade.token}</span>
      </div>
      <div className="text-right">
        <p className="font-mono">{trade.amount} @ {trade.price}</p>
        {trade.profit && (
          <p className={trade.profit > 0 ? 'text-green-400' : 'text-red-400'}>
            {trade.profit > 0 ? '+' : ''}{trade.profit} SOL
          </p>
        )}
      </div>
    </div>
  );
}
