# 🎰 Chog Casino

A premium crypto-themed casino web app featuring four games — **Coin Flip, Mines, Roulette, and Blackjack** — with a Real/Fun mode toggle, social profile, and wallet connection.

## 🔗 Live Site

**▶️ https://chog-casino-api-server-ewan.vercel.app**

The live site auto-updates on every push to `main`.

## ✨ Features

- **Four games:** Coin Flip, Mines, Roulette (animated wheel), Blackjack
- **Real / Fun mode toggle** — play with real $CHOG (wallet-gated) or free demo credits
- **Shared persistent balance** across all games
- **Profile page** — custom avatar + username
- **Social connect** scaffolding for X (Twitter) and Discord
- **Wallet connection** via RainbowKit / wagmi

## 🛠 Tech Stack

- Vite + React + TypeScript
- wouter (routing), TanStack Query
- Tailwind CSS + shadcn/ui, Framer Motion
- wagmi + viem + RainbowKit (wallet)
- pnpm workspace monorepo

## 🚀 Run Locally

This is a pnpm monorepo. The frontend lives in `artifacts/chog-casino`.

```bash
# install (from repo root)
pnpm install

# start the dev server
cd artifacts/chog-casino
PORT=5173 BASE_PATH=/ pnpm run dev
```

Then open http://localhost:5173

## 📦 Deployment

Deployed on Vercel with Root Directory set to `artifacts/chog-casino`. Configuration lives in [`artifacts/chog-casino/vercel.json`](artifacts/chog-casino/vercel.json). Every push to `main` triggers an automatic redeploy.
