const WILDCARD_PREFIX = '*.'

export const normalizeWildcardDomainRule = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\.+$/, '')

export const parseWildcardDomainPool = (input) => {
  const values = Array.isArray(input)
    ? input
    : String(input || '').split(/[\n,;]+/)

  const result = []
  for (const value of values) {
    const normalized = normalizeWildcardDomainRule(value)
    if (!normalized || result.includes(normalized)) continue
    result.push(normalized)
  }
  return result
}

export const matchesWildcardDomainRule = (domain, rule) => {
  const normalizedDomain = normalizeWildcardDomainRule(domain)
  const normalizedRule = normalizeWildcardDomainRule(rule)
  if (!normalizedDomain || !normalizedRule.startsWith(WILDCARD_PREFIX)) return false
  const suffix = normalizedRule.slice(1)
  return normalizedDomain.length > suffix.length && normalizedDomain.endsWith(suffix)
}

export const findMatchingDomainOption = (addressOrDomain, domainOptions = []) => {
  const normalized = normalizeWildcardDomainRule(addressOrDomain?.includes?.('@')
    ? addressOrDomain.split('@')[1]
    : addressOrDomain)

  return domainOptions.find((option) => {
    const value = normalizeWildcardDomainRule(option?.value)
    if (!value) return false
    if (value.startsWith(WILDCARD_PREFIX)) {
      return matchesWildcardDomainRule(normalized, value)
    }
    return normalized === value
  }) || null
}

export const formatAddressWithDomainHint = (address, domainOptions = []) => {
  if (!address) return address
  const option = findMatchingDomainOption(address, domainOptions)
  if (!option) return address
  const label = normalizeWildcardDomainRule(option.label || option.value)
  if (!label) return address
  return `${address} (${label})`
}
