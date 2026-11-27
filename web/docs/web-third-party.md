# Cshell web third-party dependencies

Original Cshell UI material is covered by the root MIT license. Dependencies keep their own licenses; a technical rewrite is not legal clearance. The authoritative versioned release inventory is generated from installed production dependencies, not this narrative file or a direct-only license checker.

## Production inventory and notices

Direct runtime roots are `vue`, `vue-router`, `pinia`, `vue-i18n`, and `qrcode`. The verified 2026-11-24 installed closure contains **60 packages** (direct + transitive + required peers) and **31 distinct notice texts**. Dev/test-only roots, optional peer-only tooling (such as TypeScript), and unrelated pnpm store entries are excluded. Production-only metadata can still include packages whose code is tree-shaken; keeping their notices is conservative.

Run from the repository root:

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web run build
node scripts/release-licenses.mjs npm
node scripts/release-artifacts.mjs package
node scripts/release-artifacts.mjs check
```

`web/dist/legal/npm/inventory.json` records exact names, versions, dependency edges, declared license expressions, metadata hashes, lockfile hash, and each published notice path/hash. `THIRD_PARTY_NOTICES.txt` concatenates the verbatim notices; `texts/` retains content-addressed copies. Generated notices are distributable alongside the minified code. Unknown expressions, absent texts and unresolved required dependency paths fail closed.

The archive for `@vue/devtools-api@6.6.4` declares MIT but omits its LICENSE. Its exact-version repository license is vendored in `docs/licenses/`, with source URL and Git blob/SHA-256 evidence; the generator checks the hash. No author/copyright was guessed.

Build/test tooling (Vite, TypeScript, ESLint, Vitest, test-utils, jsdom, Playwright and their tooling dependencies) is not shipped in the runtime closure. It remains governed by its own published licenses when distributing tooling/source installations.

## Brand asset

`public/2shell.jpeg` is Cshell branding. Donz confirmed original ownership or sufficient rights on 2026-11-23. This is owner confirmation only, not an independent legal clearance. See `docs/provenance.md` for historical material and configuration ancestry caveats.
