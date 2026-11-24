import { describe, expect, it } from 'vitest'
import { isValidIpOrCidr } from '@/lib/ip'

describe('isValidIpOrCidr', () => {
  it('accepts well-formed IPv4 addresses', () => {
    expect(isValidIpOrCidr('1.1.1.1')).toBe(true)
    expect(isValidIpOrCidr('255.255.255.255')).toBe(true)
    expect(isValidIpOrCidr('0.0.0.0')).toBe(true)
  })

  it('rejects malformed IPv4 addresses', () => {
    expect(isValidIpOrCidr('256.1.1.1')).toBe(false)
    expect(isValidIpOrCidr('1.1.1')).toBe(false)
    expect(isValidIpOrCidr('1.1.1.1.1')).toBe(false)
    expect(isValidIpOrCidr('abc.def.ghi.jkl')).toBe(false)
    expect(isValidIpOrCidr('01.1.1.1')).toBe(true)
  })

  it('accepts well-formed IPv6 addresses', () => {
    expect(isValidIpOrCidr('::1')).toBe(true)
    expect(isValidIpOrCidr('2001:db8::1')).toBe(true)
    expect(isValidIpOrCidr('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true)
    expect(isValidIpOrCidr('::ffff:127.0.0.1')).toBe(true)
  })

  it('rejects malformed IPv6 addresses', () => {
    expect(isValidIpOrCidr('2001:db8:::1')).toBe(false)
    expect(isValidIpOrCidr('2001:db8:85a3:0000:0000:8a2e:0370:7334:1')).toBe(false)
    expect(isValidIpOrCidr('gggg::1')).toBe(false)
  })

  it('accepts CIDR blocks within prefix limits', () => {
    expect(isValidIpOrCidr('10.0.0.0/8')).toBe(true)
    expect(isValidIpOrCidr('192.168.1.1/32')).toBe(true)
    expect(isValidIpOrCidr('2001:db8::/32')).toBe(true)
    expect(isValidIpOrCidr('::1/128')).toBe(true)
  })

  it('rejects CIDR blocks with invalid prefixes', () => {
    expect(isValidIpOrCidr('10.0.0.0/33')).toBe(false)
    expect(isValidIpOrCidr('::1/129')).toBe(false)
    expect(isValidIpOrCidr('10.0.0.0/abc')).toBe(false)
    expect(isValidIpOrCidr('10.0.0.0/8/8')).toBe(false)
    expect(isValidIpOrCidr('not-an-ip/8')).toBe(false)
  })

  it('rejects blank entries', () => {
    expect(isValidIpOrCidr('')).toBe(false)
    expect(isValidIpOrCidr('   ')).toBe(false)
  })
})
