# Cshell validation

## Local real-backend functional acceptance

Local functional UI and browser acceptance use the complete real Sub2API backend through Cshell; no business API routes are mocked. Do not start a mock UI fixture for functional acceptance.

```sh
node scripts/cshell-local-real.mjs start
node scripts/cshell-local-real.mjs status
node scripts/cshell-local-real.mjs logs
node scripts/cshell-local-real.mjs stop   # keep database volume
node scripts/cshell-local-real.mjs reset  # stop and wipe database volume
```

The launcher binds only to loopback: Cshell at `http://127.0.0.1:18080`, upstream at `http://127.0.0.1:18081`. It provisions a real Sub2API container (default latest image resolved/pinned by digest), PostgreSQL and Redis, builds production `web/dist` and Cshell when stale, and verifies a real login. Generated credentials are stored in `artifacts/local-real/state.json` with mode 0600; `start` prints the account credentials required for browser login. `stop` tears down services but preserves database data; `reset` deletes the database volume so the next start creates a clean registration state. Do not commit or share the state file.

Real model inference, payment settlement, outbound email, and OAuth/Passkey provider flows are intentionally not exercised. An empty real account may legitimately have no keys or usage; assertions must distinguish the documented empty state from errors.

## Proxy protocol unit tests (not UI functional acceptance)

After building Cshell and the independent `web/` UI:

```sh
/home/donz/.cargo/bin/cargo build --bin cshell
node scripts/proxy-smoke.mjs --binary target/debug/cshell --static-dir web/dist
```

This starts a local Node HTTP fixture and the real Cshell binary on ephemeral loopback ports. It checks health, same-origin SPA/static delivery, representative auth/order/payment callback forwarding, request bytes and response headers. These are wire-level Rust proxy unit tests only: fixture callback acknowledgements do not establish payment, validate signatures, contact providers, or test browser behavior. `scripts/mock-sub2api.mjs` is also restricted to proxy protocol tests; it is not an acceptable UI functional backend.

## Real-backend browser gate

CI runs `scripts/sub2api-browser.mjs` against the production bundle and real Sub2API, for both fixed source baseline `2af3f1e15c98c893a89255a037f551046883b8c0` and latest image pinned to its resolved digest. It fails closed on missing credentials, unavailable upstream, interactive captcha, non-loopback base URL, runtime/console/request/HTTP errors, and undeclared negative responses. CI separately runs `scripts/sub2api-integration.mjs` for real API contracts. See [compatibility.md](compatibility.md) for CI and historical evidence boundaries.

The browser gate covers production asset serving/deep links, guest pages, real registered-account login, desktop light/dark and mobile Chinese UI, theme/locale persistence, section and drawer navigation, preference/settings gates, dialogs and focus/Escape hierarchy (including nested selects), real key create/edit/delete, Usage's four scales and applied filters, real empty-data states, profile update/revert, logout/protected redirects, admin redirect, and billing paths that never claim an unpaid order is paid. Only exact, declared negative responses are tolerated; stale same-origin usage GET cancellations are narrowly tolerated.

Manual execution against a running local real loop:

```sh
node scripts/cshell-local-real.mjs start
# Set the credentials printed by start in the environment (do not save them in source).
CSHELL_BASE_URL=http://127.0.0.1:18080 \
SUB2API_TEST_EMAIL=... SUB2API_TEST_PASSWORD=... \
SUB2API_ADMIN_EMAIL=... SUB2API_ADMIN_PASSWORD=... \
SUB2API_UPSTREAM_ID=<commit-or-image-digest> node scripts/sub2api-browser.mjs
```

A prior full live local run of the real latest-image loop is recorded in the migration notes in this repository. It is prior evidence, not a claim that this interrupted migration reran containers or browser acceptance. CI results are pending until this work is pushed and workflow execution completes.
