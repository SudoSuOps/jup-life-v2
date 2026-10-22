// POST /api/drops (form or JSON): JUP LIFE Drops email list. Adds the address to a Resend audience
// when RESEND_AUDIENCE_ID is set, and always tells the studio so no signup is lost.
import { allow, clientIp, fail, json, notify } from '../_lib.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  let email = '', honey = '', source = '';
  try {
    if ((request.headers.get('Content-Type') || '').includes('application/json')) {
      const b = await request.json();
      email = b.email; honey = b.website; source = b.source_page;
    } else {
      const fd = await request.formData();
      email = fd.get('email'); honey = fd.get('website'); source = fd.get('source_page');
    }
  } catch { return fail(400, 'Bad request.'); }

  if (honey) return json({ ok: true }); // honeypot
  if (!allow('drops', clientIp(request), Number(env.RATE_LIMIT_PER_HOUR) || 8)) return fail(429, 'Too many requests. Try again later.');
  email = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 200) : '';
  if (!EMAIL.test(email)) return fail(422, 'Please enter a valid email address.');
  source = typeof source === 'string' ? source.slice(0, 200) : '';

  let listed = false;
  if (env.RESEND_API_KEY && env.RESEND_AUDIENCE_ID) {
    try {
      const r = await fetch(`https://api.resend.com/audiences/${encodeURIComponent(env.RESEND_AUDIENCE_ID)}/contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, unsubscribed: false }),
      });
      listed = r.ok;
      if (!r.ok) console.error('drops audience failed', r.status, (await r.text()).slice(0, 300));
    } catch (e) { console.error('drops audience error', String(e)); }
  }

  await notify(env, {
    subject: `[Drops signup] ${email}`,
    text: `New JUP LIFE Drops signup\n\nEmail: ${email}\nPage: ${source || 'unknown'}\nAdded to Resend audience: ${listed ? 'yes' : 'no (email this to the list by hand)'}`,
    replyTo: email,
  });
  return json({ ok: true });
}
