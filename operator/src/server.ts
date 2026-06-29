import express from "express";
import { randomBytes } from "node:crypto";
import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { SeedStore } from "./store.js";
import { config, type GameName } from "./config.js";
import { getLiveCards } from "./blackjackWatcher.js";
import { DepositStore } from "./depositStore.js";
import { getOrCreateDepositAddress } from "./depositWatcher.js";
import {
  placeCoinFlipBet,
  placeDiceBet,
  placeRouletteBet,
  placeMinesBet,
  placeCrashBet,
  placePlinkoBet,
  placeBlackjackBet,
  blackjackHit,
  blackjackStand,
  blackjackDouble,
  blackjackSplit,
  getVaultBetResult,
  VaultBetError,
} from "./vaultBet.js";

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

  /**
   * Instant, signature-free CoinFlip bet funded by the player's CustodialVault balance — see
   * vaultBet.ts for the full safety ordering (bet placed before debit, never the reverse).
   */
  app.post("/vault-bet/coinFlip/place", async (req, res) => {
    try {
      const owner = req.body?.owner as string | undefined;
      const token = req.body?.token as string | undefined;
      const amountWei = req.body?.amountWei as string | undefined;
      const wantsHeads = req.body?.wantsHeads as boolean | undefined;
      if (!owner || !isAddress(owner)) return res.status(400).json({ error: "owner must be a valid address" });
      if (!token || !isAddress(token)) return res.status(400).json({ error: "token must be a valid address" });
      if (!amountWei) return res.status(400).json({ error: "amountWei is required" });
      if (typeof wantsHeads !== "boolean") return res.status(400).json({ error: "wantsHeads must be a boolean" });

      const result = await placeCoinFlipBet(store, owner as Address, token as Address, BigInt(amountWei), wantsHeads);
      res.json(result);
    } catch (err) {
      if (err instanceof VaultBetError) return res.status(err.status).json({ error: err.message });
      console.error("[server] /vault-bet/coinFlip/place failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  app.post("/vault-bet/dice/place", async (req, res) => {
    try {
      const owner = req.body?.owner as string | undefined;
      const token = req.body?.token as string | undefined;
      const amountWei = req.body?.amountWei as string | undefined;
      const target = req.body?.target as number | undefined;
      const isUnder = req.body?.isUnder as boolean | undefined;
      if (!owner || !isAddress(owner)) return res.status(400).json({ error: "owner must be a valid address" });
      if (!token || !isAddress(token)) return res.status(400).json({ error: "token must be a valid address" });
      if (!amountWei) return res.status(400).json({ error: "amountWei is required" });
      if (typeof target !== "number") return res.status(400).json({ error: "target must be a number" });
      if (typeof isUnder !== "boolean") return res.status(400).json({ error: "isUnder must be a boolean" });

      const result = await placeDiceBet(store, owner as Address, token as Address, BigInt(amountWei), target, isUnder);
      res.json(result);
    } catch (err) {
      if (err instanceof VaultBetError) return res.status(err.status).json({ error: err.message });
      console.error("[server] /vault-bet/dice/place failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  app.post("/vault-bet/roulette/place", async (req, res) => {
    try {
      const owner = req.body?.owner as string | undefined;
      const token = req.body?.token as string | undefined;
      const amountWei = req.body?.amountWei as string | undefined;
      const kind = req.body?.kind as number | undefined;
      const number_ = req.body?.number as number | undefined;
      if (!owner || !isAddress(owner)) return res.status(400).json({ error: "owner must be a valid address" });
      if (!token || !isAddress(token)) return res.status(400).json({ error: "token must be a valid address" });
      if (!amountWei) return res.status(400).json({ error: "amountWei is required" });
      if (typeof kind !== "number") return res.status(400).json({ error: "kind must be a number" });
      if (typeof number_ !== "number") return res.status(400).json({ error: "number must be a number" });

      const result = await placeRouletteBet(store, owner as Address, token as Address, BigInt(amountWei), kind, number_);
      res.json(result);
    } catch (err) {
      if (err instanceof VaultBetError) return res.status(err.status).json({ error: err.message });
      console.error("[server] /vault-bet/roulette/place failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  app.post("/vault-bet/mines/place", async (req, res) => {
    try {
      const owner = req.body?.owner as string | undefined;
      const token = req.body?.token as string | undefined;
      const amountWei = req.body?.amountWei as string | undefined;
      const picks = req.body?.picks as number | undefined;
      const mineCount = req.body?.mineCount as number | undefined;
      if (!owner || !isAddress(owner)) return res.status(400).json({ error: "owner must be a valid address" });
      if (!token || !isAddress(token)) return res.status(400).json({ error: "token must be a valid address" });
      if (!amountWei) return res.status(400).json({ error: "amountWei is required" });
      if (typeof picks !== "number") return res.status(400).json({ error: "picks must be a number" });
      if (typeof mineCount !== "number") return res.status(400).json({ error: "mineCount must be a number" });

      const result = await placeMinesBet(store, owner as Address, token as Address, BigInt(amountWei), picks, mineCount);
      res.json(result);
    } catch (err) {
      if (err instanceof VaultBetError) return res.status(err.status).json({ error: err.message });
      console.error("[server] /vault-bet/mines/place failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  app.post("/vault-bet/crash/place", async (req, res) => {
    try {
      const owner = req.body?.owner as string | undefined;
      const token = req.body?.token as string | undefined;
      const amountWei = req.body?.amountWei as string | undefined;
      const autoCashoutBps = req.body?.autoCashoutBps as string | undefined;
      if (!owner || !isAddress(owner)) return res.status(400).json({ error: "owner must be a valid address" });
      if (!token || !isAddress(token)) return res.status(400).json({ error: "token must be a valid address" });
      if (!amountWei) return res.status(400).json({ error: "amountWei is required" });
      if (!autoCashoutBps) return res.status(400).json({ error: "autoCashoutBps is required" });

      const result = await placeCrashBet(store, owner as Address, token as Address, BigInt(amountWei), BigInt(autoCashoutBps));
      res.json(result);
    } catch (err) {
      if (err instanceof VaultBetError) return res.status(err.status).json({ error: err.message });
      console.error("[server] /vault-bet/crash/place failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  app.post("/vault-bet/plinko/place", async (req, res) => {
    try {
      const owner = req.body?.owner as string | undefined;
      const token = req.body?.token as string | undefined;
      const amountWei = req.body?.amountWei as string | undefined;
      const rows = req.body?.rows as number | undefined;
      if (!owner || !isAddress(owner)) return res.status(400).json({ error: "owner must be a valid address" });
      if (!token || !isAddress(token)) return res.status(400).json({ error: "token must be a valid address" });
      if (!amountWei) return res.status(400).json({ error: "amountWei is required" });
      if (rows === undefined || rows < 8 || rows > 16) return res.status(400).json({ error: "rows must be 8-16" });

      const result = await placePlinkoBet(store, owner as Address, token as Address, BigInt(amountWei), rows);
      res.json(result);
    } catch (err) {
      if (err instanceof VaultBetError) return res.status(err.status).json({ error: err.message });
      console.error("[server] /vault-bet/plinko/place failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  /**
   * Instant, signature-free Blackjack round funded by the player's CustodialVault balance.
   * Returns the same {cards} shape as the wallet-direct flow's placeBet so the frontend's
   * existing round-state handling doesn't need to branch on which mode opened the round.
   */
  app.post("/vault-bet/blackjack/place", async (req, res) => {
    try {
      const owner = req.body?.owner as string | undefined;
      const token = req.body?.token as string | undefined;
      const amountWei = req.body?.amountWei as string | undefined;
      if (!owner || !isAddress(owner)) return res.status(400).json({ error: "owner must be a valid address" });
      if (!token || !isAddress(token)) return res.status(400).json({ error: "token must be a valid address" });
      if (!amountWei) return res.status(400).json({ error: "amountWei is required" });

      const { roundId } = await placeBlackjackBet(store, owner as Address, token as Address, BigInt(amountWei));
      const cards = await getLiveCards(config.blackjack, BigInt(roundId), store);
      res.json({ roundId, cards });
    } catch (err) {
      if (err instanceof VaultBetError) return res.status(err.status).json({ error: err.message });
      console.error("[server] /vault-bet/blackjack/place failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  function blackjackActionRoute(action: (store: SeedStore, owner: Address, roundId: string, handIndex: number) => Promise<void>) {
    return async (req: express.Request, res: express.Response) => {
      try {
        const owner = req.body?.owner as string | undefined;
        const handIndex = (req.body?.handIndex as number | undefined) ?? 0;
        if (!owner || !isAddress(owner)) return res.status(400).json({ error: "owner must be a valid address" });

        await action(store, owner as Address, req.params.roundId, handIndex);
        const cards = await getLiveCards(config.blackjack, BigInt(req.params.roundId), store);
        res.json({ cards });
      } catch (err) {
        if (err instanceof VaultBetError) return res.status(err.status).json({ error: err.message });
        console.error(`[server] ${req.path} failed`, err);
        res.status(500).json({ error: "internal error" });
      }
    };
  }

  app.post("/vault-bet/blackjack/:roundId/hit", blackjackActionRoute(blackjackHit));
  app.post("/vault-bet/blackjack/:roundId/stand", blackjackActionRoute(blackjackStand));
  app.post("/vault-bet/blackjack/:roundId/double", blackjackActionRoute(blackjackDouble));

  app.post("/vault-bet/blackjack/:roundId/split", async (req, res) => {
    try {
      const owner = req.body?.owner as string | undefined;
      if (!owner || !isAddress(owner)) return res.status(400).json({ error: "owner must be a valid address" });

      await blackjackSplit(store, owner as Address, req.params.roundId);
      const cards = await getLiveCards(config.blackjack, BigInt(req.params.roundId), store);
      res.json({ cards });
    } catch (err) {
      if (err instanceof VaultBetError) return res.status(err.status).json({ error: err.message });
      console.error("[server] /vault-bet/blackjack/:roundId/split failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  /** Polled by the frontend after placing a vault-funded bet — no wallet event watching needed
   *  client-side, since there's no wallet involved in a vault-funded bet at all. */
  app.get("/vault-bet/:game/:betRef/result", (req, res) => {
    const result = getVaultBetResult(store, req.params.game, req.params.betRef);
    if (!result) return res.status(404).json({ error: "bet not found" });
    res.json(result);
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.listen(config.port, () => console.log(`[server] listening on :${config.port}`));
}
