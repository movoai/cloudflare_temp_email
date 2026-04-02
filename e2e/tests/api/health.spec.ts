import { test, expect } from '@playwright/test';
import { TEST_WILDCARD_RULE, WORKER_URL } from '../../fixtures/test-helpers';

test.describe('Health & Settings', () => {
  test('GET /health_check returns OK', async ({ request }) => {
    const res = await request.get(`${WORKER_URL}/health_check`);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toBe('OK');
  });

  test('GET /open_api/settings returns wildcard rules and receive-only defaults', async ({ request }) => {
    const res = await request.get(`${WORKER_URL}/open_api/settings`);
    expect(res.ok()).toBe(true);

    const settings = await res.json();
    expect(settings.domains).toContain(TEST_WILDCARD_RULE);
    expect(settings.defaultDomains).toContain(TEST_WILDCARD_RULE);
    expect(settings.enableSendMail).toBe(false);
    expect(settings.cloudflareAddressRetentionDays).toBe(90);
    expect(settings.enableUserCreateEmail).toBe(true);
    expect(settings.enableUserDeleteEmail).toBe(true);
  });
});
