// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ISemaphore } from "@semaphore/contracts/interfaces/ISemaphore.sol";
import { ISemaphoreGroups } from "@semaphore/contracts/interfaces/ISemaphoreGroups.sol";
import { BuildInfo } from "./generated/BuildInfo.sol";

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
    error InvalidSemaphore();
    error EmptyMembership();
    error BatchSizeExceeded();
    error InvalidMemberManager();
    error MemberManagerAlreadyExists();
    error MemberManagerNotFound();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferCancelled(address indexed owner, address indexed cancelledPendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MemberManagerAdded(address indexed manager);
    event MemberManagerRemoved(address indexed manager);
    event MemberAdded(uint256 indexed identityCommitment, uint256 indexed merkleTreeRoot);
    event MemberRemoved(uint256 indexed identityCommitment, uint256 indexed merkleTreeRoot);
    event MembershipVerified(uint256 indexed merkleTreeRoot, uint256 indexed nullifier);
    event MembershipValidated(uint256 indexed merkleTreeRoot, uint256 indexed nullifier);

    /// @notice The Semaphore contract that manages the Merkle tree and verifies ZK proofs.
    ISemaphore public immutable semaphore;

    /// @notice The id of the Semaphore group managed by this contract.
    uint256 public immutable groupId;

    /// @notice Maximum commitments accepted in one batch, selected to retain substantial margin below Swissledger's 20M gas block budget.
    uint256 public constant MAX_BATCH_SIZE = 64;

    /// @notice Current contract owner.
    address public owner;

    /// @notice Address that must accept before ownership changes.
    address public pendingOwner;

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

    /// @param semaphoreAddress Address of an already-deployed Semaphore v4 contract.
    constructor(address semaphoreAddress) {
        if (semaphoreAddress == address(0) || semaphoreAddress.code.length == 0) {
            revert InvalidSemaphore();
        }
        semaphore = ISemaphore(semaphoreAddress);
        groupId = semaphore.createGroup();

        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        _addMemberManager(msg.sender);
    }

    // ---------------------------------------------------------------
    //  Ownership & access control
    // ---------------------------------------------------------------

    /// @notice Starts a two-step ownership transfer.
    /// @dev Replaces any prior pending owner. The automatic owner-manager role moves only on acceptance.
    /// Explicit member managers are not changed by this operation.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert InvalidOwner();
        }
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Cancels the currently pending ownership transfer.
    function cancelOwnershipTransfer() external onlyOwner {
        address cancelledPendingOwner = pendingOwner;
        if (cancelledPendingOwner == address(0)) {
            revert InvalidOwner();
        }
        delete pendingOwner;
        emit OwnershipTransferCancelled(owner, cancelledPendingOwner);
    }

    /// @notice Accepts a pending ownership transfer.
    /// @dev On acceptance the automatic owner-manager role moves from the old owner to the new owner.
    /// Explicit member managers remain untouched; an already-manager new owner is not added twice.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) {
            revert Unauthorized();
        }

        address oldOwner = owner;
        owner = msg.sender;
        delete pendingOwner;
        if (isMemberManager[oldOwner]) {
            _removeMemberManager(oldOwner);
        }
        if (!isMemberManager[msg.sender]) {
            _addMemberManager(msg.sender);
        }
        emit OwnershipTransferred(oldOwner, msg.sender);
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

    /// @notice Adds up to {MAX_BATCH_SIZE} identity commitments in a single transaction.
    /// @dev Empty batches are rejected locally; duplicate or out-of-field commitments retain Semaphore's upstream reverts.
    /// @return merkleTreeRoot The new Merkle root after all insertions.
    function addMembers(uint256[] calldata identityCommitments)
        external
        onlyMemberManager
        returns (uint256)
    {
        if (identityCommitments.length == 0) {
            revert EmptyMembership();
        }
        if (identityCommitments.length > MAX_BATCH_SIZE) {
            revert BatchSizeExceeded();
        }
        semaphore.addMembers(groupId, identityCommitments);
        uint256 root = ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId);
        for (uint256 i = 0; i < identityCommitments.length; i++) {
            emit MemberAdded(identityCommitments[i], root);
        }
        return root;
    }

    /// @notice Removes an identity commitment from the group using its current Merkle sibling path.
    /// @dev Semaphore validates membership and sibling-path shape. Removal zeroes the leaf and does not shrink
    /// LeanIMT's insertion count returned by {memberCount}.
    /// @param identityCommitment The commitment to remove.
    /// @param merkleProofSiblings Sibling hashes of the Merkle proof for this leaf.
    /// @return merkleTreeRoot The new Merkle root after removal.
    function removeMember(uint256 identityCommitment, uint256[] calldata merkleProofSiblings)
        external
        onlyMemberManager
        returns (uint256)
    {
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
        bool valid = semaphore.verifyProof(
            groupId, _buildProof(merkleTreeDepth, merkleTreeRoot, nullifier, message, points)
        );
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

    /// @notice Validates a Semaphore ZK proof and consumes its nullifier for this group.
    /// @dev Unlike {verifyMembership}, this reverts when a nullifier is replayed. The proof scope is pinned
    /// to this registry's group id, and the caller supplies the proof message.
    /// @return True after Semaphore has accepted the proof and recorded its nullifier.
    function validateMembership(
        uint256 merkleTreeDepth,
        uint256 merkleTreeRoot,
        uint256 nullifier,
        uint256 message,
        uint256[8] calldata points
    ) public returns (bool) {
        semaphore.validateProof(
            groupId, _buildProof(merkleTreeDepth, merkleTreeRoot, nullifier, message, points)
        );
        emit MembershipValidated(merkleTreeRoot, nullifier);
        return true;
    }

    /// @notice Validates membership with message=0 and consumes the proof nullifier for this group.
    /// @dev Convenience overload; scope remains pinned to this registry's group id.
    function validateMembership(
        uint256 merkleTreeDepth,
        uint256 merkleTreeRoot,
        uint256 nullifier,
        uint256[8] calldata points
    ) external returns (bool) {
        return validateMembership(merkleTreeDepth, merkleTreeRoot, nullifier, 0, points);
    }

    // ---------------------------------------------------------------
    //  Read-only queries
    // ---------------------------------------------------------------

    /// @notice Returns the current Merkle root of the group.
    function activeRoot() external view returns (uint256) {
        return ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId);
    }

    /// @notice Returns LeanIMT's insertion count, including positions later zeroed by removal.
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

    /// @dev Builds a Semaphore proof with this registry's immutable group id as scope.
    function _buildProof(
        uint256 merkleTreeDepth,
        uint256 merkleTreeRoot,
        uint256 nullifier,
        uint256 message,
        uint256[8] calldata points
    ) private view returns (ISemaphore.SemaphoreProof memory) {
        return ISemaphore.SemaphoreProof(
            merkleTreeDepth, merkleTreeRoot, nullifier, message, groupId, points
        );
    }

    function _addMemberManager(address manager) private {
        if (manager == address(0)) {
            revert InvalidMemberManager();
        }
        if (isMemberManager[manager]) {
            revert MemberManagerAlreadyExists();
        }

        isMemberManager[manager] = true;
        memberManagerList.push(manager);
        memberManagerIndex[manager] = memberManagerList.length;
        emit MemberManagerAdded(manager);
    }

    function _removeMemberManager(address manager) private {
        uint256 index = memberManagerIndex[manager];
        if (index == 0) {
            revert MemberManagerNotFound();
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
