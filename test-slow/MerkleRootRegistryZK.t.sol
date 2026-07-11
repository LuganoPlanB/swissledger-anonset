// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ISemaphore} from "@semaphore/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreGroups} from "@semaphore/contracts/interfaces/ISemaphoreGroups.sol";
import {Semaphore} from "@semaphore/contracts/Semaphore.sol";
import {SemaphoreVerifier} from "@semaphore/contracts/base/SemaphoreVerifier.sol";
import {ISemaphoreVerifier} from "@semaphore/contracts/interfaces/ISemaphoreVerifier.sol";
import {MerkleRootRegistryZK} from "../src/MerkleRootRegistryZK.sol";

/// @notice Heavy tests — deploys the full Groth16 SemaphoreVerifier.
///         Only run these on main push, not in PR CI.
contract MerkleRootRegistryZKTest is Test {
    MerkleRootRegistryZK internal registry;
    ISemaphore internal semaphore;

    event MembershipVerified(uint256 indexed merkleTreeRoot, uint256 indexed nullifier);

    function setUp() external {
        SemaphoreVerifier verifier = new SemaphoreVerifier();
        semaphore = ISemaphore(address(new Semaphore(ISemaphoreVerifier(address(verifier)))));
        registry = new MerkleRootRegistryZK(address(semaphore));
    }

    function testVerifyMembership() external {
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

        vm.expectEmit(true, true, false, false);
        emit MembershipVerified(merkleTreeRoot, nullifier);

        bool result = registry.verifyMembership(
            merkleTreeDepth, merkleTreeRoot, nullifier, message, points
        );
        assertTrue(result, "valid ZK proof rejected");
    }

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

    function testVerifyMembershipFailsForEmptyGroup() external {
        uint256 merkleTreeDepth = 1;
        uint256 merkleTreeRoot = 0;
        uint256 nullifier = 0;
        uint256 message = 0;
        uint256[8] memory points;

        vm.expectRevert();
        registry.verifyMembership(merkleTreeDepth, merkleTreeRoot, nullifier, message, points);
    }

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

        bool result1 = registry.verifyMembership(
            merkleTreeDepth, merkleTreeRoot, nullifier, message, points
        );
        assertTrue(result1, "first proof rejected");

        bool result2 = registry.verifyMembership(
            merkleTreeDepth, merkleTreeRoot, nullifier, message, points
        );
        assertTrue(result2, "proof replay rejected");
    }
}
