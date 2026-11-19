local ETH = require_once('crypto_ethereum')

local SLZK = {}

local MERKLEZK_REGISTRY_SIGNATURES = {
   transferOwnership       = { i={'address'}, o={} },
   cancelOwnershipTransfer = { i={}, o={} },
   acceptOwnership         = { i={}, o={} },
   addMemberManager        = { i={'address'}, o={} },
   removeMemberManager     = { i={'address'}, o={} },
   getMemberManagers       = { o={'address[]'}, view=true },  -- empty i removed
   addMember               = { i={'uint256'}, o={'uint256'} },
   addMembers              = { i={'uint256[]'}, o={} },
   removeMember            = { i={'uint256', 'uint256[]'}, o={'uint256'} },
   verifyMembership4       = { name='verifyMembership', i={'uint256', 'uint256', 'uint256', 'uint256', 'uint256[8]'}, o={'bool'} },
   verifyMembership3       = { name='verifyMembership', i={'uint256', 'uint256', 'uint256', 'uint256[8]'}, o={'bool'} },
   validateMembership4     = { name='validateMembership', i={'uint256', 'uint256', 'uint256', 'uint256', 'uint256[8]'}, o={'bool'} },
   validateMembership3     = { name='validateMembership', i={'uint256', 'uint256', 'uint256', 'uint256[8]'}, o={'bool'} },
   activeRoot              = { o={'uint256'}, view=true }, -- empty i removed
   memberCount             = { o={'uint256'}, view=true },  -- empty i removed
   version                 = { o={'string'}, view=true} -- empty i removed
}


SLZK.merkle_registry = {}
for k, v in pairs(MERKLEZK_REGISTRY_SIGNATURES) do 
	SLZK.merkle_registry[k] = ETH.data_contract_factory(v.name or k, v.i)
end 

SLZK.merkle_registry_return = {}
for k, v in pairs(MERKLEZK_REGISTRY_SIGNATURES) do
	SLZK.merkle_registry_return[k] = ETH.contract_return_factory(v.o)
end

-- Write When for zencode

-- Function from zencode ethereum 
local function _use_eth_transaction(abi_fun, ...)
  local tx = have'ethereum transaction'
  zencode_assert(not tx.data or #tx.data == 0, "Cannot overwrite transaction data")
  tx.data = abi_fun(...)
end

-- When to transfer the ownership of the registry
When("use ethereum transaction to transfer ownership to ''", function(newOwner)
	_use_eth_transaction(SLZK.merkle_registry.transferOwnership, have(newOwner))
end)

-- When to cancel the ownnership transfer
When("use ethereum transaction to cancel ownership transfer", function()
	_use_eth_transaction(SLZK.merkle_registry.cancelOwnershipTransfer)
end)

-- When to accept the ownership
When("use ethereum transaction to accept ownership", function()
	_use_eth_transaction(SLZK.merkle_registry.acceptOwnership)
end)

--When to add a new manager
When("use ethereum transaction to add a manager ''", function(newmanager)
	_use_eth_transaction(SLZK.merkle_registry.addMemberManager, have(newmanager))
end)

-- When to remove a manager
When("use ethereum transaction to remove a manager ''", function(remManager)
	_use_eth_transaction(SLZK.merkle_registry.removeMemberManager, have(remManager))
end)

-- When to add a new member
When("use ethereum transaction to add a member ''", function(newmember)
	_use_eth_transaction(SLZK.merkle_registry.addMember, BIG.from_decimal(O.to_string(have(newmember))))
end)

-- When to remove a member
When("use ethereum transaction to remove a member '' with proof ''", function(remMember, proof)
	local list = {}
	for i, v in ipairs(have(proof)) do
		list[i] = BIG.from_decimal(O.to_string(v))
	end
	_use_eth_transaction(SLZK.merkle_registry.removeMember, BIG.from_decimal(O.to_string(have(remMember))), list)
end)

-- When to add new members (max 64)
When("use ethereum transaction to add members ''", function(newmembers)
	local list = {}
	for i, v in ipairs(have(newmembers)) do
		list[i] = BIG.from_decimal(O.to_string(v))
	end
	_use_eth_transaction(SLZK.merkle_registry.addMembers, list)
end)

-- When to verify membership
When("use ethereum transaction to verify membership with merkle tree depth '' and root '' and nullifier '' and message '' and points ''", function(depth, root, nullifier, message, points)
	local list = {}
	for i, v in ipairs(have(points)) do
		list[i] = BIG.from_decimal(O.to_string(v))
	end
	_use_eth_transaction(SLZK.merkle_registry.verifyMembership4, BIG.from_decimal(O.to_string(have(depth))),  BIG.from_decimal(O.to_string(have(root))),  BIG.from_decimal(O.to_string(have(nullifier))), BIG.from_decimal(O.to_string(have(message))), list)
end)

When("use ethereum transaction to validate membership with merkle tree depth '' and root '' and nullifier '' and message '' and points ''", function(depth, root, nullifier, message, points)
	local list = {}
	for i, v in ipairs(have(points)) do
		list[i] = BIG.from_decimal(O.to_string(v))
	end
	_use_eth_transaction(SLZK.merkle_registry.validateMembership4, BIG.from_decimal(O.to_string(have(depth))),  BIG.from_decimal(O.to_string(have(root))),  BIG.from_decimal(O.to_string(have(nullifier))), BIG.from_decimal(O.to_string(have(message))), list)
end)

When("use ethereum transaction to verify membership with merkle tree depth '' and root '' and nullifier '' and points ''", function(depth, root, nullifier, points)
	local list = {}
	for i, v in ipairs(have(points)) do
		list[i] = BIG.from_decimal(O.to_string(v))
	end
	_use_eth_transaction(SLZK.merkle_registry.verifyMembership3, BIG.from_decimal(O.to_string(have(depth))),  BIG.from_decimal(O.to_string(have(root))),  BIG.from_decimal(O.to_string(have(nullifier))), list)
end)


When("use ethereum transaction to validate membership with merkle tree depth '' and root '' and nullifier '' and points ''", function(depth, root, nullifier, points)
	local list = {}
	for i, v in ipairs(have(points)) do
		list[i] = BIG.from_decimal(O.to_string(v))
	end
	_use_eth_transaction(SLZK.merkle_registry.validateMembership3, BIG.from_decimal(O.to_string(have(depth))),  BIG.from_decimal(O.to_string(have(root))),  BIG.from_decimal(O.to_string(have(nullifier))), list)
end)

return SLZK

