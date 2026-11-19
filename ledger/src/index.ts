import { requireAccess } from './access';
import type { Env } from './env';
import { text } from './http';
import { log } from './log';
import { backfillShopify, handleShopifyWebhook } from './shopify';
import { backfillStripe, handleStripeWebhook } from './stripe';

const WEBHOOKS = new Set(['/hook/stripe', '/hook/shopify']);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
    if (!WEBHOOKS.has(path)) {
      const denied = await requireAccess(request, env);
      if (denied) return denied;
    }
    try {
      if (path === '/hook/stripe' && request.method === 'POST') return handleStripeWebhook(request, env);
      if (path === '/hook/shopify' && request.method === 'POST') return handleShopifyWebhook(request, env);
      if (path === '/') return text('JUP LIFE ledger', 200, 'text/html; charset=utf-8');
      return text('Not found', 404);
    } catch (error) {
      log('request_error', { message: error instanceof Error ? error.message : 'error', path });
      return text('Internal error', 500);
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const full = controller.cron === '15 12 * * 1';
    ctx.waitUntil(
      (async () => {
        await backfillStripe(env, { full }).catch((error: unknown) => {
          log('stripe_backfill_error', { message: error instanceof Error ? error.message : 'error' });
        });
        await backfillShopify(env, { full }).catch((error: unknown) => {
          log('shopify_backfill_error', { message: error instanceof Error ? error.message : 'error' });
        });
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
