# Cshell validation

## Loopback smoke test

After building Cshell and the pinned frontend, run:

```sh
/home/donz/.cargo/bin/cargo build --bin cshell
node scripts/proxy-smoke.mjs --binary target/debug/cshell --static-dir frontend/dist
```

The script starts a local Node HTTP fixture and the real Cshell binary on ephemeral loopback ports. It exercises health, same-origin SPA and static-resource delivery, auth register/login/refresh/logout/me, authenticated order creation, public order verification and resume-token resolution, and EasyPay GET and POST plus Alipay and Stripe POST callback forwarding. Mocked responses assert the upstream request method, path and query, raw body, representative headers, status, response body and repeated `Set-Cookie` headers. The fixture accepts no external destinations and makes no real provider requests. Values used as tokens and orders are dummy test data.

These are protocol and reverse-proxy checks. The mock's callback acknowledgements do not establish payment, validate signatures, contact providers, or prove that the real Rust backend accepts a callback or transitions an order. The fixture does not exercise frontend browser behavior or frontend API-store state.

## Not covered here

No real database or deployed Sub2API backend was used. OAuth redirects/provider credentials, Passkey/WebAuthn ceremonies, browser interaction, real authentication, real payment checkout/provider success, and provider signature verification are not exercised. Other payment callback providers and callback error cases are not claimed as validated by this smoke test. WebSocket and streaming checks are separate backend tests, not covered here.
