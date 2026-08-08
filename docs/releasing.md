# GitHub-only releases

Releases are made only from the exact `main` commit that completed the trusted
testnet deployment workflow. The release workflow verifies that SHA, downloads
its evidence artifact, rebuilds and compares the contract identity, then runs
semantic-release without any version-file, changelog, or npm preparation.

This intentionally means `CHANGELOG.md`, `package.json`, `package-lock.json`,
and `BuildInfo.sol` are never changed by the release workflow: making a
post-testnet release commit would make the tag describe a different commit than
the deployed bytecode. GitHub release notes and the attached checked release
bundle are the changelog for this exact-SHA release channel.

The package remains private. No npm credential, registry access, or publish
step is permitted in release automation.
