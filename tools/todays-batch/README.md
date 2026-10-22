# JUP LIFE: Today's Batch template
Make a print card and social/web posts for every drop from one file.

1. **Edit** `batch.yaml` (or copy `fall_2026.yaml` / `summer.yaml`). Set the season, harvest month/year, optional `date` (YYYY-MM-DD, prints e.g. "THU OCT 22"), optional `batch_no`, up to 6 flavors (name, hex color, short note), an optional `chefs_special` (leave it "" for no ribbon), and the price tiers (they default to the real wholesale tiers: 100 at $2.00, 500 at $1.60, 1,000 at $1.20 each; `samples_free: true`).
2. **Run** `python3 make_card.py batch.yaml` (needs `pip install reportlab pyyaml`, plus `pdftoppm` from poppler-utils).
3. **Grab** the files from `out/<season>_<date>/`:
   - `..._card_3.5in.pdf` is print-ready: 3.5" square plus a 0.125" bleed. The matching `..._card_3.5in.png` is a 300 dpi proof.
   - `..._feed_1080x1350.png` (4:5), `..._story_1080x1920.png` (9:16) and `..._banner_1600x600.png`.
   - `today.html` is a self-contained embed with inline CSS and the logo built in.

Locked (don't edit in YAML): the header, "Locally grown in Jupiter, FL", "Washable, dishwasher safe TPU · Built different.", juplifestudio.com, "Wholesale: Smash · 561-532-7120", the colors and the fonts.
**Fit check:** notes auto-shrink down to 6 pt on the card. If one still won't fit, the script prints `WARNING ... Shorten it` and exits with code 2. Keep notes to about 2-3 short words.
No health claims. Use only real prices in `tiers`.
