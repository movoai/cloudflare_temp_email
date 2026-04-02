import { describe, expect, it } from 'vitest';
import {
  normalizeWildcardRule,
  validateWildcardRuleList,
  expandWildcardRule,
  matchesWildcardRule,
  createUniqueConcreteDomain,
  computeExpiresAtSql,
  validateCloudflareWildcardSettings,
  mapWildcardRulesToOpenSettings,
  resolveConcreteDomain,
  isAddressActive,
  assertSendSupportedAddressRow,
} from '../cloudflare_wildcard';

describe('cloudflare wildcard helpers', () => {
  it('normalizes valid wildcard rules and rejects malformed entries', () => {
    expect(normalizeWildcardRule(' *.Mail.Example.com. ')).toBe('*.mail.example.com');
    expect(validateWildcardRuleList(['*.a.com', '*.b.net'])).toEqual(['*.a.com', '*.b.net']);
    expect(() => validateWildcardRuleList(['mail.example.com'])).toThrow(/wildcard/i);
    expect(() => validateWildcardRuleList(['*.bad_domain.com'])).toThrow(/invalid/i);
    expect(() => validateWildcardRuleList(['*..example.com'])).toThrow(/invalid/i);
  });

  it('expands a wildcard rule into a concrete subdomain', () => {
    expect(expandWildcardRule('*.a.com', () => 'silverharbor')).toBe('silverharbor.a.com');
  });

  it('matches a concrete domain back to its wildcard rule', () => {
    expect(matchesWildcardRule('mistbrook.a.com', '*.a.com')).toBe(true);
    expect(matchesWildcardRule('a.com', '*.a.com')).toBe(false);
  });

  it('retries until it finds an unused concrete subdomain', async () => {
    const labels = ['mistbrook', 'silverharbor'];
    const chosen = await createUniqueConcreteDomain({
      rule: '*.a.com',
      makeLabel: () => labels.shift() || 'fallback',
      isAvailable: async (domain) => domain !== 'mistbrook.a.com',
    });
    expect(chosen).toBe('silverharbor.a.com');
  });

  it('computes a SQL DATETIME expiry 90 days from a fixed clock', () => {
    expect(computeExpiresAtSql(new Date('2026-04-02T00:00:00.000Z'), 90)).toBe('2026-07-01 00:00:00');
  });

  it('rejects active rules that are not inside the configured pool', () => {
    expect(() =>
      validateCloudflareWildcardSettings({
        wildcardDomains: ['*.a.com'],
        activeWildcardDomains: ['*.b.net'],
        retentionDays: 90,
      }),
    ).toThrow(/active/i);
  });

  it('falls back to 90 retention days when unset', () => {
    expect(
      validateCloudflareWildcardSettings({
        wildcardDomains: ['*.a.com'],
        activeWildcardDomains: ['*.a.com'],
      }).retentionDays,
    ).toBe(90);
  });

  it('rejects malformed wildcard roots in persisted settings', () => {
    expect(() =>
      validateCloudflareWildcardSettings({
        wildcardDomains: ['*.bad_domain.com'],
        activeWildcardDomains: ['*.bad_domain.com'],
        retentionDays: 90,
      }),
    ).toThrow(/invalid/i);
  });

  it('maps active wildcard rules into the existing domains/defaultDomains shape', () => {
    expect(mapWildcardRulesToOpenSettings(['*.a.com', '*.b.net'])).toEqual({
      domains: ['*.a.com', '*.b.net'],
      defaultDomains: ['*.a.com', '*.b.net'],
      domainLabels: ['*.a.com', '*.b.net'],
    });
  });

  it('selects the requested active wildcard rule and expands it to a concrete domain', () => {
    expect(
      resolveConcreteDomain({
        activeRules: ['*.a.com'],
        requestedRule: '*.a.com',
        defaultFirst: true,
        makeLabel: () => 'mistbrook',
      }),
    ).toBe('mistbrook.a.com');
  });

  it('treats past expires_at values as inactive', () => {
    expect(isAddressActive({ expires_at: '2026-04-01 00:00:00' }, new Date('2026-04-02T00:00:00.000Z'))).toBe(false);
  });

  it('rejects sending from persisted wildcard-created addresses even if the rule is no longer active', () => {
    expect(() => assertSendSupportedAddressRow({ source_meta: 'wildcard:*.a.com|origin:web' })).toThrow(/not support/i);
  });
});
