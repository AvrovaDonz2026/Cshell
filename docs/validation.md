# Cshell validation

## Loopback smoke test

After building Cshell and the independent `web/` UI, run:

```sh
/home/donz/.cargo/bin/cargo build --bin cshell
node scripts/proxy-smoke.mjs --binary target/debug/cshell --static-dir web/dist
```

The script starts a local Node HTTP fixture and the real Cshell binary on ephemeral loopback ports. It exercises health, same-origin SPA and static-resource delivery, auth register/login/refresh/logout/me, authenticated order creation, public order verification and resume-token resolution, and EasyPay GET and POST plus Alipay and Stripe POST callback forwarding. Mocked responses assert the upstream request method, path and query, raw body, representative headers, status, response body and repeated `Set-Cookie` headers. The fixture accepts no external destinations and makes no real provider requests. Values used as tokens and orders are dummy test data.

These are protocol and reverse-proxy checks. The mock's callback acknowledgements do not establish payment, validate signatures, contact providers, or prove that the real Rust backend accepts a callback or transitions an order. The fixture does not exercise frontend browser behavior or frontend API-store state.

## Not covered here

No real database or deployed Sub2API backend was used. OAuth redirects/provider credentials, Passkey/WebAuthn ceremonies, browser interaction, real authentication, real payment checkout/provider success, and provider signature verification are not exercised. Other payment callback providers and callback error cases are not claimed as validated by this smoke test. WebSocket and streaming checks are separate backend tests, not covered here.

## Required real-upstream CI integration

The workflow contains a required `sub2api-integration` job. It clones Sub2API outside the Cshell checkout, fetches and verifies the exact commit
`2af3f1e15c98c893a89255a037f551046883b8c0`, builds that checkout's own Dockerfile, and runs it with isolated PostgreSQL 16 and Redis 7 service containers. The job has no `continue-on-error` or conditional skip. It waits for bounded health readiness, starts Cshell on separate loopback ports, and runs `scripts/sub2api-integration.mjs` through Cshell.

The real checks assert an unauthenticated profile request is rejected, administrator login returns an access token, the authenticated profile preserves the test account identity, and the authenticated keys endpoint returns JSON. Credentials are generated only for the CI run; no provider credentials, paid calls, or production services are used. Cleanup and sanitized diagnostic artifact upload run on failure or completion.

The reusable script is intentionally separate from `scripts/proxy-smoke.mjs`: the smoke suite uses a loopback mock and proves protocol forwarding, while this job is the real pinned-upstream verification. On 2026-11-20, native Podman local verification started isolated PostgreSQL 18-alpine, Redis 8-alpine, and Sub2API runtime containers, then ran host-compiled Cshell on loopback ports. The fetched `docker.io/weishaw/sub2api:0.2.23` image reports OCI revision `5af9afb588c4b014b3df9db7d4073af1f8ae01b6`, which does not equal the required pinned commit. Against that runtime, the integration script passed with statuses `401/200/200/200` for unauthorized profile, login, authenticated profile, and keys. A separate Podman build from the exact pinned checkout was attempted; its dependency install was blocked by repeated external TLS `ECONNRESET`/socket timeouts from `registry.npmjs.org`, so the local live result is explicitly evidence for the inspected 0.2.23 image, not proof of the pinned source build. The GitHub job remains configured to build the exact checkout with Docker and has not been run from this unpushed workspace. Any leftover historical preview listeners were left untouched.


## Historical user workspace checks — 2026-11-21 (superseded for acceptance)

The Claude-spatial user workspace keeps Cshell's own `2shell.jpeg`, warm paper/terracotta colors and square surfaces. The shared user-only layout covers dashboard, usage, keys, embedded model plaza, subscriptions, purchase, orders, redemption, profile, affiliate, available channels, monitor, MCP/custom pages and authenticated payment results. Provider popup/anonymous return surfaces retain their independent flow. Admin routes retain their separate layout; no database, upstream source copying, backend API or server-side state was added.

The following records earlier work; the temporary browser drivers were permissive and these observations are not the strict reproducible acceptance gate below:

- Full frontend ESLint passed (final run 462.83s). `vue-tsc -b` and Vite production build passed together with lint in 1088.36s; Vite itself reported 10m28s. Non-blocking warnings remain for old Browserslist data, a PostCSS `from` option, and large existing chunks.
- Complete Vitest run with normal file isolation (`vitest run --maxWorkers=2 --minWorkers=1`): **390 files / 3182 tests passed**, 1485.78s. No `--no-isolate` was used. New workspace coverage includes named collapsed navigation, active route, Tab/Shift+Tab trapping, Escape, resizing, theme light/dark/system and storage, portal cleanup, scroll locking, responsive widths and admin isolation. A separate final focused shell run passed 26/26 tests.
- Chrome/Playwright responsive matrix uses 1440×1000 desktop, 820×1180 tablet, and 390×844 mobile. Thirteen user routes per viewport have no document horizontal overflow. Mobile drawer keyboard trapping and focus restoration pass. Key creation dialog opens. Dashboard, usage, keys, embedded models, purchase, orders, profile and authenticated payment result survive direct navigation/reload.
- Four populated heatmap scales pass: hourly (24 cells), monthly daily, yearly daily, and multi-year monthly, with independent selection states and no page overflow. Missing records remain visibly different from zero.
- Preview: `http://127.0.0.1:4174/dashboard` (Vite), backed by an isolated loopback UI fixture at port 40939. The preview login accepts dummy credentials; it is **not a real upstream login**. No provider payment, real API-key creation, OAuth/passkey ceremony, or production data is claimed. Fixture and browser driver scripts live in `/tmp/cshell-workspace-*.mjs`; screenshots and machine-readable reports are under `artifacts/workspace/`.

Screenshots: `desktop-light.png`, `desktop-dark.png`, `tablet-light.png`, `mobile-light.png`, `usage-multiyear.png`, and `keys-dialog.png`. Browser JSON distinguishes viewport/route checks from component readiness and full reload checks. Earlier fixture-shape errors and resource-pressure retries were corrected rather than counted as acceptance evidence. Previously existing ports/processes were absent on recovery; only newly started redundant previews were stopped. No plan edits, commit, push, or backend changes were made for the workspace task.


## Historical LGPL `frontend/` workspace preview (removed)

The former repository-owned `scripts/workspace-*.mjs` drivers targeted the LGPL-derived `frontend/` tree on ports **4184 / 4185 / 40949**. That UI directory and those scripts have been **removed** from the current working tree (canonical tooling is `scripts/cshell-web-*.mjs`). The following remains as a historical acceptance record only; do not attempt to re-run the old commands against this tree.

Final strict acceptance (2026-11-21): **PASSED** — 177 browser checks, 81 screenshots; see archived `artifacts/workspace/acceptance/` if present. Vitest at that time: 396 files / 3242 tests. Preview was then healthy at `http://127.0.0.1:4184/dashboard`.

## Independent `web/` preview and browser acceptance (2026-11-21)

The original SPA under `web/` has its own loopback preview and strict Playwright acceptance. Historical `frontend/` preview ports **4184 / 4185 / 40949** are obsolete after that tree’s removal; independent scripts refuse those ports. Default independent ports:

| Role | Port | Bind |
|------|------|------|
| Front proxy + mock badge | **4284** | `127.0.0.1` |
| Vite (cwd `web/`) | **4285** | `127.0.0.1` |
| API fixture | **41949** | `127.0.0.1` |

Scripts (distinct names under `scripts/`):

- `scripts/cshell-web-fixture.mjs` — deterministic LOCAL MOCK for auth, settings/public, dashboard stats/trend, usage, keys CRUD, groups/available, subscriptions summary, payment checkout/plans/orders/my; `POST /payment/orders` returns **409**
- `scripts/cshell-web-preview.mjs` — `start` \| `stop` \| `status` \| `serve`; state in `artifacts/cshell-web/preview-state.json`; injects visible badge `LOCAL MOCK DATA · independent web · no real payments`
- `scripts/cshell-web-vite.config.mjs` — loads `web/vite.config.ts`, `base: '/'`, proxies `/api` to the fixture
- `scripts/cshell-web-browser.mjs` — strict acceptance against `WORKSPACE_URL` default `http://127.0.0.1:4284`

```sh
cd /home/donz/Cshell
pnpm --dir web install --frozen-lockfile
# optional browser binary for acceptance:
# pnpm --dir web exec playwright install chromium
node scripts/cshell-web-preview.mjs start
node scripts/cshell-web-preview.mjs status
WORKSPACE_CHROME=/opt/google/chrome/chrome WORKSPACE_URL=http://127.0.0.1:4284 \
  node scripts/cshell-web-browser.mjs
# leave preview running after a pass, or:
# node scripts/cshell-web-preview.mjs stop
```

Override ports with `CSHELL_WEB_PORT`, `CSHELL_WEB_VITE_PORT`, and `CSHELL_WEB_FIXTURE_PORT` (scripts refuse 4184/4185/40949). Use `WORKSPACE_CHROME` when a system Chrome binary is preferred; otherwise Playwright Chromium from the `web/` `playwright` devDependency is used.

Acceptance matrix: desktop 1440×1000, tablet 820×1180, phone 390×844; themes light/dark (and system resolved via OS `colorScheme`, because `web/` theme store is light|dark only). Asserts computed warm paper colors when present, no document horizontal overflow, key create dialog + Escape nested select, billing inline confirm, four heatmap scales with populated cells, admin redirected to `/admin` without user workspace class, guest redirected to `/login` and dummy login. Nonzero exit on runtime/console/request/HTTP/theme/overflow failures. Screenshots and `results.json` under `artifacts/cshell-web/acceptance/`. SHA-256 digest of `web/src` must be stable across the run.

**Not claimed:** real payment checkout, OAuth/passkeys, real upstream authentication, or production data.

Final independent web acceptance (2026-11-21): **PASSED** — 123 checks, 0 failures, 0 runtime/console/request/HTTP errors, 53 screenshots, source digests matched. Preview left healthy at `http://127.0.0.1:4284/dashboard`. Unit gate: `pnpm --dir web test:run`, `typecheck`, and `lint:check` all passed (14 tests).
