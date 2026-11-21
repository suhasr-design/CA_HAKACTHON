// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The parts of Semaphore v4 that Fan Pass uses (same ABI as ISemaphore).
interface ISemaphoreMin {
    struct SemaphoreProof {
        uint256 merkleTreeDepth;
        uint256 merkleTreeRoot;
        uint256 nullifier;
        uint256 message;
        uint256 scope;
        uint256[8] points;
    }

    function createGroup(address admin, uint256 merkleTreeDuration) external returns (uint256);
    function addMember(uint256 groupId, uint256 identityCommitment) external;
    function removeMember(uint256 groupId, uint256 identityCommitment, uint256[] calldata merkleProofSiblings) external;
    function verifyProof(uint256 groupId, SemaphoreProof calldata proof) external view returns (bool);
    function getMerkleTreeSize(uint256 groupId) external view returns (uint256);
}
