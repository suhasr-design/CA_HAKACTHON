// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FairTicketsBase} from "./FairTicketsBase.sol";

/// @title FairTickets (commit-reveal version), for Quai Orchard, where Chainlink VRF isn't available.
/// @notice Randomness = keccak256(organiser secret, hash of a block mined AFTER registration closed).
///  1. Before registration opens, the organiser commits keccak256(secret) on-chain.
///  2. After registration closes, requestDraw() freezes the entrant list and picks a FUTURE block.
///  3. The organiser reveals the secret; the seed mixes it with that block's hash.
/// The organiser can't change the secret (it was committed before anyone registered), and when
/// committing they couldn't know the future block hash. If the organiser refuses to reveal,
/// anyone can trigger a fallback draw after REVEAL_WINDOW blocks, so withholding can't stall the
/// sale. Honest limitation: the organiser could withhold a reveal they dislike, forcing the
/// fallback seed; they still can't choose the result.
contract FairTicketsCommitReveal is FairTicketsBase {
    uint256 public constant REVEAL_WINDOW = 200; // blocks; must stay under 256 for blockhash
    bytes32 public seedCommitment;
    uint256 public drawBlock;

    event SeedCommitted(bytes32 commitment);
    event DrawRequested(uint256 drawBlock);
    event SeedRevealed(bytes32 secret, uint256 seed);
    event FallbackDraw(uint256 seed);

    constructor(
        string memory _eventName,
        uint256 _facePrice,
        uint32 _offerWindow,
        uint32 _claimWindow,
        address _anonAadhaar,
        uint256 _nullifierSeed
    ) FairTicketsBase(_eventName, _facePrice, _offerWindow, _claimWindow, _anonAadhaar, _nullifierSeed) {}

    /// @notice Organiser commits keccak256(abi.encode(secret)) before registration opens.
    function commitSeed(bytes32 commitment) external onlyOwner inPhase(Phase.Setup) {
        require(seedCommitment == bytes32(0), "Already committed");
        require(commitment != bytes32(0), "Empty commitment");
        seedCommitment = commitment;
        emit SeedCommitted(commitment);
    }

    function _beforeOpenRegistration() internal view override {
        require(seedCommitment != bytes32(0), "Commit the seed first");
    }

    /// @notice After registration closes, anyone can freeze the list and fix the future draw block.
    function requestDraw() external {
        _beginDrawing();
        drawBlock = block.number + 1;
        emit DrawRequested(drawBlock);
    }

    /// @notice Organiser reveals the committed secret once the draw block has been mined.
    function revealSeed(bytes32 secret) external onlyOwner inPhase(Phase.Drawing) {
        require(block.number > drawBlock, "Draw block not mined yet");
        require(block.number <= drawBlock + REVEAL_WINDOW, "Reveal window passed");
        require(keccak256(abi.encode(secret)) == seedCommitment, "Secret does not match commitment");
        uint256 seed = uint256(keccak256(abi.encode(secret, blockhash(drawBlock))));
        emit SeedRevealed(secret, seed);
        _setSeed(seed);
    }

    /// @notice If the organiser never reveals, anyone can run the draw from recent block hashes.
    function fallbackDraw() external inPhase(Phase.Drawing) {
        require(block.number > drawBlock + REVEAL_WINDOW, "Organiser can still reveal");
        uint256 seed = uint256(keccak256(abi.encode(seedCommitment, blockhash(block.number - 1))));
        emit FallbackDraw(seed);
        _setSeed(seed);
    }
}
