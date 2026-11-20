# Frontend provenance

This Vue frontend is adapted from [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) at commit `2af3f1e15c98c893a89255a037f551046883b8c0`. The upstream LGPL-3.0 license is reproduced in `LICENSE`; original source notices are retained. Cshell modifications cover the design, default locale, and same-origin routing/build configuration.

The build emits `dist/`. Serve `dist/index.html` for Cshell document routes, and map `/_cshell/*` to files in `dist/`. `/admin`, `/admin/*`, `/setup`, and `/setup/*` must be served by the backend before the Cshell document fallback. The app uses `/api/v1` on the same origin and preserves upstream browser session storage.
