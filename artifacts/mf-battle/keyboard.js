// MF Battle chat keyboard. It is drawn inside the game, so it is landscape like the game
// (the phone's own keyboard opens in portrait while the game is turned on its side).
// Arabic, English, numbers & symbols, emoji; quick reactions that send with one tap.
// Keys answer on touch-down (no waiting for the finger to lift) and only the text line
// changes while typing, so it never lags.

const AR = [
  ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '٠'],
  ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج'],
  ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
  ['ذ', 'ء', 'ؤ', 'ر', 'ى', 'ة', 'و', 'ز', 'ظ', 'د', '⌫'],
];
const EN = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
];
const SYM = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '#', '$', '%', '&', '-', '+', '(', ')', '/'],
  ['*', '"', "'", ':', ';', '!', '?', '_', '=', '⌫'],
];
// Hold a key for these (like the phone's keyboard).
const ALT = {
  'ا': ['أ', 'إ', 'آ'], 'ل': ['لا', 'لأ', 'لإ', 'لآ'], 'ي': ['ئ'], 'ى': ['ئ'], 'و': ['ؤ'], 'ء': ['ئ', 'ؤ', 'أ', 'إ'],
  'ه': ['ة'], 'ت': ['ة'], 'ك': ['گ'], 'ب': ['پ'], 'ج': ['چ'], 'ز': ['ژ'], 'ف': ['ڤ'], 'ش': ['ڜ'],
  '١': ['1'], '٢': ['2'], '٣': ['3'], '٤': ['4'], '٥': ['5'], '٦': ['6'], '٧': ['7'], '٨': ['8'], '٩': ['9'], '٠': ['0'],
  'e': ['é', 'è', 'ê'], 'a': ['á', 'à', 'â'], 'o': ['ó', 'ö'], 'u': ['ú', 'ü'], 'i': ['í'], 'n': ['ñ'],
};
// One tap sends these straight away.
export const REACTIONS = ['😂', '😡', '😭', '😎', '🔥', '👍', '❤️', '😈', '💀', '🤡', '👋', 'GG'];
const EMOJI = (
  '😂 🤣 😅 😆 😁 😄 😊 😍 😘 😜 😎 🤩 🥳 😇 🙂 🙃 😉 😋 😏 😐 🙄 😬 😴 🤤 😷 🤢 🤮 🥵 🥶 😵 🤯 🤠 🧐 😕 🙁 😮 😲 😳 🥺 ' +
  '😨 😰 😢 😭 😱 😖 😞 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👻 👽 🤖 🙈 🙉 🙊 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ' +
  '💯 💢 💥 💫 💦 💨 🔥 ⭐ 🌟 ✨ ⚡ 👍 👎 👊 ✊ 🤛 🤜 👏 🙌 🤝 🙏 ✌️ 🤞 🤟 🤘 👌 👈 👉 👆 👇 ☝️ ✋ 👋 💪 🫡 🏃 ' +
  '👑 💎 🎯 🏆 🥇 🎉 🎁 🍕 🍔 🍟 🍗 ☕ 🌙 ☀️ 🌹 🐐 🐍 🦁 🐉'
).split(' ');
const MAX_LEN = 60; // the server keeps 60 characters

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * host: the game's element. opts: onSend(text), onClose(), canSend() → true or a reason.
 * Returns { open(), close(), isOpen(), key(keyboardEvent) }.
 */
export function createChatKeyboard(host, { onSend, onClose }) {
  const el = document.createElement('div');
  el.className = 'kb';
  el.hidden = true;
  el.innerHTML = `
    <div class="kb-react">${REACTIONS.map((r) => `<div class="kb-r" data-r="${esc(r)}">${esc(r)}</div>`).join('')}</div>
    <div class="kb-bar">
      <div class="kb-x" data-act="close">✕</div>
      <div class="kb-text"><span class="kb-val" dir="auto"></span><i class="kb-caret"></i><span class="kb-ph">اكتب رسالتك…</span></div>
      <div class="kb-send" data-act="send">إرسال ➤</div>
    </div>
    <div class="kb-keys"></div>`;
  host.appendChild(el);
  const keysEl = el.querySelector('.kb-keys');
  const valEl = el.querySelector('.kb-val');
  const phEl = el.querySelector('.kb-ph');
  const sendEl = el.querySelector('.kb-send');

  let text = '';
  let lang = 'ar';
  try { lang = localStorage.getItem('mfb-kb-lang') === 'en' ? 'en' : 'ar'; } catch (e) { /* private mode */ }
  let mode = 'letters'; // letters | sym | emoji
  let shift = 0; // 0 off, 1 next letter, 2 caps lock
  let lastShiftTap = 0;
  let repeat = null; // backspace held
  let hold = null; // long press waiting for alternates
  let alt = null; // the alternates popup: { el, base }

  function show() {
    valEl.textContent = text;
    phEl.hidden = text.length > 0;
    sendEl.classList.toggle('on', text.trim().length > 0);
  }

  function keyHTML(k, cls = '', act = '', label = k) {
    const a = act ? ` data-act="${act}"` : ` data-k="${esc(k)}"`;
    return `<div class="k ${cls}"${a}>${esc(label)}${ALT[k] ? `<small>${esc(ALT[k][0])}</small>` : ''}</div>`;
  }
  function row(keys, cls = '') {
    return `<div class="kb-row ${cls}">${keys
      .map((k) => {
        if (k === '⌫') return keyHTML('⌫', 'wide fn', 'back');
        if (k === '⇧') return keyHTML('⇧', `wide fn${shift ? ' on' : ''}${shift === 2 ? ' lock' : ''}`, 'shift');
        return keyHTML(k, '', '', shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k);
      })
      .join('')}</div>`;
  }
  function bottom() {
    const letters = lang === 'ar' ? 'أبج' : 'ABC';
    const parts = [];
    parts.push(mode === 'letters' ? keyHTML(lang === 'ar' ? '؟١٢٣' : '?123', 'wide fn', 'sym') : keyHTML(letters, 'wide fn', 'letters'));
    if (mode !== 'emoji') parts.push(keyHTML('😊', 'fn', 'emoji'));
    if (mode === 'letters') parts.push(keyHTML(lang === 'ar' ? 'EN' : 'ع', 'fn', 'lang'));
    parts.push(`<div class="k space" data-act="space">${lang === 'ar' ? 'العربية' : 'English'}</div>`);
    if (mode === 'emoji') parts.push(keyHTML('⌫', 'wide fn', 'back'));
    else parts.push(keyHTML(lang === 'ar' ? '،' : ','), keyHTML('.'));
    parts.push(keyHTML('➤', 'wide go', 'send'));
    return `<div class="kb-row">${parts.join('')}</div>`;
  }
  function render() {
    closeAlt();
    let html = '';
    if (mode === 'emoji') {
      html = `<div class="kb-emoji">${EMOJI.map((e) => `<div class="kb-e" data-e="${esc(e)}">${esc(e)}</div>`).join('')}</div>`;
    } else {
      const rows = mode === 'sym' ? SYM : lang === 'ar' ? AR : EN;
      html = rows.map((r, i) => row(r, i === 0 ? 'digits' : '')).join('');
    }
    keysEl.innerHTML = html + bottom();
    keysEl.classList.toggle('ar', lang === 'ar' && mode === 'letters');
  }

  function insert(s) {
    if (text.length + s.length > MAX_LEN) return false;
    text += s;
    if (shift === 1) {
      shift = 0;
      if (mode === 'letters' && lang === 'en') render();
    }
    show();
    return true;
  }
  function backspace() {
    if (!text) return;
    const chars = Array.from(text); // emojis are more than one code unit
    chars.pop();
    // Zero-width joiners / variation selectors go with the emoji before them.
    while (chars.length && /[‍️]/.test(chars[chars.length - 1])) chars.pop();
    text = chars.join('');
    show();
  }
  function send() {
    const t = text.trim();
    if (!t) return;
    if (onSend(t) === false) return; // too soon: keep the text
    text = '';
    show();
    close();
  }

  // ── Alternates (hold a key) ──
  function openAlt(keyEl, base) {
    closeAlt();
    const box = document.createElement('div');
    box.className = 'kb-alt';
    box.innerHTML = ALT[base].map((a) => `<div class="k" data-alt="${esc(a)}">${esc(a)}</div>`).join('');
    keysEl.appendChild(box);
    // Above the key, inside the keyboard (offsets are in the game's own, turned, space).
    const left = Math.max(0, Math.min(keysEl.clientWidth - box.offsetWidth, keyEl.offsetLeft + keyEl.offsetWidth / 2 - box.offsetWidth / 2));
    box.style.left = `${left}px`;
    box.style.top = `${Math.max(0, keyEl.offsetTop - box.offsetHeight - 4)}px`;
    alt = { el: box, base };
  }
  function closeAlt() {
    if (alt) alt.el.remove();
    alt = null;
  }
  function chooseAlt(a) {
    // The plain letter went in on touch-down: swap it for the chosen one.
    if (alt && text.endsWith(alt.base)) text = text.slice(0, -alt.base.length);
    insert(a);
    closeAlt();
  }
  function altAt(x, y) {
    const t = document.elementFromPoint(x, y);
    return t && t.closest ? t.closest('[data-alt]') : null;
  }

  function stopTimers() {
    if (repeat) { clearTimeout(repeat.t); clearInterval(repeat.i); repeat = null; }
    if (hold) { clearTimeout(hold.t); hold = null; }
  }

  function press(keyEl) {
    keyEl.classList.add('down');
    setTimeout(() => keyEl.classList.remove('down'), 110);
  }

  function onDown(e) {
    e.stopPropagation();
    const t = e.target;
    // Emoji grid scrolls: an emoji is typed on lift if the finger didn't move.
    const em = t.closest('[data-e]');
    if (em) { el.dataset.ex = `${e.clientX},${e.clientY}`; return; }
    e.preventDefault();
    const altEl = t.closest('[data-alt]');
    if (altEl) { chooseAlt(altEl.dataset.alt); return; }
    if (alt) closeAlt();
    const r = t.closest('[data-r]');
    if (r) {
      press(r);
      onSend(r.dataset.r, true);
      return;
    }
    const keyEl = t.closest('[data-k],[data-act]');
    if (!keyEl) return;
    press(keyEl);
    const act = keyEl.dataset.act;
    if (!act) {
      const k = keyEl.dataset.k;
      const ch = shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k;
      insert(ch);
      if (ALT[k]) hold = { t: setTimeout(() => { hold = null; openAlt(keyEl, ch); }, 380) };
      return;
    }
    if (act === 'back') {
      backspace();
      repeat = { t: setTimeout(() => { repeat.i = setInterval(backspace, 65); }, 420), i: 0 };
    } else if (act === 'space') insert(' ');
    else if (act === 'send') send();
    else if (act === 'close') close();
    else if (act === 'shift') {
      const now = Date.now();
      shift = now - lastShiftTap < 320 ? 2 : shift ? 0 : 1;
      lastShiftTap = now;
      render();
    } else if (act === 'lang') {
      lang = lang === 'ar' ? 'en' : 'ar';
      shift = 0;
      try { localStorage.setItem('mfb-kb-lang', lang); } catch (err) { /* private mode */ }
      render();
    } else if (act === 'sym') { mode = 'sym'; render(); }
    else if (act === 'emoji') { mode = 'emoji'; render(); }
    else if (act === 'letters') { mode = 'letters'; render(); }
  }
  function onUp(e) {
    const em = e.target.closest && e.target.closest('[data-e]');
    if (em && el.dataset.ex) {
      const [x, y] = el.dataset.ex.split(',').map(Number);
      if (Math.hypot(e.clientX - x, e.clientY - y) < 12) { insert(em.dataset.e); press(em); }
    }
    delete el.dataset.ex;
    // Held a key, then slid onto one of its alternates and let go there.
    if (alt) {
      const a = altAt(e.clientX, e.clientY);
      if (a) chooseAlt(a.dataset.alt);
    }
    stopTimers();
  }
  function onMove(e) {
    if (!alt) return;
    const a = altAt(e.clientX, e.clientY);
    alt.el.querySelectorAll('.k').forEach((k) => k.classList.toggle('on', k === a));
  }
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', () => { delete el.dataset.ex; stopTimers(); });
  el.addEventListener('pointermove', onMove);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  function open() {
    if (!el.hidden) return;
    mode = 'letters';
    shift = 0;
    render();
    show();
    el.hidden = false;
  }
  function close() {
    if (el.hidden) return;
    stopTimers();
    closeAlt();
    el.hidden = true;
    if (onClose) onClose();
  }

  /** A computer's keyboard types here too while the chat is open. */
  function key(e) {
    if (el.hidden) return false;
    if (e.type !== 'keydown') return true;
    if (e.key === 'Enter') send();
    else if (e.key === 'Escape') close();
    else if (e.key === 'Backspace') backspace();
    else if (e.key.length === 1 || Array.from(e.key).length === 1) insert(e.key);
    else return true;
    e.preventDefault();
    return true;
  }

  return { open, close, isOpen: () => !el.hidden, key };
}
