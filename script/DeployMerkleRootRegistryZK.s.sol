// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MerkleRootRegistryZK} from "../src/MerkleRootRegistryZK.sol";
import {Semaphore} from "@semaphore/contracts/Semaphore.sol";
import {SemaphoreVerifier} from "@semaphore/contracts/base/SemaphoreVerifier.sol";
import {ISemaphoreVerifier} from "@semaphore/contracts/interfaces/ISemaphoreVerifier.sol";
import {Script} from "forge-std/Script.sol";

bytes32 constant SALT = bytes32(0);

/// @notice Deploys the full Semaphore stack + MerkleRootRegistryZK.
///
/// Usage:
///   forge script script/DeployMerkleRootRegistryZK.s.sol \
///     --rpc-url anvil --broadcast
///
///   # Or against a real chain:
///   forge script script/DeployMerkleRootRegistryZK.s.sol \
///     --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --legacy
contract DeployMerkleRootRegistryZK is Script {
    function run()
        external
        returns (
            address registryAddr,
            address semaphoreAddr,
            address semaphoreVerifierAddr
        )
    {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Groth16 verifier for Semaphore circuits
        SemaphoreVerifier semaphoreVerifierContract = new SemaphoreVerifier{salt: SALT}();
        semaphoreVerifierAddr = address(semaphoreVerifierContract);

        // 2. Deploy Semaphore (on-chain group + Merkle tree + proof router)
        Semaphore semaphoreContract = new Semaphore{salt: SALT}(
            ISemaphoreVerifier(semaphoreVerifierAddr)
        );
        semaphoreAddr = address(semaphoreContract);

        // 3. Deploy MerkleRootRegistryZK (creates its own group inside Semaphore)
        MerkleRootRegistryZK registryContract = new MerkleRootRegistryZK{salt: SALT}(
            semaphoreAddr
        );
        registryAddr = address(registryContract);

        vm.stopBroadcast();
    }
}
