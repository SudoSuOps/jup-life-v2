# Amendments to BRIEF.md (decided during design, Oct 22 2026)

These override the brief where they conflict.

## Contacts
- **Added `hello@juplifestudio.com`** as the general address ("Say hello"). `dee@juplifestudio.com` stays, labeled "Email Dee". LocalBusiness schema `email` = hello@. Sample-request notifications go to both.

## Home page
- **Today's Batch (Fall Tray) now has 6 flavors**: Pumpkin, Cinnamon, Cranberry, Maple, Rhubarb, **Sunflower ("the hero")**, matching the owner's Pop Coasters flavor board. Sunflower `#F6C21C` is the always-on hero in both Fall and Summer trays.
- **Hero**: the cake-dome studio render (`hero-dome-*.webp`) sits softly blurred behind the board (desktop only). The "Fresh Baked Daily" seal sticker overlaps the board's top-left corner.
- **This week's tray** = 6 cards + a full-width custom-logo CTA strip:
  Fall Tray Pop Coasters · **Stack Bands** (new) · 6-Coaster Set + Case ($29) · **The Gigi** (new) · Tide Soap Dish · Tide Hand Soap Dispenser.
  **The Readers moved to Shop only** (brief caps Home at 6 cards; no photo yet).
  A full-width Fall flavor-board image sits above the cards.
- **New section "Out of the oven."** (after the tray): three tap-to-play vertical shorts. `preload="none"`, no autoplay, posters set.
  - `fresh-baked.mp4` (15 s), `coaster-party.mp4` (15 s), `built-different.mp4` (23.4 s).
  - `built-different.mp4` is the owner's 30 s "Built different" cut **with the "Meet The Gigi." segment (≈17.7–23.9 s) removed** because it shows a gold metal-chain bracelet (brief bans metal-chain imagery). Do not restore the original.
- **Quality by design**: flex close-up render beside the heading; the studio-vision render (`studio-vision.webp`, the brief's optional `bakery_studio_vision.jpg`) full width under the five beats.
- **For restaurants**: beach-table drink render under the copy.
- **Meet Mrs. Smash**: the Mrs. Smash TPU tag render stands in until `[[DEE PORTRAIT]]` arrives.

## Products added
- **Stack Bands**: 3-packs by the batch. Fall: Harvest (Pumpkin/Cinnamon/Maple), Berry Pie (Cranberry/Rhubarb/Maple), Coastal Batch (Sea Salt/Pumpkin/Rhubarb). Summer: Sunset (Peach/Watermelon/Key Lime), Berry Coast (Blueberry/Coconut/Sea Salt), Coastal Batch (Sea Salt/Peach/Coconut). Price: Ask about this batch. Material: unconfirmed, so no material line and no dishwasher claim.
- **The Gigi**: flexible monogram band ("JI" monogram). Price: Ask about this batch. Material: unconfirmed. Owner to sanity-check the name + repeating monogram against the "no other brands' marks" rule.

## Implementation decisions
- Modal and bag use native `<dialog>` (focus containment + Esc built in). FAQ uses `<details>/<summary>` (zero JS).
- Payments: Stripe Checkout (hosted) via `POST /api/checkout`, server-side sku→Price ID mapping, verified webhook.
- Form intake: `POST /api/sample-request` (multipart) with honeypot, per-IP throttle, logo type/size/magic-byte checks, SVG script rejection; notifications via Resend HTTP API (optional; logs otherwise).
