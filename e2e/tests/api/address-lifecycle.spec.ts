import { test, expect } from '@playwright/test';
import { TEST_DOMAIN_SUFFIX, WORKER_URL, createTestAddress, deleteAddress } from '../../fixtures/test-helpers';

test.describe('Address Lifecycle', () => {
  test('create concrete wildcard address, fetch receive-only settings, then delete', async ({ request }) => {
    // Create address
    const { jwt, address, address_id } = await createTestAddress(request, 'lifecycle-test');
    expect(address).toMatch(new RegExp(`@[^.]+\\.${TEST_DOMAIN_SUFFIX.replaceAll('.', '\\.')}$`));
    expect(jwt).toBeTruthy();
    expect(address_id).toBeGreaterThan(0);

    // Fetch address settings — wildcard-created addresses stay receive-only
    const settingsRes = await request.get(`${WORKER_URL}/api/settings`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(settingsRes.ok()).toBe(true);
    const settings = await settingsRes.json();
    expect(settings.send_balance).toBe(0);

    // Delete address
    await deleteAddress(request, jwt);

    // Verify address is gone — settings should fail
    const afterDelete = await request.get(`${WORKER_URL}/api/settings`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(afterDelete.ok()).toBe(false);
  });
});
