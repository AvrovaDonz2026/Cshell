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
| `web/` source, tests, build config | Original | Independent user SPA; see `web/docs/web-third-party.md` for npm deps |
| `web/dist/` | Original build of `web/` | Produced by `pnpm --dir web run build` |
| `scripts/cshell-web-*.mjs`, `scripts/proxy-smoke.mjs`, `scripts/mock-sub2api.mjs`, `scripts/sub2api-integration.mjs` | Original | Preview/acceptance and protocol checks |
| `LICENSE`, `HISTORY-LICENSE.md` | Original notices | MIT for current originals; history note for past LGPL ships |
| Vue / npm / Rust crates | Third-party | See `web/pnpm-lock.yaml` and `Cargo.lock` |
| `2shell.jpeg` (repo root and `web/public/`) | Pending → claim Cshell brand | Keep under review until authorship record is finalized |
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

`2shell.jpeg` is treated as Cshell branding for the independent UI. Until its authorship record is finalized, distribution notices must not assert third-party ownership, and unknown alternate logos must not be introduced.

## Non-goals

- Rewriting git history
- Claiming that technical rewrite alone extinguishes obligations of previously published LGPL distributions
- Relicensing third-party dependencies
