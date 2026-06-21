# Chog Casino — Operator Service

This is the off-chain "operator" that the commit-reveal RNG in `../contracts` depends on. Without
it running, every bet placed on any of the 6 games sits on-chain forever, unresolved — nobody
wins or loses, because nothing ever calls `revealAndResolve`.

## What it actually does

1. **`POST /commit`** — called by the frontend right before a player submits a bet. Generates a
   random server seed, stores it, and returns `{ commitment, clientSeed }` for the frontend to
   pass into the contract's `placeBet` call.
2. **Watches all 6 contracts** for the events that mean "a bet matching one of our commitments
   just landed on-chain" (`BetPlaced` for the 5 single-shot games, `RoundOpened` for Blackjack).
3. **For the 5 single-shot games** (CoinFlip/Dice/Roulette/Mines/Crash): immediately calls
   `revealAndResolve` the instant the bet is on-chain — there's no further player decision.
4. **For Blackjack**: also watches `ActionTaken` (Hit/Stand/Double/Split) and exposes
   `GET /blackjack/:roundId/cards`, which the frontend polls during play to show the player
   their real cards live — computed locally from the seed it already generated, without ever
   touching the chain. Once every hand is closed, it automatically calls `revealAndResolve`.

## Setup

```
cp .env.example .env
```

Fill in `.env`:

- **`OPERATOR_PRIVATE_KEY`** — a **brand-new wallet**, dedicated to this service only. Do **not**
  reuse your admin/deployer wallet. This process signs an unattended on-chain transaction every
  time a bet closes, so give it the least privilege possible: just `OPERATOR_ROLE`, nothing else.
- The contract addresses — already filled with the live Monad mainnet deployment; update if you
  redeploy.

### Grant OPERATOR_ROLE

The wallet behind `OPERATOR_PRIVATE_KEY` needs `OPERATOR_ROLE` on **every** game contract (all 6).
Run `npm run dev` once to print its address and the exact role hash, then from your **admin**
wallet, for each game address:

```powershell
cast send <GAME_ADDRESS> "grantRole(bytes32,address)" <OPERATOR_ROLE_HASH> <OPERATOR_WALLET_ADDRESS> --rpc-url https://rpc.monad.xyz --private-key $env:DEPLOYER_PRIVATE_KEY
```

Also fund the operator wallet with a little MON — every reveal is a real transaction and costs gas.

### Run it

```
npm install
npm run verify-math   # sanity-checks the card math against an independent keccak256 — should
                       # print "All 10 card indices match" before you trust this with real money
npm run dev            # local development
npm run build && npm start   # production
```

This needs to run **continuously** (not a one-off script) — host it on a small always-on server (a
$5/mo VPS is plenty to start), not on your own laptop that goes to sleep.

## Known gaps (MVP, not production-hardened)

- **Seed storage is a flat JSON file** (`data/seeds.json`), not a real database. It's
  durable across restarts (atomic writes), but has no replication or backups. If this file is
  lost after a commitment is on-chain but before it's revealed, that bet can **never** be
  settled — back it up. Swap in Postgres/SQLite before any real volume.
- **Missed events on restart**: if the process is down when a `BetPlaced`/`RoundOpened` event
  fires, `watchContractEvent` won't replay it once restarted — `reconcileUnmatched` in
  `watcher.ts` is a stub for this. A production version should scan recent blocks on startup to
  catch up. Until then, restart this service as little as possible, and during any restart,
  don't let players place new bets.
- **CORS is wide open** (`*`) in `server.ts` — restrict it to your real frontend origin before
  going live.

## Custodial deposit addresses (optional)

Gives each player a permanent on-chain address (derived from `DEPOSIT_MNEMONIC`) to deposit
MON/USDC/CHOG into from anywhere — even a wallet or exchange they've never connected to the
site. Funds are swept into `CustodialVault` and credited to the player's in-game balance there.
Leave the vars below in `.env.example` blank to disable this entirely; everything above (the
commit-reveal betting flow) works independently of it.

- **`DEPOSIT_MNEMONIC`** — the single most sensitive secret in this whole system. It can derive
  *every* player's deposit address, not just one. Generate with `cast wallet new-mnemonic`,
  store it more carefully than `OPERATOR_PRIVATE_KEY` (ideally on a separate machine), and never
  commit it. Rotating it changes every player's deposit address.
- **`VAULT_OPERATOR_PRIVATE_KEY`** — a separate dedicated wallet (NOT `OPERATOR_PRIVATE_KEY`)
  holding `OPERATOR_ROLE` on `CustodialVault` (see `contracts/script/DeployCustodialVault.s.sol`).
  Key separation matters here: a leak of the betting-resolution key must not also grant
  custodial-credit privileges, and vice versa. This wallet also funds small MON gas top-ups so
  deposit addresses can sweep out ERC20 (USDC/CHOG) balances — keep it stocked with MON, but it
  should never hold more than gas money.
- **Funds sit briefly at the derived address** between deposit and sweep (one poll interval,
  `DEPOSIT_POLL_INTERVAL_MS`, default 20s) — the watcher sweeps immediately on detecting a
  balance, but this is not instantaneous. A compromised `DEPOSIT_MNEMONIC` could in principle
  drain whatever's sitting at an address in that window; it cannot touch anything already
  credited in `CustodialVault`, since withdrawal there is player-signed, not operator-signed.
- **`data/deposit-addresses.json`** — same durability requirement as `data/seeds.json`: it's the
  only record of which address belongs to which player, and of in-flight sweeps that moved funds
  but haven't been credited yet. Back it up.
