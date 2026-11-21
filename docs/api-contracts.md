# Core API contracts for independent Cshell UI

Wire shapes derived from Cshell proxy smoke fixtures, Sub2API integration checks, and documented envelope conventions. Baseline upstream: Sub2API commit `2af3f1e15c98c893a89255a037f551046883b8c0`. Paths are relative to same-origin `/api/v1`.

## Envelope

Success: `{ "code": 0, "message": string, "data": T }`  
Client uses `data`. Non-zero `code` or HTTP 4xx/5xx are errors. Unauthenticated protected routes return 401/403.

## Auth storage (browser)

`localStorage`: `auth_token`, `refresh_token`, `auth_user`, `token_expires_at`  
Requests: `Authorization: Bearer <access_token>`, `Accept: application/json`.

## Auth and session

| Method | Path | Body / notes | `data` |
|--------|------|--------------|--------|
| POST | `/auth/login` | `email`, `password` | `access_token`, `refresh_token`, `expires_in`, `user` |
| POST | `/auth/register` | `email`, `password`, optional username / verify fields | same auth payload |
| POST | `/auth/refresh` | `{ refresh_token }` | new tokens |
| POST | `/auth/logout` | optional `{ refresh_token }` | message |
| GET | `/auth/me` | Bearer | `User` |
| GET | `/settings/public` | public | site flags (`registration_enabled`, `payment_enabled`, `subscription_enabled`, `billing_currency`, …) |

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
| POST | `/payment/public/orders/verify` | `{ out_trade_no }` (public) |
| POST | `/payment/public/orders/resolve` | `{ resume_token }` (public) |

Independent local mocks intentionally reject real checkout POSTs. Production payment providers remain separately verified.

## Pagination

Query: `page`, `page_size`. Response: `items`, `total`, `page`, `page_size`, `pages`. Some builds may expose alternate collection keys; normalize after unwrap.

## Proxy boundary

Cshell serves the independent SPA for allowlisted user document routes and `/_cshell/*` assets. All `/api/v1/*`, `/admin/*`, `/setup/*`, `/v1/*`, and webhooks are reverse-proxied to Sub2API unchanged.
