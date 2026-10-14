// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Chog Shield — loss-rebate ("bailout") system for the prediction market.
/// The authorized market rakes a fee into this contract via plain MON transfers; recorded
/// user losses are rebated at REBATE_BPS, capped per claim and by the contract's balance.
contract ChogShield is Ownable2Step, ReentrancyGuard {
    address public immutable chogNFT;
    address public authorizedMarket;

    uint256 public constant REBATE_BPS = 2000; // 20%
    uint256 public constant MAX_BAILOUT_PER_CLAIM = 50 ether; // 50 MON cap
    uint256 public constant COOLDOWN_PERIOD = 7 days;

    mapping(address => uint256) public lastClaimTimestamp;
    mapping(address => uint256) public userRecordedLosses;

    event MarketAuthorized(address indexed market);
    event LossRecorded(address indexed user, uint256 amount, uint256 totalRecorded);
    event BailoutClaimed(address indexed user, uint256 amount);

    constructor(address _chogNFT) Ownable(msg.sender) {
        require(_chogNFT != address(0), "bad NFT address");
        chogNFT = _chogNFT;
    }

    function setAuthorizedMarket(address _market) external onlyOwner {
        authorizedMarket = _market;
        emit MarketAuthorized(_market);
    }

    /// @dev Accepts the fee rake pushed in by the authorized market.
    receive() external payable {}

    modifier onlyAuthorizedMarket() {
        require(msg.sender == authorizedMarket, "not market");
        _;
    }

    function recordLoss(address user, uint256 amount) external onlyAuthorizedMarket {
        require(user != address(0), "bad user");
        require(amount > 0, "zero amount");
        userRecordedLosses[user] += amount;
        emit LossRecorded(user, amount, userRecordedLosses[user]);
    }

    function claimBailout() external nonReentrant {
        require(IERC721(chogNFT).balanceOf(msg.sender) > 0, "No Chog NFT");
        require(block.timestamp >= lastClaimTimestamp[msg.sender] + COOLDOWN_PERIOD, "Cooldown active");

        uint256 refund = (userRecordedLosses[msg.sender] * REBATE_BPS) / 10000;
        if (refund > MAX_BAILOUT_PER_CLAIM) {
            refund = MAX_BAILOUT_PER_CLAIM;
        }
        if (refund > address(this).balance) {
            refund = address(this).balance;
        }
        require(refund > 0, "No loss to claim");

        userRecordedLosses[msg.sender] = 0;
        lastClaimTimestamp[msg.sender] = block.timestamp;

        (bool success, ) = msg.sender.call{value: refund}("");
        require(success, "transfer failed");

        emit BailoutClaimed(msg.sender, refund);
    }
}
