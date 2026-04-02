import { describe, expect, it } from 'vitest';
import { validateCustomSql } from '../admin_api/cleanup_api';

describe('validateCustomSql', () => {
  it('rejects deletes against protected address lifecycle tables', () => {
    expect(validateCustomSql('DELETE FROM address WHERE 1 = 1').valid).toBe(false);
    expect(validateCustomSql('DELETE FROM users_address WHERE 1 = 1').valid).toBe(false);
    expect(validateCustomSql('DELETE FROM main.address WHERE 1 = 1').valid).toBe(false);
    expect(validateCustomSql('DELETE FROM "users_address" WHERE 1 = 1').valid).toBe(false);
  });
});
