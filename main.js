/* =========================================================
   Vimaan — front-end behaviour
   ========================================================= */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* shared state the chat widget can read */
  window.VimaanState = { ride: null };

  /* ---------- data ---------- */
  const RIDES = {
    bike:  { name: 'Bike',  icon: '🏍️', base: 15, km: 6,  min: 0.5, speed: 26, seats: 1, eta: [1, 3], vehicle: 'Bike' },
    auto:  { name: 'Auto',  icon: '🛺', base: 25, km: 9,  min: 0.8, speed: 20, seats: 3, eta: [2, 4], vehicle: 'Auto' },
    mini:  { name: 'Mini',  icon: '🚗', base: 35, km: 11, min: 1.0, speed: 22, seats: 4, eta: [2, 5], vehicle: 'Hatchback' },
    sedan: { name: 'Sedan', icon: '🚙', base: 45, km: 14, min: 1.2, speed: 22, seats: 4, eta: [3, 5], vehicle: 'Sedan' },
    xl:    { name: 'XL',    icon: '🚐', base: 60, km: 18, min: 1.5, speed: 20, seats: 6, eta: [3, 6], vehicle: 'SUV' }
  };

  const PLACES = {
    'Connaught Place': [28.6315, 77.2167],
    'India Gate': [28.6129, 77.2295],
    'New Delhi Railway Station': [28.6430, 77.2197],
    'IGI Airport T3': [28.5562, 77.1000],
    'Hauz Khas': [28.5494, 77.2001],
    'Saket': [28.5245, 77.2066],
    'Lajpat Nagar': [28.5677, 77.2437],
    'Nehru Place': [28.5491, 77.2530],
    'Karol Bagh': [28.6519, 77.1909],
    'Red Fort': [28.6562, 77.2410],
    'Chandni Chowk': [28.6506, 77.2303],
    'Vasant Kunj': [28.5200, 77.1590],
    'Dwarka Sector 21': [28.5523, 77.0583],
    'Noida Sector 18': [28.5708, 77.3260],
    'Gurugram Cyber Hub': [28.4950, 77.0890]
  };

  const RIDER_NAMES = ['Rahul S.', 'Amit K.', 'Sanjay V.', 'Imran A.', 'Vikram T.', 'Deepak R.', 'Manoj P.', 'Suresh G.', 'Farhan M.', 'Anil B.'];
  const PLATE = () => `DL ${rand(1, 14).toString().padStart(2, '0')}${'ABCDEFGHJKLMNPRSTUVWXYZ'[rand(0, 22)]}${'ABCDEFGHJKLMNPRSTUVWXYZ'[rand(0, 22)]} ${rand(1000, 9999)}`;

  /* ---------- fare math ---------- */
  function haversine(a, b) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function hashStr(s) {
    let h = 2166136261;
    for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function findPlace(text) {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    const key = Object.keys(PLACES).find(k => k.toLowerCase() === t);
    return key ? PLACES[key] : null;
  }
  function tripKm(from, to) {
    const a = findPlace(from), b = findPlace(to);
    if (a && b) return Math.max(1, haversine(a, b) * 1.3);       // road factor
    return 2.5 + (hashStr(from.trim().toLowerCase() + '>' + to.trim().toLowerCase()) % 140) / 10; // free-text: stable pseudo-distance
  }
  function fareFor(type, km) {
    const r = RIDES[type];
    const mins = km / r.speed * 60;
    return Math.max(r.base + km * r.km + mins * r.min, r.base + 10);
  }
  const TYPICAL_FACTOR = 1.4;   // illustrative "typical peak fare" multiplier

  /* ---------- header, progress, nav ---------- */
  const header = $('#header'), progress = $('#progress'), burger = $('#burger'), nav = $('#nav');
  function onScroll() {
    const y = window.scrollY, h = document.documentElement.scrollHeight - innerHeight;
    header.classList.toggle('scrolled', y > 8);
    progress.style.transform = `scaleX(${h > 0 ? y / h : 0})`;
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  function setMenu(open) {
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  burger.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  $$('a, button', nav).forEach(el => el.addEventListener('click', () => setMenu(false)));
  addEventListener('resize', () => { if (innerWidth > 960) setMenu(false); });

  /* active link highlight */
  const links = $$('.nav-links > a');
  const secObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  links.forEach(l => { const t = $(l.getAttribute('href')); if (t) secObs.observe(t); });

  /* ---------- reveal + counters ---------- */
  function countUp(el) {
    const target = +el.dataset.count;
    if (reduce) { el.textContent = target; return; }
    const t0 = performance.now(), dur = 1400;
    (function step(t) {
      const p = clamp((t - t0) / dur, 0, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  const revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      $$('[data-count]', e.target).forEach(countUp);
      revealObs.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach(el => revealObs.observe(el));

  /* ---------- render ride cards / chips / select ---------- */
  const rideGrid = $('#rideGrid'), chipsBox = $('#rideChips'), rideSelect = $('#rideSelect');
  rideGrid.innerHTML = Object.entries(RIDES).map(([k, r], i) => `
    <button class="ride-card reveal" style="--d:${i * 0.06}s" data-ride="${k}" type="button">
      <span class="ride-icon" aria-hidden="true">${r.icon}</span>
      <h3>${r.name}</h3>
      <p class="meta">${r.seats} seat${r.seats > 1 ? 's' : ''} · ${r.vehicle}</p>
      <div class="price">₹${r.km}<small>/km</small></div>
      <span class="eta-tag">${r.eta[0]}–${r.eta[1]} min pickup</span>
    </button>`).join('');
  $$('.ride-card', rideGrid).forEach(el => revealObs.observe(el));

  chipsBox.innerHTML = Object.entries(RIDES).map(([k, r], i) => `
    <label class="chip">
      <input type="radio" name="ride" value="${k}" ${i === 2 ? 'checked' : ''}>
      <span><i aria-hidden="true">${r.icon}</i>${r.name}<small id="chip-${k}">₹—</small></span>
    </label>`).join('');
  rideSelect.innerHTML = Object.entries(RIDES).map(([k, r]) => `<option value="${k}" ${k === 'mini' ? 'selected' : ''}>${r.name}</option>`).join('');
  $('#places').innerHTML = Object.keys(PLACES).map(p => `<option value="${p}"></option>`).join('');

  /* clicking a ride card selects it in the booking form */
  rideGrid.addEventListener('click', e => {
    const card = e.target.closest('[data-ride]');
    if (!card) return;
    const input = $(`input[name="ride"][value="${card.dataset.ride}"]`);
    if (input) { input.checked = true; updateEstimate(); }
    $('#book').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  });

  /* ---------- booking estimate ---------- */
  const pickup = $('#pickup'), drop = $('#drop'), estFare = $('#estFare'), estMeta = $('#estMeta'), estSave = $('#estSave');
  const selectedType = () => ($('input[name="ride"]:checked') || {}).value || 'mini';
  let lastFareText = '';

  function updateEstimate() {
    const from = pickup.value, to = drop.value;
    const ready = from.trim() && to.trim() && from.trim().toLowerCase() !== to.trim().toLowerCase();
    if (!ready) {
      estFare.textContent = '₹—';
      estMeta.textContent = from.trim() && from.trim().toLowerCase() === to.trim().toLowerCase() ? 'Pickup and drop are the same' : 'Enter pickup & drop';
      estSave.textContent = '';
      Object.keys(RIDES).forEach(k => $('#chip-' + k).textContent = '₹—');
      return;
    }
    const km = tripKm(from, to);
    Object.keys(RIDES).forEach(k => $('#chip-' + k).textContent = inr(fareFor(k, km)));
    const type = selectedType(), price = fareFor(type, km), mins = Math.round(km / RIDES[type].speed * 60);
    const text = inr(price);
    estFare.textContent = text;
    if (text !== lastFareText) { estFare.classList.remove('num-pop'); void estFare.offsetWidth; estFare.classList.add('num-pop'); lastFareText = text; }
    estMeta.textContent = `${km.toFixed(1)} km · ~${mins} min`;
    estSave.textContent = `Save ~${inr(price * TYPICAL_FACTOR - price)} vs peak fares`;
  }
  [pickup, drop].forEach(el => el.addEventListener('input', updateEstimate));
  chipsBox.addEventListener('change', updateEstimate);
  $('#swapBtn').addEventListener('click', () => { [pickup.value, drop.value] = [drop.value, pickup.value]; updateEstimate(); });
  updateEstimate();

  /* ---------- live availability ticker (riders always > customers) ---------- */
  const elRiders = $('#ridersOnline'), elCust = $('#custWaiting'), elRatio = $('#ratioVal'), barR = $('#ridersBar'), barC = $('#custBar');
  let riders = 2140, ratioTarget = 1.4;
  function tick() {
    riders = clamp(riders + rand(-45, 55), 1800, 2600);
    ratioTarget = clamp(ratioTarget + (Math.random() - 0.5) * 0.12, 1.25, 1.7);   // never below 1.25
    const customers = Math.round(riders / ratioTarget);
    elRiders.textContent = riders.toLocaleString('en-IN');
    elCust.textContent = customers.toLocaleString('en-IN');
    elRatio.textContent = (riders / customers).toFixed(1) + '×';
    barR.style.width = clamp(riders / 2800 * 100, 10, 100) + '%';
    barC.style.width = clamp(customers / 2800 * 100, 10, 100) + '%';
  }
  tick();
  setInterval(tick, 2600);

  /* ---------- range fill helper ---------- */
  function paintRange(r) { r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); }

  /* ---------- pricing comparison ---------- */
  const kmRange = $('#kmRange');
  function updateCompare() {
    paintRange(kmRange);
    const km = +kmRange.value, type = rideSelect.value;
    const ours = fareFor(type, km), typical = ours * TYPICAL_FACTOR;
    $('#kmVal').textContent = km + ' km';
    $('#vimaanFare').textContent = inr(ours);
    $('#typicalFare').textContent = inr(typical);
    $('#barTypical').style.width = '100%';
    $('#barVimaan').style.width = (ours / typical * 100) + '%';
    $('#saveText').textContent = `You save ${inr(typical - ours)} on this ride (${Math.round((1 - ours / typical) * 100)}% less)`;
  }
  kmRange.addEventListener('input', updateCompare);
  rideSelect.addEventListener('change', updateCompare);
  updateCompare();

  /* ---------- rider earnings ---------- */
  const rpd = $('#rpd'), afare = $('#afare');
  function updateEarn() {
    paintRange(rpd); paintRange(afare);
    $('#rpdVal').textContent = rpd.value;
    $('#afareVal').textContent = inr(afare.value);
    $('#earnOut').textContent = inr(rpd.value * afare.value * 26 * 0.92);
  }
  rpd.addEventListener('input', updateEarn);
  afare.addEventListener('input', updateEarn);
  updateEarn();

  /* ---------- booking modal simulation ---------- */
  const modal = $('#rideModal');
  let timers = [], rafId = 0, lastFocus = null;
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(rafId); };

  function openModal() {
    lastFocus = document.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#modalClose').focus(), 60);
  }
  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    clearTimers();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $$('[data-close]', modal).forEach(el => el.addEventListener('click', closeModal));
  addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

  function startRide(e) {
    e.preventDefault();
    const from = pickup.value.trim(), to = drop.value.trim();
    if (!from || !to) { (from ? drop : pickup).focus(); estMeta.textContent = 'Please enter both locations'; return; }
    if (from.toLowerCase() === to.toLowerCase()) { drop.focus(); return; }

    clearTimers();
    const type = selectedType(), km = tripKm(from, to), price = fareFor(type, km), r = RIDES[type];
    const name = RIDER_NAMES[rand(0, RIDER_NAMES.length - 1)];
    const etaTotal = rand(r.eta[0], r.eta[1]);
    const ride = {
      id: 'VM' + rand(100000, 999999), type, typeName: r.name, from, to,
      km: +km.toFixed(1), fare: Math.round(price), eta: etaTotal, rider: name,
      status: 'driver_assigned', startedAt: Date.now()
    };
    window.VimaanState.ride = ride;

    modal.dataset.stage = 'search';
    openModal();

    timers.push(setTimeout(() => {
      $('#rideIdText').textContent = ride.id;
      $('#driverName').textContent = name;
      $('#driverAvatar').textContent = name[0];
      $('#driverMeta').textContent = `${r.vehicle} · ${PLATE()}`;
      $('#driverRating').textContent = (4.6 + Math.random() * 0.4).toFixed(1);
      $('#rideRoute').textContent = `${from} → ${to}`;
      $('#ridePrice').textContent = inr(price);
      $('#rideOtp').textContent = String(rand(1000, 9999));
      $('#statusLine').textContent = 'Rider is on the way';
      $('#etaMin').textContent = etaTotal;
      $('#etaBar').style.width = '0%';
      $('#foundNote').textContent = 'Free cancellation within 2 minutes. Late pickup earns you ₹50 credit.';
      $('#cancelRide').hidden = false;
      modal.dataset.stage = 'found';
      animateApproach(etaTotal, ride);
    }, reduce ? 300 : 2400));
  }

  function animateApproach(etaTotal, ride) {
    const path = $('#routePath'), dot = $('#routeDot'), bar = $('#etaBar');
    const len = path.getTotalLength(), dur = reduce ? 1500 : 14000, t0 = performance.now();
    (function step(t) {
      const p = clamp((t - t0) / dur, 0, 1);
      const pt = path.getPointAtLength(len * p);
      dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
      bar.style.width = (p * 100) + '%';
      $('#etaMin').textContent = Math.max(0, Math.ceil(etaTotal * (1 - p)));
      if (p < 1) { rafId = requestAnimationFrame(step); return; }
      $('#statusLine').textContent = 'Your rider has arrived 🎉';
      $('#etaMin').textContent = 0;
      ride.status = 'arrived';
    })(t0);
  }

  $('#cancelRide').addEventListener('click', () => {
    clearTimers();
    const ride = window.VimaanState.ride;
    const free = ride && Date.now() - ride.startedAt < 120000;
    $('#doneTitle').textContent = 'Ride cancelled';
    $('#doneText').textContent = free ? 'Cancelled within 2 minutes — no charges applied.' : 'A small cancellation fee may apply. Ask our AI assistant for details.';
    if (ride) ride.status = 'cancelled';
    modal.dataset.stage = 'done';
  });
  $('#modalChat').addEventListener('click', () => {
    closeModalKeepRide();
    if (window.VimaanChat) window.VimaanChat.open();
  });
  function closeModalKeepRide() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  $('#book').addEventListener('submit', startRide);

  /* anchor links: smooth scroll honouring reduced motion (CSS handles offset) */
  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const t = $(id);
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', id);
  }));
})();
