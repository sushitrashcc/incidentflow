/* Cartora storefront (hash-routed single page app) */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const view = $('#view');
  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const off = (p) => Math.round((1 - p.price / p.mrp) * 100);

  const ICONS = {
    electronics: '<path d="M4 14a8 8 0 0 1 16 0"/><rect x="2.5" y="13" width="4.5" height="7" rx="2"/><rect x="17" y="13" width="4.5" height="7" rx="2"/>',
    fashion: '<path d="M8 3l4 3 4-3 5 4-3 4-2-1v11H8V10l-2 1-3-4z"/>',
    home: '<path d="M4 10h16v3a8 8 0 0 1-16 0z"/><path d="M2 10h20M9 6c0-1.5 1-1.5 1-3M14 6c0-1.5 1-1.5 1-3"/>',
    beauty: '<rect x="8" y="9" width="8" height="12" rx="2"/><path d="M10 9V6h4v3M12 3v3"/>',
    sports: '<path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12"/>',
    books: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>'
  };
  const icon = (cat, extra = '') => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' + extra + '>' + (ICONS[cat] || ICONS.home) + '</svg>';

  // Text colour that reads on the product's swatch colour.
  function onColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return l > 0.6 ? '#13294b' : '#ffffff';
  }
  function art(p) {
    const drawn = window.CARTORA_ART && window.CARTORA_ART(p);
    if (drawn) {
      const [svg, bg, ink] = drawn.split('|');
      return '<div class="art" style="background:' + bg + '">' + svg + '<span class="bn" style="color:' + ink + '">' + esc(p.brand) + '</span></div>';
    }
    const fg = onColor(p.color);
    return '<div class="art" style="background:' + p.color + ';color:' + fg + '">' + icon(p.category) + '<span class="bn">' + esc(p.brand) + '</span></div>';
  }
  function media(p, withTag = true) {
    return '<div class="pimg">' + art(p) +
      (withTag && off(p) >= 40 ? '<span class="tag">' + off(p) + '% off</span>' : '') + '</div>';
  }

  // ---------- state ----------
  let products = [];
  let categories = [];
  const byId = (id) => products.find((p) => p.id === id);
  const cart = {
    read() { try { return JSON.parse(localStorage.getItem('cartora_cart') || '[]'); } catch { return []; } },
    write(items) { try { localStorage.setItem('cartora_cart', JSON.stringify(items)); } catch {} renderCount(); },
    add(id, qty = 1) {
      const items = this.read();
      const it = items.find((i) => i.id === id);
      if (it) it.qty = Math.min(10, it.qty + qty); else items.push({ id, qty });
      this.write(items);
    },
    set(id, qty) { this.write(this.read().map((i) => (i.id === id ? { ...i, qty } : i)).filter((i) => i.qty > 0)); },
    clear() { this.write([]); }
  };

  function renderCount() { $('#cartCount').textContent = cart.read().reduce((s, i) => s + i.qty, 0); }
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
  }
  async function api(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(body.error || 'Request failed'); e.body = body; e.status = res.status; throw e; }
    return body;
  }

  // ---------- pieces ----------
  function card(p) {
    return '<article class="card">' +
      '<a class="media" href="#/p/' + p.id + '" tabindex="-1" aria-hidden="true">' + media(p) + '</a>' +
      '<div class="body"><span class="brand">' + esc(p.brand) + '</span>' +
      '<h3><a href="#/p/' + p.id + '">' + esc(p.name) + '</a></h3>' +
      '<span class="rating"><b>' + p.rating.toFixed(1) + ' ★</b>' + p.reviews.toLocaleString('en-IN') + ' ratings</span>' +
      '<div class="price"><span class="now">' + inr(p.price) + '</span><s>' + inr(p.mrp) + '</s><span class="off">' + off(p) + '% off</span></div>' +
      (p.stock <= 10 ? '<span class="low">Only ' + p.stock + ' left</span>' : '') +
      '<div class="add"><button class="btn primary small" data-add="' + p.id + '">Add to cart</button></div>' +
      '</div></article>';
  }
  const grid = (list) => list.length ? '<div class="grid">' + list.map(card).join('') + '</div>'
    : '<div class="panel empty"><h2>No products match your search</h2><p class="muted">Try a shorter word, or browse a category above.</p></div>';

  const marigolds = '<svg class="marigolds" viewBox="0 0 300 300" aria-hidden="true">' +
    [[200, 190, 70], [110, 250, 46], [262, 92, 40]].map(([x, y, r]) => {
      let petals = '';
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        petals += '<ellipse cx="' + (x + Math.cos(a) * r * 0.55).toFixed(1) + '" cy="' + (y + Math.sin(a) * r * 0.55).toFixed(1) + '" rx="' + (r * 0.32).toFixed(1) + '" ry="' + (r * 0.5).toFixed(1) + '" transform="rotate(' + (a * 180 / Math.PI + 90).toFixed(1) + ' ' + (x + Math.cos(a) * r * 0.55).toFixed(1) + ' ' + (y + Math.sin(a) * r * 0.55).toFixed(1) + ')" fill="' + (i % 2 ? '#f5a524' : '#f7b53f') + '"/>';
      }
      return petals + '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.34).toFixed(1) + '" fill="#d98a07"/>';
    }).join('') + '</svg>';

  // ---------- views ----------
  function home() {
    const deals = products.filter((p) => off(p) >= 45).slice(0, 4);
    const picks = ['p202', 'p301', 'p401', 'p203', 'p601', 'p303', 'p204', 'p402'].map(byId).filter(Boolean);
    view.innerHTML =
      '<div class="wrap">' +
      '<section class="hero">' +
        '<div class="hero-main">' + marigolds +
          '<h1>Diwali Dhamaka Sale is live</h1>' +
          '<p>Up to 60% off audio, kitchen and fashion. Extra 10% instant discount with UPI on orders above ₹1,499.</p>' +
          '<a class="btn primary" href="#/c/electronics">Shop the Diwali sale</a>' +
        '</div>' +
        '<div class="hero-side">' +
          '<a class="promo a" href="#/c/home"><div><h2>Kitchen upgrade</h2><p>Tri-ply cookware and dinner sets from ₹899</p></div><span>Shop home & kitchen</span></a>' +
          '<a class="promo b" href="#/c/books"><div><h2>Read something new</h2><p>Tech and business bestsellers under ₹600</p></div><span>Browse books</span></a>' +
        '</div>' +
      '</section>' +
      '<div class="trust">' +
        trust('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>', 'Free delivery', 'On orders above ₹999') +
        trust('<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/>', '7-day returns', 'No questions asked') +
        trust('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>', 'UPI, cards & COD', 'Secure checkout') +
        trust('<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="m9 12 2 2 4-4"/>', 'Genuine products', 'Sourced from brands') +
      '</div>' +
      '<section class="block"><div class="block-head"><h2>Shop by category</h2></div><div class="cat-tiles">' +
        categories.map((c) => '<a class="cat-tile" href="#/c/' + c.id + '"><span class="ic">' + icon(c.id) + '</span><strong>' + esc(c.name) + '</strong><small>' + esc(c.blurb) + '</small></a>').join('') +
      '</div></section>' +
      '<section class="block"><div class="block-head"><h2>Deals of the day <span class="timer" id="timer"></span></h2><a href="#/s/">See all products</a></div>' + grid(deals) + '</section>' +
      '<section class="block"><div class="block-head"><h2>Popular right now</h2></div>' + grid(picks) + '</section>' +
      '</div>';
    tick();
  }
  function trust(path, a, b) {
    return '<div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg><span><strong>' + a + '</strong>' + b + '</span></div>';
  }
  let timerHandle;
  function tick() {
    clearInterval(timerHandle);
    const draw = () => {
      const el = $('#timer'); if (!el) return clearInterval(timerHandle);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const s = Math.max(0, Math.floor((end - new Date()) / 1000));
      el.textContent = 'Ends in ' + [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    };
    draw(); timerHandle = setInterval(draw, 1000);
  }

  async function listing(title, query) {
    view.innerHTML = '<div class="wrap"><p class="crumbs">Loading products…</p></div>';
    try {
      const list = await api('/api/products' + query);
      view.innerHTML = '<div class="wrap"><p class="crumbs"><a href="#/">Home</a> / ' + esc(title) + '</p>' +
        '<div class="block-head"><h2>' + esc(title) + '</h2><span class="muted">' + list.length + ' items</span></div>' + grid(list) + '</div>';
    } catch (err) { failed(err); }
  }

  async function product(id) {
    const base = byId(id);
    if (!base) return notFound();
    view.innerHTML = '<div class="wrap"><p class="crumbs">Loading…</p></div>';
    let p = base;
    try { p = await api('/api/products/' + id); } catch {}
    const cat = categories.find((c) => c.id === p.category) || { name: '' };
    const stockLine = p.stock == null
      ? '<p class="low">Live stock could not be checked. You can still add this to your cart.</p>'
      : p.stock <= 10 ? '<p class="low">Hurry, only ' + p.stock + ' left in stock</p>' : '<p style="color:var(--leaf);font-weight:600">In stock</p>';
    view.innerHTML = '<div class="wrap"><p class="crumbs"><a href="#/">Home</a> / <a href="#/c/' + p.category + '">' + esc(cat.name) + '</a> / ' + esc(p.name) + '</p>' +
      '<div class="pdp"><div>' + media(p) + '</div><div>' +
        '<span class="brand muted" style="font-weight:600">' + esc(p.brand) + '</span><h1>' + esc(p.name) + '</h1>' +
        '<span class="rating"><b>' + p.rating.toFixed(1) + ' ★</b>' + p.reviews.toLocaleString('en-IN') + ' ratings</span>' +
        '<div class="price" style="margin-top:12px"><span class="now">' + inr(p.price) + '</span><s>MRP ' + inr(p.mrp) + '</s><span class="off">' + off(p) + '% off</span></div>' +
        '<p class="muted" style="font-size:13px;margin:2px 0 0">Inclusive of all taxes</p>' + stockLine +
        '<div class="offers"><strong>Available offers</strong><ul>' +
          '<li>10% instant discount with UPI on orders above ₹1,499</li><li>No-cost EMI on credit cards above ₹2,999</li><li>Free delivery on this order' + (p.price >= 999 ? '' : ' when you add ₹' + (999 - p.price) + ' more') + '</li></ul></div>' +
        '<div class="buy"><button class="btn primary" data-add="' + p.id + '">Add to cart</button><button class="btn dark" data-buy="' + p.id + '">Buy now</button></div>' +
        '<p class="desc">' + esc(p.desc) + '</p>' +
        '<form class="pin" id="pinForm"><label class="sr" for="pin">PIN code</label><input id="pin" inputmode="numeric" maxlength="6" placeholder="Enter PIN code" value="603203"><button class="btn ghost">Check</button></form>' +
        '<p class="muted" id="pinOut" style="font-size:14px">Delivery by ' + eta(4) + ' • Cash on delivery available</p>' +
      '</div></div>' +
      '<section class="block"><div class="block-head"><h2>Similar products</h2></div>' + grid(products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4)) + '</section></div>';
    $('#pinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('#pin').value.trim();
      $('#pinOut').textContent = /^\d{6}$/.test(v) ? 'Delivery to ' + v + ' by ' + eta(v.startsWith('6') ? 3 : 5) + ' • Cash on delivery available' : 'Enter a valid 6 digit PIN code';
    });
  }
  const eta = (d) => new Date(Date.now() + d * 86400000).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  function totals(items) {
    const subtotal = items.reduce((s, i) => s + byId(i.id).price * i.qty, 0);
    const mrp = items.reduce((s, i) => s + byId(i.id).mrp * i.qty, 0);
    const shipping = subtotal >= 999 || subtotal === 0 ? 0 : 49;
    return { subtotal, mrp, shipping, total: subtotal + shipping };
  }
  function summary(items, cta) {
    const t = totals(items);
    return '<div class="panel"><h2>Price details</h2><div class="sum">' +
      '<div><span>Price (' + items.reduce((s, i) => s + i.qty, 0) + ' items)</span><span>' + inr(t.mrp) + '</span></div>' +
      '<div><span>Discount</span><span style="color:var(--leaf)">− ' + inr(t.mrp - t.subtotal) + '</span></div>' +
      '<div><span>Delivery</span><span>' + (t.shipping ? inr(t.shipping) : '<span style="color:var(--leaf)">Free</span>') + '</span></div>' +
      '<div class="total"><span>Total</span><span>' + inr(t.total) + '</span></div></div>' +
      '<p style="color:var(--leaf);font-weight:600;font-size:14px">You save ' + inr(t.mrp - t.subtotal) + ' on this order</p>' + cta + '</div>';
  }

  function cartView() {
    const items = cart.read().filter((i) => byId(i.id));
    if (!items.length) {
      view.innerHTML = '<div class="wrap"><div class="panel empty" style="margin-top:18px"><h2>Your cart is empty</h2><p class="muted">Add a few things you like and they will show up here.</p><a class="btn primary" href="#/">Continue shopping</a></div></div>';
      return;
    }
    view.innerHTML = '<div class="wrap"><div class="two"><div class="panel"><h2>Your cart</h2>' +
      items.map((i) => { const p = byId(i.id); return '<div class="line"><a href="#/p/' + p.id + '">' + media(p, false) + '</a><div><strong style="font-weight:600">' + esc(p.name) + '</strong><div class="price"><span class="now" style="font-size:16px">' + inr(p.price) + '</span><s>' + inr(p.mrp) + '</s></div>' +
        '<span class="qty"><button data-q="' + p.id + '" data-d="-1" aria-label="Decrease quantity">−</button><span>' + i.qty + '</span><button data-q="' + p.id + '" data-d="1" aria-label="Increase quantity">+</button></span><button class="linkbtn" data-rm="' + p.id + '">Remove</button></div>' +
        '<strong>' + inr(p.price * i.qty) + '</strong></div>'; }).join('') +
      '</div>' + summary(items, '<a class="btn primary" style="width:100%" href="#/checkout">Proceed to checkout</a>') + '</div></div>';
  }

  function checkoutView() {
    const items = cart.read().filter((i) => byId(i.id));
    if (!items.length) return cartView();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('cartora_addr') || '{}'); } catch {}
    const v = (k) => esc(saved[k] || '');
    view.innerHTML = '<div class="wrap"><form id="co" class="two" novalidate><div class="panel"><h2>Delivery address</h2><div id="coErr"></div>' +
      '<div class="row2"><label class="f">Full name<input name="name" required autocomplete="name" value="' + v('name') + '"></label><label class="f">Mobile number<input name="phone" required inputmode="numeric" maxlength="10" autocomplete="tel-national" value="' + v('phone') + '"></label></div>' +
      '<label class="f">Email<input name="email" type="email" required autocomplete="email" value="' + v('email') + '"></label>' +
      '<label class="f">Address (house no, street, area)<input name="address" required autocomplete="street-address" value="' + v('address') + '"></label>' +
      '<div class="row2"><label class="f">City<input name="city" required autocomplete="address-level2" value="' + v('city') + '"></label><label class="f">PIN code<input name="pincode" required inputmode="numeric" maxlength="6" autocomplete="postal-code" value="' + v('pincode') + '"></label></div>' +
      '<h2 style="margin-top:10px">Payment method</h2><div class="pay">' +
        '<label><input type="radio" name="payment" value="upi" checked><span><strong>UPI</strong><small>Google Pay, PhonePe, Paytm or any UPI app</small></span></label>' +
        '<label><input type="radio" name="payment" value="card"><span><strong>Credit or debit card</strong><small>Visa, Mastercard, RuPay</small></span></label>' +
        '<label><input type="radio" name="payment" value="cod"><span><strong>Cash on delivery</strong><small>Pay when your order arrives</small></span></label>' +
      '</div></div>' + summary(items, '<button class="btn primary" style="width:100%" id="placeBtn">Place order</button>') + '</form></div>';
    $('#co').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const customer = Object.fromEntries(['name', 'phone', 'email', 'address', 'city', 'pincode'].map((k) => [k, String(f.get(k) || '').trim()]));
      try { localStorage.setItem('cartora_addr', JSON.stringify(customer)); } catch {}
      const btn = $('#placeBtn'); btn.disabled = true; btn.textContent = 'Placing your order…';
      try {
        const order = await api('/api/orders', { method: 'POST', body: JSON.stringify({ items, customer, payment: f.get('payment') }) });
        cart.clear();
        try { sessionStorage.setItem('cartora_last', JSON.stringify(order)); } catch {}
        location.hash = '#/order/' + order.id;
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Place order';
        $('#coErr').innerHTML = '<div class="err">' + esc(err.message) + (err.body && err.body.incidentRef ? '<br><small>Reference: ' + esc(err.body.incidentRef) + '. Our team has been alerted automatically.</small>' : '') + '</div>';
        $('#coErr').scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }

  async function orderView(id, fresh) {
    view.innerHTML = '<div class="wrap"><p class="crumbs">Loading order…</p></div>';
    try {
      const o = await api('/api/orders/' + encodeURIComponent(id));
      const stage = o.tracking ? 2 : 1;
      view.innerHTML = '<div class="wrap"><div class="confirm panel">' +
        (fresh ? '<div class="tick"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="m5 12 5 5 9-10"/></svg></div><h1>Order placed</h1><p class="muted">Thank you! A confirmation has been sent to your email.</p>' : '<h1>Order ' + esc(o.id) + '</h1>') +
        '<p>Order ID <strong>' + esc(o.id) + '</strong> • ' + inr(o.total) + ' • ' + o.items.reduce((s, i) => s + i.qty, 0) + ' items</p>' +
        '<div class="steps"><div class="done">Confirmed</div><div class="' + (stage >= 2 ? 'done' : '') + '">Packed</div><div>Shipped</div><div>Delivered</div></div>' +
        (o.tracking ? '<p class="muted">' + esc(o.tracking.courier) + ': ' + esc(o.tracking.stage) + '. Expected by ' + new Date(o.tracking.eta).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '.</p>'
          : '<p class="low">' + esc(o.trackingError || 'Tracking unavailable') + '</p>') +
        '<a class="btn primary" href="#/">Continue shopping</a></div></div>';
    } catch (err) {
      view.innerHTML = '<div class="wrap"><div class="panel empty" style="margin-top:18px"><h2>We could not find order ' + esc(id) + '</h2><p class="muted">Check the order ID in your confirmation email and try again.</p><a class="btn dark" href="#/track">Track another order</a></div></div>';
    }
  }

  function trackView() {
    view.innerHTML = '<div class="wrap"><div class="panel" style="max-width:520px;margin:28px auto"><h2>Track your order</h2>' +
      '<form id="tf"><label class="f">Order ID<input name="id" required placeholder="e.g. CRT50001"></label><button class="btn dark">Track order</button></form></div></div>';
    $('#tf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/track/' + new FormData(e.target).get('id').trim().toUpperCase(); });
  }
  function notFound() { view.innerHTML = '<div class="wrap"><div class="panel empty" style="margin-top:18px"><h2>This page does not exist</h2><a class="btn primary" href="#/">Go to the homepage</a></div></div>'; }
  function failed(err) { view.innerHTML = '<div class="wrap"><div class="panel empty" style="margin-top:18px"><h2>Products could not be loaded</h2><p class="muted">' + esc(err.message) + '. Our team has been alerted. Please refresh in a minute.</p></div></div>'; }

  // ---------- router ----------
  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const [seg, arg] = [h.split('/')[0], h.split('/').slice(1).join('/')];
    document.querySelectorAll('#catNav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#/' + h));
    if (!seg) home();
    else if (seg === 'c') { const c = categories.find((x) => x.id === arg); c ? listing(c.name, '?category=' + c.id) : notFound(); }
    else if (seg === 's') { $('#q').value = arg; listing(arg ? 'Results for “' + arg + '”' : 'All products', arg ? '?q=' + encodeURIComponent(arg) : ''); }
    else if (seg === 'p') product(arg);
    else if (seg === 'cart') cartView();
    else if (seg === 'checkout') checkoutView();
    else if (seg === 'order') orderView(arg, true);
    else if (seg === 'track') arg ? orderView(arg, false) : trackView();
    else notFound();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { cart.add(add.dataset.add); toast('Added to cart'); return; }
    const buy = e.target.closest('[data-buy]');
    if (buy) { cart.add(buy.dataset.buy); location.hash = '#/checkout'; return; }
    const q = e.target.closest('[data-q]');
    if (q) { const it = cart.read().find((i) => i.id === q.dataset.q); cart.set(q.dataset.q, Math.min(10, it.qty + Number(q.dataset.d))); cartView(); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) { cart.set(rm.dataset.rm, 0); cartView(); return; }
    if (e.target.closest('[data-report]')) { e.preventDefault(); $('#reportMsg').innerHTML = ''; $('#reportDlg').showModal(); }
  });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/s/' + $('#q').value.trim(); });
  $('#deliverBtn').addEventListener('click', () => { location.hash = '#/p/p101'; });
  $('#reportForm').addEventListener('submit', async (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('/api/support/report', { method: 'POST', body: JSON.stringify(data) });
      e.target.reset(); $('#reportDlg').close(); toast('Report sent. Ticket ' + r.ticket);
    } catch (err) { $('#reportMsg').innerHTML = '<div class="err">' + esc(err.message) + '</div>'; }
  });

  async function statusNotice() {
    try {
      const s = await api('/api/status');
      const inc = s.incidents[0];
      $('#notice').innerHTML = s.overall === 'operational' || !inc ? '' :
        '<div class="notice ' + (s.overall === 'outage' ? 'bad' : '') + '"><div class="wrap">' +
        (s.overall === 'outage' ? 'Some payments are failing right now. Cash on delivery is working normally.' : 'Some parts of the store are slower than usual.') +
        ' <a href="/status">See service status</a></div></div>';
    } catch {}
  }

  async function boot() {
    try {
      [categories, products] = await Promise.all([api('/api/categories'), api('/api/products')]);
    } catch (err) { categories = categories || []; failed(err); return; }
    $('#catNav').innerHTML = '<a href="#/">Home</a>' + categories.map((c) => '<a href="#/c/' + c.id + '">' + esc(c.name) + '</a>').join('') + '<a href="#/s/">All products</a>';
    renderCount(); route(); statusNotice();
    setInterval(statusNotice, 30000);
    fetch('/health').then((r) => r.json()).then((h) => { $('#ver').textContent = 'Build ' + h.version; }).catch(() => {});
  }
  window.addEventListener('hashchange', route);
  boot();
})();
