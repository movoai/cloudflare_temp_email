import { test, expect } from '@playwright/test';
import { WORKER_URL, createTestAddress, requestSendAccess, deleteAddress } from '../../fixtures/test-helpers';

test.describe('Send Access', () => {
  test('request send access is rejected for wildcard-created addresses', async ({ request }) => {
    const { jwt } = await createTestAddress(request, 'send-access');

    try {
      await expect(requestSendAccess(request, jwt)).rejects.toThrow(/wildcard/i);

      const settingsRes = await request.get(`${WORKER_URL}/api/settings`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(settingsRes.ok()).toBe(true);
      const settings = await settingsRes.json();
      expect(settings.send_balance).toBe(0);
    } finally {
      await deleteAddress(request, jwt);
    }
  });
});
