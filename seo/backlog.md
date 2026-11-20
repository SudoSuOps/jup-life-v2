# Backlog (ordered by expected contacts/sample requests per hour of work)

Volume and position data: none yet (no Search Console data, no Ahrefs/DataForSEO). Re-rank once Search Console has two weeks of data.

1. **www duplicate host (owner, Cloudflare):** www.juplifestudio.com serves 200 instead of 301 to apex. Its canonical already points to apex, so the damage is limited. Fix: Cloudflare Bulk Redirect or Redirect Rule `www.* -> https://juplifestudio.com/$1` (301). A Pages `_redirects` file can't match on host.
2. **Submit the sitemap in Search Console (owner):** then run `tools/indexnow.py --sitemap dist/sitemap.xml` after each deploy. Indexing is not verified: the brand search on 2026-11-20 returned no juplifestudio.com result.
3. **/enterprise: "Who it's for" landing sections → use-case pages** (Airbnb hosts, events, boutique hotels). The queries are in the keyword map as gaps. Blocked on owner OK, because the brief §8 limits page scope. Each page needs real photos or examples from the studio.
4. **Proof on /enterprise:** a real photo of a logo batch on a bar, once a client agrees (the current mockup is captioned "Example design, not a client"). Ask the owner.
5. **/palm-beach-county:** 389 words, with each town section thin. Add a concrete local detail per town (delivery or pickup, venues served) from the owner; don't invent any.
6. **Comparison article "3D printed vs cork vs stone vs paper coasters for bars":** sourced from competitor spec pages plus the studio's own washability claim. Needs owner OK (blog scope).
7. **/about** is 307 words. Add Dee's story and the 30-printer studio fact (BRIEF §5 lists it as an allowed claim; confirm the fleet count is still current).
8. **Brand-name consistency:** schema `brand` says "JUP LIFE Studio" while the business is named "JUP LIFE by Mrs. Smash". Ask the owner which name is canonical, then align titles and schema.
9. **Validate /shop Product markup:** run it through the Rich Results Test or check Search Console > Merchant listings to confirm the hasMerchantReturnPolicy is accepted (not just present).
10. **Check the /enterprise title change (2026-11-20):** it was made without reading the live results for its query. Treat it as a hypothesis and compare position and CTR once Search Console data exists.
