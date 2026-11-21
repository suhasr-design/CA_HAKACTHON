// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISemaphoreMin} from "./ISemaphoreMin.sol";

interface IFanPass {
    function verify(uint256 scope, uint256 message, ISemaphoreMin.SemaphoreProof calldata proof) external view returns (bool);
}
