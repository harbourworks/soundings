# Changelog

All notable changes to soundings-cli. Versions follow [semantic versioning](https://semver.org); while it's 0.x, a minor version can change behaviour.

## Unreleased

- Evidence schema 0.2 with content-derived IDs, scan coverage and a claim-marker parser.
- Redaction guard that fails on secret formats and on values from the project's `.env` files.
- Three fixture projects with answer keys, including decoys a scan must not report.
- CI: typecheck, tests and build on every pull request.
