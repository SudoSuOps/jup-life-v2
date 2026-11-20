/* JUP LIFE site JS. Vanilla, no deps, target < 10 KB minified.
   - Today's Batch board from JSON
   - Sample request <dialog> (+ "Product question" preselect)
   - Bag (localStorage) -> Shopify cart permalink on shop.juplifestudio.com (checkout lives in Shopify)
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
    const d = new Date((b.date || '') + 'T12:00:00');
    const dateEl = $('[data-batch-date]', board);
    if (dateEl && b.date && !isNaN(d)) {
      const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      dateEl.textContent = `${day} ${mon} ${d.getDate()}`;
    }
    let noEl = $('[data-batch-no]', board);
    if (b.batch_no) {
      if (!noEl && dateEl) {
        dateEl.insertAdjacentHTML('afterend', ' · Batch #<span data-batch-no></span>');
        noEl = $('[data-batch-no]', board);
      }
      if (noEl) noEl.textContent = b.batch_no;
    } else if (noEl) {
      const prev = noEl.previousSibling;
      if (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent.includes('Batch #')) prev.remove();
      noEl.remove();
    }
    $('[data-batch-tray]', board).textContent = b.tray;
    const ul = $('[data-batch-rows]', board);
    ul.replaceChildren(...(b.flavors || []).slice(0, 6).map((f) => {
      const li = document.createElement('li');
      li.className = 'row';
      const sw = document.createElement('span'); sw.className = /^Coconut/.test(f.name) ? 'swatch swatch-clear' : 'swatch'; sw.style.background = f.hex; sw.setAttribute('aria-hidden', 'true');
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

  /* ---------- Free sample request (modal + any inline [data-sample-form]) ---------- */
  // One form: name, company, email, phone, ship to. The modal heading follows the button that opened it.
  const DLG_COPY = {
    Sample: ['Free samples · by request', 'Request a free sample', 'Send my free sample'],
    'Product question': ['Ask us anything', 'Ask about a coaster', 'Send my question'],
    Custom: ['Baked to order', 'Custom order', 'Send my request'],
  };
  function setDialogCopy(dlg, form) {
    const [eyebrow, title, label] = DLG_COPY[form.request_type?.value] || DLG_COPY.Sample;
    const eye = $('[data-dlg-eyebrow]', dlg); if (eye) eye.textContent = eyebrow;
    const h = $('[data-dlg-title]', dlg); if (h) h.textContent = title;
    const submit = $('[data-submit]', form); if (submit) submit.textContent = label;
  }

  function initSample() {
    // every form with [data-sample-form] lives inside a container holding [data-form-view] + [data-success-view]
    $$('[data-sample-form]').forEach(wireForm);

    const dlg = $('#sample-dlg');
    if (!dlg) return;
    wireClose(dlg);
    const form = $('[data-sample-form]', dlg);
    $$('[data-open-sample]').forEach((btn) => btn.addEventListener('click', () => {
      $('[data-form-view]', dlg).hidden = false; $('[data-success-view]', dlg).hidden = true;
      $('[data-form-error]', dlg).textContent = '';
      form.request_type.value = DLG_COPY[btn.dataset.type] ? btn.dataset.type : 'Sample';
      form.product.value = btn.dataset.product || '';
      if (btn.dataset.product && !form.notes.value) form.notes.value = `About: ${btn.dataset.product}`;
      setDialogCopy(dlg, form);
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
      const file = form.logo && !form.logo.disabled ? form.logo.files[0] : null;
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

  /* ---------- Bag -> Shopify checkout ---------- */
  // Variant IDs come from web/data/shopify.json (embedded as #shopify-map). The site never charges anything:
  // Checkout builds a Shopify cart permalink, /cart/<variant>:<qty>,..., and Shopify takes it from there.
  const BAG_KEY = 'jup_bag_v2';
  const loadBag = () => { try { return JSON.parse(localStorage.getItem(BAG_KEY)) || []; } catch { return []; } };
  const saveBag = (bag) => { try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch { /* private mode: bag lives in memory */ } };
  try { localStorage.removeItem('jup_bag_v1'); } catch { /* old Stripe-era bag */ }
  let bag = loadBag();
  let shop = null;
  try { shop = JSON.parse($('#shopify-map')?.textContent || 'null'); } catch { shop = null; }

  const variantFor = (sku, opts) => {
    const entry = shop?.products?.[sku];
    if (!entry) return null;
    return entry.variants[entry.options.map((k) => opts[k] || '').join('|')] || null;
  };
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
      const detail = Object.values(i.opts || {}).filter(Boolean).join(' · ');
      $('.sub', li).textContent = detail ? `${detail} · ${money(i.price)}` : money(i.price);
      $('.qty span', li).textContent = i.qty;
      const [minus, plus] = $$('button', li);
      minus.addEventListener('click', () => setQty(i.variant, i.qty - 1));
      plus.addEventListener('click', () => setQty(i.variant, i.qty + 1));
      return li;
    }));
    $('[data-bag-empty]').hidden = bag.length > 0;
    $('[data-checkout]').disabled = bag.length === 0;
    $('[data-bag-subtotal]').textContent = money(bag.reduce((s, i) => s + i.price * i.qty, 0));
  }
  function setQty(variant, qty) {
    bag = bag.map((i) => (i.variant === variant ? { ...i, qty: Math.min(qty, 20) } : i)).filter((i) => i.qty > 0);
    saveBag(bag); renderBag();
  }
  function choiceFrom(card) {
    const opts = {};
    if (!card) return opts;
    $$('[data-option]', card).forEach((fs) => {
      const checked = fs.querySelector('input:checked');
      if (checked) opts[fs.dataset.option] = checked.value;
    });
    return opts;
  }
  const cartUrl = (items) => `${shop.store}/cart/${items.map((i) => `${i.variant}:${i.qty}`).join(',')}?attributes[source]=juplifestudio.com`;

  function initBag() {
    const dlg = $('#bag-dlg');
    if (!dlg) return;
    wireClose(dlg);
    // drop anything saved before a variant changed in shopify.json
    if (shop) bag = bag.filter((i) => i.variant && variantFor(i.sku, i.opts || {}) === i.variant);
    $$('[data-open-bag]').forEach((b) => b.addEventListener('click', () => openDlg(dlg)));
    $$('[data-add-to-bag]').forEach((b) => b.addEventListener('click', () => {
      const { sku, name, price } = b.dataset;
      const opts = choiceFrom(b.closest('[data-coaster]'));
      const variant = variantFor(sku, opts);
      if (!variant) { b.textContent = 'Unavailable'; b.disabled = true; return; }
      const hit = bag.find((i) => i.variant === variant);
      if (hit) hit.qty = Math.min(hit.qty + 1, 20); else bag.push({ sku, name, price: Number(price), qty: 1, opts, variant });
      saveBag(bag); renderBag(); openDlg(dlg);
    }));
    $('[data-checkout]', dlg).addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (!bag.length || !shop?.store) return;
      btn.disabled = true; btn.textContent = 'Opening checkout…';
      const url = cartUrl(bag);
      // Shopify now holds the cart; clear ours so a return visit starts fresh.
      bag = []; saveBag(bag);
      location.assign(url);
    });
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

  function shotFor(book, sku, opts) {
    const entry = book[sku];
    if (!entry) return null;
    const pick = (group, key) => (group && key && group[key] && group[key].img ? group[key] : null);
    if (opts.flower) return pick(entry.flower, opts.flower) || entry.card || null;
    if (opts.tray && opts.tray !== 'Mixed') return pick(entry.tray, opts.tray) || pick(entry.style, opts.style) || entry.card || null;
    return pick(entry.style, opts.style) || pick(entry.tray, opts.tray) || entry.card || null;
  }

  function showShot(card, shot) {
    const figure = $('[data-product-figure]', card);
    if (!figure || !shot) return;
    const img = $('img', figure);
    const cap = $('[data-photo-cap]', figure);
    const well = $('[data-photo-well]', figure);
    if (!shot.img) {
      if (img) img.hidden = true;
      if (well) {
        well.hidden = false;
        const ph = $('[data-photo-ph]', well);
        if (ph) ph.textContent = shot.placeholder || 'Photo coming';
      }
      if (cap) cap.hidden = true;
      return;
    }
    if (well) well.hidden = true;
    if (img) {
      img.hidden = false;
      const next = `/${String(shot.img).replace(/^\//, '')}`;
      if (img.getAttribute('src') !== next) {
        img.src = next;
        img.removeAttribute('srcset');
        $$('source', figure).forEach((s) => s.remove());
      }
      img.alt = shot.alt || '';
    }
    if (cap) {
      const label = typeof shot.caption === 'string' ? shot.caption.trim() : '';
      const show = label && !/studio rendering|concept render/i.test(label);
      cap.hidden = !show;
      cap.textContent = show ? label : '';
    }
  }

  function initPhotos() {
    const raw = $('#photo-book');
    if (!raw) return;
    let book;
    try { book = JSON.parse(raw.textContent); } catch { return; }
    $$('[data-coaster]').forEach((card) => {
      const apply = () => showShot(card, shotFor(book, card.dataset.coaster, choiceFrom(card)));
      $$('[data-option] input', card).forEach((input) => input.addEventListener('change', apply));
    });
  }

  renderBatch(); initSample(); initPhotos(); initBag(); initDrops(); initReveal();
})();
