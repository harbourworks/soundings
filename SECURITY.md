# Security policy

## Reporting a problem in Soundings itself

Email **support@dynamomaritime.com** with "Security" in the subject. Please include the version (`npx @dynamomaritime/soundings-cli --version`), what you found, and how to reproduce it. A small, made-up example is ideal; please don't send real secrets or code you can't share.

We'll acknowledge it within two working days and keep you updated until it's fixed. Please give us a reasonable chance to release a fix before you publish details. We're happy to credit you in the release notes.

## What counts

- Anything that makes Soundings upload code, send data it says it doesn't, or print a secret it should have masked.
- A repository that can make Soundings run a command or write outside the folder it scans (for example through git config, hooks or crafted file names).
- A way to use paid features without a valid licence.
- A way to make a generated document state something with no evidence reference.

A fact Soundings misses, or a wrong one, is a normal bug rather than a security issue: email us or open an issue.

## Supported versions

Fixes go into the latest release.
