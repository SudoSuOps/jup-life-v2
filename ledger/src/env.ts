export interface Env {
  DB: D1Database;
  SHOPIFY_SHOP: string;
  SHOPIFY_API_VERSION: string;
  SHOPIFY_ON_STRIPE: string;
  STRIPE_READ_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
  SHOPIFY_WEBHOOK_SECRET?: string;
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  JUP_PRICE_IDS?: string;
}
