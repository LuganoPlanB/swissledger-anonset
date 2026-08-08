# Vendored PoseidonT3

`PoseidonT3.sol` is an unmodified copy from `poseidon-solidity` 0.0.5
(MIT), originally published at
<https://github.com/vimwitch/poseidon-solidity>.

Upstream source SHA-256:
`08a7493be37838166954af6c77d583d797cc17d37673196498fc70cbf557831c`.

Semaphore's LeanIMT hashes two children and therefore requires `PoseidonT3`.
`PoseidonT6` has a different input width and is not a newer interchangeable
implementation.
