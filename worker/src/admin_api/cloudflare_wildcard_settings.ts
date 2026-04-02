import type { Context } from 'hono';

import { getCloudflareWildcardConfig, validateCloudflareWildcardSettings } from '../cloudflare_wildcard';
import { CONSTANTS } from '../constants';
import { saveSetting } from '../utils';

export default {
  get: async (c: Context<HonoCustomType>) => c.json(await getCloudflareWildcardConfig(c)),
  save: async (c: Context<HonoCustomType>) => {
    const settings = validateCloudflareWildcardSettings(await c.req.json());
    await saveSetting(c, CONSTANTS.CLOUDFLARE_WILDCARD_SETTINGS_KEY, JSON.stringify(settings));
    return c.json({ success: true, settings });
  },
};
