// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface of the Anon Aadhaar on-chain verifier (PSE / Ethereum Foundation).
/// It checks a Groth16 zero-knowledge proof that the caller holds a genuine,
/// UIDAI-signed Aadhaar secure QR code, without revealing its contents.
interface IAnonAadhaar {
    function verifyAnonAadhaarProof(
        uint256 nullifierSeed,
        uint256 nullifier,
        uint256 timestamp,
        uint256 signal,
        uint256[4] calldata revealArray,
        uint256[8] calldata groth16Proof
    ) external view returns (bool);
}
