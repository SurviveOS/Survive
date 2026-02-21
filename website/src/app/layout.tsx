import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SURVIVE | Autonomous AI Trading Agent",
  description: "An open-source AI trading agent that autonomously trades Solana meme coins. 70% profits reinvested, 30% used for token buybacks.",
  keywords: ["AI", "trading", "Solana", "crypto", "meme coins", "autonomous agent", "open source"],
  openGraph: {
    title: "SURVIVE | Autonomous AI Trading Agent",
    description: "An open-source AI trading agent on Solana. 70% reinvest, 30% token buybacks.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SURVIVE | Autonomous AI Trading Agent",
    description: "An open-source AI trading agent on Solana. 70% reinvest, 30% token buybacks.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
