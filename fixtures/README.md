# Fixtures

Small made-up projects used to test the scanner. **Never install their dependencies, deploy them or copy code from them.** The package names and versions in their `package.json` files are illustrative only.

- Every app under `apps/` is fictional. They contain no real keys. Tests that need key-shaped fake secrets create them in a temporary folder at run time, so none are committed here.
- `expected/<name>.json` is the answer key for each app: the facts a scan must find, the questions it must raise, and the **decoys** it must not report. Keys sit outside the app folder so the answers never travel with it.
- A decoy is text that looks like a fact if you only match words: a roadmap note naming a provider, a commented-out import, a public key that is public by design. Each detector needs a case it must flag and a decoy it must not.
