# Core API contracts for independent Cshell UI

Wire evidence is classified below: pinned backend source inspection, existing integration coverage, and isolated unit tests are distinct evidence classes. Baseline upstream: Sub2API commit `2af3f1e15c98c893a89255a037f551046883b8c0`. Paths are relative to same-origin `/api/v1`.

## Envelope

Success: `{ "code": 0, "message": string, "data": T }`  
Client uses `data`. Non-zero `code` or HTTP 4xx/5xx are errors. Unauthenticated protected routes return 401/403.

## Auth storage (browser)

`localStorage`: `auth_token`, `refresh_token`, `auth_user`, `token_expires_at`  
Requests: `Authorization: Bearer <access_token>`, `Accept: application/json`.

## Evidence status

On 2026-11-24, independently inspected the pinned **backend only** through `gh api repos/Wei-Shaw/sub2api/contents/backend/...?...ref=2af3f1e15c98c893a89255a037f551046883b8c0`. No upstream frontend implementation was consulted or copied for contracts. No matching local backend checkout was found in the bounded search. Source inspection proves declared handler types, route registrations and response construction, not a successful live email/captcha/payment-provider transaction. Existing real-upstream integration remains limited to login/profile/keys; mocks prove local behavior only.

Pinned evidence (all links use the exact baseline):
- [Auth handler](https://github.com/Wei-Shaw/sub2api/blob/2af3f1e15c98c893a89255a037f551046883b8c0/backend/internal/handler/auth_handler.go): `RegisterRequest`, `SendVerifyCodeRequest/Response`, `LoginRequest`, `Register`, `SendVerifyCode`, `AuthResponse`.
- [Auth routes](https://github.com/Wei-Shaw/sub2api/blob/2af3f1e15c98c893a89255a037f551046883b8c0/backend/internal/server/routes/auth.go): send/register/login registered; **no standalone `/auth/verify-email` route**.
- [Public settings DTO](https://github.com/Wei-Shaw/sub2api/blob/2af3f1e15c98c893a89255a037f551046883b8c0/backend/internal/handler/dto/settings.go): `PublicSettings` JSON tags.
- [Payment handler](https://github.com/Wei-Shaw/sub2api/blob/2af3f1e15c98c893a89255a037f551046883b8c0/backend/internal/handler/payment_handler.go): create payload, anonymous verify/resolve request and distinct response structs, `publicOrderStatusPaid`.
- [Payment service types](https://github.com/Wei-Shaw/sub2api/blob/2af3f1e15c98c893a89255a037f551046883b8c0/backend/internal/service/payment_service.go), [order construction](https://github.com/Wei-Shaw/sub2api/blob/2af3f1e15c98c893a89255a037f551046883b8c0/backend/internal/service/payment_order.go), and [payment constants](https://github.com/Wei-Shaw/sub2api/blob/2af3f1e15c98c893a89255a037f551046883b8c0/backend/internal/payment/types.go).

## Auth and session

| Method | Path | Body / notes | `data` |
|--------|------|--------------|--------|
| POST | `/auth/login` | `email`, `password`, optional `turnstile_token` / Tencent captcha proof | `access_token`, `refresh_token`, `expires_in`, `user` |
| POST | `/auth/register` | required `email` (email syntax), `password` (min 6); optional `verify_code`, `turnstile_token`, `tencent_captcha_ticket`, `tencent_captcha_randstr`, `invitation_code`, `promo_code`, `aff_code` | same auth payload |
| POST | `/auth/send-verify-code` | `{ email, turnstile_token?, tencent_captcha_ticket?, tencent_captcha_randstr? }` | `{ message: string, countdown: number }` |
| — | `/auth/verify-email` | **Not registered in pinned backend; mock-only assumption** | Register submits `verify_code` instead |
| POST | `/auth/refresh` | `{ refresh_token }` | new tokens |
| POST | `/auth/logout` | optional `{ refresh_token }` | message |
| GET | `/auth/me` | Bearer | `User` |
| GET | `/settings/public` | public | site flags (`registration_enabled`, `payment_enabled`, `subscription_enabled`, `billing_currency`, …) |

`captcha_provider` (`"turnstile"` \| `"mock"`) is a Cshell-side marker used only by the isolated captcha unit test; it is not a claimed upstream field. Pinned upstream uses **`turnstile_enabled` and `turnstile_site_key`**, plus `tencent_captcha_enabled`/`tencent_captcha_app_id` and `aliyun_captcha_enabled`/scene/prefix/region; **`captcha_enabled` is not a proven pinned public setting**. Unsupported enabled providers must not silently bypass verification. Login and send-verify-code verify captcha; registration invokes `VerifyCaptchaForRegister` with `verify_code` to avoid reusing a one-time ticket in email-verification scenarios. The SPA treats registration and billing flags as fail-closed: they only enable after a successful `/settings/public` fetch and an explicit `true`.

## Profile

| Method | Path | Notes |
|--------|------|-------|
| GET | `/user/profile` | `User` (id, username, email, role, balance, status, …) |
| PUT | `/user` | profile update → `User` |
| PUT | `/user/password` | `{ old_password, new_password }` |

Admin role: if `user.role === 'admin'`, the independent UI redirects to upstream `/admin` rather than the user workspace.

## Dashboard and usage

| Method | Path | Query | `data` |
|--------|------|-------|--------|
| GET | `/usage/dashboard/stats` | | totals / today / rpm / tpm / active keys |
| GET | `/usage/dashboard/trend` | `start_date`, `end_date`, `granularity`=`day`\|`hour`, `timezone` | `{ trend[], start_date, end_date, granularity }` |
| GET | `/usage/dashboard/snapshot-v2` | same + include flags | combined snapshot |
| GET | `/usage` | pagination + filters | paginated logs |

Trend point fields used by heatmap: `date`, `requests`, token fields, `cost`, `actual_cost`. Missing calendar days are absent from `trend` (not zero). Hourly `date` may be `YYYY-MM-DD HH:00:00`.

## API keys

| Method | Path | Notes |
|--------|------|-------|
| GET | `/keys` | `page`, `page_size`, filters → `{ items, total, page, page_size, pages }` |
| POST | `/keys` | `name`, optional `group_id`, quota / IP fields |
| PUT | `/keys/{id}` | partial update |
| DELETE | `/keys/{id}` | |
| GET | `/groups/available` | groups for key creation |

## Subscriptions and billing

| Method | Path | Notes |
|--------|------|-------|
| GET | `/subscriptions`, `/subscriptions/active`, `/subscriptions/summary` | lists / summary |
| GET | `/payment/config`, `/payment/checkout-info`, `/payment/plans`, `/payment/limits` | checkout metadata |
| GET | `/payment/orders/my` | paginated orders |
| POST | `/payment/orders` | create order (`amount`, `payment_type`, `order_type`, optional `plan_id`, `return_url`) |
| POST | `/payment/public/orders/verify` | `{ out_trade_no }` (public) → status/paid |
| POST | `/payment/public/orders/resolve` | `{ resume_token }` (public) → status (no `paid` field) |
| POST | `/payment/orders/{id}/cancel` | user-initiated cancellation |
| GET | `/payment/orders/{id}` | single order detail |

### Independently proven payment wire details

Create request fields are `amount`, required `payment_type`, optional `openid`, `wechat_resume_token`, `return_url`, `payment_source`, `order_type`, `plan_id`, `is_mobile`. No `mock_result` field exists in pinned handler. Result types are **`order_created`, `oauth_required`, `jsapi_ready`**, not mock names `redirect`/`qr`/`query`. A normal order may provide a pay URL or QR data under `order_created`.

`CreateOrderResponse` always serializes `order_id`, `amount`, **`pay_amount`**, `fee_rate`, `bonus_amount`, `status`, `payment_type`, `expires_at`; `result_type`, `out_trade_no`, `pay_url`, `qr_code`, `client_secret`, `intent_id`, `currency`, `country_code`, `payment_env`, `oauth`, `jsapi`, `jsapi_payload`, `payment_mode`, `resume_token`, `alipay_mobile_precreate_deep_link` are `omitempty`. Do not require `resume_token`, `out_trade_no` or `order_type` in every create result. `payable_amount` is not the declared amount key.

Public verify (`out_trade_no`) returns minimal `out_trade_no`, `status`, **`paid`**, `created_at`, `expires_at`, optional `paid_at`/`completed_at`. Public resolve (`resume_token`) returns richer `id`, `out_trade_no`, `amount`, `pay_amount`, `fee_rate`, `bonus_amount`, `currency`, `payment_type`, `order_type`, `status`, creation/expiry/payment/completion timestamps and refund/plan fields; **it does not serialize `paid`**. Treat these as different types. The handler considers PAID, COMPLETED and refund-related statuses paid; it does not list RECHARGING in that helper.

### UI corrections after pinned source inspection

The independent UI now uses `turnstile_enabled`, sends `turnstile_token` on login and send-code, and consumes `{ message, countdown }`. Registration submits `verify_code`, never `username`/`captcha_token`; when email verification is enabled it does not reuse the ticket consumed by send-code, matching `VerifyCaptchaForRegister`. One-time widgets reset after requests; unsupported enabled captcha providers fail closed. `/email-verify` is a clear explanation/link to registration code entry, not a fabricated API client. Passwords remain only in component memory.

Checkout accepts `order_created` URL/QR fields with `pay_amount`; URLs are validated and opened only on an explicit click. `oauth_required`/`jsapi_ready` are visibly unsupported and do not invoke OAuth, JSAPI, or claim payment. Verify and resolve have distinct types; resolve is normalized from status without requiring `paid`. Pending checkout recovery stores only the owner user id and numeric order id in per-tab session storage; authenticated order detail rehydrates status after refresh. It stores no password, resume token, provider URL, QR payload or client secret. Recovered checkout cannot resume a provider link unless the backend supplies a new supported flow; refresh/status/cancel remain available.

Auth request structs and payment constants were independently rechecked through `gh` at the pinned commit during correction. Captcha/email/provider end-to-end behavior remains **UNVERIFIED** on a real deployment. Isolated component unit tests and a stubbed Turnstile API test prove local request/lifecycle behavior only. No external payment or email was performed.

The Rust proxy protocol harness intentionally rejects unexpected checkout POSTs. Production payment providers remain separately verified.

## Pagination

Query: `page`, `page_size`. Response: `items`, `total`, `page`, `page_size`, `pages`. Some builds may expose alternate collection keys; normalize after unwrap.

## Proxy boundary

Cshell serves the independent SPA for allowlisted user document routes and `/_cshell/*` assets. All `/api/v1/*`, `/admin/*`, `/setup/*`, `/v1/*`, and webhooks are reverse-proxied to Sub2API unchanged.
