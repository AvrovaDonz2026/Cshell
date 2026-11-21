# Cshell web third-party dependencies

The `web/` package (`cshell-web`) is original Cshell UI source under the repository MIT license for original materials. Direct npm dependencies remain third-party and keep their own licenses. This file lists those direct dependencies; it is not a substitute for reviewing each package license before redistribution.

## Runtime (direct)

| Package | Role |
|---------|------|
| `vue` | UI framework |
| `vue-router` | Client routing |
| `pinia` | Client state |
| `vue-i18n` | Localization |

## Tooling / test (direct)

| Package | Role |
|---------|------|
| `vite` | Dev server and bundler |
| `@vitejs/plugin-vue` | Vue SFC support for Vite |
| `typescript` | Type checking / emit tooling |
| `vue-tsc` | Vue-aware TypeScript checks |
| `vitest` | Unit tests |
| `@vue/test-utils` | Vue component test helpers |
| `jsdom` | DOM environment for Vitest |
| `playwright` | Optional Chromium driver for `scripts/cshell-web-browser.mjs` (system Chrome via `WORKSPACE_CHROME` still uses this package API) |
| `eslint` | Lint runner |
| `@eslint/js` | ESLint JS baseline |
| `eslint-plugin-vue` | Vue lint rules |
| `typescript-eslint` | TypeScript ESLint integration |
| `globals` | ESLint global definitions |

## Brand asset

`public/2shell.jpeg` is treated as Cshell branding (see `docs/provenance.md`). It is not an npm dependency.

## License note

Do not treat npm packages as MIT merely because Cshell original source is MIT-oriented. Consult each package’s published license (and `pnpm-lock.yaml` for the exact resolved versions) before shipping distributions.
