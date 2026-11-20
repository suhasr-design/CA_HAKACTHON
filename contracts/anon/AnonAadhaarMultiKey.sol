// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@anon-aadhaar/contracts/interfaces/IAnonAadhaarGroth16Verifier.sol";
import "../interfaces/IAnonAadhaar.sol";

/// @title AnonAadhaarMultiKey
/// @notice Same check as the official AnonAadhaar contract, but accepts several UIDAI signing keys.
/// UIDAI rotates the key that signs Aadhaar Secure QRs (2021 key, Feb-2026 key, current 2026 key
/// valid to 2029). The official contract stores ONE key hash, so it would reject every QR signed
/// with any other key. Here the accepted key hashes are fixed at deployment: there is no admin and
/// no way to add keys later, so nobody can quietly accept a forged "UIDAI" key.
contract AnonAadhaarMultiKey is IAnonAadhaar {
    address public immutable verifier;
    uint256[] private _keyHashes;

    constructor(address _verifier, uint256[] memory keyHashes) {
        require(keyHashes.length > 0 && keyHashes.length <= 8, "1-8 key hashes");
        verifier = _verifier;
        _keyHashes = keyHashes;
    }

    function acceptedKeyHashes() external view returns (uint256[] memory) {
        return _keyHashes;
    }

    function verifyAnonAadhaarProof(
        uint256 nullifierSeed,
        uint256 nullifier,
        uint256 timestamp,
        uint256 signal,
        uint256[4] calldata revealArray,
        uint256[8] calldata groth16Proof
    ) external view returns (bool) {
        uint256 signalHash = uint256(keccak256(abi.encodePacked(signal))) >> 3;
        for (uint256 i = 0; i < _keyHashes.length; i++) {
            uint256[9] memory inputs = [
                _keyHashes[i], nullifier, timestamp,
                revealArray[0], revealArray[1], revealArray[2], revealArray[3],
                nullifierSeed, signalHash
            ];
            try IAnonAadhaarGroth16Verifier(verifier).verifyProof(
                [groth16Proof[0], groth16Proof[1]],
                [[groth16Proof[2], groth16Proof[3]], [groth16Proof[4], groth16Proof[5]]],
                [groth16Proof[6], groth16Proof[7]],
                inputs
            ) returns (bool ok) {
                if (ok) return true;
            } catch {}
        }
        return false;
    }
}
