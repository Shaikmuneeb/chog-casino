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
