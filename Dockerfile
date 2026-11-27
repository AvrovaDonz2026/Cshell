FROM node:24-bookworm-slim AS web-builder
WORKDIR /build/web
# Match web/package.json packageManager and CI toolchain.
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
COPY scripts/release-*.mjs /build/scripts/
COPY LICENSE THIRD_PARTY_NOTICES.md /build/
COPY docs/licenses/ /build/docs/licenses/
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm run build \
    && node /build/scripts/release-licenses.mjs npm \
    && node /build/scripts/release-artifacts.mjs package \
    && node /build/scripts/release-artifacts.mjs check

FROM rust:1.93-bookworm AS rust-builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src/ ./src/
COPY scripts/release-licenses.mjs ./scripts/
COPY --from=web-builder /usr/local/bin/node /usr/local/bin/node
RUN cargo fetch --locked \
    && cargo build --release --locked --bin cshell \
    && node scripts/release-licenses.mjs rust /build/rust-legal

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=rust-builder /build/target/release/cshell /usr/local/bin/cshell
COPY --from=web-builder /build/web/dist/ /app/web/dist/
COPY LICENSE THIRD_PARTY_NOTICES.md HISTORY-LICENSE.md /usr/share/doc/cshell/
COPY --from=rust-builder /build/rust-legal/ /usr/share/doc/cshell/rust/
COPY web/docs/web-third-party.md /usr/share/doc/cshell/web-third-party.md

ENV CSHELL_LISTEN=0.0.0.0:8080 \
    CSHELL_STATIC_DIR=/app/web/dist

USER 65532:65532
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["curl", "--fail", "--silent", "--show-error", "--max-time", "3", "http://127.0.0.1:8080/_cshell/health"]

ENTRYPOINT ["/usr/local/bin/cshell"]
