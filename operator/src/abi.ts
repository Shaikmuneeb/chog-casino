// Minimal ABIs — only what the operator needs to watch events and call revealAndResolve.

export const SINGLE_SHOT_GAME_ABI = [
  {
    type: "event",
    name: "BetPlaced",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "betRef", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "BetResolved",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "payoutAmount", type: "uint256", indexed: false },
      { name: "won", type: "bool", indexed: false },
    ],
  },
  {
    type: "function",
    name: "revealAndResolve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "betId", type: "uint256" },
      { name: "serverSeed", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "serverSeedCommitment",
    stateMutability: "view",
    inputs: [{ name: "betId", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

// CoinFlip-specific placeBet — combined with SINGLE_SHOT_GAME_ABI's events/revealAndResolve
// when the operator needs both (see COINFLIP_ABI below).
export const COINFLIP_PLACE_BET_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "wantsHeads", type: "bool" },
      { name: "userRandomNumber", type: "bytes32" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "betRef", type: "uint256" }],
  },
] as const;

export const COINFLIP_ABI = [...SINGLE_SHOT_GAME_ABI, ...COINFLIP_PLACE_BET_ABI] as const;

export const DICE_PLACE_BET_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "target", type: "uint8" },
      { name: "isUnder", type: "bool" },
      { name: "userRandomNumber", type: "bytes32" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "betRef", type: "uint256" }],
  },
] as const;
export const DICE_ABI = [...SINGLE_SHOT_GAME_ABI, ...DICE_PLACE_BET_ABI] as const;

export const ROULETTE_PLACE_BET_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "kind", type: "uint8" },
      { name: "number", type: "uint8" },
      { name: "userRandomNumber", type: "bytes32" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "betRef", type: "uint256" }],
  },
] as const;
export const ROULETTE_ABI = [...SINGLE_SHOT_GAME_ABI, ...ROULETTE_PLACE_BET_ABI] as const;

// Mirrors Roulette.sol's BetKind enum order exactly.
export const RouletteBetKind = {
  StraightNumber: 0,
  Red: 1,
  Black: 2,
  Odd: 3,
  Even: 4,
  Low: 5,
  High: 6,
} as const;

export const MINES_PLACE_BET_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "picks", type: "uint8" },
      { name: "mineCount", type: "uint8" },
      { name: "userRandomNumber", type: "bytes32" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "betRef", type: "uint256" }],
  },
] as const;
export const MINES_ABI = [...SINGLE_SHOT_GAME_ABI, ...MINES_PLACE_BET_ABI] as const;

export const CRASH_PLACE_BET_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "autoCashoutBps", type: "uint256" },
      { name: "userRandomNumber", type: "bytes32" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "betRef", type: "uint256" }],
  },
] as const;
export const CRASH_ABI = [...SINGLE_SHOT_GAME_ABI, ...CRASH_PLACE_BET_ABI] as const;

export const BLACKJACK_ABI = [
  {
    type: "event",
    name: "RoundOpened",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "betAmount", type: "uint256", indexed: false },
      { name: "serverSeedCommitment", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ActionTaken",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "action", type: "uint8", indexed: false },
      { name: "handIndex", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RoundResolved",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "totalPayout", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "revealAndResolve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "serverSeed", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "roundId", type: "uint256" }],
  },
  {
    type: "function",
    name: "hit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "handIndex", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "stand",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "handIndex", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "double",
    stateMutability: "payable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "handIndex", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "split",
    stateMutability: "payable",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "rounds",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [
      { name: "player", type: "address" },
      { name: "token", type: "address" },
      { name: "betHand0", type: "uint256" },
      { name: "betHand1", type: "uint256" },
      { name: "totalHands", type: "uint8" },
      { name: "cardCount0", type: "uint8" },
      { name: "cardCount1", type: "uint8" },
      { name: "hand0Closed", type: "bool" },
      { name: "hand1Closed", type: "bool" },
      { name: "isSplit", type: "bool" },
      { name: "resolved", type: "bool" },
      { name: "exists", type: "bool" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "getActions",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "action", type: "uint8" },
          { name: "handIndex", type: "uint8" },
        ],
      },
    ],
  },
] as const;

export const ActionType = { Hit: 0, Stand: 1, Double: 2, Split: 3 } as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const CUSTODIAL_VAULT_ABI = [
  {
    type: "function",
    name: "credit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "sweepRef", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "debit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "betRef", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
