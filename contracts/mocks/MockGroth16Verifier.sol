// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Test stand-in for the Groth16 verifier: a "proof" is valid when proof[0] equals the
/// public-key-hash input, so tests can simulate QRs signed by different UIDAI keys.
contract MockGroth16Verifier {
    function verifyProof(uint256[2] calldata pA, uint256[2][2] calldata, uint256[2] calldata, uint256[9] calldata inputs)
        external
        pure
        returns (bool)
    {
        if (pA[1] == 0xbad) revert("malformed");
        return pA[0] == inputs[0];
    }
}
