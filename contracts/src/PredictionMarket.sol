// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IChogShield {
    function recordLoss(address user, uint256 amount) external;
}

/// @notice Binary yes/no prediction market. Protocol takes a 2.5% rake off the LOSING
/// pool at resolution, split 60/40 between the Chog Shield loss-rebate pool and treasury.
/// Winners claim a pro-rata share of the remaining pot; losers get their stake recorded
/// against ChogShield for the 20% loss rebate.
contract PredictionMarket is Ownable2Step, ReentrancyGuard {
    address payable public immutable shieldPool;
    address public immutable treasury;

    uint256 public constant PROTOCOL_FEE_BPS = 250; // 2.5% total rake
    uint256 public constant SHIELD_CUT_BPS = 6000; // 60% of fee to shield (1.5% net), 40% to treasury
    uint256 public constant BPS_DENOMINATOR = 10000;

    uint256 public marketCount;

    struct Market {
        string question;
        uint256 endTime;
        uint256 totalYesAmount;
        uint256 totalNoAmount;
        bool resolved;
        uint8 winningOutcome; // 0: Open/None, 1: Yes, 2: No
        mapping(address => uint256) yesBets;
        mapping(address => uint256) noBets;
        mapping(address => bool) claimed;
    }

    mapping(uint256 => Market) public markets;

    event MarketCreated(uint256 indexed marketId, string question, uint256 endTime);
    event BetPlaced(uint256 indexed marketId, address indexed user, bool isYes, uint256 amount);
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, uint256 shieldFee, uint256 treasuryFee);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 payout);

    constructor(address payable _shieldPool, address _treasury) Ownable(msg.sender) {
        require(_shieldPool != address(0), "bad shield");
        require(_treasury != address(0), "bad treasury");
        shieldPool = _shieldPool;
        treasury = _treasury;
    }

    function createMarket(string calldata question, uint256 duration)
        external
        onlyOwner
        returns (uint256 marketId)
    {
        require(bytes(question).length > 0, "Empty question");
        require(duration > 0, "Zero duration");

        marketId = ++marketCount;
        Market storage m = markets[marketId];
        m.question = question;
        m.endTime = block.timestamp + duration;

        emit MarketCreated(marketId, question, m.endTime);
    }

    function placeBet(uint256 marketId, bool isYes) external payable nonReentrant {
        Market storage m = markets[marketId];
        require(block.timestamp < m.endTime, "Market closed");
        require(msg.value > 0, "Zero bet");

        if (isYes) {
            m.yesBets[msg.sender] += msg.value;
            m.totalYesAmount += msg.value;
        } else {
            m.noBets[msg.sender] += msg.value;
            m.totalNoAmount += msg.value;
        }

        emit BetPlaced(marketId, msg.sender, isYes, msg.value);
    }

    function resolveMarket(uint256 marketId, uint8 outcome) external onlyOwner nonReentrant {
        require(outcome == 1 || outcome == 2, "Invalid outcome");

        Market storage m = markets[marketId];
        require(block.timestamp >= m.endTime, "Market still active");
        require(!m.resolved, "Already resolved");

        m.resolved = true;
        m.winningOutcome = outcome;

        uint256 losingPool = (outcome == 1) ? m.totalNoAmount : m.totalYesAmount;
        uint256 shieldFee = 0;
        uint256 treasuryFee = 0;

        if (losingPool > 0) {
            uint256 totalFee = (losingPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
            shieldFee = (totalFee * SHIELD_CUT_BPS) / BPS_DENOMINATOR;
            treasuryFee = totalFee - shieldFee;

            if (shieldFee > 0) {
                (bool shieldOk, ) = shieldPool.call{value: shieldFee}("");
                require(shieldOk, "shield transfer failed");
            }
            if (treasuryFee > 0) {
                (bool treasuryOk, ) = treasury.call{value: treasuryFee}("");
                require(treasuryOk, "treasury transfer failed");
            }
        }

        emit MarketResolved(marketId, outcome, shieldFee, treasuryFee);
    }

    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.resolved, "Not resolved");
        require(!m.claimed[msg.sender], "Already claimed");

        uint256 stakeOnWinning;
        uint256 stakeOnLosing;
        if (m.winningOutcome == 1) {
            stakeOnWinning = m.yesBets[msg.sender];
            stakeOnLosing = m.noBets[msg.sender];
        } else {
            stakeOnWinning = m.noBets[msg.sender];
            stakeOnLosing = m.yesBets[msg.sender];
        }
        require(stakeOnWinning > 0 || stakeOnLosing > 0, "No bet");

        // CEI: lock the claim before any external call so neither the shield recordLoss
        // nor the payout can be replayed.
        m.claimed[msg.sender] = true;

        if (stakeOnLosing > 0) {
            IChogShield(shieldPool).recordLoss(msg.sender, stakeOnLosing);
        }

        uint256 payout;
        if (stakeOnWinning > 0) {
            uint256 winningPool = (m.winningOutcome == 1) ? m.totalYesAmount : m.totalNoAmount;
            uint256 losingPool = (m.winningOutcome == 1) ? m.totalNoAmount : m.totalYesAmount;
            uint256 totalFee = (losingPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
            // Rake was already paid out at resolution, so the remaining pot is the whole
            // pot minus that fee, split pro-rata across winning stakes.
            uint256 remainingPot = m.totalYesAmount + m.totalNoAmount - totalFee;
            payout = (stakeOnWinning * remainingPot) / winningPool;
        }

        if (payout > 0) {
            (bool ok, ) = payable(msg.sender).call{value: payout}("");
            require(ok, "payout failed");
            emit WinningsClaimed(marketId, msg.sender, payout);
        }
    }
}
