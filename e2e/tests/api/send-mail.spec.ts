import { test, expect } from '@playwright/test';
import {
  createTestAddress,
  deleteAddress,
  WORKER_URL,
} from '../../fixtures/test-helpers';

test.describe('Send Mail', () => {
  test('wildcard-created addresses cannot send mail', async ({ request }) => {
    const { jwt, address } = await createTestAddress(request, 'sender-test');

    // Send mail via worker API
    const sendRes = await request.post(`${WORKER_URL}/api/send_mail`, {
      headers: { Authorization: `Bearer ${jwt}` },
      data: {
        from_name: 'E2E Sender',
        to_name: 'E2E Recipient',
        to_mail: 'recipient@test.example.com',
        subject: `Blocked ${Date.now()}`,
        content: '<h1>Hello</h1><p>This should be blocked.</p>',
        is_html: true,
      },
    });
    expect(sendRes.ok()).toBe(false);
    expect(await sendRes.text()).toContain('not support sending mail');
    expect(address).toContain('@');

    // Cleanup
    await deleteAddress(request, jwt);
  });
});
