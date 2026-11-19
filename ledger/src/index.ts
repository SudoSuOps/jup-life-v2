import type { Env } from './env';

// Placeholder router. Source ingests and the read-only UI land in follow-up commits.
// Non-webhook routes fail closed until Access verification is wired.
const WEBHOOKS = new Set(['/hook/stripe', '/hook/shopify']);

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!WEBHOOKS.has(url.pathname)) {
      return new Response('Forbidden', { status: 403 });
    }
    return new Response('Not implemented', { status: 501 });
  },
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    return;
  },
} satisfies ExportedHandler<Env>;
