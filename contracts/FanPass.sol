// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAnonAadhaar} from "./interfaces/IAnonAadhaar.sol";
import {ISemaphoreMin} from "./interfaces/ISemaphoreMin.sol";

/// @title FanPass: prove you're a unique human ONCE, then join any event in seconds.
/// @notice
///  - Enrol (once, heavy): an Anon Aadhaar proof whose signal is the fan's Fan Pass identity commitment.
///    One Aadhaar = one Fan Pass (tracked by the Aadhaar nullifier for this registry). The commitment is
///    added to a Semaphore group. Anyone may submit the enrolment (a kiosk or relayer pays the gas),
///    because the proof is bound to the commitment, not to the sender.
///  - Use (every event, light): a Semaphore proof "I'm in the group" whose scope is the event and whose
///    message is the fan's wallet. Semaphore's nullifier is unique per (person, event) and can't be linked
///    across events. Proving takes ~1-2 s on a phone (5 MB artifacts) instead of minutes (584 MB).
///  - Lost phone: re-enrol with the same Aadhaar. The old commitment is REMOVED from the group first, so
///    the old phone's pass stops working.
contract FanPass {
    ISemaphoreMin public immutable semaphore;
    IAnonAadhaar public immutable anonAadhaar;
    uint256 public immutable aadhaarSeed;   // nullifier seed for this registry (not shared with any event)
    uint256 public immutable groupId;

    mapping(uint256 => uint256) public passOfAadhaar;   // Aadhaar nullifier => current commitment (0 = none)
    mapping(uint256 => bool) public isMember;           // commitment => active
    // UIDAI signing time of the QR used last. A replacement must use a NEWER QR, so an old enrolment
    // proof can't be replayed to swap a fan's pass back to a stolen phone.
    mapping(uint256 => uint256) public lastQrTime;
    uint256 public members;

    event Enrolled(uint256 indexed commitment, uint256 indexed aadhaarNullifier, uint256 members);
    event Replaced(uint256 indexed oldCommitment, uint256 indexed newCommitment);

    constructor(address _semaphore, address _anonAadhaar, uint256 _aadhaarSeed) {
        semaphore = ISemaphoreMin(_semaphore);
        anonAadhaar = IAnonAadhaar(_anonAadhaar);
        aadhaarSeed = _aadhaarSeed;
        // This contract is the group admin. Old Merkle roots stay valid for only 5 minutes (Semaphore's
        // default is 1 hour), so a replaced pass on a lost phone stops working quickly.
        groupId = ISemaphoreMin(_semaphore).createGroup(address(this), 5 minutes);
    }

    /// @param oldSiblings Merkle siblings of the old commitment (only when replacing a lost pass).
    function enroll(
        uint256 commitment,
        uint256 nullifier,
        uint256 timestamp,
        uint256[4] calldata revealArray,
        uint256[8] calldata groth16Proof,
        uint256[] calldata oldSiblings
    ) external {
        require(commitment != 0 && !isMember[commitment], "Pass already active");
        bool valid;
        try anonAadhaar.verifyAnonAadhaarProof(aadhaarSeed, nullifier, timestamp, commitment, revealArray, groth16Proof) returns (bool ok) {
            valid = ok;
        } catch {
            valid = false;
        }
        require(valid, "Invalid Anon Aadhaar proof");

        require(timestamp > lastQrTime[nullifier], "Use a newer Aadhaar QR");
        lastQrTime[nullifier] = timestamp;
        uint256 old = passOfAadhaar[nullifier];
        if (old != 0) {
            // Same person, new phone: retire the old pass so it can't be used any more.
            semaphore.removeMember(groupId, old, oldSiblings);
            isMember[old] = false;
            members--;
            emit Replaced(old, commitment);
        }
        semaphore.addMember(groupId, commitment);
        passOfAadhaar[nullifier] = commitment;
        isMember[commitment] = true;
        members++;
        emit Enrolled(commitment, nullifier, members);
    }

    /// @notice Is this a valid Fan Pass proof for `scope` (an event) and `message` (a wallet)?
    function verify(uint256 scope, uint256 message, ISemaphoreMin.SemaphoreProof calldata proof) external view returns (bool) {
        if (proof.scope != scope || proof.message != message) return false;
        return semaphore.verifyProof(groupId, proof);
    }
}
