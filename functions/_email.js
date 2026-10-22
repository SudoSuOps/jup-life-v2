// Branded HTML for emails that go to customers (underscore prefix = not routed).
// Table layout + inline styles because email clients ignore most CSS. Colors match web/css/tokens.css.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const C = { cream: '#FBF7F0', deep: '#F3EADC', cocoa: '#5A3E2B', kraft: '#C9A67A', terracotta: '#A9532F', chalk: '#2B2B2B' };
const SERIF = "'DM Serif Display', Georgia, 'Times New Roman', serif";
const SANS = "Montserrat, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export function brandedEmail({ base, preheader = '', eyebrow = '', heading, paragraphs = [], cta, signoff = [], footnote = '' }) {
  const p = (t) => `<p style="margin:0 0 16px;font:400 16px/1.6 ${SANS};color:${C.cocoa}">${esc(t)}</p>`;
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px"><tr><td style="background:${C.terracotta};border-radius:10px">
        <a href="${esc(cta.url)}" style="display:inline-block;padding:14px 26px;font:600 16px ${SANS};color:#FFFFFF;text-decoration:none">${esc(cta.label)}</a></td></tr></table>`
    : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${C.deep}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.deep}"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.cream};border-radius:16px;overflow:hidden">
    <tr><td align="center" style="padding:28px 24px 8px"><a href="${esc(base)}/"><img src="${esc(base)}/img/logo.png" width="120" alt="JUP LIFE by Mrs. Smash" style="display:block;border:0;height:auto"></a></td></tr>
    <tr><td style="padding:8px 36px 0">
      ${eyebrow ? `<p style="margin:16px 0 4px;font:600 12px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.terracotta}">${esc(eyebrow)}</p>` : ''}
      <h1 style="margin:0 0 16px;font:400 34px/1.1 ${SERIF};color:${C.cocoa}">${esc(heading)}</h1>
      ${paragraphs.map(p).join('')}
      ${button}
      ${signoff.map((l, i) => `<p style="margin:0 0 ${i === signoff.length - 1 ? 28 : 2}px;font:${i === 0 ? '400 italic' : '600'} 16px/1.5 ${i === 0 ? SERIF : SANS};color:${C.cocoa}">${esc(l)}</p>`).join('')}
    </td></tr>
    <tr><td style="background:${C.chalk};padding:22px 36px;text-align:center">
      <p style="margin:0 0 6px;font:400 14px/1.5 ${SANS};color:#E9D9C2">Fresh baked. Built different.</p>
      <p style="margin:0;font:400 13px/1.6 ${SANS};color:#E9D9C2">JUP LIFE by Mrs. Smash · Jupiter, FL<br>
        <a href="mailto:hello@juplifestudio.com" style="color:#E9D9C2">hello@juplifestudio.com</a> · <a href="tel:+15615327120" style="color:#E9D9C2">561-532-7120</a></p>
      ${footnote ? `<p style="margin:12px 0 0;font:400 12px/1.5 ${SANS};color:#C9B8A0">${esc(footnote)}</p>` : ''}
    </td></tr>
  </table>
</td></tr></table></body></html>`;
  const text = [heading, '', ...paragraphs.flatMap((t) => [t, '']), cta ? `${cta.label}: ${cta.url}\n` : '', ...signoff, '', footnote]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();
  return { html, text };
}
