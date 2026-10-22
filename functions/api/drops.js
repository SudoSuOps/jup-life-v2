// POST /api/drops (form or JSON): JUP LIFE Drops email list. Adds the address to Resend contacts
// when RESEND_API_KEY is set, and always tells the studio so no signup is lost.
import { allow, clientIp, fail, json, notify, siteUrl } from '../_lib.js';
import { brandedEmail } from '../_email.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One short thank-you to the subscriber. Never throws, so a failed send can't break the signup.
async function welcome(env, email, base) {
  if (!env.RESEND_API_KEY) return;
  const { html, text } = brandedEmail({
    base,
    preheader: "You'll be first in line when the next tray comes out of the oven.",
    eyebrow: 'JUP LIFE Drops',
    heading: "You're on the list.",
    paragraphs: [
      "Thanks for joining JUP LIFE Drops. You'll be first in line when a new tray comes out of the oven here in Jupiter: seasonal flavors, small-batch specials and the occasional surprise.",
      "We only write when there's something fresh.",
    ],
    cta: { label: "See what's baking now", url: `${base}/shop` },
    signoff: ['Fresh baked, built different.', 'Mrs. Smash'],
    footnote: 'You joined the Drops list on our website. Changed your mind? Just reply "unsubscribe" and we will take you off.',
  });
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.NOTIFY_FROM || 'JUP LIFE <hello@juplifestudio.com>', to: [email], reply_to: 'hello@juplifestudio.com', subject: "You're on the JUP LIFE Drops list", html, text }),
    });
    if (!r.ok) console.error('drops welcome failed', r.status, (await r.text()).slice(0, 300));
  } catch (e) { console.error('drops welcome error', String(e)); }
}

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
  if (env.RESEND_API_KEY) {
    // Resend contacts are global now; RESEND_SEGMENT_ID (optional) also files the contact in a segment.
    const body = { email, unsubscribed: false };
    if (env.RESEND_SEGMENT_ID) body.segments = [{ id: env.RESEND_SEGMENT_ID }];
    try {
      const r = await fetch('https://api.resend.com/contacts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      listed = r.ok;
      if (!r.ok) console.error('drops contact failed', r.status, (await r.text()).slice(0, 300));
    } catch (e) { console.error('drops contact error', String(e)); }
  }

  await welcome(env, email, siteUrl(env, request));
  await notify(env, {
    subject: `[Drops signup] ${email}`,
    text: `New JUP LIFE Drops signup\n\nEmail: ${email}\nPage: ${source || 'unknown'}\nAdded to Resend contacts: ${listed ? 'yes' : 'no (add this address by hand)'}`,
    replyTo: email,
  });
  return json({ ok: true });
}
