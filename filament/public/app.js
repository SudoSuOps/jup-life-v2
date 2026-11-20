// JUP LIFE filament shelf: talks to /api/* (D1). Sign-in is handled by Cloudflare Access in front of the site.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const GROUPS = ['Stock', 'Pop', 'Flower', 'Coastal', 'Other'];
  const GROUP_LABEL = { Stock: 'Spools on the shelf', Pop: 'Pop Coasters', Flower: 'Flower Coasters', Coastal: 'Coastal Coasters', Other: 'Cases & other' };
  // Manufacturer print temps (°C). Filled into a color when you pick its maker and the temps are blank.
  const PRESETS = {
    'SUNLU': { nozzle: '190-210', bed: '50-60', product: 'SUNLU High Speed TPU 95A', note: '210-230 °C if printing 80-120 mm/s' },
    'QIDI': { nozzle: '210-230', bed: '20-50', product: 'QIDI TPU 95A HF' },
    'Bambu Lab': { nozzle: '220-240', bed: '30-36', product: 'Bambu TPU 95A HF' },
  };
  let filaments = [], deals = [], settings = { spoolG: 1000, lowSpools: 1, targetSpools: 3 }, filter = 'all';
  const pending = new Map();

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const money = (n) => (n == null ? '–' : '$' + n.toFixed(2));
  const setSync = (t) => { $('#sync').textContent = t; };

  async function api(path, opts = {}) {
    const r = await fetch('/api/' + path, {
      ...opts, credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    if (r.status === 401) { showBanner('Your sign-in expired. Reload the page to sign in again.'); throw new Error('auth'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }
  function showBanner(t) { const b = $('#banner'); b.textContent = t; b.hidden = !t; }

  function calc(f) {
    const full = num(f.full), part = num(f.partialG);
    if (full == null && part == null) return { counted: false, grams: 0, status: 'idle', toOrder: 0 };
    const g = (full || 0) * settings.spoolG + (part || 0);
    const low = g < settings.lowSpools * settings.spoolG;
    const toOrder = low ? Math.max(0, Math.ceil((settings.targetSpools * settings.spoolG - g) / settings.spoolG)) : 0;
    return { counted: true, grams: g, status: low ? 'order' : 'ok', toOrder };
  }
  const pillHTML = (c) => c.status === 'order' ? `<span class="pill order">ORDER ${c.toOrder}</span>` : c.status === 'ok' ? '<span class="pill ok">OK</span>' : '<span class="pill idle">Count me</span>';
  const tallyHTML = (c) => `<span>On hand <strong>${c.counted ? Math.round(c.grams).toLocaleString() + ' g' : '–'}</strong></span><span>${c.counted ? (c.grams / settings.spoolG).toFixed(1) + ' spools' : 'not counted'}</span>`;

  function renderSummary() {
    let order = 0, spools = 0, idle = 0, grams = 0;
    for (const f of filaments) { const c = calc(f); if (!c.counted) idle++; else { grams += c.grams; if (c.status === 'order') { order++; spools += c.toOrder; } } }
    const has = filaments.length > 0;
    $('#s-order').textContent = has ? order : '–';
    $('#s-spools').textContent = has ? spools : '–';
    $('#s-idle').textContent = has ? idle : '–';
    $('#s-kg').textContent = has ? (grams / 1000).toFixed(1) + ' kg' : '–';
  }

  function cardHTML(f) {
    const c = calc(f);
    const reelCls = !f.hex ? 'reel none' : f.clear ? 'reel clear' : 'reel';
    const mats = ['', 'TPU', 'PLA', 'PETG', 'Other'].map((m) => `<option ${f.material === m ? 'selected' : ''} value="${m}">${m || '–'}</option>`).join('');
    const makers = ['', 'SUNLU', 'QIDI', 'Bambu Lab', 'Other'].map((m) => `<option ${f.maker === m ? 'selected' : ''} value="${m}">${m || '–'}</option>`).join('');
    const id = esc(f.id);
    return `<article class="spool ${c.status === 'order' ? 'order' : ''}" data-id="${id}">
      <div class="${reelCls}" style="--sw:${esc(f.hex || 'transparent')}" aria-hidden="true"></div>
      <div class="spool-head"><span class="name">${esc(f.name)} ${pillHTML(c)}</span><span class="used">${esc(f.usedIn || '')}${f.hex ? ' · ' + esc(f.hex) : ''}</span></div>
      <div class="fields">
        <label for="full-${id}">Full spools<input id="full-${id}" type="number" min="0" step="1" inputmode="numeric" data-k="full" value="${esc(f.full ?? '')}"></label>
        <label for="part-${id}">Open spool (g left)<input id="part-${id}" type="number" min="0" step="10" inputmode="numeric" data-k="partialG" value="${esc(f.partialG ?? '')}"></label>
        <label for="maker-${id}">Maker<select id="maker-${id}" data-k="maker">${makers}</select></label>
        <label for="mat-${id}">Material<select id="mat-${id}" data-k="material">${mats}</select></label>
        <label for="brand-${id}" class="span2">Product / color code<input id="brand-${id}" type="text" data-k="brand" value="${esc(f.brand || '')}" placeholder="e.g. SUNLU TPU 95A, Orange"></label>
        <label for="noz-${id}">Print temp (°C)<input id="noz-${id}" type="text" inputmode="numeric" data-k="nozzle" value="${esc(f.nozzle || '')}" placeholder="210-230"></label>
        <label for="bed-${id}">Bed temp (°C)<input id="bed-${id}" type="text" inputmode="numeric" data-k="bed" value="${esc(f.bed || '')}" placeholder="30-36"></label>
      </div>
      <div class="tally">${tallyHTML(c)}</div>
      <form class="log" data-log="${id}"><label for="use-${id}">Log a print (g used)<input id="use-${id}" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 84"></label><button class="btn ghost small" type="submit">Log</button></form>
      ${f.note ? `<p class="note">${esc(f.note)}</p>` : ''}
    </article>`;
  }

  function renderChart() {
    const box = $('#chart');
    if (!filaments.length) { box.innerHTML = '<p class="empty">No colors yet. Use “+ Add color” to start the chart.</p>'; return; }
    let html = '';
    for (const g of GROUPS) {
      const list = filaments.filter((f) => (f.group || 'Other') === g).filter((f) => filter === 'all' || calc(f).status === filter)
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
      if (list.length) html += `<div class="group" style="margin-bottom:22px"><h3>${GROUP_LABEL[g]}</h3><div class="grid">${list.map(cardHTML).join('')}</div></div>`;
    }
    box.innerHTML = html || '<p class="empty">Nothing matches this filter.</p>';
  }

  function renderDeals() {
    const tb = $('#deals');
    if (!deals.length) { tb.innerHTML = '<tr><td colspan="10" class="empty">No deals saved yet. Add the next bulk offer you get above.</td></tr>'; return; }
    const today = new Date().toISOString().slice(0, 10);
    const rows = deals.map((d) => { const p = num(d.price), s = num(d.sizeG) || 1000; return { ...d, perKg: p == null ? null : p / (s / 1000), expired: !!(d.expires && d.expires < today) }; })
      .sort((a, b) => (a.expired - b.expired) || ((a.perKg ?? 1e9) - (b.perKg ?? 1e9)));
    const best = rows.find((r) => !r.expired && r.perKg != null);
    tb.innerHTML = rows.map((r) => {
      const total = num(r.price) != null && num(r.minQty) != null ? money(num(r.price) * num(r.minQty)) : '–';
      const link = r.link && /^https?:\/\//i.test(r.link) ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.link.replace(/^https?:\/\//, '').slice(0, 40))}</a>` : '';
      return `<tr class="${r === best ? 'best' : ''} ${r.expired ? 'expired' : ''}">
        <td><strong>${esc(r.supplier)}</strong>${r === best ? '<span class="tag-best">Best</span>' : ''}</td>
        <td>${esc(r.what || '')}</td><td>${esc(r.material || '–')}</td>
        <td class="num">${money(num(r.price))}</td><td class="num">${money(r.perKg)}</td>
        <td class="num">${esc(r.minQty ?? '–')}</td><td class="num">${total}</td>
        <td class="num">${r.expires ? esc(r.expires) : '–'} ${r.expired ? '<span class="tag-exp">ended</span>' : ''}</td>
        <td>${link}${link && r.notes ? '<br>' : ''}${esc(r.notes || '')}</td>
        <td><button class="btn ghost small" data-del-deal="${esc(r.id)}">Remove</button></td></tr>`;
    }).join('');
  }

  function renderSettings() { $('#set-spool').value = settings.spoolG; $('#set-low').value = settings.lowSpools; $('#set-target').value = settings.targetSpools; }
  function renderAll() { renderSummary(); renderChart(); renderDeals(); }

  function refreshCard(card, f) {
    const c = calc(f);
    card.classList.toggle('order', c.status === 'order');
    card.querySelector('.pill').outerHTML = pillHTML(c);
    card.querySelector('.tally').innerHTML = tallyHTML(c);
  }

  // one write per color, coalesced while typing
  function queueWrite(id, patch) {
    const cur = pending.get(id) || { patch: {}, t: 0 };
    Object.assign(cur.patch, patch); clearTimeout(cur.t);
    cur.t = setTimeout(async () => {
      pending.delete(id); setSync('Saving…');
      try { await api('filaments/' + encodeURIComponent(id), { method: 'PATCH', body: cur.patch }); setSync('Saved'); }
      catch (e) { if (e.message !== 'auth') setSync("Couldn't save: " + e.message); }
    }, 600);
    pending.set(id, cur);
  }

  document.addEventListener('input', (ev) => {
    const el = ev.target; const card = el.closest?.('.spool'); if (!card || !el.dataset.k) return;
    const id = card.dataset.id, k = el.dataset.k;
    let v = el.value; if (k === 'full' || k === 'partialG') v = v === '' ? null : Math.max(0, parseFloat(v) || 0);
    const f = filaments.find((x) => x.id === id); if (!f) return;
    if (k === 'nozzle' || k === 'bed') {
      v = v.trim().replace(/\s+/g, '').replace(/[–—]/g, '-').replace(/°?c$/i, '');
      const okT = v === '' || /^\d{2,3}(-\d{2,3})?$/.test(v);
      el.setCustomValidity(okT ? '' : 'Use a number or a range, like 215 or 210-230');
      if (!okT) return;
    }
    const patch = { [k]: v }; f[k] = v;
    if (k === 'maker' && PRESETS[v]) {
      const p = PRESETS[v];
      for (const [fk, pv] of [['nozzle', p.nozzle], ['bed', p.bed], ['brand', p.product]]) {
        if (!f[fk]) { f[fk] = pv; patch[fk] = pv; const inp = card.querySelector(`[data-k="${fk}"]`); if (inp) inp.value = pv; }
      }
      if (!f.material) { f.material = 'TPU'; patch.material = 'TPU'; const s = card.querySelector('[data-k="material"]'); if (s) s.value = 'TPU'; }
    }
    queueWrite(id, patch); renderSummary(); refreshCard(card, f);
  });
  document.addEventListener('change', (ev) => { if (ev.target.closest?.('.spool') && ev.target.tagName === 'SELECT') ev.target.dispatchEvent(new Event('input', { bubbles: true })); });

  document.addEventListener('submit', async (ev) => {
    const form = ev.target; const id = form.dataset?.log; if (!id) return;
    ev.preventDefault();
    const input = form.querySelector('input'); const grams = num(input.value); if (!grams || grams <= 0) return;
    setSync('Logging…');
    try {
      const res = await api('usage', { method: 'POST', body: { filament: id, grams, source: 'shelf page' } });
      const r = res.results[0]; const f = filaments.find((x) => x.id === id);
      if (f && r.full != null) { f.full = r.full; f.partialG = r.partialG; }
      input.value = ''; renderAll();
      setSync(r.short == null ? `Logged ${grams} g. Count ${r.name} so prints come off the shelf.` : r.short > 0 ? `Logged. ${r.name} ran out ${r.short} g short: restock it.` : `Logged ${grams} g of ${r.name}.`);
    } catch (e) { if (e.message !== 'auth') setSync("Couldn't log: " + e.message); }
  });

  let setT = 0;
  for (const [sel, key] of [['#set-spool', 'spoolG'], ['#set-low', 'lowSpools'], ['#set-target', 'targetSpools']]) {
    $(sel).addEventListener('input', (e) => {
      const v = num(e.target.value); if (v == null || v < 0) return;
      settings[key] = v; renderSummary(); renderChart();
      clearTimeout(setT); setT = setTimeout(async () => {
        try { settings = await api('settings', { method: 'PUT', body: settings }); setSync('Saved'); } catch (er) { if (er.message !== 'auth') setSync("Couldn't save: " + er.message); }
      }, 600);
    });
  }

  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderChart();
  }));

  $('#deal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = { supplier: $('#d-supplier').value.trim(), what: $('#d-what').value.trim(), material: $('#d-material').value, price: num($('#d-price').value), sizeG: num($('#d-size').value) || 1000, minQty: num($('#d-min').value), expires: $('#d-exp').value || null, link: $('#d-link').value.trim(), notes: $('#d-notes').value.trim() };
    if (!d.supplier || d.price == null) return;
    setSync('Saving…');
    try { const saved = await api('deals', { method: 'POST', body: d }); deals.unshift(saved); renderDeals(); e.target.reset(); $('#d-size').value = 1000; setSync('Deal saved'); }
    catch (er) { if (er.message !== 'auth') setSync("Couldn't save: " + er.message); }
  });
  $('#deals').addEventListener('click', async (e) => {
    const id = e.target.dataset?.delDeal; if (!id) return;
    const btn = e.target;
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Tap again to remove'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Remove'; }, 3000); return; }
    try { await api('deals/' + encodeURIComponent(id), { method: 'DELETE' }); deals = deals.filter((d) => d.id !== id); renderDeals(); setSync('Deal removed'); }
    catch (er) { if (er.message !== 'auth') setSync("Couldn't remove: " + er.message); }
  });

  $('#add-color').addEventListener('click', () => { $('#color-form').reset(); $('#color-dlg').showModal(); });
  $('#color-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok') return;
    const name = $('#c-name').value.trim(); if (!name) return;
    try {
      const f = await api('filaments', { method: 'POST', body: { name, hex: $('#c-hex').value, usedIn: $('#c-used').value.trim(), group: $('#c-group').value, clear: $('#c-clear').checked, order: 999 } });
      filaments.push(f); renderAll(); setSync('Color added');
    } catch (er) { if (er.message !== 'auth') setSync("Couldn't add: " + er.message); }
  });

  async function load(initial) {
    const typing = document.activeElement && document.activeElement.closest?.('#chart, #deal-form, .settings');
    if (!initial && (typing || pending.size)) return; // don't clobber what's being typed
    try {
      const [fl, dl] = await Promise.all([api('filaments'), api('deals')]);
      settings = fl.settings; filaments = fl.filaments; deals = dl.deals;
      renderSettings(); renderAll(); showBanner(''); setSync('Up to date');
    } catch (e) {
      if (e.message !== 'auth') { setSync("Can't reach the shelf right now."); if (initial) $('#chart').innerHTML = '<p class="empty">Couldn\'t load your colors. Check the connection and reload.</p>'; }
    }
  }
  renderSettings();
  load(true);
  // other devices (phone at the shelf, laptop) stay in step
  setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(false); });
})();
