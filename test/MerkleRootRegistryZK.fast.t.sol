// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ISemaphore} from "@semaphore/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreGroups} from "@semaphore/contracts/interfaces/ISemaphoreGroups.sol";
import {Semaphore} from "@semaphore/contracts/Semaphore.sol";
import {SemaphoreVerifier} from "@semaphore/contracts/base/SemaphoreVerifier.sol";
import {ISemaphoreVerifier} from "@semaphore/contracts/interfaces/ISemaphoreVerifier.sol";
import {MerkleRootRegistryZK} from "../src/MerkleRootRegistryZK.sol";
import {BuildInfo} from "../src/generated/BuildInfo.sol";

contract UnauthorizedCaller {
    function tryAddMember(MerkleRootRegistryZK registry, uint256 commitment) external returns (bool) {
        (bool ok,) = address(registry).call(abi.encodeCall(MerkleRootRegistryZK.addMember, (commitment)));
        return ok;
    }

    function tryAddMemberManager(MerkleRootRegistryZK registry, address manager) external returns (bool) {
        (bool ok,) =
            address(registry).call(abi.encodeCall(MerkleRootRegistryZK.addMemberManager, (manager)));
        return ok;
    }

    function tryRemoveMemberManager(MerkleRootRegistryZK registry, address manager) external returns (bool) {
        (bool ok,) =
            address(registry).call(abi.encodeCall(MerkleRootRegistryZK.removeMemberManager, (manager)));
        return ok;
    }

    function tryTransferOwnership(MerkleRootRegistryZK registry, address newOwner) external returns (bool) {
        (bool ok,) =
            address(registry).call(abi.encodeCall(MerkleRootRegistryZK.transferOwnership, (newOwner)));
        return ok;
    }

    function addMember(MerkleRootRegistryZK registry, uint256 commitment) external {
        registry.addMember(commitment);
    }
}

/// @notice Fast tests — deploys Semaphore with a dummy verifier to avoid
///         the expensive Groth16 verifier deployment in Anvil.
contract MerkleRootRegistryZKFastTest is Test {
    MerkleRootRegistryZK internal registry;
    ISemaphore internal semaphore;
    ISemaphoreGroups internal semaphoreGroups;

    event MemberAdded(uint256 indexed identityCommitment, uint256 indexed merkleTreeRoot);
    event MemberRemoved(uint256 indexed identityCommitment, uint256 indexed merkleTreeRoot);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MemberManagerAdded(address indexed manager);
    event MemberManagerRemoved(address indexed manager);

    function setUp() external {
        // Use a mock verifier — Semaphore.group operations don't need Groth16
        DummyVerifier verifier = new DummyVerifier();
        semaphore = ISemaphore(address(new Semaphore(ISemaphoreVerifier(address(verifier)))));
        semaphoreGroups = ISemaphoreGroups(address(semaphore));
        registry = new MerkleRootRegistryZK(address(semaphore));
    }

    function testGroupCreatedInConstructor() public view {
        assertEq(semaphore.groupCounter(), 1);
        assertEq(registry.groupId(), 0);
    }

    function testOwnerIsMemberManager() public view {
        assertTrue(registry.isMemberManager(address(this)));
        address[] memory managers = registry.getMemberManagers();
        assertEq(managers.length, 1);
        assertEq(managers[0], address(this));
    }

    function testActiveRootIsZeroForEmptyGroup() public view {
        assertEq(registry.activeRoot(), 0);
        assertEq(registry.memberCount(), 0);
    }

    function testVersionMatchesBuildInfo() public view {
        assertEq(keccak256(bytes(registry.version())), keccak256(bytes(BuildInfo.VERSION)));
    }

    function testRejectUnauthorizedAddMember() external {
        UnauthorizedCaller caller = new UnauthorizedCaller();
        bool ok = caller.tryAddMember(registry, 123);
        assertTrue(!ok, "unauthorized add accepted");
    }

    function testRejectUnauthorizedAddMemberManager() external {
        UnauthorizedCaller caller = new UnauthorizedCaller();
        bool ok = caller.tryAddMemberManager(registry, address(caller));
        assertTrue(!ok, "unauthorized manager add accepted");
    }

    function testRejectUnauthorizedRemoveMemberManager() external {
        UnauthorizedCaller caller = new UnauthorizedCaller();
        bool ok = caller.tryRemoveMemberManager(registry, address(caller));
        assertTrue(!ok, "unauthorized manager remove accepted");
    }

    function testRejectUnauthorizedTransferOwnership() external {
        UnauthorizedCaller caller = new UnauthorizedCaller();
        bool ok = caller.tryTransferOwnership(registry, address(caller));
        assertTrue(!ok, "unauthorized ownership transfer accepted");
    }

    function testAddMemberManagerAllowsAddMember() external {
        UnauthorizedCaller caller = new UnauthorizedCaller();
        registry.addMemberManager(address(caller));
        caller.addMember(registry, 123);
        assertEq(registry.memberCount(), 1);
    }

    function testRemoveMemberManagerRevokesAccess() external {
        UnauthorizedCaller caller = new UnauthorizedCaller();
        registry.addMemberManager(address(caller));
        registry.removeMemberManager(address(caller));
        bool ok = caller.tryAddMember(registry, 123);
        assertTrue(!ok, "removed manager still adds members");
        assertTrue(!registry.isMemberManager(address(caller)));
        assertEq(registry.getMemberManagers().length, 1);
    }

    function testTransferOwnershipMovesManagerPermission() external {
        UnauthorizedCaller caller = new UnauthorizedCaller();
        registry.transferOwnership(address(caller));
        assertEq(registry.owner(), address(caller));
        assertTrue(!registry.isMemberManager(address(this)));
        assertTrue(registry.isMemberManager(address(caller)));
    }

    function testAddMemberIncrementsCount() external {
        uint256 commitment =
            11005642493773047649202648265396872197147567800455247120861783398111750817516;
        vm.expectEmit(true, true, false, false);
        emit MemberAdded(commitment, commitment);
        registry.addMember(commitment);
        assertEq(registry.memberCount(), 1);
        assertEq(registry.activeRoot(), commitment);
    }

    function testAddMembersBatch() external {
        uint256[] memory commitments = new uint256[](2);
        commitments[0] =
            11005642493773047649202648265396872197147567800455247120861783398111750817516;
        commitments[1] =
            14473821761500463903284857947161896352613497175238126022206384102438097355186;
        registry.addMembers(commitments);
        assertEq(registry.memberCount(), 2);
    }

    function testRemoveMember() external {
        uint256 commitment =
            11005642493773047649202648265396872197147567800455247120861783398111750817516;
        registry.addMember(commitment);
        uint256 rootBefore = registry.activeRoot();
        uint256[] memory proofSiblings = new uint256[](0);
        vm.expectEmit(true, true, false, false);
        emit MemberRemoved(commitment, 0);
        registry.removeMember(commitment, proofSiblings);
        assertTrue(registry.activeRoot() == 0, "root should be zero");
        assertTrue(registry.activeRoot() != rootBefore, "root should change");
    }

    function testRemoveMemberFromTwoElementTree() external {
        uint256[] memory commitments = new uint256[](2);
        commitments[0] =
            11005642493773047649202648265396872197147567800455247120861783398111750817516;
        commitments[1] =
            14473821761500463903284857947161896352613497175238126022206384102438097355186;
        registry.addMembers(commitments);
        uint256 rootBefore = registry.activeRoot();
        uint256[] memory proofSiblings = new uint256[](1);
        proofSiblings[0] = commitments[1];
        registry.removeMember(commitments[0], proofSiblings);
        assertTrue(registry.activeRoot() != rootBefore, "root should change after removal");
    }
}

/// @notice Dummy verifier that always returns false — used only for tests
///         that don't exercise ZK proof verification.
contract DummyVerifier is ISemaphoreVerifier {
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[4] calldata,
        uint256
    ) external pure returns (bool) {
        return false;
    }
}
