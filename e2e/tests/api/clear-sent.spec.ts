import { test, expect } from '@playwright/test';
import {
  WORKER_URL,
  createTestAddress,
  deleteAddress,
} from '../../fixtures/test-helpers';

test.describe('Clear Sent Items', () => {
  test('clear sent items still succeeds when wildcard address has no sendbox entries', async ({ request }) => {
    const { jwt } = await createTestAddress(request, 'clear-sent');

    try {
      // Verify sendbox starts empty
      const listRes = await request.get(`${WORKER_URL}/api/sendbox?limit=10&offset=0`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(listRes.ok()).toBe(true);
      const { results } = await listRes.json();
      expect(results).toHaveLength(0);

      // Clear sent items
      const clearRes = await request.delete(`${WORKER_URL}/api/clear_sent_items`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(clearRes.ok()).toBe(true);
      const clearBody = await clearRes.json();
      expect(clearBody.success).toBe(true);

      // Verify sendbox is empty
      const afterRes = await request.get(`${WORKER_URL}/api/sendbox?limit=10&offset=0`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(afterRes.ok()).toBe(true);
      const after = await afterRes.json();
      expect(after.results).toHaveLength(0);
    } finally {
      await deleteAddress(request, jwt);
    }
  });
});
