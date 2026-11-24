/**
 * Asset URLs must respect the configured Vite base path, which differs between
 * dev (`/`), preview (`/`) and builds (`/_cshell/`). Importing the base once
 * keeps the logo working under every deployment prefix.
 */
const base = import.meta.env.BASE_URL

export const logoUrl = `${base}2shell.jpeg`
