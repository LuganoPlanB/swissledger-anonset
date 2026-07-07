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

/// @notice Full-stack test deploying Semaphore + MerkleRootRegistryZK.
contract MerkleRootRegistryZKTest is Test {
    MerkleRootRegistryZK internal registry;
    ISemaphore internal semaphore;
    ISemaphoreGroups internal semaphoreGroups;
    uint256 internal groupId;

    event MemberAdded(uint256 indexed identityCommitment, uint256 indexed merkleTreeRoot);
    event MemberRemoved(uint256 indexed identityCommitment, uint256 indexed merkleTreeRoot);
    event MembershipVerified(uint256 indexed merkleTreeRoot, uint256 indexed nullifier);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MemberManagerAdded(address indexed manager);
    event MemberManagerRemoved(address indexed manager);

    function setUp() external {
        // Deploy SemaphoreVerifier
        SemaphoreVerifier verifier = new SemaphoreVerifier();

        // Deploy Semaphore
        semaphore = ISemaphore(address(new Semaphore(ISemaphoreVerifier(address(verifier)))));
        semaphoreGroups = ISemaphoreGroups(address(semaphore));

        // Deploy MerkleRootRegistryZK (test contract is the owner)
        registry = new MerkleRootRegistryZK(address(semaphore));
        groupId = registry.groupId();
    }

    // ---------------------------------------------------------------
    //  Deployment & initial state
    // ---------------------------------------------------------------

    function testGroupCreatedInConstructor() public view {
        uint256 groupCount = semaphore.groupCounter();
        assertEq(groupCount, 1);
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
        assertEq(
            keccak256(bytes(registry.version())),
            keccak256(bytes(BuildInfo.VERSION))
        );
    }

    // ---------------------------------------------------------------
    //  Access control
    // ---------------------------------------------------------------

    function testRejectUnauthorizedAddMember() external {
        UnauthorizedCaller caller = new UnauthorizedCaller();
        uint256 dummyCommitment = 123;

        bool ok = caller.tryAddMember(registry, dummyCommitment);
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
        uint256 dummyCommitment = 123;

        caller.addMember(registry, dummyCommitment);
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

    // ---------------------------------------------------------------
    //  Group membership
    // ---------------------------------------------------------------

    function testAddMemberIncrementsCount() external {
        // Known Semaphore identity commitments (from template fixtures)
        uint256 commitment =
            11005642493773047649202648265396872197147567800455247120861783398111750817516;

        vm.expectEmit(true, true, false, false);
        emit MemberAdded(commitment, commitment); // root == commitment for single-element tree

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

        // For a single-element tree, the removal proof is empty
        uint256[] memory proofSiblings = new uint256[](0);

        vm.expectEmit(true, true, false, false);
        emit MemberRemoved(commitment, 0);

        registry.removeMember(commitment, proofSiblings);

        // LeanIMT does not shrink — the tree size stays the same,
        // but the leaf is zeroed and the root changes.
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

        // Get proof siblings from the Semaphore group
        uint256[] memory proofSiblings = new uint256[](1);
        proofSiblings[0] = commitments[1];

        registry.removeMember(commitments[0], proofSiblings);

        // LeanIMT does not shrink — tree size remains, but root changes
        assertTrue(registry.activeRoot() != rootBefore, "root should change after removal");
    }

    // ---------------------------------------------------------------
    //  ZK membership verification
    // ---------------------------------------------------------------

    /// @notice Verifies a ZK proof of membership using fresh proof values.
    ///
    /// These proof values were generated by scripts/gen-proof-fixture.mjs
    /// using the Anvil default private key as identity seed.
    function testVerifyMembership() external {
        // Fresh commitments from the fixture generator
        uint256 commitment1 =
            19623054902652752572768837767368819438537190388386768123804313486594551687560;
        uint256 commitment2 =
            2558416608539854054499355957775135229499065168204701492353724394129257340904;

        uint256[] memory commitments = new uint256[](2);
        commitments[0] = commitment1;
        commitments[1] = commitment2;

        registry.addMembers(commitments);

        uint256 merkleTreeDepth = 1;
        uint256 merkleTreeRoot = registry.activeRoot();
        uint256 message = 0;

        // Proof values from fresh fixture generation
        uint256 nullifier =
            3857440980446736879702653168101521035851199389313593657501992580489135521217;
        uint256[8] memory points = [
            919827643781421602481439089602558803496719179659756104652607237727463952328,
            4278593718133005210744063667381849936998355967678124462977286449532002021087,
            13096589833515570713610993586355462702183923471304293878247448778846493323049,
            19966225419588909272319210160245012881602095177825521056680361219000141448309,
            1910511172721637318211978345200019435013419235280831992883691173697414152168,
            21684854321542660041126625942777327946143297801298757031822697012002178742489,
            5010656900483957974070666419573105543492514801736277788176017258494710736936,
            6267345633791412177224963352151071087538540524768790484607374039446662849418
        ];

        vm.expectEmit(true, true, false, false);
        emit MembershipVerified(merkleTreeRoot, nullifier);

        bool result = registry.verifyMembership(
            merkleTreeDepth, merkleTreeRoot, nullifier, message, points
        );

        assertTrue(result, "valid ZK proof rejected");
    }

    /// @notice Verifying with a wrong message should fail.
    function testVerifyMembershipRejectsWrongMessage() external {
        uint256 commitment1 =
            19623054902652752572768837767368819438537190388386768123804313486594551687560;
        uint256 commitment2 =
            2558416608539854054499355957775135229499065168204701492353724394129257340904;

        uint256[] memory commitments = new uint256[](2);
        commitments[0] = commitment1;
        commitments[1] = commitment2;

        registry.addMembers(commitments);

        uint256 merkleTreeDepth = 1;
        uint256 merkleTreeRoot = registry.activeRoot();
        uint256 wrongMessage = uint256(bytes32("wrong"));

        uint256 nullifier =
            3857440980446736879702653168101521035851199389313593657501992580489135521217;
        uint256[8] memory points = [
            919827643781421602481439089602558803496719179659756104652607237727463952328,
            4278593718133005210744063667381849936998355967678124462977286449532002021087,
            13096589833515570713610993586355462702183923471304293878247448778846493323049,
            19966225419588909272319210160245012881602095177825521056680361219000141448309,
            1910511172721637318211978345200019435013419235280831992883691173697414152168,
            21684854321542660041126625942777327946143297801298757031822697012002178742489,
            5010656900483957974070666419573105543492514801736277788176017258494710736936,
            6267345633791412177224963352151071087538540524768790484607374039446662849418
        ];

        bool result = registry.verifyMembership(
            merkleTreeDepth, merkleTreeRoot, nullifier, wrongMessage, points
        );

        assertTrue(!result, "proof with wrong message accepted");
    }

    /// @notice Empty group always rejects proofs.
    function testVerifyMembershipFailsForEmptyGroup() external {
        uint256 merkleTreeDepth = 1;
        uint256 merkleTreeRoot = 0;
        uint256 nullifier = 0;
        uint256 message = 0;
        uint256[8] memory points;

        vm.expectRevert();
        registry.verifyMembership(merkleTreeDepth, merkleTreeRoot, nullifier, message, points);
    }

    // ---------------------------------------------------------------
    //  Replay: no nullifier tracking
    // ---------------------------------------------------------------

    /// @notice The same ZK proof can be submitted multiple times.
    function testProofReplayAllowed() external {
        uint256 commitment1 =
            19623054902652752572768837767368819438537190388386768123804313486594551687560;
        uint256 commitment2 =
            2558416608539854054499355957775135229499065168204701492353724394129257340904;

        uint256[] memory commitments = new uint256[](2);
        commitments[0] = commitment1;
        commitments[1] = commitment2;

        registry.addMembers(commitments);

        uint256 merkleTreeDepth = 1;
        uint256 merkleTreeRoot = registry.activeRoot();
        uint256 message = 0;
        uint256 nullifier =
            3857440980446736879702653168101521035851199389313593657501992580489135521217;
        uint256[8] memory points = [
            919827643781421602481439089602558803496719179659756104652607237727463952328,
            4278593718133005210744063667381849936998355967678124462977286449532002021087,
            13096589833515570713610993586355462702183923471304293878247448778846493323049,
            19966225419588909272319210160245012881602095177825521056680361219000141448309,
            1910511172721637318211978345200019435013419235280831992883691173697414152168,
            21684854321542660041126625942777327946143297801298757031822697012002178742489,
            5010656900483957974070666419573105543492514801736277788176017258494710736936,
            6267345633791412177224963352151071087538540524768790484607374039446662849418
        ];

        // First verification
        bool result1 = registry.verifyMembership(
            merkleTreeDepth, merkleTreeRoot, nullifier, message, points
        );
        assertTrue(result1, "first proof rejected");

        // Same proof again — must still pass (no nullifier tracking)
        bool result2 = registry.verifyMembership(
            merkleTreeDepth, merkleTreeRoot, nullifier, message, points
        );
        assertTrue(result2, "proof replay rejected");
    }
}
