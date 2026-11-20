// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVRFCoordinatorV2Plus, VRFV2PlusClient} from "../interfaces/IVRFCoordinatorV2Plus.sol";

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @notice DEMO ONLY. Behaves like the Chainlink VRF v2.5 coordinator on a local chain:
/// it records requests and later calls back the consumer with random words.
/// On a testnet, FairTickets points at Chainlink's real coordinator instead,
/// which also delivers a cryptographic proof that the number was not chosen.
contract MockVRFCoordinator is IVRFCoordinatorV2Plus {
    uint256 public lastRequestId;
    mapping(uint256 => address) public consumerOf;
    mapping(uint256 => uint32) public numWordsOf;

    event RandomWordsRequested(uint256 indexed requestId, address indexed consumer);
    event RandomWordsFulfilled(uint256 indexed requestId, uint256 firstWord);

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId)
    {
        requestId = ++lastRequestId;
        consumerOf[requestId] = msg.sender;
        numWordsOf[requestId] = req.numWords;
        emit RandomWordsRequested(requestId, msg.sender);
    }

    /// @notice Fulfil with a seed chosen by the caller (useful for reproducible tests).
    function fulfillWithSeed(uint256 requestId, uint256 seed) public {
        address consumer = consumerOf[requestId];
        require(consumer != address(0), "Unknown request");
        uint256[] memory words = new uint256[](numWordsOf[requestId]);
        for (uint256 i = 0; i < words.length; i++) {
            words[i] = uint256(keccak256(abi.encode(seed, i)));
        }
        delete consumerOf[requestId];
        IVRFConsumer(consumer).rawFulfillRandomWords(requestId, words);
        emit RandomWordsFulfilled(requestId, words.length > 0 ? words[0] : 0);
    }

    /// @notice Fulfil with a pseudo-random seed (local demo convenience only).
    function fulfill(uint256 requestId) external {
        fulfillWithSeed(requestId, uint256(keccak256(abi.encode(blockhash(block.number - 1), requestId, block.timestamp))));
    }
}
