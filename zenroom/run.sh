#!/usr/bin/env bash
set -euo pipefail


CAST="bin/swissledger-cast"
# Generate a temporary dir to put temporary files
TEMP=$(mktemp -d)
# PRIVATE_KEY without 0x (zenroom)
O_KEY=${PRIVATE_KEY#0x}
# Get the wallet address (from private key)
ADDR=$("$CAST" wallet address --private-key "$PRIVATE_KEY")
# Retrieve the nonce
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")
# Retrieve the gas price
GAS=$("$CAST" gas-price --rpc-url "$RPC_URL")

# Create the keyring and save it in the temporary directory
cat << EOF > "$TEMP/myKeyring.json"
{
    "keyring": {
            "ethereum": "$O_KEY"
    }
}
EOF


# Test add_member

# The zen file in the repo has chain ID 222 (the testnet) but in anvil is 31337
# (The file is saved in the temporary directory)
sed "s/chain '222'/chain '$CHAIN_ID'/" zenroom/add_memberZK.zen > "$TEMP/add_memberZK.zen"

# An identity is needed to obtain its commitment 
export COMMIT1=$(node clients/anonset/anonset-cli.mjs identity create "$TEMP/identity1.json" | jq -r .commitment)

# Create the input file (json)
cat << EOF > "$TEMP/add_memberZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "member": "$COMMIT1"
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/add_memberZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/add_memberZK.zen" > "$TEMP/add_memberZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/add_memberZK_out.json")"

# Check the result
"$CAST" call "$CONTRACT" 'memberCount()(uint256)' --rpc-url "$RPC_URL" \
  |grep -qx 1 || { echo "FAIL: member not added"; exit 1; }
echo "PASS: add_member"


# Test add_members

# Create two new identities to add
export COMMIT2=$(node clients/anonset/anonset-cli.mjs identity create "$TEMP/identity2.json" | jq -r .commitment)
export COMMIT3=$(node clients/anonset/anonset-cli.mjs identity create "$TEMP/identity3.json" | jq -r .commitment)

# Retrieve the nonce 
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed "s/chain '222'/chain '$CHAIN_ID'/" zenroom/add_membersZK.zen > "$TEMP/add_membersZK.zen"

# Create the input file
cat << EOF > "$TEMP/add_membersZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "members": ["$COMMIT2", "$COMMIT3"]
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/add_membersZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/add_membersZK.zen" > "$TEMP/add_membersZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/add_membersZK_out.json")"

# Check the result
"$CAST" call "$CONTRACT" 'memberCount()(uint256)' --rpc-url "$RPC_URL" \
  |grep -qx 3 || { echo "FAIL: members not added"; exit 1; }
echo "PASS: add_members"


# Test remove_member

# Retrieve the nonce 
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed "s/chain '222'/chain '$CHAIN_ID'/" zenroom/remove_memberZK.zen > "$TEMP/remove_memberZK.zen"

# "siblings" is needed as proof by the function remove_member
SIBLINGS=$(node -e 'const {Group}=require("@semaphore-protocol/group"); const g=new Group([BigInt(process.env.COMMIT1),BigInt(process.env.COMMIT2),BigInt(process.env.COMMIT3)]);console.log(JSON.stringify(g.generateMerkleProof(1).siblings.map(String)))')

# Create the input file
cat << EOF > "$TEMP/remove_memberZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "member": "$COMMIT2",
    "siblings": $SIBLINGS
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/remove_memberZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/remove_memberZK.zen" > "$TEMP/remove_memberZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/remove_memberZK_out.json")"

# To verify, the address of the semaphore contract is needed
SEMAPHORE=$("$CAST" call "$CONTRACT" 'semaphore()(address)' --rpc-url "$RPC_URL")
GROUPID=$("$CAST" call "$CONTRACT" 'groupId()(uint256)' --rpc-url "$RPC_URL")
"$CAST" call "$SEMAPHORE" 'hasMember(uint256,uint256)(bool)' "$GROUPID" "$COMMIT2" --rpc-url "$RPC_URL" \
  |grep -q false || { echo "FAIL: member not removed"; exit 1; }
echo "PASS: remove_member"


# Test add_memberManager

# Retrieve the nonce
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed "s/chain '222'/chain '$CHAIN_ID'/" zenroom/add_memberManagerZK.zen > "$TEMP/add_memberManagerZK.zen"

# Create the input file
cat << EOF > "$TEMP/add_memberManagerZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "new_manager": "$ADDRESS2"
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/add_memberManagerZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/add_memberManagerZK.zen" > "$TEMP/add_memberManagerZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/add_memberManagerZK_out.json")"

# Check the result
"$CAST" call "$CONTRACT" 'isMemberManager(address)(bool)' "$ADDRESS2" --rpc-url "$RPC_URL" \
  |grep -q true || { echo "FAIL: manager not added"; exit 1; }
echo "PASS: add_memberManager"


# Test remove_memberManager

# Retrieve the nonce
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed "s/chain '222'/chain '$CHAIN_ID'/" zenroom/remove_memberManagerZK.zen > "$TEMP/remove_memberManagerZK.zen"

# Create the input file
cat << EOF > "$TEMP/remove_memberManagerZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "rem_manager": "$ADDRESS2"
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/remove_memberManagerZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/remove_memberManagerZK.zen" > "$TEMP/remove_memberManagerZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/remove_memberManagerZK_out.json")"

# Check the result
"$CAST" call "$CONTRACT" 'isMemberManager(address)(bool)' "$ADDRESS2" --rpc-url "$RPC_URL" \
  |grep -q false || { echo "FAIL: manager not removed"; exit 1; }
echo "PASS: remove_memberManager"


# Test verify_membership4

# Retrieve the nonce
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed "s/chain '222'/chain '$CHAIN_ID'/" zenroom/verify_membership4ZK.zen > "$TEMP/verify_membership4ZK.zen"

# The proof needs: depth, num_root, nullifier, message and points 
node clients/anonset/anonset-cli.mjs proof generate-chain "$TEMP/identity1.json" "$CONTRACT" "$RPC_URL" "$CHAIN_ID" 19 > "$TEMP/proof4_ver.json"
DEPTH=$(jq .merkleTreeDepth "$TEMP/proof4_ver.json")
ROOT=$(jq .merkleTreeRoot "$TEMP/proof4_ver.json")
NULLIFIER=$(jq .nullifier "$TEMP/proof4_ver.json")
MESSAGE=$(jq .message "$TEMP/proof4_ver.json")
POINTS=$(jq .points "$TEMP/proof4_ver.json")

# Create the input file
cat << EOF > "$TEMP/verify_membership4ZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "depth": "$DEPTH",
    "num_root": $ROOT,
    "nullifier": $NULLIFIER,
    "message": $MESSAGE,
    "points": $POINTS
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/verify_membership4ZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/verify_membership4ZK.zen" > "$TEMP/verify_membership4ZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/verify_membership4ZK_out.json")"

# To verify this test, a second transaction is published: it should pass
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

cat << EOF > "$TEMP/verify_membership4ZK_second.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "depth": "$DEPTH",
    "num_root": $ROOT,
    "nullifier": $NULLIFIER,
    "message": $MESSAGE,
    "points": $POINTS
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/verify_membership4ZK_second.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/verify_membership4ZK.zen" > "$TEMP/verify_membership4ZK_second_out.json"

# Publish the transaction (save the output in a file)
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/verify_membership4ZK_second_out.json")" > "$TEMP/verify4_status.json"

jq -r .status "$TEMP/verify4_status.json" \
  |grep -qx 0x1 || { echo "FAIL: transaction not passed"; exit 1; }
echo "PASS: verify4"


# Test verify_membership3

# Retrieve the nonce 
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed "s/chain '222'/chain '$CHAIN_ID'/" zenroom/verify_membership3ZK.zen > "$TEMP/verify_membership3ZK.zen"

# The proof needs: depth, num_root, nullifier and points 
node clients/anonset/anonset-cli.mjs proof generate-chain "$TEMP/identity1.json" "$CONTRACT" "$RPC_URL" "$CHAIN_ID" 0 > "$TEMP/proof3_ver.json"
DEPTH=$(jq .merkleTreeDepth "$TEMP/proof3_ver.json")
ROOT=$(jq .merkleTreeRoot "$TEMP/proof3_ver.json")
NULLIFIER=$(jq .nullifier "$TEMP/proof3_ver.json")
POINTS=$(jq .points "$TEMP/proof3_ver.json")

# Create the input file
cat << EOF > "$TEMP/verify_membership3ZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "depth": "$DEPTH",
    "num_root": $ROOT,
    "nullifier": $NULLIFIER,
    "points": $POINTS
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/verify_membership3ZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/verify_membership3ZK.zen" > "$TEMP/verify_membership3ZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/verify_membership3ZK_out.json")"

# To verify this test, a second transaction is published: it should pass
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Create the input file
cat << EOF > "$TEMP/verify_membership3ZK_second.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "depth": "$DEPTH",
    "num_root": $ROOT,
    "nullifier": $NULLIFIER,
    "points": $POINTS
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/verify_membership3ZK_second.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/verify_membership3ZK.zen" > "$TEMP/verify_membership3ZK_second_out.json"

# Publish the transaction (save the output in a file)
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/verify_membership3ZK_second_out.json")" > "$TEMP/verify3_status.json"

jq -r .status "$TEMP/verify3_status.json" \
  |grep -qx 0x1 || { echo "FAIL: transaction not passed"; exit 1; }
echo "PASS: verify3"


# Test validate_membership4

# Retrieve the nonce
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed "s/chain '222'/chain '$CHAIN_ID'/" zenroom/validate_membership4ZK.zen > "$TEMP/validate_membership4ZK.zen"

# The proof needs: depth, num_root, nullifier, message and points 
node clients/anonset/anonset-cli.mjs proof generate-chain "$TEMP/identity1.json" "$CONTRACT" "$RPC_URL" "$CHAIN_ID" 12 > "$TEMP/proof4_val.json"
DEPTH=$(jq .merkleTreeDepth "$TEMP/proof4_val.json")
ROOT=$(jq -r .merkleTreeRoot "$TEMP/proof4_val.json")
NULLIFIER=$(jq -r .nullifier "$TEMP/proof4_val.json")
MESSAGE=$(jq -r .message "$TEMP/proof4_val.json")
POINTS=$(jq -c .points "$TEMP/proof4_val.json")

# Create the input file
cat << EOF > "$TEMP/validate_membership4ZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "depth": "$DEPTH",
    "num_root": "$ROOT",
    "nullifier": "$NULLIFIER",
    "message": "$MESSAGE",
    "points": $POINTS
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/validate_membership4ZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/validate_membership4ZK.zen" > "$TEMP/validate_membership4ZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/validate_membership4ZK_out.json")" > "$TEMP/validate4_status.json"

jq -r .status "$TEMP/validate4_status.json" \
  | grep -qx 0x1 || { echo "FAIL: transaction not passed"; exit 1; }
echo "PASS: validate4, first transaction"

# To verify this test, simulate a second transaction
POINTS2=${POINTS//\"/}

# The expected error is "Semaphore__YouAreUsingTheSameNullifierTwice()"
ERROR="Semaphore__YouAreUsingTheSameNullifierTwice()"
ERROR_VAL=$("$CAST" sig "$ERROR")

TRANSACTION2=$("$CAST" call "$CONTRACT" 'validateMembership(uint256,uint256,uint256,uint256,uint256[8])(bool)' "$DEPTH" "$ROOT" "$NULLIFIER" "$MESSAGE" "$POINTS2" --rpc-url "$RPC_URL" 2>&1) || true

# The transaction has to be rejected because of the nullifier
echo "$TRANSACTION2" | grep -q "$ERROR_VAL" \
  || { echo "FAIL: not rejected by the nullifier"; exit 1; }
echo "the error is $ERROR"
echo "PASS: validate4"  


# Test validate_membership3

# Retrieve the nonce
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed "s/chain '222'/chain '$CHAIN_ID'/" zenroom/validate_membership3ZK.zen > "$TEMP/validate_membership3ZK.zen"

# The proof needs: depth, num_root, nullifier and points 
node clients/anonset/anonset-cli.mjs proof generate-chain "$TEMP/identity3.json" "$CONTRACT" "$RPC_URL" "$CHAIN_ID" 0 > "$TEMP/proof3_val.json"
DEPTH=$(jq -r .merkleTreeDepth "$TEMP/proof3_val.json")
ROOT=$(jq -r .merkleTreeRoot "$TEMP/proof3_val.json")
NULLIFIER=$(jq -r .nullifier "$TEMP/proof3_val.json")
POINTS=$(jq -c .points "$TEMP/proof3_val.json")

# Create the input file
cat << EOF > "$TEMP/validate_membership3ZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "depth": "$DEPTH",
    "num_root": "$ROOT",
    "nullifier": "$NULLIFIER",
    "points": $POINTS    
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/validate_membership3ZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/validate_membership3ZK.zen" > "$TEMP/validate_membership3ZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/validate_membership3ZK_out.json")" > "$TEMP/validate3_status.json"

jq -r .status "$TEMP/validate3_status.json" \
  | grep -qx 0x1 || { echo "FAIL: transaction not passed"; exit 1; }
echo "PASS: validate3, first transaction"

# To verify this test, simulate a second transaction
POINTS2=${POINTS//\"/}

# The expected error is "Semaphore__YouAreUsingTheSameNullifierTwice()"
ERROR="Semaphore__YouAreUsingTheSameNullifierTwice()"
ERROR_VAL=$("$CAST" sig "$ERROR")

TRANSACTION2=$("$CAST" call "$CONTRACT" 'validateMembership(uint256,uint256,uint256,uint256[8])(bool)' "$DEPTH" "$ROOT" "$NULLIFIER" "$POINTS2" --rpc-url "$RPC_URL" 2>&1) || true

# The transaction has to be rejected because of the nullifier
echo "$TRANSACTION2" | grep -q "$ERROR_VAL" \
  || { echo "FAIL: not rejected by the nullifier"; exit 1; }
echo "the error is $ERROR"
echo "PASS: validate3"  


# Test transfer_ownership

# Retrieve the nonce 
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed  "s/chain '222'/chain '$CHAIN_ID'/" zenroom/transfer_ownershipZK.zen > "$TEMP/transfer_ownershipZK.zen"

# Create the input file
cat << EOF > "$TEMP/transfer_ownershipZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "new_owner": "$ADDRESS2" 
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/transfer_ownershipZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/transfer_ownershipZK.zen" > "$TEMP/transfer_ownershipZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/transfer_ownershipZK_out.json")"

# Check that the current owner is still the same
"$CAST" call "$CONTRACT" 'owner()(address)' --rpc-url "$RPC_URL" \
  | grep -qx "$ADDR" || { echo "FAIL: owner changed"; exit 1; }
echo "The owner is still the same"

# Check that the pending owner is the new address
"$CAST" call "$CONTRACT" 'pendingOwner()(address)' --rpc-url "$RPC_URL" \
  | grep -qx "$ADDRESS2" || { echo "FAIL: pendingOwner not set"; exit 1; }
echo "The pending owner is correct"
echo "PASS: transfer_ownership"

  
# Test cancel_ownershipTransfer

# Retrieve the nonce 
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed  "s/chain '222'/chain '$CHAIN_ID'/" zenroom/cancel_ownershipTransferZK.zen > "$TEMP/cancel_ownershipTransferZK.zen"

# Create the input file
cat << EOF > "$TEMP/cancel_ownershipTransferZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT"
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/cancel_ownershipTransferZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/cancel_ownershipTransferZK.zen" > "$TEMP/cancel_ownershipTransferZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/cancel_ownershipTransferZK_out.json")"

# To verify, check that the current owner is unchanged and the pending owner is zero
"$CAST" call "$CONTRACT" 'owner()(address)' --rpc-url "$RPC_URL" \
  | grep -qx "$ADDR" || { echo "FAIL: owner changed"; exit 1; }
echo "The owner is still the same"

ZERO_ADDR="0x0000000000000000000000000000000000000000"
"$CAST" call "$CONTRACT" 'pendingOwner()(address)' --rpc-url "$RPC_URL" \
  | grep -qx "$ZERO_ADDR" || { echo "FAIL: pendingOwner not zero"; exit 1; }
echo "The pending owner is correct"
echo "PASS: cancel_ownershipTransfer"


# Test accept_ownership

# "transfer_ownership" has to be done again

# Retrieve the nonce 
NONCE=$("$CAST" nonce "$ADDR" --rpc-url "$RPC_URL")

# Correct the chain id
sed  "s/chain '222'/chain '$CHAIN_ID'/" zenroom/transfer_ownershipZK.zen > "$TEMP/transfer_ownershipZK.zen"

# Create the input file
cat << EOF > "$TEMP/transfer_ownershipZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT",
    "new_owner": "$ADDRESS2" 
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/transfer_ownershipZK.json" -k "$TEMP/myKeyring.json" -l zenroom/swiss_merkleZK.lua "$TEMP/transfer_ownershipZK.zen" > "$TEMP/transfer_ownershipZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/transfer_ownershipZK_out.json")"

# "accept ownership"

# A second keyring is needed
KEY_SEC=${KEY2#0x}
cat << EOF > "$TEMP/myKeyring2.json"
{
    "keyring": {
            "ethereum": "$KEY_SEC"
    }
}
EOF

# Retrieve the nonce 
NONCE=$("$CAST" nonce "$ADDRESS2" --rpc-url "$RPC_URL")

# Correct the chain id
sed  "s/chain '222'/chain '$CHAIN_ID'/" zenroom/accept_ownershipZK.zen > "$TEMP/accept_ownershipZK.zen"

# Create the input file
cat << EOF > "$TEMP/accept_ownershipZK.json"
{
    "gas price": "$GAS",
    "gas limit": "300000",
    "ethereum nonce": "$NONCE",
    "contract_address": "$CONTRACT"
}
EOF

# Sign the transaction
"$ZENROOM" -z -a "$TEMP/accept_ownershipZK.json" -k "$TEMP/myKeyring2.json" -l zenroom/swiss_merkleZK.lua "$TEMP/accept_ownershipZK.zen" > "$TEMP/accept_ownershipZK_out.json"

# Publish the transaction
"$CAST" publish --rpc-url "$RPC_URL" "0x$(jq -r .signed_ethereum_transaction "$TEMP/accept_ownershipZK_out.json")"

# Check that the new owner is correct and the pending owner is zero
"$CAST" call "$CONTRACT" 'owner()(address)' --rpc-url "$RPC_URL" \
  | grep -qx "$ADDRESS2" || { echo "FAIL: owner not changed"; exit 1; }
echo "The new owner is correct"

"$CAST" call "$CONTRACT" 'pendingOwner()(address)' --rpc-url "$RPC_URL" \
  | grep -qx "$ZERO_ADDR" || { echo "FAIL: pendingOwner not zero"; exit 1; }
echo "The pending owner is zero"
echo "PASS: accept_ownership"
