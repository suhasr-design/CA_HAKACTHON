// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Pulls the official Anon Aadhaar contracts (PSE / Ethereum Foundation) into the Hardhat build:
//  - Verifier:    the Groth16 verifier generated from the Anon Aadhaar circuit
//  - AnonAadhaar: checks the proof against a stored UIDAI public-key hash (test or production)
import "@anon-aadhaar/contracts/src/Verifier.sol";
import "@anon-aadhaar/contracts/src/AnonAadhaar.sol";
