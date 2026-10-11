/* =========================================================
   Vimaan AI support — chat widget
   Talks to the Python assistant at /api/chat. If the backend is
   not reachable (e.g. index.html opened straight from disk) it
   falls back to a built-in offline engine so support still works.
   ========================================================= */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  const API = ((window.VIMAAN_API || '') + '/api/chat');
  const fab = $('#chatFab'), panel = $('#chat'), body = $('#chatBody'), form = $('#chatForm'),
        input = $('#chatInput'), suggestBox = $('#chatSuggest'), closeBtn = $('#chatClose');

  const DEFAULT_SUGGESTIONS = ['My rider is late', 'Refund status', 'Payment failed', 'Cancel my ride', 'Lost an item', 'Fare looks wrong'];
  const history = [];           // {role:'user'|'assistant', content}
  let sessionId = 'web-' + Math.random().toString(36).slice(2, 10);
  try {
    sessionId = sessionStorage.getItem('vimaan_sid') || sessionId;
    sessionStorage.setItem('vimaan_sid', sessionId);
  } catch (_) { /* storage unavailable */ }
  let backendDownUntil = 0, busy = false, greeted = false;

  /* ---------- rendering ---------- */
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

  function scrollDown() { body.scrollTop = body.scrollHeight; }
  function addMsg(role, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
    el.innerHTML = md(text);
    body.appendChild(el);
    scrollDown();
    return el;
  }
  function showTyping() {
    const el = document.createElement('div');
    el.className = 'msg bot typing';
    el.innerHTML = '<i></i><i></i><i></i>';
    body.appendChild(el);
    scrollDown();
    return el;
  }
  function setSuggestions(list) {
    suggestBox.innerHTML = '';
    (list && list.length ? list : DEFAULT_SUGGESTIONS).slice(0, 6).forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.addEventListener('click', () => send(t));
      suggestBox.appendChild(b);
    });
  }

  /* ---------- open / close ---------- */
  function open(prefill) {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    fab.setAttribute('aria-expanded', 'true');
    fab.setAttribute('aria-label', 'Close Vimaan AI support chat');
    if (!greeted) {
      greeted = true;
      const ride = window.VimaanState && window.VimaanState.ride;
      addMsg('bot', ride
        ? `Hi! I'm **Vimaan AI**. I can see your ride **${ride.id}** (${ride.from} → ${ride.to}). How can I help?`
        : `Hi! I'm **Vimaan AI**, your 24×7 support assistant. I can help with rides, payments, refunds, delays, safety and rider issues. What's going on?`);
      setSuggestions();
    }
    setTimeout(() => input.focus(), 250);
    if (typeof prefill === 'string' && prefill.trim()) send(prefill.trim());
  }
  function close() {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', 'Open Vimaan AI support chat');
  }
  fab.addEventListener('click', () => panel.classList.contains('open') ? close() : open());
  closeBtn.addEventListener('click', close);
  addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('open')) close(); });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-open-chat]');
    if (!t) return;
    e.preventDefault();
    open(t.dataset.chatPrefill);
  });

  /* ---------- sending ---------- */
  form.addEventListener('submit', e => { e.preventDefault(); const t = input.value.trim(); if (t) send(t); });

  async function send(text) {
    if (busy) return;
    busy = true;
    input.value = '';
    addMsg('user', text);
    suggestBox.innerHTML = '';
    const typing = showTyping();
    const started = Date.now();

    let result;
    try { result = await askBackend(text); }
    catch (_) { result = LocalEngine.reply(text); }

    // keep a natural pace: never answer faster than ~600ms
    const wait = Math.max(0, 600 - (Date.now() - started));
    await new Promise(r => setTimeout(r, wait));
    typing.remove();
    addMsg('bot', result.reply);
    history.push({ role: 'user', content: text }, { role: 'assistant', content: result.reply });
    if (history.length > 20) history.splice(0, history.length - 20);
    setSuggestions(result.suggestions);
    busy = false;
    input.focus();
  }

  async function askBackend(message) {
    if (Date.now() < backendDownUntil || location.protocol === 'file:') throw new Error('offline');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          message,
          history: history.slice(-12),
          ride: (window.VimaanState && window.VimaanState.ride) || null
        }),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      if (!data || typeof data.reply !== 'string') throw new Error('bad payload');
      return data;
    } catch (err) {
      backendDownUntil = Date.now() + 60000;   // retry the server after a minute
      throw err;
    } finally { clearTimeout(to); }
  }

  /* =========================================================
     Offline engine (mirrors the Python assistant's core answers)
     ========================================================= */
  const LocalEngine = (() => {
    const norm = s => ' ' + s.toLowerCase().replace(/[^\p{L}\p{N}₹\s]/gu, ' ').replace(/\s+/g, ' ').trim() + ' ';
    const has = (t, words) => words.reduce((n, w) => n + (t.includes(' ' + w + ' ') || (w.includes(' ') && t.includes(w)) ? 1 : 0), 0);

    const INTENTS = [
      { name: 'safety', w: ['accident', 'unsafe', 'harass', 'harassment', 'emergency', 'attack', 'following me', 'threat', 'sos', 'drunk', 'molest'], min: 1,
        r: () => ['**Your safety comes first.** If you are in danger, call **112** right now.\n\nIn the app/site ride screen, tap **SOS** to alert our safety team and share your live location with trusted contacts. I have flagged this conversation for priority review. Are you safe right now?', ['I am safe, report rider', 'Share my trip', 'Talk about something else']] },
      { name: 'late', w: ['late', 'delay', 'delayed', 'not arrived', 'not come', 'not coming', 'taking too long', 'waiting', 'where is my rider', 'eta', 'still waiting'], min: 1,
        r: ctx => [ctx.ride ? `Sorry for the wait! Your rider **${ctx.ride.rider}** is heading to **${ctx.ride.from}**. Our **on-time promise**: if pickup is **5+ minutes** after the quoted ETA, **₹50 credit** is added to your wallet automatically.\n\nIf you'd like, I can help you cancel for free and rebook with the nearest available rider.` : `Sorry for the wait! Our **on-time promise**: if pickup is **5+ minutes** after the quoted ETA, **₹50 credit** is added to your wallet automatically.\n\nShare your ride ID (like VM123456) and I'll check the live status. Or I can help you cancel for free and rebook.`, ['Cancel my ride', 'Rebook quickly', 'Share ride ID']] },
      { name: 'cancel', w: ['cancel', 'cancellation', 'cancelled', 'cancel ride'], min: 1,
        r: () => ['**Cancellation policy**\n• Free within **2 minutes** of booking\n• Always free if the rider cancels or is late by 5+ minutes\n• Otherwise a small **₹25** fee may apply once the rider is on the way\n\nYou can cancel from the ride screen using **Cancel ride**.', ['Rider is late', 'Refund status']] },
      { name: 'refund', w: ['refund', 'money back', 'reimburse', 'refunded', 'charged twice', 'double charged', 'deducted'], min: 1,
        r: () => ['I can help with that. **Refund timelines**\n• Vimaan Wallet: **instant**\n• UPI / cards / net banking: **3–5 business days**\n\nIf you were charged twice or money was deducted without a ride, share your **ride ID** or the **amount** and I will raise it right away.', ['Payment failed', 'Share ride ID']] },
      { name: 'payment', w: ['payment', 'pay', 'upi', 'card', 'wallet', 'failed', 'transaction', 'net banking', 'cash', 'paytm', 'gpay'], min: 1,
        r: () => ['**Payment help**\n• We accept UPI, cards, net banking, cash and Vimaan Wallet\n• If a payment failed but money left your account, it is auto-reversed in **3–5 business days**\n• Try switching method (UPI ↔ card ↔ wallet) to retry\n\nTell me your **ride ID** or **amount** and I will check it.', ['I want a refund', 'Fare looks wrong']] },
      { name: 'fare', w: ['fare', 'price', 'overcharged', 'overcharge', 'expensive', 'cost', 'charge', 'wrong amount', 'surge', 'how much'], min: 1,
        r: () => ['**How Vimaan fares work**\nFare = base + distance + time. **No surge pricing, ever.**\n• Bike ₹6/km · Auto ₹9/km · Mini ₹11/km · Sedan ₹14/km · XL ₹18/km\n\nIf you think you were overcharged, send your **ride ID** and I will compare it with the fare breakdown and correct any difference.', ['Estimate a fare', 'Share ride ID']] },
      { name: 'lost', w: ['lost', 'forgot', 'left behind', 'left my', 'missing item', 'belongings', 'phone left', 'bag'], min: 1,
        r: () => ['Sorry about that! Open your ride in **Ride history → Lost item** to get a **masked call** to the rider (available for 48 hours). Share your ride ID and I will alert the rider now.', ['Share ride ID', 'Rider not answering']] },
      { name: 'rider_behavior', w: ['rude', 'misbehave', 'misbehaved', 'behaviour', 'behavior', 'complaint', 'report rider', 'refused', 'asked extra', 'demanded', 'cash extra', 'wrong route', 'drove badly'], min: 1,
        r: () => ['I am sorry that happened. I have noted this for the quality team. Please share your **ride ID** and a short description; repeat or serious complaints lead to suspension of the rider. You will get an update within 24 hours.', ['Share ride ID', 'Safety concern']] },
      { name: 'no_rider', w: ['no rider', 'no driver', 'not finding', 'unable to book', 'cannot book', "can't book", 'no cabs', 'unavailable', 'not available'], min: 1,
        r: () => ['Vimaan keeps **more riders online than customers**, so this should be rare. Try again in a few seconds or choose a different ride type (a Bike or Auto is often fastest). You are **never charged** if no rider is found.', ['Rebook quickly', 'Rider is late']] },
      { name: 'rider_signup', w: ['register', 'join', 'become a rider', 'drive with', 'driver signup', 'earn', 'earnings', 'commission', 'payout', 'documents', 'licence', 'license'], min: 1,
        r: () => ['**Riding with Vimaan**\n• Only **8%** flat commission, you keep **92%**\n• Weekly payouts, plus instant cash-out\n• Documents: driving licence, vehicle RC, ID proof, bank details\n• Approval usually within 24–48 hours', ['Payout delayed', 'Estimate my earnings']] },
      { name: 'otp', w: ['otp', 'code not working', 'verify ride'], min: 1,
        r: () => ['Your **ride OTP** is shown on the ride screen. Share it with the rider only **after** you are seated. If it is not working, cancel and rebook — you won\'t be charged.', ['Cancel my ride', 'Talk about something else']] },
      { name: 'promo', w: ['promo', 'coupon', 'discount', 'offer', 'offers', 'voucher', 'code'], min: 1,
        r: () => ['Fares are already low with no surge, and you can add a **weekly commuter pass** for extra savings. Share a promo code and I will check why it did not apply.', ['Fare looks wrong', 'Payment failed']] },
      { name: 'human', w: ['human', 'agent', 'real person', 'representative', 'call me', 'manager', 'talk to someone'], min: 1,
        r: () => ['I am Vimaan\'s AI assistant and I can resolve nearly every ride, payment and rider issue right here, instantly. Tell me what happened and I will take care of it step by step.', ['My rider is late', 'I want a refund', 'Payment failed']] },
      { name: 'thanks', w: ['thanks', 'thank', 'thankyou', 'great', 'awesome', 'perfect', 'helpful'], min: 1,
        r: () => ['Anytime! Safe ride 🚗 Is there anything else I can help with?', ['No, that is all', 'Another question']] },
      { name: 'greeting', w: ['hi', 'hello', 'hey', 'namaste', 'good morning', 'good evening', 'good afternoon'], min: 1,
        r: () => ['Hello! 👋 How can I help with your ride today?', null] }
    ];

    function reply(text) {
      const t = norm(text);
      const ride = (window.VimaanState && window.VimaanState.ride) || null;
      const idMatch = text.match(/\bVM\d{6}\b/i);
      let best = null, bestScore = 0;
      for (const it of INTENTS) {
        const sc = has(t, it.w);
        if (sc > bestScore) { best = it; bestScore = sc; }
      }
      if (best && bestScore >= best.min) {
        const [r, s] = best.r({ ride, rideId: idMatch && idMatch[0].toUpperCase() });
        const prefix = idMatch && best.name !== 'safety' ? `Thanks, I have noted ride **${idMatch[0].toUpperCase()}**.\n\n` : '';
        return { reply: prefix + r, suggestions: s || DEFAULT_SUGGESTIONS };
      }
      if (idMatch) {
        return { reply: `Got it, ride **${idMatch[0].toUpperCase()}**. What would you like help with: **delay, fare, payment, refund, or a rider issue**?`, suggestions: ['Rider is late', 'Fare looks wrong', 'I want a refund', 'Payment failed'] };
      }
      return { reply: 'I want to get this right. Could you tell me a bit more? For example: is it about a **delay**, **payment/refund**, **fare**, **safety**, or a **rider/customer issue**? Sharing your ride ID (like VM123456) helps too.', suggestions: DEFAULT_SUGGESTIONS };
    }
    return { reply };
  })();

  /* public API for the rest of the page */
  window.VimaanChat = { open, close, send };
})();
