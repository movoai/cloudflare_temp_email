import { test, expect } from '@playwright/test';
import {
  FRONTEND_URL,
  createTestAddress,
  seedTestMail,
  deleteAddress,
} from '../../fixtures/test-helpers';
import { request as apiRequest } from '@playwright/test';

test.describe('Wildcard receive-only inbox', () => {
  test('reply action is hidden for wildcard-created addresses', async ({ page }) => {
    const api = await apiRequest.newContext();
    let jwt: string | undefined;

    try {
      const created = await createTestAddress(api, 'reply-xss');
      jwt = created.jwt;
      const address = created.address;

      // Seed email with XSS payloads embedded in HTML
      const xssHtml = [
        '<div>',
        '  <h1>Important Message</h1>',
        '  <p>Please review this content.</p>',
        '  <script>alert("xss")</script>',
        '  <img src=x onerror="alert(1)">',
        '  <a href="javascript:alert(2)">click me</a>',
        '  <p style="color:red">Styled paragraph</p>',
        '</div>',
      ].join('\n');

      await seedTestMail(api, address, {
        subject: 'XSS Test Email',
        html: xssHtml,
        from: 'attacker@test.example.com',
      });

      page.on('dialog', async (dialog) => {
        await dialog.dismiss();
      });

      await page.goto(`${FRONTEND_URL}/en/?jwt=${jwt}`);

      const mailItem = page.getByRole('listitem').getByText('XSS Test Email');
      await expect(mailItem).toBeVisible({ timeout: 10_000 });
      await mailItem.click();

      const replyButton = page.locator('button').filter({ hasText: /Reply/i }).first();
      await expect(replyButton).toBeHidden();
    } finally {
      try {
        if (jwt) await deleteAddress(api, jwt);
      } finally {
        await api.dispose();
      }
    }
  });
});
