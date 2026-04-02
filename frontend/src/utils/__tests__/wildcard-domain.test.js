import { describe, expect, it } from 'vitest'

import {
  formatAddressWithDomainHint,
  matchesWildcardDomainRule,
  parseWildcardDomainPool,
} from '../wildcard-domain'

describe('parseWildcardDomainPool', () => {
  it('normalizes, de-duplicates, and ignores empty lines', () => {
    expect(parseWildcardDomainPool(' *.A.com\n*.b.net\n\n*.a.com, *.c.org. ')).toEqual([
      '*.a.com',
      '*.b.net',
      '*.c.org',
    ])
  })
})

describe('matchesWildcardDomainRule', () => {
  it('matches concrete subdomains for a wildcard rule', () => {
    expect(matchesWildcardDomainRule('alpha.test.example.com', '*.test.example.com')).toBe(true)
  })

  it('does not match the root domain itself', () => {
    expect(matchesWildcardDomainRule('test.example.com', '*.test.example.com')).toBe(false)
  })
})

describe('formatAddressWithDomainHint', () => {
  it('shows the wildcard rule for a concrete wildcard address', () => {
    expect(formatAddressWithDomainHint('tmp@alpha.test.example.com', [
      { label: '*.test.example.com', value: '*.test.example.com' },
    ])).toBe('tmp@alpha.test.example.com (*.test.example.com)')
  })

  it('returns the original address when no configured rule matches', () => {
    expect(formatAddressWithDomainHint('tmp@alpha.other.example.com', [
      { label: '*.test.example.com', value: '*.test.example.com' },
    ])).toBe('tmp@alpha.other.example.com')
  })
})
