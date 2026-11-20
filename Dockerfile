FROM node:24-bookworm-slim AS frontend-builder
WORKDIR /build/frontend
# Match the pinned upstream lockfile and CI toolchain.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY docs/legal/ /build/docs/legal/
COPY frontend/ ./
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm run build

FROM rust:1.93-bookworm AS rust-builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src/ ./src/
RUN cargo build --release --locked --bin cshell

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=rust-builder /build/target/release/cshell /usr/local/bin/cshell
COPY --from=frontend-builder /build/frontend/dist/ /app/frontend/dist/
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/doc/cshell/

ENV CSHELL_LISTEN=0.0.0.0:8080 \
    CSHELL_STATIC_DIR=/app/frontend/dist

USER 65532:65532
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["curl", "--fail", "--silent", "--show-error", "--max-time", "3", "http://127.0.0.1:8080/_cshell/health"]

ENTRYPOINT ["/usr/local/bin/cshell"]

