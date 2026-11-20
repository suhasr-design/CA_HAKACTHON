// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAnonAadhaar} from "../interfaces/IAnonAadhaar.sol";

/// @notice TESTS ONLY. Stands in for the Anon Aadhaar verifier in unit tests.
/// Every proof is accepted except one marked invalid (last element == 0xdead),
/// so tests can also simulate a bad proof.
contract MockAnonAadhaar is IAnonAadhaar {
    function verifyAnonAadhaarProof(
        uint256,
        uint256,
        uint256,
        uint256,
        uint256[4] calldata,
        uint256[8] calldata groth16Proof
    ) external pure returns (bool) {
        return groth16Proof[7] != 0xdead;
    }
}
