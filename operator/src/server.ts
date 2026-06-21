import express from "express";
import { randomBytes } from "node:crypto";
import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { SeedStore } from "./store.js";
import { config, type GameName } from "./config.js";
import { getLiveCards } from "./blackjackWatcher.js";
import { DepositStore } from "./depositStore.js";
import { getOrCreateDepositAddress } from "./depositWatcher.js";

const GAME_NAMES: (GameName | "blackjack")[] = [...Object.keys(config.games), "blackjack"] as (GameName | "blackjack")[];

export function startServer(store: SeedStore, depositStore: DepositStore) {
  const app = express();
  app.use(express.json());

  // CORS — restrict this to your actual frontend origin in production.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  /**
   * Called by the frontend BEFORE the player submits placeBet on-chain. Generates a fresh
   * server seed, commits only its hash, and returns {commitment, clientSeed} for the
   * frontend to pass straight into the contract's placeBet call.
   */
  app.post("/commit", (req, res) => {
    const game = req.body?.game as string | undefined;
    if (!game || !GAME_NAMES.includes(game as GameName | "blackjack")) {
      return res.status(400).json({ error: `game must be one of: ${GAME_NAMES.join(", ")}` });
    }

    const serverSeed = toHex(randomBytes(32)) as Hex;
    const clientSeed = (req.body?.clientSeed as Hex) ?? (toHex(randomBytes(32)) as Hex);
    const commitment = keccak256(serverSeed);

    store.add({ serverSeed, clientSeed, commitment, game, resolved: false, createdAt: Date.now() });

    res.json({ commitment, clientSeed });
  });

  /**
   * Polled by the Blackjack frontend during play to learn the player's real cards (the
   * dealer's hole card is withheld until the round closes — see getLiveCards' doc comment).
   */
  app.get("/blackjack/:roundId/cards", async (req, res) => {
    try {
      const roundId = BigInt(req.params.roundId);
      const cards = await getLiveCards(config.blackjack, roundId, store);
      if (!cards) return res.status(404).json({ error: "round not found or not ours" });
      res.json(cards);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
    }
  });

  /**
   * Returns (creating on first call) the permanent custodial deposit address for `owner`
   * (the player's connected wallet address). Send MON/USDC/CHOG to this address from anywhere
   * — the deposit watcher sweeps it into CustodialVault and credits owner's balance there.
   */
  app.post("/deposit-address", (req, res) => {
    if (!config.depositMnemonic) {
      return res.status(503).json({ error: "Custodial deposits are not configured on this operator" });
    }
    const owner = req.body?.owner as string | undefined;
    if (!owner || !isAddress(owner)) {
      return res.status(400).json({ error: "owner must be a valid address" });
    }
    const depositAddress = getOrCreateDepositAddress(depositStore, owner as Address);
    res.json({ depositAddress });
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.listen(config.port, () => console.log(`[server] listening on :${config.port}`));
}
