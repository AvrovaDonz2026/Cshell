# Cshell provenance inventory (independent frontend migration)

This inventory supports the independent `web/` frontend. It records material classes for the current tree and historical context. It is a technical checklist, not a legal opinion.

## Material classes

| Class | Meaning |
|-------|---------|
| Original | Authored for Cshell under root MIT (Donz, 2026) |
| Upstream-derived | Adapted from Wei-Shaw/sub2api @ `2af3f1e15c98c893a89255a037f551046883b8c0` (LGPL-3.0-or-later) |
| Third-party | Dependencies or assets under their own licenses |
| Pending | Origin unclear; must not be labeled original MIT until resolved |

## Current distribution tree

| Path | Class | Notes |
|------|-------|-------|
| `src/`, `tests/`, `Cargo.toml`, `Cargo.lock` | Original | Rust reverse proxy |
| `web/` source and tests | Original (migration authorship claim; not legal clearance) | Independent user SPA; see `web/docs/web-third-party.md` for npm deps |
| `web/dist/` | Mixed original + third-party build of `web/` | Produced by `pnpm --dir web run build` |
| `scripts/cshell-web-*.mjs`, `scripts/proxy-smoke.mjs`, `scripts/mock-sub2api.mjs`, `scripts/sub2api-integration.mjs` | Original | Preview/acceptance and protocol checks |
| `LICENSE`, `HISTORY-LICENSE.md` | Original notices | MIT for current originals; history note for past LGPL ships |
| Vue / npm / Rust crates | Third-party | See `web/pnpm-lock.yaml` and `Cargo.lock` |
| `2shell.jpeg` (repo root and `web/public/`) | Cshell brand, used with owner confirmation | Donz confirmed on 2026-11-23 that the asset is original or covered by sufficient rights. This records the owner's confirmation; it is not an independent legal clearance. |
| Sub2API runtime | Separate product | Not shipped as Cshell source inside the image |

## Historical (removed from working tree; retained in git)

| Path / object | Class | Notes |
|---------------|-------|-------|
| Former `frontend/` (source, `LICENSE`, `UPSTREAM.md`, dist) | Upstream-derived | Removed from current tree; see `HISTORY-LICENSE.md` |
| Former `scripts/workspace-*.mjs` | Original tooling | Superseded by `scripts/cshell-web-*.mjs`; deleted to avoid broken `frontend/` paths |
| Historical git objects containing `frontend/` | Upstream-derived history | Not rewritten; past LGPL obligations for past distributions remain |

## Core feature boundary (first independent release)

In scope: email login/register (and required verification fields the API demands), dashboard, usage + multi-scale heatmap, API keys, profile, subscriptions / purchase / orders.

Out of scope for first release UI: model plaza entry, third-party OAuth login, Passkey, affiliate, channels, MCP, batch image, admin UI. Admin and `/setup` continue to be served by the independent Sub2API deployment.

## Brand asset note

`2shell.jpeg` is used as Cshell branding in the independent UI. On 2026-11-23 the repository owner confirmed original authorship or sufficient rights for this asset; that confirmation is recorded here rather than presented as third-party clearance. Do not introduce other logos or brand assets whose rights are unknown.

## Configuration ancestry

Configuration is **standard/template-like; exclusive original expression is not established**. A local git audit on 2026-11-24 found the current `web/` configuration first added in `d53abfb`; the preceding historical `frontend/tsconfig.json` contains the same ordered TypeScript option sequence (`useDefineForClassFields`, module/lib, skipLibCheck, bundler resolution, import extensions, JSON, isolatedModules, noEmit, JSX, strict/noUnused/noFallthrough). Current application config changes target, path aliases, include patterns and splits project files, but those changes do not establish independent ancestry for the shared sequence. Historical Vite config was substantially larger; current code retains ordinary Vue plugin, alias and proxy concepts. No particular external template/version was proven. These conventional settings are not represented as uniquely authored MIT material or as a legal determination; history remains available under the historical notices. No upstream frontend implementation was copied during this audit.

## Repeatable release evidence (2026-11-24)

`node scripts/release-licenses.mjs npm` walks each installed production dependency and non-optional peer through real pnpm symlink resolution, recursively following package metadata. It does not scan unrelated/stale store entries, and does not mistake the root direct dependency list for the closure. Current result: **60 resolved npm packages**, 31 distinct published notice texts, zero unresolved records. Includes QR code dependencies as well as Vue packages. Build-time/test-only roots are excluded; production packages may contain files removed by bundler tree shaking, so this is a conservative production closure, not an exact minified-module attribution.

`node scripts/release-licenses.mjs rust` uses locked offline Cargo metadata and `cargo tree --edges normal,build` for the host target (override `RELEASE_TARGET`). Current x86_64-unknown-linux-gnu result: **133 crates**, 108 distinct texts, zero unresolved records. Dev-only roots are excluded; normal/build dependencies and proc macros are included conservatively. Cargo feature unification with test dependencies can conservatively overinclude features; this is explicitly not an exact linked-symbol inventory. Manifest hash, crate source/checksum and lockfile hash are recorded. Every recursive published LICENSE/COPYING/NOTICE/COPYRIGHT/AUTHORS file is preserved verbatim and hashed; copyright is never inferred from package authors.

One installed npm archive (`@vue/devtools-api@6.6.4`) declares MIT but omits license text. `docs/licenses/sources.json` records its exact-version repository license URL, Git blob SHA and SHA-256, and the verbatim text is checked in. No substitute copyright was invented. Missing expressions, missing texts, missing required dependencies and altered supplemental text fail the generator.

After a normal `pnpm --dir web run build`, run npm generation, `node scripts/release-artifacts.mjs package`, then `node scripts/release-artifacts.mjs check`. This packages MIT + third-party notices, full text inventory and hashed file manifest into `web/dist/legal/`; rejects unexpected directories, development/fixture files, source maps and stale/tampered outputs. Docker generates both inventories in builders and copies only the binary, SPA and notices, retaining base-system `/usr/share/doc` notices. CI checks an exported image without starting its services. This checks technical packaging, not legal clearance or base-image supply-chain attestation.

Local normal production build and web artifact checks passed. Docker executable is absent in this environment; image build/runtime packaging remains a CI verification requirement, not a locally demonstrated result. Local toolchain was Node 22.23.5 / pnpm 9.15.9; CI/Docker pin Node 24 / pnpm 10.11.0. No external publication or payment was performed.


## Non-goals

- Rewriting git history
- Claiming that technical rewrite alone extinguishes obligations of previously published LGPL distributions
- Relicensing third-party dependencies
