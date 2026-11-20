// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FairTicketsBase} from "./FairTicketsBase.sol";
import {IVRFCoordinatorV2Plus, VRFV2PlusClient} from "./interfaces/IVRFCoordinatorV2Plus.sol";

/// @title FairTickets (Chainlink VRF version), used for the local demo.
/// @notice Randomness comes from Chainlink VRF v2.5: a random number with a proof that nobody
/// chose it. On the local chain a mock coordinator stands in for Chainlink.
contract FairTickets is FairTicketsBase {
    struct VrfConfig {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        bool nativePayment;
    }

    IVRFCoordinatorV2Plus public immutable vrfCoordinator;
    VrfConfig public vrfConfig;
    uint256 public vrfRequestId;

    event DrawRequested(uint256 requestId);

    constructor(
        string memory _eventName,
        uint256 _facePrice,
        uint32 _offerWindow,
        uint32 _claimWindow,
        address _anonAadhaar,
        uint256 _nullifierSeed,
        address _vrfCoordinator,
        VrfConfig memory _vrfConfig
    ) FairTicketsBase(_eventName, _facePrice, _offerWindow, _claimWindow, _anonAadhaar, _nullifierSeed) {
        vrfCoordinator = IVRFCoordinatorV2Plus(_vrfCoordinator);
        vrfConfig = _vrfConfig;
    }

    /// @notice After registration closes, anyone can request the random seed.
    function requestDraw() external {
        _beginDrawing();
        vrfRequestId = vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfConfig.keyHash,
                subId: vrfConfig.subId,
                requestConfirmations: vrfConfig.requestConfirmations,
                callbackGasLimit: vrfConfig.callbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: vrfConfig.nativePayment}))
            })
        );
        emit DrawRequested(vrfRequestId);
    }

    /// @notice Called by the VRF coordinator (same entry point as Chainlink's VRFConsumerBaseV2Plus).
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        require(msg.sender == address(vrfCoordinator), "Only VRF coordinator");
        require(requestId == vrfRequestId, "Unexpected request");
        _setSeed(randomWords[0]);
    }
}
