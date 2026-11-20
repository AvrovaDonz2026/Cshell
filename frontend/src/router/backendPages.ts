/** These document routes belong to the upstream frontend on the same origin. */
export function isBackendPage(path: string): boolean {
  return /^\/(?:admin|setup)(?:\/|$)/i.test(path)
}
