/* Google tag: GA4 + Google Ads conversions. Built into dist/js/ only when site.json google_tag has an id
   (tools/build.py). Config comes from <script type="application/json" id="gtag-config">. No inline JS:
   CSP allows 'self' plus Google's documented hosts only. */
(() => {
  const el = document.getElementById('gtag-config');
  if (!el) return;
  const cfg = JSON.parse(el.textContent);
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  if (cfg.ga4_id) gtag('config', cfg.ga4_id);
  if (cfg.ads_id) gtag('config', cfg.ads_id);

  const adsConversion = (label) => { if (cfg.ads_id && label) gtag('event', 'conversion', { send_to: `${cfg.ads_id}/${label}` }); };

  // Free sample request accepted by the API (main.js fires this).
  document.addEventListener('jup:sample-sent', (e) => {
    if (cfg.ga4_id) gtag('event', 'generate_lead', { lead_source: 'sample_form', page_path: e.detail?.source_page });
    adsConversion(cfg.sample_label);
  });

  // Tap to call or text.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="tel:"], a[href^="sms:"]');
    if (!a) return;
    if (cfg.ga4_id) gtag('event', a.href.startsWith('tel:') ? 'click_to_call' : 'click_to_text', { page_path: location.pathname });
    adsConversion(cfg.call_label);
  }, true);
})();
