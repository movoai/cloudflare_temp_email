import type { Context } from 'hono';

import type { CloudflareWildcardSettings } from './models';
import { CONSTANTS } from './constants';
import { getDefaultDomains, getDomains, getJsonSetting } from './utils';

const WILDCARD_PREFIX = '*.';
const DOMAIN_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const normalizeWildcardRule = (value: string | null | undefined): string =>
  String(value || '').trim().toLowerCase().replace(/\.+$/, '');

export const isValidWildcardRootDomain = (value: string): boolean => {
  const labels = String(value || '').split('.');
  return labels.length >= 2 && labels.every((label) => DOMAIN_LABEL_REGEX.test(label));
};

export const validateWildcardRuleList = (values: Array<string | null | undefined>): string[] => {
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeWildcardRule(value);
    if (!normalized) continue;
    const rootDomain = normalized.slice(WILDCARD_PREFIX.length);
    if (!normalized.startsWith(WILDCARD_PREFIX) || !isValidWildcardRootDomain(rootDomain)) {
      throw new Error(`Invalid Cloudflare wildcard rule: ${value}`);
    }
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
};

export const expandWildcardRule = (rule: string, makeLabel: () => string): string => {
  const suffix = normalizeWildcardRule(rule).slice(WILDCARD_PREFIX.length);
  return `${makeLabel()}.${suffix}`;
};

export const matchesWildcardRule = (domain: string, rule: string): boolean => {
  const normalizedDomain = normalizeWildcardRule(domain);
  const suffix = normalizeWildcardRule(rule).slice(1);
  return normalizedDomain.length > suffix.length && normalizedDomain.endsWith(suffix);
};

export const createUniqueConcreteDomain = async ({
  rule,
  makeLabel,
  isAvailable,
  maxAttempts = 10,
}: {
  rule: string;
  makeLabel: () => string;
  isAvailable: (domain: string) => Promise<boolean>;
  maxAttempts?: number;
}): Promise<string> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = expandWildcardRule(rule, makeLabel);
    if (await isAvailable(candidate)) return candidate;
  }
  throw new Error('Failed to generate a unique wildcard subdomain');
};

export const computeExpiresAtSql = (now: Date, retentionDays: number): string => {
  const expires = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  return expires.toISOString().slice(0, 19).replace('T', ' ');
};


export const validateCloudflareWildcardSettings = (raw: any): CloudflareWildcardSettings => {
  const wildcardDomains = validateWildcardRuleList(raw?.wildcardDomains || []);
  const activeWildcardDomains = validateWildcardRuleList(raw?.activeWildcardDomains || []);
  for (const rule of activeWildcardDomains) {
    if (!wildcardDomains.includes(rule)) {
      throw new Error(`Active wildcard rule must exist in wildcard pool: ${rule}`);
    }
  }
  const retentionValue = Number(raw?.retentionDays || 90);
  return {
    wildcardDomains,
    activeWildcardDomains,
    retentionDays: retentionValue > 0 ? retentionValue : 90,
  };
};

const extractEnvWildcardRules = (values: string[]): string[] =>
  validateWildcardRuleList(values.filter((value) => normalizeWildcardRule(value).startsWith(WILDCARD_PREFIX)));

export const getCloudflareWildcardConfig = async (
  c: Context<HonoCustomType>,
): Promise<CloudflareWildcardSettings> => {
  const dbSettings = await getJsonSetting<CloudflareWildcardSettings>(
    c,
    CONSTANTS.CLOUDFLARE_WILDCARD_SETTINGS_KEY,
  );
  if (dbSettings) {
    return validateCloudflareWildcardSettings(dbSettings);
  }

  const wildcardDomains = extractEnvWildcardRules(getDomains(c));
  const defaultRules = extractEnvWildcardRules(getDefaultDomains(c));
  return validateCloudflareWildcardSettings({
    wildcardDomains,
    activeWildcardDomains: defaultRules.length > 0 ? defaultRules : wildcardDomains,
    retentionDays: 90,
  });
};


export const pickActiveWildcardRule = (
  activeRules: string[],
  requestedRule: string | null | undefined,
  defaultFirst: boolean,
): string => {
  const normalizedRequest = normalizeWildcardRule(requestedRule);
  if (normalizedRequest) {
    if (!activeRules.includes(normalizedRequest)) {
      throw new Error('Requested wildcard rule is not active');
    }
    return normalizedRequest;
  }
  if (activeRules.length === 0) {
    throw new Error('No active Cloudflare wildcard domains configured');
  }
  return defaultFirst ? activeRules[0] : activeRules[Math.floor(Math.random() * activeRules.length)];
};

export const makeRandomWildcardLabel = (): string => {
  const words = ['silver', 'harbor', 'mist', 'brook', 'sun', 'field', 'amber', 'pine'];
  const picked = `${words[Math.floor(Math.random() * words.length)]}${words[Math.floor(Math.random() * words.length)]}`
    .replace(/[^a-z0-9]/g, '')
    .toLowerCase();
  return picked || Math.random().toString(36).slice(2, 14);
};

export const resolveConcreteDomain = ({
  activeRules,
  requestedRule,
  defaultFirst,
  makeLabel,
}: {
  activeRules: string[];
  requestedRule?: string | null;
  defaultFirst: boolean;
  makeLabel: () => string;
}): string =>
  expandWildcardRule(pickActiveWildcardRule(activeRules, requestedRule, defaultFirst), makeLabel);

export const mapWildcardRulesToOpenSettings = (activeRules: string[]) => ({
  domains: activeRules,
  defaultDomains: activeRules,
  domainLabels: activeRules,
});


export const isAddressActive = (
  row: { expires_at?: string | null },
  now = new Date(),
): boolean => !!row?.expires_at && new Date(String(row.expires_at).replace(' ', 'T') + 'Z').getTime() > now.getTime();

export const assertActiveAddressRow = (row: { expires_at?: string | null } | null | undefined): void => {
  if (!row || !isAddressActive(row)) {
    throw new Error('Address expired or not found');
  }
};

export const isWildcardCreatedAddressRow = (
  row: { source_meta?: string | null } | null | undefined,
): boolean => String(row?.source_meta || '').includes('wildcard:');

export const assertSendSupportedAddressRow = (
  row: { source_meta?: string | null } | null | undefined,
): void => {
  if (isWildcardCreatedAddressRow(row)) {
    throw new Error('Cloudflare wildcard addresses do not support sending mail');
  }
};
