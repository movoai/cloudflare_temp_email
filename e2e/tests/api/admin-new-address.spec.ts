import { test, expect } from '@playwright/test';
import { TEST_DOMAIN_SUFFIX, TEST_WILDCARD_RULE, WORKER_URL } from '../../fixtures/test-helpers';

test.describe('Admin New Address', () => {
  test('should return a concrete wildcard address and address_id in response', async ({ request }) => {
    const uniqueName = `admin-test${Date.now()}`;
    const res = await request.post(`${WORKER_URL}/admin/new_address`, {
      data: { name: uniqueName, domain: TEST_WILDCARD_RULE },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();

    const sanitizedName = uniqueName.replace(/[^a-z0-9]/g, '');
    expect(body.address).toMatch(new RegExp(`^${sanitizedName}@[^.]+\\.${TEST_DOMAIN_SUFFIX.replaceAll('.', '\\.')}$`));
    expect(body.jwt).toBeTruthy();
    expect(body.address_id).toBeGreaterThan(0);
    expect(typeof body.address_id).toBe('number');
  });
});
