import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(root, 'migrations'));
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      fileParallelism: false,
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
              STRIPE_READ_KEY: 'rk_test_local',
              SHOPIFY_WEBHOOK_SECRET: 'shpss_test_secret',
              SHOPIFY_ADMIN_TOKEN: 'shpat_test_local',
              ACCESS_AUD: 'test-aud',
              ACCESS_TEAM_DOMAIN: 'https://juplife.cloudflareaccess.com',
              JUP_PRICE_IDS: 'price_jup_1,price_jup_2',
            },
          },
        },
      },
    },
  };
});
