// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ISemaphore} from "@semaphore/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreGroups} from "@semaphore/contracts/interfaces/ISemaphoreGroups.sol";
import {BuildInfo} from "./generated/BuildInfo.sol";

/// @title MerkleRootRegistryZK
/// @notice On-chain anonymous membership registry using Semaphore zero-knowledge proofs.
///
/// This contract holds a single Semaphore group. The owner adds identity commitments
/// to the group. Anyone holding a valid identity secret can generate a ZK proof
/// demonstrating membership without revealing which identity they are.
///
/// No nullifier tracking is performed — members may prove inclusion as often as
/// they want. Use the parent Semaphore contract's validateProof for replay-protection
/// if needed.
contract MerkleRootRegistryZK {
    error Unauthorized();
    error InvalidOwner();
    error EmptyMembership();
    error InvalidMemberManager();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MemberManagerAdded(address indexed manager);
    event MemberManagerRemoved(address indexed manager);
    event MemberAdded(uint256 indexed identityCommitment, uint256 indexed merkleTreeRoot);
    event MemberRemoved(uint256 indexed identityCommitment, uint256 indexed merkleTreeRoot);
    event MembershipVerified(uint256 indexed merkleTreeRoot, uint256 indexed nullifier);

    /// @notice The Semaphore contract that manages the Merkle tree and verifies ZK proofs.
    ISemaphore public immutable semaphore;

    /// @notice The id of the Semaphore group managed by this contract.
    uint256 public immutable groupId;

    /// @notice Current contract owner.
    address public owner;

    /// @notice Addresses allowed to add and remove members.
    mapping(address => bool) public isMemberManager;
    address[] private memberManagerList;
    mapping(address => uint256) private memberManagerIndex;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyMemberManager() {
        if (!isMemberManager[msg.sender]) {
            revert Unauthorized();
        }
        _;
    }

    /// @param semaphoreAddress Address of an already-deployed Semaphore contract.
    constructor(address semaphoreAddress) {
        semaphore = ISemaphore(semaphoreAddress);
        groupId = semaphore.createGroup();

        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        _addMemberManager(msg.sender);
    }

    // ---------------------------------------------------------------
    //  Ownership & access control
    // ---------------------------------------------------------------

    /// @notice Transfers contract ownership to a new address.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert InvalidOwner();
        }
        address oldOwner = owner;
        owner = newOwner;
        _removeMemberManager(oldOwner);
        _addMemberManager(newOwner);
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /// @notice Adds an address allowed to manage group members.
    function addMemberManager(address manager) external onlyOwner {
        _addMemberManager(manager);
    }

    /// @notice Removes a previously added member manager.
    function removeMemberManager(address manager) external onlyOwner {
        _removeMemberManager(manager);
    }

    /// @notice Returns the current list of member managers.
    function getMemberManagers() external view returns (address[] memory) {
        return memberManagerList;
    }

    // ---------------------------------------------------------------
    //  Group membership (permissioned)
    // ---------------------------------------------------------------

    /// @notice Adds one identity commitment to the Semaphore group.
    /// @return merkleTreeRoot The new Merkle root after insertion.
    function addMember(uint256 identityCommitment) external onlyMemberManager returns (uint256) {
        semaphore.addMember(groupId, identityCommitment);
        uint256 root = ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId);
        emit MemberAdded(identityCommitment, root);
        return root;
    }

    /// @notice Adds multiple identity commitments in a single transaction.
    /// @return merkleTreeRoot The new Merkle root after all insertions.
    function addMembers(uint256[] calldata identityCommitments) external onlyMemberManager returns (uint256) {
        semaphore.addMembers(groupId, identityCommitments);
        uint256 root = ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId);
        for (uint256 i = 0; i < identityCommitments.length; i++) {
            emit MemberAdded(identityCommitments[i], root);
        }
        return root;
    }

    /// @notice Removes an identity commitment from the group using a Merkle proof.
    /// @param identityCommitment The commitment to remove.
    /// @param merkleProofSiblings Sibling hashes of the Merkle proof for this leaf.
    /// @return merkleTreeRoot The new Merkle root after removal.
    function removeMember(
        uint256 identityCommitment,
        uint256[] calldata merkleProofSiblings
    ) external onlyMemberManager returns (uint256) {
        semaphore.removeMember(groupId, identityCommitment, merkleProofSiblings);
        uint256 root = ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId);
        emit MemberRemoved(identityCommitment, root);
        return root;
    }

    // ---------------------------------------------------------------
    //  Anonymous membership verification
    // ---------------------------------------------------------------

    /// @notice Verifies a Semaphore ZK proof of membership in the group.
    ///
    /// Anyone can call this function. It does NOT enforce nullifier uniqueness —
    /// the same member can prove inclusion multiple times without linking those proofs.
    ///
    /// @param merkleTreeDepth Depth of the Merkle tree used in the proof.
    /// @param merkleTreeRoot Merkle root the proof is generated against.
    /// @param nullifier Nullifier hash (not tracked, included for proof validity).
    /// @param message Signal carried by the proof (set to 0 for pure membership).
    /// @param points Groth16 proof points.
    /// @return True if the proof is valid and the prover is in the group.
    function verifyMembership(
        uint256 merkleTreeDepth,
        uint256 merkleTreeRoot,
        uint256 nullifier,
        uint256 message,
        uint256[8] calldata points
    ) public returns (bool) {
        ISemaphore.SemaphoreProof memory proof = ISemaphore.SemaphoreProof(
            merkleTreeDepth,
            merkleTreeRoot,
            nullifier,
            message,
            groupId, // scope = groupId
            points
        );

        bool valid = semaphore.verifyProof(groupId, proof);
        if (valid) {
            emit MembershipVerified(merkleTreeRoot, nullifier);
        }
        return valid;
    }

    /// @notice Verifies membership using only the required Semaphore proof fields.
    ///
    /// Convenience overload that sets message=0 and scope=groupId automatically.
    function verifyMembership(
        uint256 merkleTreeDepth,
        uint256 merkleTreeRoot,
        uint256 nullifier,
        uint256[8] calldata points
    ) external returns (bool) {
        return verifyMembership(merkleTreeDepth, merkleTreeRoot, nullifier, 0, points);
    }

    // ---------------------------------------------------------------
    //  Read-only queries
    // ---------------------------------------------------------------

    /// @notice Returns the current Merkle root of the group.
    function activeRoot() external view returns (uint256) {
        return ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId);
    }

    /// @notice Returns the number of members currently in the group.
    function memberCount() external view returns (uint256) {
        return ISemaphoreGroups(address(semaphore)).getMerkleTreeSize(groupId);
    }

    /// @notice Returns the semantic version embedded into this build.
    function version() external pure returns (string memory) {
        return BuildInfo.VERSION;
    }

    // ---------------------------------------------------------------
    //  Internal helpers
    // ---------------------------------------------------------------

    function _addMemberManager(address manager) private {
        if (manager == address(0)) {
            revert InvalidMemberManager();
        }
        if (isMemberManager[manager]) {
            return;
        }

        isMemberManager[manager] = true;
        memberManagerList.push(manager);
        memberManagerIndex[manager] = memberManagerList.length;
        emit MemberManagerAdded(manager);
    }

    function _removeMemberManager(address manager) private {
        uint256 index = memberManagerIndex[manager];
        if (index == 0) {
            return;
        }

        uint256 lastIndex = memberManagerList.length;
        if (index != lastIndex) {
            address lastManager = memberManagerList[lastIndex - 1];
            memberManagerList[index - 1] = lastManager;
            memberManagerIndex[lastManager] = index;
        }

        memberManagerList.pop();
        delete memberManagerIndex[manager];
        delete isMemberManager[manager];
        emit MemberManagerRemoved(manager);
    }
}
