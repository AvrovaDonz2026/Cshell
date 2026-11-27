/** Small IPv4/IPv6/CIDR validator used by API-key IP allow/deny lists. */

const IPV4_OCTET = /^\d{1,3}$/
const HEX_GROUP = /^[0-9a-fA-F]{1,4}$/
const CIDR_PREFIX = /^\d{1,3}$/

function isIPv4Octet(octet: string): boolean {
  if (!IPV4_OCTET.test(octet)) return false
  return Number(octet) <= 255
}

export function isValidIPv4(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 4) return false
  return parts.every(isIPv4Octet)
}

export function isValidIPv6(value: string): boolean {
  if (!value || !value.includes(':')) return false

  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1) counts as two groups.
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':')
    if (lastColon < 0) return false
    const v4 = value.slice(lastColon + 1)
    if (!isValidIPv4(v4)) return false
    const head = value.slice(0, lastColon + 1)
    return isValidIPv6(`${head}0:0`)
  }

  const halves = value.split('::')
  if (halves.length > 2) return false

  const toGroups = (part: string): string[] =>
    part === '' ? [] : part.split(':')

  const left = toGroups(halves[0])
  const right = halves.length === 2 ? toGroups(halves[1]) : []

  if (!left.every((group) => HEX_GROUP.test(group))) return false
  if (!right.every((group) => HEX_GROUP.test(group))) return false

  if (halves.length === 1) {
    return left.length === 8
  }

  // A compressed address must omit at least one group.
  return left.length + right.length <= 7
}

/**
 * True when `entry` is an IPv4 address, an IPv6 address, or one of those
 * followed by a CIDR prefix (`/0`–`/32` for IPv4, `/0`–`/128` for IPv6).
 */
export function isValidIpOrCidr(entry: string): boolean {
  const value = entry.trim()
  if (!value) return false

  const slash = value.indexOf('/')
  if (slash === -1) {
    return isValidIPv4(value) || isValidIPv6(value)
  }

  const address = value.slice(0, slash)
  const prefixText = value.slice(slash + 1)
  if (!CIDR_PREFIX.test(prefixText)) return false
  const prefix = Number(prefixText)

  if (isValidIPv4(address)) return prefix <= 32
  if (isValidIPv6(address)) return prefix <= 128
  return false
}
