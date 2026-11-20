// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAnonAadhaar} from "../interfaces/IAnonAadhaar.sol";

/// @notice DEMO ONLY. Sits between FairTickets and the real Anon Aadhaar verifier.
///  - Real zero-knowledge proofs are always forwarded to the real verifier.
///  - A fixed list of synthetic demo accounts, set once at deployment and public on-chain,
///    may join with an all-zero "synthetic" proof so a crowd can be simulated on stage.
/// Production deploys FairTickets directly against the official AnonAadhaar contract,
/// without this router.
contract DemoAadhaarRouter is IAnonAadhaar {
    IAnonAadhaar public immutable realVerifier;
    mapping(address => bool) public isSyntheticFan;
    address[] public syntheticFans;

    constructor(address _realVerifier, address[] memory _syntheticFans) {
        realVerifier = IAnonAadhaar(_realVerifier);
        for (uint256 i = 0; i < _syntheticFans.length; i++) {
            isSyntheticFan[_syntheticFans[i]] = true;
        }
        syntheticFans = _syntheticFans;
    }

    function verifyAnonAadhaarProof(
        uint256 nullifierSeed,
        uint256 nullifier,
        uint256 timestamp,
        uint256 signal,
        uint256[4] calldata revealArray,
        uint256[8] calldata groth16Proof
    ) external view returns (bool) {
        if (isSyntheticProof(groth16Proof)) {
            return isSyntheticFan[address(uint160(signal))];
        }
        return realVerifier.verifyAnonAadhaarProof(nullifierSeed, nullifier, timestamp, signal, revealArray, groth16Proof);
    }

    function isSyntheticProof(uint256[8] calldata p) public pure returns (bool) {
        for (uint256 i = 0; i < 8; i++) if (p[i] != 0) return false;
        return true;
    }

    function syntheticFanCount() external view returns (uint256) {
        return syntheticFans.length;
    }
}
