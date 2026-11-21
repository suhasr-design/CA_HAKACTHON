// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

// Pulls the official Semaphore v4 contracts (PSE / Ethereum Foundation) into the Hardhat build.
// Semaphore requires Solidity >=0.8.23, so this file (and only this file's import tree) is compiled
// with 0.8.23 targeting the same "london" EVM as everything else (see hardhat.config.js overrides).
import "@semaphore-protocol/contracts/Semaphore.sol";
import "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
