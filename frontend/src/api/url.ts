const API_BASE_URL = '/api/v1'

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

export function getAPIBaseURL(): string {
  return API_BASE_URL
}

export function buildApiUrl(path: string): string {
  const suffix = normalizePath(path)
  if (suffix === API_BASE_URL || suffix.startsWith(`${API_BASE_URL}/`)) return suffix
  return `${API_BASE_URL}${suffix}`
}

export function buildGatewayUrl(path: string): string {
  const suffix = normalizePath(path)
  return typeof window === 'undefined' ? suffix : `${window.location.origin}${suffix}`
}
