/* JUP LIFE site JS. Vanilla, no deps, target < 10 KB minified.
   - Today's Batch board from JSON
   - Sample request <dialog> (+ "Product question" preselect)
   - Bag (localStorage) -> POST /api/checkout -> Stripe Checkout redirect
   - One-time fade-up on sections (respects prefers-reduced-motion via CSS)
*/
(() => {
  'use strict';
  const API = document.querySelector('meta[name="api-base"]')?.content || '/api';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = (n) => '$' + n.toFixed(2);

  /* ---------- Today's Batch ---------- */
  function renderBatch() {
    const board = $('[data-batch-board]');
    const raw = $('#batch-data');
    if (!board || !raw) return;
    let b;
    try { b = JSON.parse(raw.textContent); } catch { return; }
    const d = new Date(b.date + 'T12:00:00');
    if (!isNaN(d)) {
      const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      $('[data-batch-date]', board).textContent = `${day} ${mon} ${d.getDate()}`;
    }
    $('[data-batch-no]', board).textContent = b.batch_no || '____';
    $('[data-batch-tray]', board).textContent = b.tray;
    const ul = $('[data-batch-rows]', board);
    ul.replaceChildren(...(b.flavors || []).slice(0, 6).map((f) => {
      const li = document.createElement('li');
      li.className = 'row';
      const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = f.hex; sw.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'name'; name.textContent = f.name;
      const lead = document.createElement('span'); lead.className = 'leader'; lead.setAttribute('aria-hidden', 'true');
      const note = document.createElement('span'); note.className = 'muted'; note.style.fontStyle = 'italic'; note.textContent = f.note;
      li.append(sw, name, lead, note);
      return li;
    }));
    $('.ribbon', board)?.remove();
    if (b.chefs_special) {
      const r = document.createElement('div'); r.className = 'ribbon'; r.textContent = `Chef's Special: ${b.chefs_special}`;
      board.prepend(r);
    }
  }

  /* ---------- Dialog helpers ---------- */
  let lastFocus = null;
  function openDlg(dlg) { lastFocus = document.activeElement; dlg.showModal(); }
  function wireClose(dlg) {
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop click
    dlg.addEventListener('close', () => lastFocus?.focus?.());
  }

  /* ---------- Sample request (modal + any inline [data-sample-form]) ---------- */
  function initSample() {
    // every form with [data-sample-form] lives inside a container holding [data-form-view] + [data-success-view]
    $$('[data-sample-form]').forEach(wireForm);

    // inline-form shortcuts: <a data-fill-form="#request" data-type="Custom" data-segment="Event">
    $$('[data-fill-form]').forEach((a) => a.addEventListener('click', () => {
      const form = $(`${a.dataset.fillForm} [data-sample-form]`) || $(a.dataset.fillForm);
      if (!form) return;
      if (a.dataset.type) form.request_type.value = a.dataset.type;
      if (a.dataset.segment && form.segment) form.segment.value = a.dataset.segment;
    }));

    const dlg = $('#sample-dlg');
    if (!dlg) return;
    wireClose(dlg);
    const form = $('[data-sample-form]', dlg);
    const COPY = {
      'Sample': ['sample', '1 free sample coaster for retail buyers', 'Get a free sample', 'Send my sample'],
      'Half Dozen order': ['biz', "We'll confirm details and pricing", 'Order a Half Dozen', 'Send my order'],
      'Half Dozen sample': ['biz', '6 free sample coasters for wholesale buyers', 'Get 6 free sample coasters', 'Send my samples'],
      'Product question': ['biz', 'Ask us anything', 'Ask about this batch', 'Send my question'],
      Custom: ['biz', 'Baked to order', 'Custom order', 'Send my request'],
    };
    // Retail samples are one coaster shipped to an address; business requests keep business/city/logo.
    const applyType = () => {
      const [mode, eyebrow, title, submit] = COPY[form.request_type.value] || COPY['Half Dozen sample'];
      $$('[data-mode]', form).forEach((el) => {
        const on = el.dataset.mode === mode;
        el.hidden = !on;
        $$('input', el).forEach((i) => { i.disabled = !on; });
      });
      $('[data-dlg-eyebrow]', dlg).textContent = eyebrow;
      $('[data-dlg-title]', dlg).textContent = title;
      $('[data-submit]', form).textContent = submit;
    };
    form.request_type.addEventListener('change', applyType);
    $$('[data-open-sample]').forEach((btn) => btn.addEventListener('click', () => {
      $('[data-form-view]', dlg).hidden = false; $('[data-success-view]', dlg).hidden = true;
      $('[data-form-error]', dlg).textContent = '';
      form.request_type.value = btn.dataset.type || 'Half Dozen sample';
      applyType();
      form.product.value = btn.dataset.product || '';
      if (form.segment && btn.dataset.segment) form.segment.value = btn.dataset.segment;
      if (btn.dataset.product && !form.notes.value) form.notes.value = `About: ${btn.dataset.product}`;
      openDlg(dlg);
    }));
  }

  function wireForm(form) {
    const box = form.closest('[data-form-box]') || form.closest('dialog') || form.parentElement.parentElement;
    const err = $('[data-form-error]', box);
    const formView = $('[data-form-view]', box);
    const okView = $('[data-success-view]', box);
    form.source_page.value = location.pathname;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!form.checkValidity()) {
        const bad = $$(':invalid', form)[0];
        err.textContent = 'Please fill in the required fields.';
        bad?.focus();
        return;
      }
      const file = form.logo.files[0];
      if (file && file.size > 4 * 1024 * 1024) { err.textContent = 'Logo must be 4 MB or smaller.'; return; }
      const btn = $('[type=submit]', form);
      btn.disabled = true;
      try {
        const res = await fetch(`${API}/sample-request`, { method: 'POST', body: new FormData(form) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Something went wrong.');
        form.reset();
        form.source_page.value = location.pathname;
        formView.hidden = true; okView.hidden = false;
        ($('[data-close]', okView) || okView).focus?.();
      } catch (ex) {
        err.textContent = typeof ex.message === 'string' ? ex.message : 'Something went wrong. Try again or email hello@juplifestudio.com.';
      } finally { btn.disabled = false; }
    });
  }

  /* ---------- Bag + Stripe Checkout ---------- */
  const BAG_KEY = 'jup_bag_v1';
  const loadBag = () => { try { return JSON.parse(localStorage.getItem(BAG_KEY)) || []; } catch { return []; } };
  const saveBag = (bag) => { try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch { /* private mode: bag lives in memory */ } };
  let bag = loadBag();

  function renderBag() {
    const count = bag.reduce((n, i) => n + i.qty, 0);
    $$('[data-bag-count]').forEach((el) => { el.textContent = count; });
    $$('[data-open-bag]').forEach((el) => el.setAttribute('aria-label', `Bag, ${count} item${count === 1 ? '' : 's'}`));
    const list = $('[data-bag-list]');
    if (!list) return;
    list.replaceChildren(...bag.map((i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span><strong></strong><br><span class="sub"></span></span>
        <span class="qty"><button type="button" aria-label="One fewer">−</button><span aria-live="polite"></span><button type="button" aria-label="One more">+</button></span>`;
      $('strong', li).textContent = i.name;
      $('.sub', li).textContent = money(i.price);
      $('.qty span', li).textContent = i.qty;
      const [minus, plus] = $$('button', li);
      minus.addEventListener('click', () => setQty(i.sku, i.qty - 1));
      plus.addEventListener('click', () => setQty(i.sku, i.qty + 1));
      return li;
    }));
    $('[data-bag-empty]').hidden = bag.length > 0;
    $('[data-checkout]').disabled = bag.length === 0;
    $('[data-bag-subtotal]').textContent = money(bag.reduce((s, i) => s + i.price * i.qty, 0));
  }
  function setQty(sku, qty) {
    bag = bag.map((i) => (i.sku === sku ? { ...i, qty: Math.min(qty, 20) } : i)).filter((i) => i.qty > 0);
    saveBag(bag); renderBag();
  }

  function initBag() {
    const dlg = $('#bag-dlg');
    if (!dlg) return;
    wireClose(dlg);
    $$('[data-open-bag]').forEach((b) => b.addEventListener('click', () => openDlg(dlg)));
    $$('[data-add-to-bag]').forEach((b) => b.addEventListener('click', () => {
      // price shown client-side is display only; the server maps sku -> Stripe Price
      const { sku, name, price } = b.dataset;
      const hit = bag.find((i) => i.sku === sku);
      if (hit) hit.qty = Math.min(hit.qty + 1, 20); else bag.push({ sku, name, price: Number(price), qty: 1 });
      saveBag(bag); renderBag(); openDlg(dlg);
    }));
    $('[data-checkout]', dlg).addEventListener('click', async (e) => {
      const btn = e.currentTarget; const err = $('[data-bag-error]', dlg);
      err.textContent = ''; btn.disabled = true; btn.textContent = 'One moment…';
      try {
        const res = await fetch(`${API}/checkout`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: bag.map(({ sku, qty }) => ({ sku, qty })) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data.detail || 'Checkout is unavailable right now.');
        location.assign(data.url);
      } catch (ex) {
        err.textContent = `${ex.message} You can also call 561-532-7120.`;
        btn.disabled = false; btn.textContent = 'Checkout';
      }
    });
    // Returning from Stripe: success clears the bag; show the matching banner if the page has one
    const status = new URLSearchParams(location.search).get('checkout');
    if (status === 'success') { bag = []; saveBag(bag); }
    if (status) { const b = $(`[data-checkout-banner="${status}"]`); if (b) b.hidden = false; }
    renderBag();
  }

  /* ---------- Fade-up, once ---------- */
  function initReveal() {
    const els = $$('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { rootMargin: '0px 0px -10% 0px' });
    els.forEach((e) => io.observe(e));
  }

  /* ---------- Drops signup ---------- */
  function initDrops() {
    $$('[data-drops-form]').forEach((form) => {
      const msg = $('[data-drops-msg]', form);
      form.source_page.value = location.pathname;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.className = 'drops-msg'; msg.textContent = '';
        if (!form.checkValidity()) { msg.classList.add('bad'); msg.textContent = 'Please enter a valid email address.'; form.email.focus(); return; }
        const btn = $('[type=submit]', form); btn.disabled = true;
        try {
          const res = await fetch(`${API}/drops`, { method: 'POST', body: new FormData(form) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Something went wrong. Try again.');
          form.reset(); form.source_page.value = location.pathname;
          msg.textContent = "You're on the list. We'll send word when the next tray comes out.";
        } catch (ex) { msg.classList.add('bad'); msg.textContent = ex.message; }
        finally { btn.disabled = false; }
      });
    });
  }

  renderBatch(); initSample(); initBag(); initDrops(); initReveal();
})();
