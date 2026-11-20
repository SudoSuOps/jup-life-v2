# filament.juplifestudio.com

The JUP LIFE filament shelf: every color we sell, spools on hand, what to reorder, bulk deals, and a print log that takes grams off the spool. Private: people sign in through Cloudflare Access, automations use an API token.

```
filament/
├── public/            index.html + app.js (no build step)
├── functions/
│   ├── _middleware.js  auth for /api/*: Access JWT (verified) or Bearer API_TOKEN; fails closed
│   └── api/            filaments, deals, settings, usage, summary, health
├── schema.sql         D1 tables
├── seed.sql           the 22 starting colors (safe to re-run)
├── tests/             node:test (run from repo root: npm test)
└── wrangler.jsonc     Pages project "jup-filament", D1 binding DB
```

**We run it on the rig: see [`server/README.md`](server/README.md)** (FastAPI + SQLite behind the Cloudflare Tunnel, data stays local).

The rest of this file is the alternative: a separate Cloudflare Pages project with D1, built from the same repo with **root directory `filament`**. Both serve the same page and the same API.

## One-time setup (Cloudflare dashboard)

1. **D1 database.** Workers & Pages → D1 → Create → name `jup-filament`. Open it → Console, paste all of `schema.sql`, run; then paste all of `seed.sql`, run. (Already ran an older `schema.sql`? Also run `migrations/0002_maker_temps.sql`.) Copy the **Database ID** and put it in `wrangler.jsonc` (`database_id`), or send it to Claude to commit.
2. **Pages project.** Workers & Pages → Create → Pages → Connect to Git → `SudoSuOps/jup-life-v2`.
   - Project name `jup-filament` · Production branch `main`
   - Framework preset: None · Build command: *(empty)* · Build output directory: `public` · **Root directory: `filament`**
   - Deploy. (The D1 binding comes from `wrangler.jsonc` once the ID is in it.)
3. **Domain.** jup-filament → Custom domains → Set up → `filament.juplifestudio.com`.
4. **Sign-in (Cloudflare Access).** Zero Trust → Access → Applications → Add → Self-hosted.
   - Name `JUP Filament` · Domain `filament.juplifestudio.com` only. Leave `jup-filament.pages.dev` outside Access: that's the door automations use with the API token. The page there is an empty shell, and its API still refuses anyone without a valid token or Access sign-in.
   - Policy: Allow → Emails → `hello@juplifestudio.com`, `dee@juplifestudio.com` (and whoever else works the shelf)
   - Login method: One-time PIN (email code) is fine.
   - After saving, copy the app's **Application Audience (AUD) tag**, and your team domain from Zero Trust → Settings → Custom pages (`<team>.cloudflareaccess.com`).
5. **Secrets** (jup-filament → Settings → Variables and secrets, type Secret):
   - `ACCESS_TEAM_DOMAIN` = `<team>.cloudflareaccess.com`
   - `ACCESS_AUD` = the AUD tag
   - `API_TOKEN` = a long random string (for automations; `openssl rand -hex 32`)
   Then Deployments → Retry deployment so they take effect.

Until 4–5 are done the API answers 401 to everyone. That's intended.

## Automations

Every call sends `Authorization: Bearer $API_TOKEN` to `jup-filament.pages.dev`. (The custom domain sits behind Access, which would stop a plain token before it reaches the API.)

```bash
H="Authorization: Bearer $API_TOKEN"; B=https://jup-filament.pages.dev/api

# a print finished: take 84 g of Pumpkin off the shelf
curl -s -X POST $B/usage -H "$H" -H 'content-type: application/json' \
  -d '{"filament":"pumpkin","grams":84,"note":"Pop tray, Flat","source":"bambu-p1s"}'

# multi-color print
curl -s -X POST $B/usage -H "$H" -H 'content-type: application/json' \
  -d '{"items":[{"filament":"sage","grams":40},{"filament":"cream","grams":40}],"source":"qidi"}'

# what to order (for a daily email / Slack post)
curl -s $B/summary -H "$H"

# restock after a delivery: 4 sealed spools of Sunflower
curl -s -X PATCH $B/filaments/sunflower -H "$H" -H 'content-type: application/json' -d '{"full":4}'
```

| Route | Does |
|---|---|
| `GET /api/filaments` | all colors with stock status and settings |
| `POST /api/filaments` | add a color `{name, hex, usedIn, group, clear}` |
| `GET/PATCH/DELETE /api/filaments/:id` | one color; PATCH any of `full, partialG, material, maker, brand, nozzle, bed, note, name, hex, usedIn, group, order, clear` (`maker`: SUNLU, QIDI, Bambu Lab, Other; temps like `210-230`) |
| `POST /api/usage` | log grams used; open spool first, then cracks sealed spools; uncounted colors are logged but not deducted |
| `GET /api/usage?filament=&limit=` | recent print log |
| `GET /api/summary` | colors/spools to order, not-counted list, kg on shelf, cheapest live deal |
| `GET/POST /api/deals`, `DELETE /api/deals/:id` | bulk offers |
| `GET/PUT /api/settings` | `spoolG`, `lowSpools`, `targetSpools` |

Shelf spool ids (SUNLU 10-pack): `sunlu-black sunlu-white sunlu-grey sunlu-red sunlu-orange sunlu-light-blue sunlu-green sunlu-blue sunlu-purple sunlu-clear`.

Sale color ids: `pumpkin cinnamon cranberry maple rhubarb sunflower blueberry peach key-lime watermelon coconut sage cream ruby frost sea-glass shell dunes red-mangrove banyan sea-turtle case`.

## Local dev

```bash
cd filament
printf 'DEV_OPEN=1\n' > .dev.vars            # skips auth locally only
npx wrangler d1 execute jup-filament --local --file schema.sql
npx wrangler d1 execute jup-filament --local --file seed.sql
npx wrangler pages dev public --port 8799
```
If `pages dev` shows the main site's vars instead of the `DB` binding, run it from a copy of this folder outside the repo (npx can pick up the parent `wrangler.jsonc`).
