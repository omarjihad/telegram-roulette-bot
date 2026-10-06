import { skinSVG, RARITY } from './skins.js';
import { CONTROLS, byId, fullLayout, defaultLayout, controlHTML, layoutPicture } from './controls.js';

const tg = window.Telegram && window.Telegram.WebApp;
const CFG = window.MF_BATTLE_CONFIG || {};
const API = String(CFG.apiBase || '').replace(/\/+$/, '');
const DEMO = new URLSearchParams(location.search).has('demo');
const COIN = 'assets/mf-coin.svg';

const stage = document.getElementById('stage');
const screenEl = document.getElementById('screen');
const panelEl = document.getElementById('panel');
const dialogEl = document.getElementById('dialog');
const toastEl = document.getElementById('toast');

const state = { player: null, profile: null, skins: [], week: null, weekly: null, editor: null };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────────── Landscape stage ─────────────
// The lobby is always laid out landscape. A phone held upright gets the whole stage
// turned sideways (like the reference game); a phone held sideways shows it as is.
let rotated = false;
let SW = 0;
let SH = 0;
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(probe);

function tgInset(name) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

function fit() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  rotated = h > w;
  SW = rotated ? h : w;
  SH = rotated ? w : h;
  stage.style.width = `${SW}px`;
  stage.style.height = `${SH}px`;
  stage.classList.toggle('rotated', rotated);
  stage.style.setProperty('--u', `${(SH / 100).toFixed(2)}px`);
  // Room for the phone's notch and Telegram's own buttons (in screen terms), mapped onto the stage.
  const ps = getComputedStyle(probe);
  const top = (parseFloat(ps.paddingTop) || 0) + tgInset('--tg-content-safe-area-inset-top');
  const bottom = parseFloat(ps.paddingBottom) || 0;
  const left = parseFloat(ps.paddingLeft) || 0;
  const right = parseFloat(ps.paddingRight) || 0;
  const pad = rotated
    ? { l: 14 + top, r: 14 + bottom, t: 10 + right, b: 10 + left }
    : { l: 14 + left, r: 14 + right, t: 10 + top, b: 10 + bottom };
  stage.style.setProperty('--pad-l', `${pad.l}px`);
  stage.style.setProperty('--pad-r', `${pad.r}px`);
  stage.style.setProperty('--pad-t', `${pad.t}px`);
  stage.style.setProperty('--pad-b', `${pad.b}px`);
  if (state.editor) state.editor.relayout();
}

/** A screen point (pointer event) in stage coordinates. */
function toStage(clientX, clientY) {
  return rotated ? { x: clientY, y: SH - clientX } : { x: clientX, y: clientY };
}

window.addEventListener('resize', fit);

// ───────────── Telegram ─────────────
function tgHash() {
  if (!tg || !tg.initData) return '';
  return [
    `tgWebAppData=${encodeURIComponent(tg.initData)}`,
    `tgWebAppVersion=${encodeURIComponent(tg.version || '')}`,
    `tgWebAppPlatform=${encodeURIComponent(tg.platform || '')}`,
    `tgWebAppThemeParams=${encodeURIComponent(JSON.stringify(tg.themeParams || {}))}`,
  ].join('&');
}

/** Back to the roulette Mini App (the same Telegram session carries over). */
function goRoulette() {
  try {
    if (tg && tg.isFullscreen && tg.exitFullscreen) tg.exitFullscreen();
  } catch (e) { /* not supported */ }
  const hash = tgHash();
  location.href = `${API}/${hash ? `#${hash}` : ''}`;
}

function onBack() {
  if (!dialogEl.hidden) return closeDialog();
  if (state.editor) return state.editor.requestExit();
  if (!panelEl.hidden) return closePanel();
  goRoulette();
}

if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast && tg.isVersionAtLeast('8.0') && tg.requestFullscreen) tg.requestFullscreen();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if (tg.setHeaderColor) tg.setHeaderColor('#07040f');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#07040f');
    if (tg.BackButton) { tg.BackButton.onClick(onBack); tg.BackButton.show(); }
    ['viewportChanged', 'fullscreenChanged', 'safeAreaChanged', 'contentSafeAreaChanged'].forEach((ev) => tg.onEvent(ev, fit));
  } catch (e) { /* older Telegram: the page still works */ }
}

function haptic(kind = 'light') {
  try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(kind); } catch (e) { /* no haptics */ }
}

// ───────────── API ─────────────
async function api(path, opts = {}) {
  if (DEMO) return demoApi(path, opts);
  const res = await fetch(`${API}/api${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': (tg && tg.initData) || '', 'X-Lang': 'ar' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.message || data.error || 'صار خطأ، حاول مرة ثانية');
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ───────────── UI helpers ─────────────
let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function showDialog(html) {
  dialogEl.innerHTML = `<div class="dialog">${html}</div>`;
  dialogEl.hidden = false;
  dialogEl.onclick = (e) => { if (e.target === dialogEl) closeDialog(); };
  return dialogEl.firstElementChild;
}
function closeDialog() {
  dialogEl.hidden = true;
  dialogEl.innerHTML = '';
}

function message(title, text, withBack = true) {
  screenEl.innerHTML = `<div class="center-msg"><img src="${COIN}" alt="" /><h2>${title}</h2><p>${text}</p>${withBack ? '<button class="btn btn-hot" data-act="roulette">↩ رجوع للروليت</button>' : ''}</div>`;
  const b = screenEl.querySelector('[data-act="roulette"]');
  if (b) b.onclick = goRoulette;
}

const skinById = (id) => state.skins.find((s) => s.id === id) || state.skins[0] || { id: 'classic', name: { ar: 'كلاسيك' }, rarity: 'common', price: 0 };
const owned = (id) => state.profile.ownedSkins.includes(id);

function coinsHTML() {
  return `<div class="coins" title="عملات MF"><img src="${COIN}" alt="MF" /><span>${fmt(state.profile.coins)}</span></div>`;
}

function avatarHTML() {
  const p = state.player;
  const initial = esc((p.name || '?').trim().charAt(0).toUpperCase());
  return `<div class="avatar">${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="" onerror="this.remove()" />` : ''}${p.photoUrl ? '' : initial}</div>`;
}

function timeLeft(date) {
  const ms = Math.max(0, new Date(date).getTime() - Date.now());
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d} يوم و ${h} ساعة` : `${h} ساعة`;
}

const LB_TYPES = {
  mass: { label: 'أكبر حجم', icon: '🫧', unit: (v) => fmt(v) },
  time: { label: 'أكثر وقت لعب', icon: '⏱️', unit: (v) => (v >= 3600 ? `${Math.floor(v / 3600)}h ${Math.floor((v % 3600) / 60)}m` : `${Math.floor(v / 60)}m`) },
  matches: { label: 'أكثر مباريات', icon: '🎮', unit: (v) => fmt(v) },
};

// ───────────── Lobby ─────────────
function renderLobby() {
  const p = state.profile;
  const skin = skinById(p.skin);
  const rar = RARITY[skin.rarity] || RARITY.common;
  screenEl.innerHTML = `
    <div class="top">
      <div class="me">
        ${avatarHTML()}
        <div class="me-text">
          <div class="me-name">${esc(state.player.name)}</div>
          <div class="me-sub">${state.player.username ? `@${esc(state.player.username)} · ` : ''}أفضل كتلة <b>${fmt(p.bestMass)}</b></div>
        </div>
      </div>
      <div class="brand">MF BATTLE</div>
      <div class="wallet">
        <button class="round-btn back-btn" data-act="roulette">↩ الروليت</button>
        <button class="round-btn" data-act="settings" aria-label="الإعدادات">⚙️</button>
        ${coinsHTML()}
      </div>
    </div>
    <div class="lobby">
      <section class="showcase">
        <button class="skin-orb" data-act="skins" aria-label="السكنات">${skinSVG(skin.id)}</button>
        <div class="skin-name">${esc(skin.name.ar)}</div>
        <span class="chip" style="color:${rar.color}">${rar.ar}</span>
        <div class="skin-stats"><span>🎮 <b>${fmt(p.totalMatches)}</b> مباراة</span><span>⏱️ <b>${Math.floor((p.totalSeconds || 0) / 60)}</b> دقيقة</span></div>
      </section>
      <section class="center">
        <div class="mode"><div><b>كلاسيك</b><small>خريطة مفتوحة · كُل الأصغر منك واكبر</small></div><span class="dot-live"></span></div>
        <button class="play" data-act="play"><b>ابدأ اللعب</b><small>كلاسيك · غرف أونلاين</small></button>
        <div class="tiles">
          <button class="tile t-store" data-act="store"><span class="ic">🛒</span>المتجر</button>
          <button class="tile t-skins" data-act="skins"><span class="ic">🎭</span>السكنات</button>
          <button class="tile t-rank" data-act="rank"><span class="ic">🏆</span>الترتيب</button>
        </div>
      </section>
      <section class="weekly" id="weekly">
        <h3>🏆 أكبر حجم <small>الأسبوع</small></h3>
        <div class="w-empty"><div class="spin" style="margin:auto"></div></div>
      </section>
    </div>`;
  bindActs(screenEl);
  renderWeekly();
}

function bindActs(root) {
  root.querySelectorAll('[data-act]').forEach((el) => {
    el.onclick = () => {
      haptic('light');
      const act = el.getAttribute('data-act');
      if (act === 'roulette') goRoulette();
      else if (act === 'play') toast('⚔️ الساحة قيد التجهيز، اللعب قريباً!');
      else openPanel(act);
    };
  });
}

async function renderWeekly() {
  const box = document.getElementById('weekly');
  if (!box) return;
  try {
    if (!state.weekly) state.weekly = await api('/battle/leaderboard?type=mass');
    const rows = state.weekly.rows.slice(0, 5);
    const list = rows.length
      ? rows.map((r) => `<div class="w-row"><span class="rk">${r.rank}</span>${skinSVG(r.skin, 26)}<span class="nm">${esc(r.name)}</span><span class="vl">${fmt(r.value)}</span></div>`).join('')
      : '<div class="w-empty">ما اكو نتائج بعد هالأسبوع.<br/>كن أول واحد بالترتيب! 🔥</div>';
    box.innerHTML = `<h3>🏆 أكبر حجم هالأسبوع <small>⏳ يتصفّر بعد ${timeLeft(state.weekly.resetsAt)}</small></h3>${list}<button class="link-btn" data-act="rank">كل الترتيب ←</button>`;
    bindActs(box);
  } catch (e) {
    box.innerHTML = '<h3>🏆 الترتيب</h3><div class="w-empty">تعذّر تحميل الترتيب</div>';
  }
}

// ───────────── Panels ─────────────
function panelHead(title) {
  return `<div class="p-head"><button class="round-btn" data-close aria-label="رجوع">→</button><h2>${title}</h2>${coinsHTML()}</div>`;
}

function openPanel(name) {
  panelEl.hidden = false;
  if (name === 'store') renderStore();
  else if (name === 'skins') renderSkins();
  else if (name === 'rank') renderRank('mass');
  else if (name === 'settings') renderSettings();
}

function closePanel() {
  panelEl.hidden = true;
  panelEl.innerHTML = '';
  renderLobby();
}

function bindPanelClose() {
  const b = panelEl.querySelector('[data-close]');
  if (b) b.onclick = closePanel;
}

function setProfile(profile) {
  state.profile = profile;
}

function skinCard(s, mode) {
  const rar = RARITY[s.rarity] || RARITY.common;
  const isOwned = owned(s.id);
  const equipped = state.profile.skin === s.id;
  let action;
  if (mode === 'store') {
    action = isOwned
      ? '<button class="btn" disabled>✓ مملوك</button>'
      : `<button class="btn ${state.profile.coins >= s.price ? 'btn-hot' : ''}" data-buy="${s.id}">شراء</button>`;
  } else {
    action = equipped ? '<button class="btn btn-cyan" disabled>✓ مستخدم</button>' : `<button class="btn btn-violet" data-equip="${s.id}">استخدام</button>`;
  }
  return `<div class="skin-card ${isOwned ? 'owned' : ''} ${equipped ? 'equipped' : ''}">
    ${skinSVG(s.id, 72)}
    <div class="sn">${esc(s.name.ar)}</div>
    <span class="rarity" style="color:${rar.color}">${rar.ar}</span>
    <span class="price"><img src="${COIN}" alt="" />${fmt(s.price)}</span>
    ${action}
  </div>`;
}

function renderStore() {
  const items = state.skins.filter((s) => s.price > 0).sort((a, b) => a.price - b.price);
  panelEl.innerHTML = `${panelHead('🛒 المتجر')}<div class="p-body"><div class="grid">${items.map((s) => skinCard(s, 'store')).join('')}</div></div>`;
  bindPanelClose();
  panelEl.querySelectorAll('[data-buy]').forEach((b) => {
    b.onclick = () => confirmBuy(b.getAttribute('data-buy'));
  });
}

function confirmBuy(id) {
  const s = skinById(id);
  if (state.profile.coins < s.price) {
    toast(`تحتاج ${fmt(s.price - state.profile.coins)} عملة MF زيادة`);
    return;
  }
  const d = showDialog(`<div style="width:90px;margin:0 auto 8px">${skinSVG(s.id, 90)}</div><h3>شراء سكن ${esc(s.name.ar)}؟</h3>
    <p>السعر <b style="color:var(--gold)">${fmt(s.price)}</b> عملة MF · رصيدك ${fmt(state.profile.coins)}</p>
    <div class="row"><button class="btn btn-hot" data-yes>شراء</button><button class="btn" data-no>إلغاء</button></div>`);
  d.querySelector('[data-no]').onclick = closeDialog;
  d.querySelector('[data-yes]').onclick = async () => {
    try {
      const res = await api(`/battle/skins/${id}/buy`, { method: 'POST' });
      setProfile(res.profile);
      closeDialog();
      haptic('medium');
      toast(`🎉 صار عندك سكن ${s.name.ar}`);
      renderStore();
    } catch (e) {
      closeDialog();
      toast(e.message);
    }
  };
}

function renderSkins() {
  const items = state.skins.filter((s) => owned(s.id));
  panelEl.innerHTML = `${panelHead('🎭 السكنات')}<div class="p-body"><div class="grid">${items.map((s) => skinCard(s, 'skins')).join('')}</div>
    <p style="text-align:center;color:var(--dim);margin-top:14px">تريد سكنات أكثر؟ <button class="link-btn" data-go-store>روح للمتجر ←</button></p></div>`;
  bindPanelClose();
  panelEl.querySelector('[data-go-store]').onclick = () => renderStore();
  panelEl.querySelectorAll('[data-equip]').forEach((b) => {
    b.onclick = async () => {
      try {
        const res = await api(`/battle/skins/${b.getAttribute('data-equip')}/equip`, { method: 'POST' });
        setProfile(res.profile);
        haptic('light');
        renderSkins();
      } catch (e) {
        toast(e.message);
      }
    };
  });
}

async function renderRank(type) {
  const t = LB_TYPES[type];
  const tabs = Object.entries(LB_TYPES).map(([k, v]) => `<button class="tab ${k === type ? 'on' : ''}" data-tab="${k}">${v.icon} ${v.label}</button>`).join('');
  panelEl.innerHTML = `${panelHead('🏆 الترتيب الأسبوعي')}<div class="tabs">${tabs}</div><div class="p-body"><div class="spin" style="margin:20px auto"></div></div>`;
  bindPanelClose();
  panelEl.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => renderRank(b.getAttribute('data-tab')); });
  try {
    const res = await api(`/battle/leaderboard?type=${type}`);
    if (type === 'mass') state.weekly = res;
    const body = panelEl.querySelector('.p-body');
    if (!body) return;
    body.innerHTML = res.rows.length
      ? `<div class="lb-list">${res.rows.map((r) => `<div class="lb-row ${r.me ? 'me' : ''} ${r.rank <= 3 ? `r${r.rank}` : ''}"><span class="rk">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>${skinSVG(r.skin, 32)}<span class="nm">${esc(r.name)}</span><span class="vl">${t.unit(r.value)}</span></div>`).join('')}</div>`
      : `<div class="center-msg" style="margin-top:20px"><h2>${t.icon}</h2><p>ما اكو نتائج بعد هالأسبوع بـ «${t.label}».<br/>العب وكن أول واحد بالقائمة!</p></div>`;
    panelEl.insertAdjacentHTML('beforeend', `<div class="lb-foot"><span>⏳ يتصفّر بعد <b>${timeLeft(res.resetsAt)}</b></span><span>ترتيبك: <b>${res.me.rank ? `#${res.me.rank} · ${t.unit(res.me.value)}` : '—'}</b></span></div>`);
  } catch (e) {
    const body = panelEl.querySelector('.p-body');
    if (body) body.innerHTML = `<div class="center-msg"><p>${esc(e.message)}</p></div>`;
  }
}

// ───────────── Settings ─────────────
let saveTimer = 0;
function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const res = await api('/battle/settings', { method: 'PUT', body: state.profile.settings });
      state.profile.settings = res.profile.settings;
    } catch (e) {
      toast(e.message);
    }
  }, 350);
}

function renderSettings() {
  const s = state.profile.settings;
  const sw = (key, label, sub) => `<div class="set-row"><div class="lbl">${label}<small>${sub}</small></div><button class="switch ${s[key] ? 'on' : ''}" data-sw="${key}" role="switch" aria-checked="${s[key]}"></button></div>`;
  const seg = (key, label, sub, opts) => `<div class="set-row"><div class="lbl">${label}<small>${sub}</small></div><div class="seg">${opts.map(([v, t]) => `<button class="${s[key] === v ? 'on' : ''}" data-seg="${key}" data-v="${v}">${t}</button>`).join('')}</div></div>`;
  panelEl.innerHTML = `${panelHead('⚙️ الإعدادات')}<div class="p-body"><div class="set-list">
    ${sw('darkMode', '🌙 الوضع المظلم', 'خلفية داكنة داخل اللعبة')}
    ${sw('chat', '💬 الشات', 'إظهار رسائل اللاعبين')}
    ${seg('quality', '✨ جودة اللعب', 'خفيف للأجهزة الضعيفة', [['low', 'خفيف'], ['medium', 'متوسط'], ['high', 'قوي']])}
    ${seg('joystick', '🕹️ الجويستك', 'ثابت بمكانه أو يتحرك ويه إصبعك', [['fixed', 'ثابت'], ['floating', 'متحرك']])}
    <div class="set-wide"><button class="controls-btn" data-controls>🎛️ إعدادات التحكم — رتّب الأزرار، حجمها وشفافيتها</button></div>
  </div></div>`;
  bindPanelClose();
  panelEl.querySelectorAll('[data-sw]').forEach((b) => {
    b.onclick = () => {
      const k = b.getAttribute('data-sw');
      s[k] = !s[k];
      b.classList.toggle('on', s[k]);
      b.setAttribute('aria-checked', String(s[k]));
      haptic('light');
      saveSettingsSoon();
    };
  });
  panelEl.querySelectorAll('[data-seg]').forEach((b) => {
    b.onclick = () => {
      const k = b.getAttribute('data-seg');
      s[k] = b.getAttribute('data-v');
      panelEl.querySelectorAll(`[data-seg="${k}"]`).forEach((x) => x.classList.toggle('on', x === b));
      haptic('light');
      saveSettingsSoon();
    };
  });
  panelEl.querySelector('[data-controls]').onclick = openEditor;
}

// ───────────── Control layout editor ─────────────
function openEditor() {
  let layout = fullLayout(state.profile.layout);
  let sel = null;
  let dirty = false;
  const ed = document.createElement('div');
  ed.className = `editor ${state.profile.settings.darkMode ? '' : 'light'}`;
  ed.innerHTML = '<div class="field"></div><div class="ed-hint">اسحب أي زر لمكانه · اضغط عليه حتى تعدّل حجمه وشفافيته</div>';
  const els = {};
  for (const c of CONTROLS) {
    const el = document.createElement('div');
    el.className = `ctl ${c.shape}`;
    el.dataset.id = c.id;
    el.innerHTML = controlHTML(c);
    ed.appendChild(el);
    els[c.id] = el;
  }
  const pnl = document.createElement('div');
  pnl.className = 'ed-panel';
  pnl.innerHTML = `
    <div class="ed-grip"><b data-title>اختار زر</b><span>⇕ اسحب اللوحة</span></div>
    <div class="ed-line"><label>📏 الحجم</label><button class="ed-step" data-step="s" data-d="-0.1">−</button><input type="range" min="50" max="200" step="5" data-range="s" /><button class="ed-step" data-step="s" data-d="0.1">+</button><span class="ed-val" data-val="s"></span></div>
    <div class="ed-line"><label>🌗 الشفافية</label><input type="range" min="20" max="100" step="5" data-range="o" /><span class="ed-val" data-val="o"></span></div>
    <div class="ed-btns">
      <button class="b-copy" data-ed="copy">📤 نسخ</button>
      <button class="b-paste" data-ed="paste">📥 لصق</button>
      <button class="b-reset" data-ed="reset">↺ افتراضي</button>
      <button class="b-save" data-ed="save">💾 حفظ</button>
      <button class="b-exit" data-ed="exit">✕ خروج</button>
    </div>
    <button class="ed-step" data-ed="hide" style="width:100%;margin-top:8px;font-size:12px">إخفاء اللوحة ▾</button>`;
  ed.appendChild(pnl);
  const showBtn = document.createElement('button');
  showBtn.className = 'ed-min';
  showBtn.textContent = '▴ إظهار لوحة التعديل';
  showBtn.hidden = true;
  ed.appendChild(showBtn);
  stage.appendChild(ed);

  let panelPos = { x: SW * 0.5 - 134, y: SH * 0.5 - 110 };
  function place(id) {
    const c = byId[id];
    const p = layout[id];
    const el = els[id];
    const w = c.w * p.s;
    const h = c.h * p.s;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.left = `${p.x * SW - w / 2}px`;
    el.style.top = `${p.y * SH - h / 2}px`;
    el.style.opacity = String(p.o);
    el.classList.toggle('sel', sel === id);
  }
  function placePanel() {
    panelPos.x = Math.min(Math.max(4, panelPos.x), SW - pnl.offsetWidth - 4);
    panelPos.y = Math.min(Math.max(4, panelPos.y), SH - pnl.offsetHeight - 4);
    pnl.style.left = `${panelPos.x}px`;
    pnl.style.top = `${panelPos.y}px`;
  }
  function refreshPanel() {
    const title = pnl.querySelector('[data-title]');
    title.textContent = sel ? `✏️ ${byId[sel].name}` : 'اختار زر حتى تعدّله';
    for (const k of ['s', 'o']) {
      const r = pnl.querySelector(`[data-range="${k}"]`);
      r.disabled = !sel;
      const v = sel ? layout[sel][k] : k === 's' ? 1 : 1;
      r.value = String(Math.round(v * 100));
      pnl.querySelector(`[data-val="${k}"]`).textContent = `${Math.round(v * 100)}%`;
    }
  }
  function relayout() {
    CONTROLS.forEach((c) => place(c.id));
    placePanel();
  }
  function clampInside(id) {
    const c = byId[id];
    const p = layout[id];
    const hw = (c.w * p.s) / 2 / SW;
    const hh = (c.h * p.s) / 2 / SH;
    p.x = Math.min(Math.max(hw, p.x), 1 - hw);
    p.y = Math.min(Math.max(hh, p.y), 1 - hh);
  }
  function select(id) {
    sel = id;
    CONTROLS.forEach((c) => els[c.id].classList.toggle('sel', c.id === id));
    refreshPanel();
  }
  function setValue(k, v) {
    if (!sel) return;
    layout[sel][k] = k === 's' ? Math.min(2, Math.max(0.5, v)) : Math.min(1, Math.max(0.2, v));
    clampInside(sel);
    dirty = true;
    place(sel);
    refreshPanel();
  }

  // Dragging controls.
  for (const c of CONTROLS) {
    const el = els[c.id];
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      select(c.id);
      haptic('light');
      el.setPointerCapture(e.pointerId);
      const start = toStage(e.clientX, e.clientY);
      const from = { x: layout[c.id].x, y: layout[c.id].y };
      const move = (ev) => {
        const pt = toStage(ev.clientX, ev.clientY);
        layout[c.id].x = from.x + (pt.x - start.x) / SW;
        layout[c.id].y = from.y + (pt.y - start.y) / SH;
        clampInside(c.id);
        dirty = true;
        place(c.id);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
  // Dragging the panel by its grip.
  const grip = pnl.querySelector('.ed-grip');
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const start = toStage(e.clientX, e.clientY);
    const from = { ...panelPos };
    const move = (ev) => {
      const pt = toStage(ev.clientX, ev.clientY);
      panelPos = { x: from.x + pt.x - start.x, y: from.y + pt.y - start.y };
      placePanel();
    };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  pnl.querySelectorAll('[data-range]').forEach((r) => {
    r.addEventListener('input', () => setValue(r.getAttribute('data-range'), Number(r.value) / 100));
  });
  pnl.querySelectorAll('[data-step]').forEach((b) => {
    b.onclick = () => { if (sel) setValue('s', layout[sel].s + Number(b.getAttribute('data-d'))); };
  });

  function close() {
    ed.remove();
    state.editor = null;
  }
  async function save() {
    try {
      const res = await api('/battle/layout', { method: 'PUT', body: { layout } });
      state.profile.layout = res.profile.layout;
      dirty = false;
      haptic('medium');
      toast('✅ انحفظت إعدادات التحكم');
    } catch (e) {
      toast(e.message);
    }
  }
  function requestExit() {
    if (!dirty) return close();
    const d = showDialog(`<h3>تطلع بدون حفظ؟</h3><p>عندك تعديلات على أماكن الأزرار ما انحفظت.</p>
      <div class="row"><button class="btn btn-hot" data-s>💾 حفظ وخروج</button><button class="btn" data-x>خروج بدون حفظ</button></div>`);
    d.querySelector('[data-s]').onclick = async () => { closeDialog(); await save(); close(); };
    d.querySelector('[data-x]').onclick = () => { closeDialog(); close(); };
  }
  async function copy() {
    try {
      toast('⏳ جاري تجهيز الكود…');
      const res = await api('/battle/layout/share', { method: 'POST', body: { layout, image: layoutPicture(layout) } });
      toastEl.hidden = true;
      try { await navigator.clipboard.writeText(res.code); } catch (e) { /* clipboard blocked: the code is shown */ }
      const d = showDialog(`<h3>📤 نسخ إعداداتي</h3><div class="code-box">${esc(res.code)}</div>
        <p>انسخ الكود ودزه لصديقك. ودزّيناه إلك بالبوت ويّا صورة لإعداداتك 📩</p>
        <div class="row"><button class="btn btn-cyan" data-c>نسخ الكود</button><button class="btn" data-x>تم</button></div>`);
      d.querySelector('[data-c]').onclick = async () => {
        try { await navigator.clipboard.writeText(res.code); toast('✅ انتسخ الكود'); } catch (e) { toast('اضغط على الكود مطولاً حتى تنسخه'); }
      };
      d.querySelector('[data-x]').onclick = closeDialog;
    } catch (e) {
      toast(e.message);
    }
  }
  function paste() {
    const d = showDialog(`<h3>📥 لصق إعدادات</h3><p>اكتب كود الإعدادات (مثل MF-AB12CD34)</p>
      <input class="code-input" maxlength="14" placeholder="MF-XXXXXXXX" />
      <div class="row"><button class="btn btn-hot" data-a>تطبيق</button><button class="btn" data-x>إلغاء</button></div>`);
    const input = d.querySelector('input');
    setTimeout(() => input.focus(), 50);
    d.querySelector('[data-x]').onclick = closeDialog;
    d.querySelector('[data-a]').onclick = async () => {
      const code = input.value.trim();
      if (!code) return;
      try {
        const res = await api(`/battle/layout/${encodeURIComponent(code)}`);
        layout = fullLayout(res.layout);
        dirty = true;
        closeDialog();
        relayout();
        refreshPanel();
        toast('✅ انلصقت الإعدادات، اضغط حفظ حتى تثبت');
      } catch (e) {
        toast(e.message);
      }
    };
  }

  pnl.querySelectorAll('[data-ed]').forEach((b) => {
    b.onclick = () => {
      const a = b.getAttribute('data-ed');
      if (a === 'save') save();
      else if (a === 'exit') requestExit();
      else if (a === 'copy') copy();
      else if (a === 'paste') paste();
      else if (a === 'reset') { layout = defaultLayout(); dirty = true; relayout(); refreshPanel(); toast('رجعت الأزرار لأماكنها الافتراضية'); }
      else if (a === 'hide') { pnl.hidden = true; showBtn.hidden = false; }
    };
  });
  showBtn.onclick = () => { pnl.hidden = false; showBtn.hidden = true; placePanel(); };
  ed.querySelector('.field').addEventListener('pointerdown', () => select(null));

  state.editor = { relayout, requestExit };
  relayout();
  refreshPanel();
  requestAnimationFrame(placePanel);
}

// ───────────── Boot ─────────────
async function boot() {
  fit();
  if (!API) return message('الإعداد ناقص', 'لازم تكتب عنوان سيرفر الروليت بملف config.js', false);
  if (!DEMO && !(tg && tg.initData)) {
    return message('افتح من داخل البوت', 'MF Battle يشتغل من داخل بوت الروليت بتيليجرام. افتح البوت واضغط على قسم MF Battle.', false);
  }
  screenEl.innerHTML = '<div class="center-msg"><img src="assets/mf-coin.svg" alt="" /><div class="spin"></div></div>';
  try {
    const res = await api('/battle');
    state.player = res.player;
    state.profile = res.profile;
    state.skins = res.skins;
    state.week = res.week;
    renderLobby();
  } catch (e) {
    if (e.code === 'BATTLE_COMING_SOON') message('قريباً ⚔️', 'MF Battle قيد التجهيز، ترقبوه!');
    else message('تعذّر الاتصال', esc(e.message));
  }
}

// ───────────── Demo data (open the page with ?demo=1 to preview without the bot) ─────────────
const demo = {
  player: { telegramId: 1, name: 'عمر', username: 'omar', photoUrl: null },
  profile: { coins: 1250, skin: 'skull', ownedSkins: ['classic', 'mf', 'ocean', 'neon', 'skull'], settings: { darkMode: true, chat: true, quality: 'medium', joystick: 'fixed' }, layout: {}, bestMass: 67976, totalMatches: 1923, totalSeconds: 98000 },
  skins: null,
};
const DEMO_SKINS = [
  ['classic', 'كلاسيك', 0, 'common'], ['mf', 'MF', 0, 'common'], ['ocean', 'المحيط', 80, 'common'], ['lava', 'الحمم', 80, 'common'],
  ['neon', 'نيون', 150, 'rare'], ['toxic', 'سام', 150, 'rare'], ['tiger', 'النمر', 250, 'rare'], ['snake', 'الحية', 300, 'epic'],
  ['galaxy', 'المجرة', 400, 'epic'], ['ziggurat', 'الزقورة', 500, 'epic'], ['skull', 'الجمجمة', 700, 'legendary'], ['crown', 'التاج', 900, 'legendary'], ['dragon', 'التنين', 1200, 'legendary'],
].map(([id, ar, price, rarity]) => ({ id, name: { ar, en: id }, price, rarity }));
const DEMO_NAMES = ['SASUKE', 'KONAN', 'عمر', 'BROKEN', 'CherryYT', 'دندون', 'زيد', 'mhmd'];
async function demoApi(path, opts) {
  await new Promise((r) => setTimeout(r, 120));
  const p = demo.profile;
  const reset = new Date(Date.now() + 3.4 * 86400000).toISOString();
  if (path === '/battle') return { ok: true, player: demo.player, profile: p, skins: DEMO_SKINS, week: { key: 'demo', resetsAt: reset } };
  if (path.startsWith('/battle/leaderboard')) {
    const type = path.split('type=')[1] || 'mass';
    const base = type === 'mass' ? 90000 : type === 'time' ? 52000 : 260;
    const rows = DEMO_NAMES.map((name, i) => ({ rank: i + 1, telegramId: i + 2, name, skin: DEMO_SKINS[(i * 3 + 2) % DEMO_SKINS.length].id, value: Math.round(base / (1 + i * 0.45)), me: name === 'عمر' }));
    return { ok: true, type, rows, resetsAt: reset, me: { rank: 3, value: rows[2].value } };
  }
  const buy = path.match(/^\/battle\/skins\/(\w+)\/buy$/);
  if (buy) {
    const s = DEMO_SKINS.find((x) => x.id === buy[1]);
    if (p.coins < s.price) { const e = new Error('ما عندك عملات MF كافية'); e.code = 'NOT_ENOUGH_COINS'; throw e; }
    p.coins -= s.price; p.ownedSkins.push(s.id);
    return { ok: true, profile: p };
  }
  const eq = path.match(/^\/battle\/skins\/(\w+)\/equip$/);
  if (eq) { p.skin = eq[1]; return { ok: true, profile: p }; }
  if (path === '/battle/settings') { p.settings = { ...p.settings, ...opts.body }; return { ok: true, profile: p }; }
  if (path === '/battle/layout') { p.layout = opts.body.layout; return { ok: true, profile: p }; }
  if (path === '/battle/layout/share') { demo.lastLayout = opts.body.layout; return { ok: true, code: 'MF-DEMO2026' }; }
  if (path.startsWith('/battle/layout/')) {
    if (!demo.lastLayout) { const e = new Error('الكود غير صحيح'); e.code = 'NOT_FOUND'; throw e; }
    return { ok: true, code: 'MF-DEMO2026', layout: demo.lastLayout };
  }
  throw new Error('unknown');
}

boot();
