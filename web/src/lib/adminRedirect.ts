/** Upstream admin UI is served outside this SPA. */
export function redirectAdminToUpstream(): void {
  window.location.assign('/admin')
}
