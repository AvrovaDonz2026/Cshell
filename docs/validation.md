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

- `scripts/cshell-web-fixture.mjs` — deterministic LOCAL MOCK for auth (register with captcha `LOCAL-OK` and code `123456`, send-code with captcha; registration consumes verification code), settings/public with live toggles (`POST /api/v1/__cshell_web/settings`), dashboard stats/trend, usage logs, keys CRUD, groups/available, subscriptions summary, payment checkout/plans/config/limits, order creation with `pay_url` + `resume_token`, public verify/resolve, and orders/my. Amount `0.01` intentionally returns 409 as the failure demo.
- `scripts/cshell-web-preview.mjs` — `start` \| `stop` \| `status` \| `serve`; state in `artifacts/cshell-web/preview-state.json`; injects visible badge `LOCAL MOCK DATA · independent web · no real payments`
- `scripts/cshell-web-vite.config.mjs` — loads `web/vite.config.ts`, `base: '/'`, proxies `/api` to the fixture
- `scripts/cshell-web-browser.mjs` — strict acceptance against `WORKSPACE_URL` default `http://127.0.0.1:4284`

```sh
cd /home/donz/Cshell
pnpm --dir web install --frozen-lockfile
# optional browser binary for acceptance:
# pnpm --dir web exec playwright install chromium
# start | stop | status (add CSHELL_WEB_STATIC=1 to serve the production build)
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

Core closure acceptance (2026-11-21): **PASSED** — 129 checks, 0 failures, 0 unexpected runtime/console/request/HTTP errors, 55 screenshots, source digests matched. Two intentionally negative registration requests (HTTP 400 for a wrong verification code) are recorded under `expectedErrors`, not counted as defects. Preview is served from a static production build (`CSHELL_WEB_STATIC=1`) to avoid Vite dev-server module reload noise; URL remains `http://127.0.0.1:4284/dashboard`. Unit gate: `pnpm --dir web test:run` (25 tests), `typecheck`, and `lint:check` all passed.

Earlier matrix run (before the closure suite) recorded 123 checks and 53 screenshots; the number now reflects added registration, payment-result, usage-log, and key-edit coverage.

Core closure suite (register, payment, usage statistics, API keys):
- Registration respects `registration_enabled`; `/register` redirects to login when closed. Captcha and email verification fields render and submit only when the public settings require them; `/email-verify` accepts the mock code and starts a session. Wrong codes surface an API error.
- Payment supports subscription and balance recharge, selects methods from `checkout-info`, posts `payment_source: 'web'` with `return_url`, then follows `pay_url` or shows a QR payload. `/payment/result` verifies via public `out_trade_no` / `resume_token` and polls for a terminal state. Local mock marks orders paid; real provider settlement is not validated here.
- Usage adds dashboard actual-cost/duration cards, trend model summary, and paginated `GET /usage` logs; heatmap zero/missing/outside semantics and single-row month labels are unchanged.
- API keys support create with quota/IP/expiry, one-time secret copy, pagination and status filter, edit via `PUT /keys/{id}`, and delete confirmation.


## Warm independent UI strict acceptance — 2026-11-24

Historical pre-contract-correction acceptance **PASSED** at `2026-11-24T03:49:28.617Z`; the 142-check/105-test counts below are superseded by the pinned-contract correction gate appended below:

- Full static-preview browser matrix: **142/142 checks**, **67 screenshots**; zero runtime errors, unexpected console errors, failed requests, HTTP failures, or unknown fixture endpoints. Source SHA-256 matched at start/end: `42b3da5a0d31c01706e6791232c9588d7049ecf399b25817e9060a9a3b2a0910`.
- Responsive checks cover 1440×1000 desktop, 820×1180 tablet, 390×844 phone; light/dark and OS-resolved system rows. Guest home has six independent light/dark screenshots, computed palette and no-overflow checks, loaded brand resource, registration link, and direct reload. Authenticated routes, nested key dialog Escape behavior and mobile navigation remain covered.
- Core checks exercise explicit local-mock captcha button (not a free-text token input), wrong-code registration, closed-registration redirect with finally restoration, key invalid quota/IP blocking without PUT then valid persisted edits, applied usage ranges (draft changes make no requests), populated heatmaps/models/logs, checkout and recharge, QR raw/data-image rendering, cancellation, expired/cancelled results, and unknown-order 404 without a false Paid state.
- Negative errors are scoped per page/request to exact method, path, status and count (one POST register 400, one POST public verify 404). Each requires one exact browser resource-console message at the matching endpoint; expectation state is removed in finally. Unrelated console/HTTP/request errors always fail. No blanket navigation-abort exemption remains. A detected teardown-aborted recharge navigation was fixed by waiting for the result and settled network before closing its context.
- Actual Rust proxy production browser runner: **4/4 checks**, **3 screenshots**, zero errors. Uses ordinary `web/dist` built with `/_cshell/` assets, starts a real Rust binary and isolated loopback mock upstream on ephemeral ports, checks `/`, `/login`, `/dashboard` direct navigation and reload, login-to-dashboard root history, forwarded login/settings/dashboard APIs, loaded `/_cshell/2shell.jpeg`, prefixed JS/CSS, and a missing-asset 404. Router history now explicitly uses `/`; asset URLs continue using Vite BASE_URL. Its browser, proxy and fixture are stopped in finally.
- Fixture regression gate: **4/4 Node tests** (unknown identifiers, rejected unsupported scenario values, unpaid pending/expired/cancelled verify+resolve, persistent cancellation). Fixture instances no longer share settings/orders. Unsupported mock states cannot fall through to successful payment.
- Frontend: **17 files / 105 tests passed**, typecheck, zero-warning ESLint and normal production build passed. Unit fixtures emit non-fatal missing-translation warnings for `keys.subtitle` and `keys.ipCountLabel`; these are test-local locale stubs, not browser console errors.
- Rust: **10 tests passed** (3 unit + 4 proxy + 3 contract), no failures; binary build passed. No real upstream, database, credentials, provider settlement, OAuth/passkey or deployed integration was verified in this run.

Reproduction:

```sh
CSHELL_WEB_STATIC=1 node scripts/cshell-web-preview.mjs start
node scripts/cshell-web-preview.mjs status
WORKSPACE_CHROME=/usr/bin/google-chrome node scripts/cshell-web-browser.mjs
node --test scripts/cshell-web-fixture.test.mjs
pnpm --dir web build
/home/donz/.cargo/bin/cargo build --bin cshell
WORKSPACE_CHROME=/usr/bin/google-chrome node scripts/cshell-production-browser.mjs
/home/donz/.cargo/bin/cargo test
```

Preview lifecycle: the owned static preview is deliberately left healthy at `http://127.0.0.1:4284/` (fixture `127.0.0.1:41949`, no Vite listener required). `preview-state.json` records static mode, owner PID/token and scope. Stop only through `node scripts/cshell-web-preview.mjs stop`, then restart with `CSHELL_WEB_STATIC=1` after source changes; the static build does not hot reload. Health checks validate fixture responsiveness and built index presence. The stop endpoint validates its owner token; historical ports are untouched. Missing static resources return 404 instead of HTML, including on preview. Production runner ephemeral services have been cleaned up.

Evidence: `artifacts/cshell-web/acceptance/results.json` and `artifacts/cshell-web/production/results.json`. Representative acceptance screenshots: `guest-home-desktop-light.png`, `guest-home-desktop-dark.png`, `guest-home-phone-light.png`, `guest-home-phone-dark.png`, `usage-applied-filters.png`, `payment-qr.png`, `payment-qr_code.png`, `payment-expired.png`, `payment-cancelled.png`, `payment-unknown.png`. Production screenshots: `production/home.png`, `production/login.png`, `production/dashboard.png` beneath `artifacts/cshell-web/`.

No plan, provenance, release-notice edits, commit, push, or historical frontend source copying were performed by this acceptance task. Remaining blocker for an upstream claim: a separately executed real pinned-upstream/provider integration is still required; local mock results do not replace it.


## Pinned-backend contract correction — final gate 2026-11-24

This supersedes the historical **142 browser checks / 105 unit tests** above. The pinned backend auth handler and payment constants were independently inspected with `gh` at `2af3f1e15c98c893a89255a037f551046883b8c0`; no upstream frontend implementation was consulted/copied. See `docs/api-contracts.md` for source links and exact wire fields.

Final results after all production source fixes:

- **Full static preview matrix: 144/144 checks passed, 67 screenshots.** Zero failures, runtime errors, unexpected console errors, failed requests, HTTP failures or unknown fixture endpoints. Source digest agrees at start/end: `304df4cee54c4b4e81817ef01926202dfbc2048ab0190825fccb0e679271a685`. Includes all responsive/theme routes, send-code captcha proof/countdown/reset, registration code flow, invalid code/registration gates, actual `order_created` URL/QR handling, unsupported OAuth/JSAPI without false payment, expired/cancelled/unknown results, and pending-order refresh/status/cancel recovery. Browser reports remain under `artifacts/cshell-web/acceptance/`.
- **Frontend: 17 files / 110 tests passed**, zero-warning ESLint, typecheck and ordinary production build passed. Added tests prove Turnstile login proof and one-time reset using a stub API, send-code proof/countdown, unsupported captcha fail-closed, actual optional create fields, and resolve normalization without `paid`. Existing test-local locale stubs still produce non-fatal `keys.subtitle`/`keys.ipCountLabel` warnings; browser console error count is zero.
- **Fixture: 5/5 Node tests passed.** Exact auth proof/message/countdown and code registration are checked; calling the nonexistent standalone verification endpoint is deliberately rejected by the fixture's unknown-endpoint 501. Its diagnostic log is intentional in this negative unit test, not a browser failure. Verify has `paid`, resolve does not. Scenario controls are fixture-only; production order payload has no `mock_result`.
- **Production Rust browser runner: 4/4 checks, 3 screenshots, zero errors**, rerun against the final `web/dist` build and corrected fixture. Ordinary `/_cshell/` asset base, root history/reload, local brand assets, forwarded APIs and captcha-protected mock login passed. **Rust tests: 10/10**, binary build passed. Protocol proxy smoke passed **16 groups**, strictly loopback mocks.
- Release artifacts regenerated with `node scripts/release-licenses.mjs npm`, `node scripts/release-artifacts.mjs package`, then `check`: **81 files / 60 npm dependencies / 31 distinct notice texts / zero unresolved**. No release script was edited. Final `git diff --check` and runner syntax checks passed.

The first correction matrix exposed completed-order recovery hiding recharge controls; recovery now refreshes in place and permits explicit start-new for terminal orders. Subsequent diagnostic runs caught a duplicated browser payment-link click and a DOM-settling assertion race; both driver issues were corrected without weakening error gates, followed by the entire 144-check passing matrix. Earlier failed runs are not counted as final acceptance.

Behavior and safety boundaries:

- Real settings use `turnstile_enabled`; login/send-code use `turnstile_token`. Registration consumes `verify_code` and does not reuse send-code's one-time proof. Mock captcha requires the explicit local provider marker; unsupported enabled providers fail closed. Requests reset captcha and email resend honors backend countdown.
- `/email-verify` clearly links back to registration and code entry; it never calls a fabricated standalone API. Passwords are held only by the registration component, never stored or put in URLs.
- `order_created` uses actual `pay_amount`/URL/QR fields. Validated HTTP(S) payment links require an explicit click. `oauth_required` and `jsapi_ready` visibly explain unsupported checkout; no OAuth, JSAPI or payment is performed. Resolve uses actual status without demanding `paid`; refund statuses do not render a generic Paid result, and RECHARGING stays pending.
- Pending checkout survives refresh using per-tab session storage containing **only owner user id + numeric order id**. Authenticated order detail restores status/amount/expiry; cancellation and new-order controls remain available. No password, resume token, QR, payment URL or provider/client secret is persisted. Provider launch details are intentionally unavailable after refresh; recovery is status/cancel, not fabricated provider resumption.

Preview remains healthy at `http://127.0.0.1:4284/` in static mode with fixture on `127.0.0.1:41949`; historical ports are untouched. Production runner ephemeral services were cleaned up. No real email, Cloudflare verification, upstream registration, provider transaction, OAuth/JSAPI ceremony, database, credentials or real pinned-upstream deployment was exercised. These are source-derived contracts plus deterministic local verification, not live-provider acceptance. No commit, plan, push or release-script change was made.


## Portal theme, locale and menu regression closure — 2026-11-24

The approved portal/theme and locale follow-up is verified against the independent static preview (local mock only).

- Full browser acceptance: **157/157 checks passed**, **68 screenshots**, zero failures, runtime errors, unexpected console errors, failed requests, or HTTP failures. Source digest matched start/end: `ae0465d98458cb1981fbaef1f11e4428a436f793bd08f3dd3ff7e71cf4d4226e`. Four intentionally expected HTTP responses were recorded by the unchanged exact failure-suppression rules.
- Coverage now clicks public home theme and locale controls, checks teleported Select colors, translated labels, storage and reload preference; checks locale option mousedown/click within the account menu, two-stage Escape/focus restore, and route preference persistence. Public auth routes and workspace route/theme matrix remain included.
- Account-menu preference controls were aligned after a visual follow-up: theme and locale controls now share full width, height, radius, surface, border and hover treatment. The strict browser check compares their computed geometry and palette in the full matrix; final rerun remains **157/157 passed**.
- Frontend gates: **17 files / 112 tests passed**, with `lint:check`, `typecheck`, and `build` passing. The pre-existing test-local missing translation warnings remain non-fatal.
- Preview restarted in owned static mode at `http://127.0.0.1:4284/`. Evidence and screenshots are in `artifacts/cshell-web/acceptance/results.json` and `artifacts/cshell-web/acceptance/`.

No commit or push was made. The plan was not edited.


## Unified account dropdown rows — 2026-11-24

Account-only styling now gives Profile, Back to home, Log out, theme and locale identical left-aligned, 400-weight, 44px-minimum rows with matching width, horizontal padding and radius. Idle rows are transparent and borderless; hover and focus-visible use the existing warm accent-soft color. The secondary email stays smaller and muted; the menu width is bounded to the viewport. Homepage/sidebar controls, theme accessible name, available locale choices, portal ownership and two-stage Escape behavior are unchanged.

Validation for this narrow follow-up:

- Frontend `lint:check`, `typecheck`, all **17 files / 112 tests**, and ordinary production `build` passed. Existing test-local missing translation warnings remain non-fatal. Fixture **5/5** and Rust **10/10** tests passed; `git diff --check` and browser runner syntax passed.
- Actual Rust production-browser runner: **4/4 checks**, **3 screenshots**, zero errors.
- Final full strict static-preview matrix finished at `2026-11-24T06:03:30.669Z`: **155/157 checks passed**, **69 screenshots**. **All 12 account-menu viewport/theme combinations passed**, including every row's left alignment, normal font weight, matching height/width/left edge/padding/radius, transparent idle surface, border absence, warm text/panel palette, hover/focus-visible colors, theme toggling, locale selection, portal ownership and Escape hierarchy. Public home controls also passed.
- **The full matrix is not green:** two purchase/billing checks failed after Chrome reported `net::ERR_NETWORK_CHANGED` while loading local purchase assets. Final report records **2 runtime errors, 15 console errors, 13 failed requests, 0 HTTP failures**. Earlier attempts also encountered Chrome network suspension/change errors and are not counted as acceptance. No network/runtime/error gate was weakened or suppressed. No adjacent purchase changes were made.
- Source SHA-256 matched start/end: `f41b8a4addff91c8b964b9285210cd692748bbf3c92bb2e21af8425cd4ea09a0`. Final evidence: `artifacts/cshell-web/acceptance/results.json`. Account screenshots: `artifacts/cshell-web/acceptance/account-menu-light.png` and `account-menu-dark.png`.

Owned preview was stopped/restarted with `CSHELL_WEB_STATIC=1`, rebuilt, and left healthy at `http://127.0.0.1:4284/` (local mock fixture only). Earlier uncommitted work was preserved. No commit, push, plan edits, added translations or backend changes were made. The remaining verification limitation is a clean full-browser run in an environment without Chrome network-change interruptions; local mock checks do not establish real upstream/provider behavior.

## Full frontend typography/layout alignment — 2026-11-24

Shared semantic typography, spacing and control-height tokens now drive portal/auth/workspace layouts while retaining the warm palette and page-width variants. Workspace table numerics use tabular figures/right alignment; identifiers selectively wrap. Auth fields/primary actions use an explicit spacious desktop variant and preserve mobile touch targets. Dialog bodies scroll inside bounded visual-viewport panels; Select popups flip/clamp and reposition on scroll/resize. These are scoped Cshell UI changes; no admin views or business API behavior changed.

Final verification after release-license bundling:
- `pnpm --dir web build`, `lint:check`, `typecheck`, and `test:run`: passed (**17 files / 112 tests**).
- Release inventories regenerated: **60 npm packages / 31 notice texts**, **133 Rust packages / 108 notice texts**, zero unresolved; production package gate passed (**82 files**).
- Full strict browser matrix: **157/157 passed**, **70 screenshots**, zero failures, runtime/console/request/HTTP errors, with matching source digests. Covers English/Chinese, light/dark, desktop/tablet/mobile plus 320px, short landscape and breakpoints, geometry/alignment, dialogs, and viewport-contained menus.
- `git diff --check`: passed. Preview remains healthy at `http://127.0.0.1:4284/` (static local mock only).

Earlier intermediate browser/build attempts had failures during implementation, including a transient CSS brace syntax error and Chrome network-change noise; these were corrected. The final complete build and strict matrix above supersede those intermediate runs. No real provider/payment transaction is implied.

## Warm AI workspace section layout — 2026-11-24

Added one shared horizontal secondary navigation for Dashboard, Usage, API Keys, Purchase and Subscriptions, gated by the existing public settings. The vertical workspace sidebar and URLs remain unchanged; Orders and Profile remain in their existing account entry points. Dashboard and Usage now share the same presentational `HeatmapGrid`, while data loading, applied date filters, timezone and aggregation remain owned by their respective views. Keys, Purchase and Subscriptions retain their existing API/payment validation and use the same centered panel/content rail.

Final verification:
- Frontend `lint:check`, `typecheck`, `test:run` (**18 files / 114 tests**) and production build passed.
- Full strict static browser matrix: **169/169 checks passed**, **70 screenshots**, zero failures/runtime/console/request/HTTP errors; source digest matched start/end.
- Matrix includes section navigation active state/settings gate and viewport containment, existing business flows, language/theme variants and mobile widths.
- `git diff --check` passed. Preview rebuilt and healthy at `http://127.0.0.1:4284/` using explicit local fixture only.

Real Sub2API/payment-provider execution remains outside this UI/mock acceptance. No commit or push was made.


## Dual-version Sub2API CI gate — 2026-11-24

Implemented (local verification scope):
- `scripts/sub2api-ci-upstream.mjs` + `sub2api-ci-upstream.test.mjs`: baseline-source / latest-image harness (resolve|up|configure|down|manifest), digest-pinned latest image, isolated bridge network with postgres:16 + redis:7, bounded build memory for the upstream frontend OOM, central secret redaction. `node --test`: **4/4 passed**, including a real `podman manifest inspect` digest resolution for `weishaw/sub2api:latest` (linux/amd64).
- `scripts/sub2api-integration.mjs`: extended strict real-proxy checks (unauth rejection, login envelope, profile identity, refresh, admin denial, key lifecycle incl. invalid quota, usage empty state, subscriptions/payment read-only endpoints, unknown-order rejection, logout). Syntax checked.
- `scripts/sub2api-browser.mjs`: production web/dist browser suite against the real backend with strict error accounting and scrubbed artifacts. Syntax checked.
- `.github/workflows/ci.yml`: dual matrix jobs (API + browser), binary/dist artifact reuse, daily schedule + workflow_dispatch, aggregate `ci-required` gate failing on any non-success dependency. Structural validation passed (no tabs, all jobs present, no continue-on-error).

NOT executed locally: full container `up`/`configure` run (no Docker CLI on this host; Podman differs in the exact docker-CLI surface the harness uses) and therefore no local end-to-end API/browser run against a live upstream. Remote CI run for this change is also pending until it is pushed. These remain honestly unexecuted rather than claimed.


## Real-backend browser gate vs the local mock matrix — 2026-11-24

`scripts/sub2api-browser.mjs` is a separate, stricter gate from the local mock acceptance suite. They answer different questions and neither replaces the other.

| | Local mock matrix (`scripts/cshell-web-browser.mjs`) | Real-backend browser gate (`scripts/sub2api-browser.mjs`) |
|---|---|---|
| Backend | Deterministic loopback fixture | Deployed Sub2API behind Cshell, reached only through the proxy |
| Responses | Mocked by design; contract shapes are asserted in the fixture | Real; any business-response interception or fixture is an error |
| Frontend | `web/` dev/preview or production `web/dist` | Downloaded production `web/dist` only |
| Breadth | Broad UI/theme/locale/geometry/short-viewport matrix, admin and guest exclusions, payment result scenarios | Narrow and deep: guest home, real sign-in, stats/trend, heatmap scales, key lifecycle, profile round-trip, logout, admin redirect, billing-disabled pages |
| Negative responses | Declared per page with exact method/path/status/count | Same discipline, but only one declared negative (a rejected login) because real state cannot be scripted |
| Purpose | Prove the UI contract is self-consistent | Prove the production bundle actually works against a real gateway |

Coverage of the real-backend gate (Playwright from `web/package.json`, Chromium, loopback-only base or it fails closed):

- **Production serving:** `/` returns SPA HTML, every referenced `/_cshell/` asset returns 200, `/dashboard` and `/login` deep links serve the shell, and `/api/v1/settings/public` forwards through Cshell as a valid envelope. All of this runs before Chromium launches, so a broken proxy fails fast.
- **Guest:** home renders the public SPA with the `/_cshell/`-prefixed bundle and no authenticated shell; one deliberately rejected login declares its exact status and then retires the exemption.
- **Desktop light user flow:** real sign-in lands on `/dashboard`; stats/trend render without an error alert (zero usage is acceptable); all three dashboard and all four usage heatmap scales re-query and settle into either a grid or the explicit empty state; key create → appears → edit → rename persists → delete → gone; profile username update persists and is reverted; logout clears storage and a protected route redirects to `/login`.
- **Desktop dark and mobile light:** same account, no destructive key operations. Theme and locale switch, persist across reloads, section/drawer navigation is reachable, every route is checked for `scrollWidth <= innerWidth + 1`, and no runtime errors are tolerated.
- **Admin:** signs in with the admin credentials, must reach the upstream `/admin` surface, and must not receive the `.cshell-user-workspace` shell. The upstream admin UI is deliberately not crawled; its own console/network noise is recorded out of band instead of being normalised away.
- **Billing:** when payments are disabled the purchase/orders routes redirect away; when enabled they must render with no runtime errors and never expose a paid order chip, a pending payment panel, or a `/payment/result` navigation.
- **Strict accounting:** `pageerror`, console errors, `requestfailed` and HTTP >= 400 all fail the run. The only tolerated noise is a same-origin `net::ERR_ABORTED` GET on `/api/v1/usage*`, which the SPA produces when it cancels a stale trend/log fetch during a filter or scale change. Expected negatives require an exact method/path/status/count declared before the response and are removed afterwards.
- **Evidence:** screenshots plus `results.json` and `summary.md` under `artifacts/sub2api-browser/` (override with `SUB2API_BROWSER_ARTIFACTS`). Passwords, access/refresh tokens, `Authorization` headers and token query parameters are redacted from every log, URL and report field; session storage is reported only as booleans, and the one-time API key secret panel is never screenshotted. Playwright traces are intentionally not enabled so a token-bearing trace cannot be uploaded by accident.
- **Fail closed:** an unreachable Cshell, a non-ready upstream, missing credentials, an enabled interactive captcha, or a non-loopback `CSHELL_BASE_URL` is a hard failure. The gate never skips and never downgrades to a skip.

Run it with:

```sh
CSHELL_BASE_URL=http://127.0.0.1:18080 \
SUB2API_TEST_EMAIL=... SUB2API_TEST_PASSWORD=... \
SUB2API_ADMIN_EMAIL=... SUB2API_ADMIN_PASSWORD=... \
SUB2API_UPSTREAM_ID=<commit-or-image-digest> \
  node scripts/sub2api-browser.mjs
```

Execution status: **not executed locally against a real Sub2API.** No Cshell instance plus real upstream was reachable at `CSHELL_BASE_URL` in this workspace, and starting external containers was out of scope for this change. What was verified locally is `node --check`, plus the gate's own control flow exercised against a throwaway in-process stand-in serving the real `web/dist`: all 15 checks passed with zero runtime/console/request/HTTP errors, and separately confirmed the gate exits non-zero for a broken `/_cshell/` asset, an unexpected HTTP 500, an undeclared 401, a declared negative that never occurs, an injected `pageerror`, and an injected horizontal overflow. Those stand-in runs are script self-tests, not evidence about a real backend, and no artifacts from them are claimed as acceptance. The real-backend result remains pending a CI run in an environment with a live Sub2API.

## Workspace-layout respace (dashboard + panel rhythm) — 2026-11-24

Implemented per plan `工作空间页借鉴布局` on branch `cursor/independent-web-frontend` (uncommitted; not pushed). No business logic, endpoints, or data semantics changed; warm palette and existing tokens preserved.

- `web/src/styles/theme.css`: added `--cshell-panel-padding-lg: 1.75rem`, `--cshell-radius-panel-lg: 20px`, `--cshell-type-page-lg: 2.25rem` (+ leading). All values derive from the existing warm scale; no new colors.
- `web/src/views/DashboardView.vue`: title row is now one flex row — large H1 (`pages.dashboard`) left, `dashboard.welcome` + `dashboard.refresh` button right (subtitle stays visible beneath the H1). Main column keeps exactly the usage / heatmap-trend / totals panels, now on the lg padding + radius tokens. Removed the standalone quick-links section; `dashboard.linkUsage` / `linkPurchase` / `quickLinks` keys were deleted only after grepping confirmed no other consumer. The rail now holds: balance card (large value, `余额明细` → /profile, `充值` → /purchase only when `settings.paymentEnabled`), the existing subscription card (still gated on `subscriptionEnabled`), a pending card (pending PENDING orders via the existing `fetchMyOrders`, keys expiring within 7 days via the existing `fetchKeys`, both filtered client-side, rows link to /orders and /keys, `—` when a request fails, `暂无` when both are zero), and a help card linking only to /profile and the dashboard itself. Empty usage states show centered muted copy (`dashboard.emptyState`) — text only, no fabricated numbers.
- `web/src/views/UsageView.vue` / `KeysView.vue` / `SubscriptionsView.vue`: title rows unified to "title left + existing action right" (Usage moved its Apply button into the header row; Keys wrapped its existing create button; Subscriptions had no action to add); main panels switched to the lg tokens. No API or behavior changes.
- `web/tests/dashboard-view.spec.ts`: rewritten around URL-routed fetch stubs matching the real api modules' signatures — covers the one-row title/welcome/refresh, refresh refetching stats, the pending card's real counts (orders from `total`, keys client-filtered to a 7-day window), the pending empty copy, the `—` fallback when pending requests fail, and the balance card's recharge link gating on `paymentEnabled`. The original stats smoke assertions are kept verbatim.

Verification (all executed locally):

| Gate | Result |
|---|---|
| `pnpm --dir web lint:check` | pass (0 warnings, `--max-warnings 0`) |
| `pnpm --dir web typecheck` | pass |
| `pnpm --dir web test:run` | 18 files / **126 tests passed** (was 119; +7 new dashboard assertions, 0 regressions) |
| `pnpm --dir web build` | pass (vite production build) |
| `git diff --check` | clean |
| Static preview | `CSHELL_WEB_STATIC=1 node scripts/cshell-web-preview.mjs stop && start && status` → healthy at `http://127.0.0.1:4284` (static build scope) |
| Strict browser matrix | `WORKSPACE_CHROME=/opt/google/chrome/chrome node scripts/cshell-web-browser.mjs` → **169 checks passed, 0 failures, 0 runtime errors, 0 console errors, 0 request failures, 0 HTTP failures**. No existing assertions needed weakening; the dashboard layout change required no browser-matrix assertion updates (its dashboard gates are nav/overflow/theme based) |

The stage-one uncommitted fixes in the tree (dialogContext scroll lock, `HeatmapGrid` compact prop, `keys.subtitle` / `ipCountLabel` i18n keys, AppShell, dialog-escape and heatmap-grid test additions) are preserved untouched and are covered by the green run above.

## Usage heatmap compaction + line-chart view toggle — 2026-11-24

User feedback on the usage area: the month/year heatmap took too much vertical space, and the same data was only visible as a heatmap. Both addressed on branch `cursor/independent-web-frontend` (uncommitted; not pushed). No API, fetch, aggregation, or draft/applied date semantics changed — the chart derives its series from the same loaded `TrendPoint[]`.

- `web/src/components/user/HeatmapGrid.vue`: compacted footprint — day-cell `min-height` 1rem→0.75rem (12px ≥ the 10px clickability floor), grid gaps .35rem→.25rem, month-label margins tightened with `line-height:1`, and multi-year `.cell--month` `min-height` 2.5rem→1.75rem (padding .35rem→.2rem). Legend, zero/missing/outside distinctions, and the `compact` prop all preserved. A full year view's day grid now measures ~150px tall in the browser (was ~208px).
- `web/src/utils/trendChart.ts` (new): `buildTrendSeries(points, metric)` — sorts day/hour buckets, derives per-slot values via the existing `metricValue`, and marks `contiguous: false` where the previous calendar slot has no point. Missing days stay absent (gaps); explicit zeros stay zero. No new endpoints.
- `web/src/components/user/TrendLineChart.vue` (new): dependency-free SVG line chart (no chart.js). Props `series`/`metric`/`translate`/`compact`; viewBox-based responsive width, fixed 180px min height (140px compact for the dashboard), area fill `--cshell-accent-soft`, line `--cshell-accent`, subtle gridlines `--cshell-border`, muted start/end-date + max-value captions, `role="img"` with an aria-label summarizing range/metric/total, and the dashboard empty-state style when there is nothing to plot.
- `web/src/components/user/UsageTrendChart.vue` (new): thin wrapper that renders `TrendLineChart` in place of `HeatmapGrid` for the same section when line mode is on; heatmap props stay untouched and the same scale/metric/date controls apply. For the `hour` scale the x axis is hours of the day (`HH:MM` captions).
- `web/src/views/UsageView.vue` + `web/src/views/DashboardView.vue`: added a segmented heatmap|line toggle (aria-pressed, styled like the scale group) in both trend panels; the metric switch re-derives the series with zero additional requests (asserted in the browser gate). Dashboard passes `compact` for a shorter chart.
- `web/src/i18n/locales/en.ts` / `zh.ts`: added `usage.viewLabel` / `usage.viewHeatmap` / `usage.viewLine`, `usage.lineChartSummary`, `usage.lineChartEmpty`.
- `web/src/lib/viewPreference.ts` (new): localStorage-backed persistence of the heatmap|line choice per surface (`cshell_usage_view` / `cshell_dash_view`), ignoring unavailable or unrecognized storage.
- `scripts/cshell-web-browser.mjs`: new strict check — default is heatmap, toggling to line renders an `svg[role="img"]` with a populated aria-label, ≥180px tall, stroke matching the theme `--cshell-accent` in light and dark (theme switched via the account menu), metric switch to Tokens changes the max caption without any new trend request, and toggling back restores the heatmap grid. Added `accent` to the script's palette probe data. No overflow/error gates weakened.

Tests: `web/tests/trend-line-chart.spec.ts` (new, 8 tests — plotted-point count, gap handling without fabricated zeros, explicit zero plotted as zero, metric re-derivation, empty state, aria-label, hour-bucket captions, all-zero baseline rendering) and `web/tests/heatmap-grid.spec.ts` (+1 compaction test asserting the new min-heights/gaps, ≥10px cells, legend presence, and cell-count semantics).

Verification (all executed locally):

| Gate | Result |
|---|---|
| `pnpm --dir web lint:check` | pass (0 warnings, `--max-warnings 0`) |
| `pnpm --dir web typecheck` | pass |
| `pnpm --dir web test:run` | 19 files / **135 tests passed** (was 126; +9) |
| `pnpm --dir web build` | pass (vite production build; chart is a small shared chunk, no chart library added) |
| Static preview | `CSHELL_WEB_STATIC=1 node scripts/cshell-web-preview.mjs stop && start && status` → healthy at `http://127.0.0.1:4284` (static build scope) |
| Strict browser matrix | `WORKSPACE_CHROME=/opt/google/chrome/chrome node scripts/cshell-web-browser.mjs` → **170 checks passed, 0 failures, 0 runtime errors, 0 console errors, 0 request failures, 0 HTTP failures** |

Evidence: `artifacts/cshell-web/acceptance/usage-line-light.png`, `usage-line-dark.png` (usage page in line mode, both themes) and `usage-heatmap-compact-year.png` (compacted year-scale heatmap).
