import { skinSVG, RARITY, loadSkinImages } from './skins.js';
import { CONTROLS, byId, fullLayout, defaultLayout, controlHTML, layoutPicture, placeIn } from './controls.js';
import { sfx, setSoundEnabled, unlockSound } from './sound.js';
import { startGame } from './game.js';
import { showAd } from './ads.js';

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

const state = { player: null, profile: null, skins: [], week: null, weekly: null, editor: null, game: null, mode: 'online' };
try { state.mode = localStorage.getItem('mfb-mode') === 'practice' ? 'practice' : 'online'; } catch (e) { /* private mode */ }
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────────── Landscape stage ─────────────
// The lobby is always laid out landscape. A phone held upright gets the whole stage
// turned sideways (like the reference game); a phone held sideways shows it as is.
let rotated = false;
let SW = 0;
let SH = 0;
// The part of the stage that is safe for buttons (no notch, no Telegram buttons over it).
let SAFE = { x: 0, y: 0, w: 1, h: 1 };
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
  // Telegram reports both the device's safe area and its own buttons' area (fullscreen);
  // env() is the browser's view of the same notch. Take whichever is bigger.
  const ps = getComputedStyle(probe);
  const side = (name, css) => Math.max(parseFloat(ps[css]) || 0, tgInset(`--tg-safe-area-inset-${name}`)) + tgInset(`--tg-content-safe-area-inset-${name}`);
  const top = side('top', 'paddingTop');
  const bottom = side('bottom', 'paddingBottom');
  const left = side('left', 'paddingLeft');
  const right = side('right', 'paddingRight');
  const pad = rotated
    ? { l: 14 + top, r: 14 + bottom, t: 10 + right, b: 10 + left }
    : { l: 14 + left, r: 14 + right, t: 10 + top, b: 10 + bottom };
  stage.style.setProperty('--pad-l', `${pad.l}px`);
  stage.style.setProperty('--pad-r', `${pad.r}px`);
  stage.style.setProperty('--pad-t', `${pad.t}px`);
  stage.style.setProperty('--pad-b', `${pad.b}px`);
  // Buttons keep a smaller margin than the lobby, but never go under the notch / Telegram buttons.
  const g = rotated
    ? { l: top, r: bottom, t: right, b: left }
    : { l: left, r: right, t: top, b: bottom };
  SAFE = { x: 6 + g.l, y: 6 + g.t, w: Math.max(100, SW - 12 - g.l - g.r), h: Math.max(100, SH - 12 - g.t - g.b) };
  if (state.editor) state.editor.relayout();
  if (state.game) state.game.resize();
}

/** A screen point (pointer event) in stage coordinates. */
function toStage(clientX, clientY) {
  return rotated ? { x: clientY, y: SH - clientX } : { x: clientX, y: clientY };
}

window.addEventListener('resize', fit);
// Browsers allow sound only after a tap.
window.addEventListener('pointerdown', unlockSound, { once: true });

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
  if (state.game) return state.game.back();
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
  if (/تعذر|تحتاج|غير|ما عندك|خطأ|لازم/.test(text)) sfx('error');
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

const skinById = (id) => state.skins.find((s) => s.id === id) || state.skins[0] || { id: 'fly', name: { ar: 'الذبانة' }, rarity: 'common', price: 0 };
const owned = (id) => state.profile.ownedSkins.includes(id);

function coinsHTML() {
  return `<div class="coins" title="عملات MF"><img src="${COIN}" alt="MF" /><span>${fmt(state.profile.coins)}</span></div>`;
}

function avatarHTML() {
  const p = state.player;
  const pr = state.profile;
  const initial = esc((p.name || '?').trim().charAt(0).toUpperCase());
  // A round frame that fills up with your progress to the next level; tap it for all levels.
  const pct = Math.max(0, Math.min(1, ((pr.xp || 0) - (pr.levelXp || 0)) / Math.max(1, (pr.nextXp || 1) - (pr.levelXp || 0))));
  const C = 2 * Math.PI * 27;
  return `<button class="avatar-ring" data-act="levels" aria-label="اللفلات">
    <svg viewBox="0 0 60 60" class="ring-svg"><circle cx="30" cy="30" r="27" class="ring-bg"/><circle cx="30" cy="30" r="27" class="ring-fg" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}"/></svg>
    <span class="avatar">${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="" onerror="this.remove()" />` : initial}</span>
    <span class="ring-lvl">${pr.level || 1}</span>
  </button>`;
}

/** A ranked player's Telegram photo (or their first letter) — not their in-game skin. */
function personPic(r, size) {
  const initial = esc((r.name || '?').trim().charAt(0).toUpperCase());
  const img = r.photoUrl ? `<img src="${esc(r.photoUrl)}" alt="" onerror="this.remove()" />` : '';
  return `<span class="person" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px">${initial}${img}</span>`;
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
          <div class="me-sub">⭐ لفل <b>${p.level || 1}</b> · ${fmt(p.xp)}/${fmt(p.nextXp)} · أفضل كتلة <b>${fmt(p.bestMass)}</b></div>
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
        <div class="modes">
          <button class="mode-btn ${state.mode === 'online' ? 'on' : ''}" data-mode="online"><b>🌐 أونلاين</b><small>ويّا المطورين · ينحسب بالترتيب</small></button>
          <button class="mode-btn ${state.mode === 'online' ? '' : 'on'}" data-mode="practice"><b>🤖 تدريب</b><small>ضد 30 بوت · بدون نت</small></button>
        </div>
        <button class="play" data-act="play"><b>ابدأ اللعب</b><small>${state.mode === 'online' ? 'أونلاين ويّا المطورين والبوتات' : 'تدريب ضد البوتات'}</small></button>
        <div class="tiles">
          <button class="tile t-store" data-act="store"><span class="ic">🛒</span>المتجر</button>
          <button class="tile t-skins" data-act="skins"><span class="ic">🎭</span>السكنات</button>
          <button class="tile t-rank" data-act="rank"><span class="ic">🏆</span>الترتيب</button>
        </div>
      </section>
      <section class="weekly" id="weekly">
        <div class="w-head"><b>🏆 أبطال الأسبوع</b></div>
        <div class="w-empty"><div class="spin" style="margin:auto"></div></div>
      </section>
    </div>`;
  bindActs(screenEl);
  screenEl.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => {
      haptic('light');
      state.mode = b.getAttribute('data-mode');
      try { localStorage.setItem('mfb-mode', state.mode); } catch (e) { /* private mode */ }
      renderLobby();
    };
  });
  renderWeekly();
}

function bindActs(root) {
  root.querySelectorAll('[data-act]').forEach((el) => {
    el.onclick = () => {
      haptic('light');
      const act = el.getAttribute('data-act');
      if (act === 'roulette') { sfx('close'); goRoulette(); }
      else if (act === 'play') playGame();
      else { sfx('open'); openPanel(act); }
    };
  });
}

// ───────────── The game ─────────────
/** Where the online room lives (the bot's server) and how to sign in to it. */
function onlineInfo() {
  const custom = new URLSearchParams(location.search).get('ws');
  if (custom) return { url: custom, initData: (tg && tg.initData) || 'demo' };
  if (DEMO) return null;
  // A dedicated game server close to the players, if the bot set one; else the bot's own server.
  const url = CFG.wsUrl || state.wsUrl || `${(API || location.origin).replace(/^http/, 'ws')}/api/battle/ws`;
  return { url, initData: (tg && tg.initData) || '' };
}

function playGame() {
  if (state.game) return;
  sfx('open');
  closeDialog();
  screenEl.hidden = true;
  state.game = startGame({
    stage,
    player: state.player,
    profile: state.profile,
    toStage,
    getSize: () => ({ w: SW, h: SH, safe: SAFE }),
    online: state.mode === 'online' ? onlineInfo() : null,
    haptic,
    openControls: (done) => openEditor(done),
    // Coins from online kills (the server already saved them): keep the lobby in step.
    onCoins: (coins, level) => {
      state.profile.coins += coins;
      if (level) state.profile.level = level;
    },
    showAd: (blockId) => showAd(blockId, { demo: DEMO, base: API, hash: tgHash() }),
    ads: {
      reward: CFG.rewardBlockId || (state.ads && state.ads.rewardBlockId) || null,
      interstitial: CFG.interstitialBlockId || (state.ads && state.ads.interstitialBlockId) || 'int-52362',
    },
    onExit: () => {
      state.game = null;
      screenEl.hidden = false;
      renderLobby();
      refreshLobby(); // new best, coins, level and ranking show up right away
    },
  });
}

async function renderWeekly() {
  const box = document.getElementById('weekly');
  if (!box) return;
  try {
    if (!state.weekly) state.weekly = await api('/battle/leaderboard?type=mass');
    const w = state.weekly;
    const rows = w.rows;
    const spot = (r, place) => {
      const cls = ['first', 'second', 'third'][place - 1];
      if (!r) return `<div class="pod ${cls} empty"><div class="pod-skin">?</div><div class="pod-name">—</div><div class="pod-base"><b>${place}</b></div></div>`;
      return `<div class="pod ${cls} ${r.me ? 'me' : ''}">
        ${place === 1 ? '<span class="pod-crown">👑</span>' : ''}
        <div class="pod-skin">${personPic(r, 52)}</div>
        <div class="pod-name">${esc(r.name)}</div>
        <div class="pod-val">${fmt(r.value)}</div>
        <div class="pod-base"><b>${place}</b></div>
      </div>`;
    };
    const rest = rows.slice(3, 5).map((r) => `<div class="w-row ${r.me ? 'me' : ''}"><span class="rk">${r.rank}</span>${personPic(r, 22)}<span class="nm">${esc(r.name)}</span><span class="vl">${fmt(r.value)}</span></div>`).join('');
    box.innerHTML = `
      <div class="w-head"><b>🏆 أبطال الأسبوع</b><span>أكبر حجم</span></div>
      <div class="podium">${spot(rows[1], 2)}${spot(rows[0], 1)}${spot(rows[2], 3)}</div>
      ${rows.length ? rest : '<div class="w-empty">الساحة تنتظر أبطالها، كن أول واحد هنا 🔥</div>'}
      <div class="w-foot">
        <span class="w-me">ترتيبك <b>${w.me.rank ? `#${w.me.rank}` : '—'}</b></span>
        <span class="w-time">⏳ ${timeLeft(w.resetsAt)}</span>
      </div>
      <button class="w-all" data-act="rank">كل الترتيب ←</button>`;
    bindActs(box);
  } catch (e) {
    box.innerHTML = '<div class="w-head"><b>🏆 أبطال الأسبوع</b></div><div class="w-empty">تعذّر تحميل الترتيب</div>';
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
  else if (name === 'levels') renderLevels();
}

function closePanel() {
  sfx('close');
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

let storeTab = 'skins';
function renderStore(tab = storeTab) {
  storeTab = tab;
  const tabs = [['skins', '🎭 السكنات'], ['throws', '🎯 الرمي'], ['sizes', '🫧 الحجم']]
    .map(([k, label]) => `<button class="tab ${k === tab ? 'on' : ''}" data-stab="${k}">${label}</button>`).join('');
  let body = '';
  if (tab === 'skins') body = storeSkinsHTML();
  else if (tab === 'throws') body = storeThrowsHTML();
  else body = storeSizesHTML();
  panelEl.innerHTML = `${panelHead('🛒 المتجر')}<div class="tabs">${tabs}</div><div class="p-body">${body}</div>`;
  bindPanelClose();
  panelEl.querySelectorAll('[data-stab]').forEach((b) => { b.onclick = () => { sfx('open'); renderStore(b.getAttribute('data-stab')); }; });
  panelEl.querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => confirmBuy(b.getAttribute('data-buy')); });
  panelEl.querySelectorAll('[data-buy-throw]').forEach((b) => { b.onclick = () => buyThrow(Number(b.getAttribute('data-buy-throw'))); });
  panelEl.querySelectorAll('[data-ad-throw]').forEach((b) => { b.onclick = () => adThrow(Number(b.getAttribute('data-ad-throw')), b); });
  panelEl.querySelectorAll('[data-buy-size]').forEach((b) => { b.onclick = () => buySize(Number(b.getAttribute('data-buy-size'))); });
}

function storeSkinsHTML() {
  const sale = state.skins.filter((s) => s.price > 0 && (s.onSale !== false || owned(s.id)));
  const byRank = (a, b) => (RARITY[b.rarity]?.rank || 0) - (RARITY[a.rarity]?.rank || 0) || b.price - a.price;
  const packs = {};
  const loose = [];
  for (const s of sale) (s.pack ? (packs[s.pack] = packs[s.pack] || []) : loose).push(s);
  let html = '';
  for (const [id, items] of Object.entries(packs)) {
    const info = (state.packs && state.packs[id]) || { name: { ar: 'حزمة' }, days: 7, endsAt: null };
    const when = info.endsAt ? `⏳ تنتهي بعد ${timeLeft(info.endsAt)}` : `⏳ متاحة ${info.days} أيام بس من إطلاق اللعبة`;
    html += `<div class="pack-head"><b>🏴‍☠️ ${esc(info.name.ar)}</b><span>${when}</span><small>بعدها تنشال من المتجر، واللي اشتراها تبقى عنده.</small></div>
      <div class="grid">${items.sort(byRank).map((s) => skinCard(s, 'store')).join('')}</div>`;
  }
  if (loose.length) html += `<div class="grid">${loose.sort(byRank).map((s) => skinCard(s, 'store')).join('')}</div>`;
  return html || '<div class="center-msg"><p>ما اكو سكنات للبيع هسه.</p></div>';
}

const SPEED_LABELS = ['×1', '×2', '×5', '×10', '×20', '×50'];
function storeThrowsHTML() {
  const t = state.profile.throws || { owned: 1, allowed: [0, 1] };
  const shop = (state.shop && state.shop.throws) || [];
  const now = Date.now();
  const left = (until) => {
    const ms = new Date(until || 0).getTime() - now;
    return ms > 0 ? `${Math.ceil(ms / 60000)} دقيقة` : null;
  };
  const cards = shop.map((x) => {
    let status;
    if (x.level <= 1) status = '<button class="btn" disabled>✓ مجاني للكل</button>';
    else if ('price' in x) {
      if (t.owned >= x.level) status = '<button class="btn" disabled>✓ مملوك</button>';
      else if (t.owned < x.level - 1) status = `<button class="btn" disabled>اشتري ${SPEED_LABELS[x.level - 1]} أول</button>`;
      else status = `<button class="btn ${state.profile.coins >= x.price ? 'btn-hot' : ''}" data-buy-throw="${x.level}"><img src="${COIN}" alt="" class="ic-coin" /> ${fmt(x.price)}</button>`;
    } else {
      const until = x.level === 4 ? t.x20Until : t.x50Until;
      const on = left(until);
      const progress = x.level === 5 && t.x50Ads ? ` (${t.x50Ads}/2)` : '';
      status = on
        ? `<button class="btn btn-cyan" disabled>✓ مفتوح · باقي ${on}</button>`
        : `<button class="btn btn-violet" data-ad-throw="${x.level}">📺 ${x.ads === 1 ? 'شاهد إعلان' : 'شاهد إعلانين'}${progress}</button>`;
    }
    const note = x.level <= 1 ? 'للكل' : 'price' in x ? 'للأبد' : `${x.minutes} دقيقة بعد ${x.ads === 1 ? 'إعلان واحد' : 'إعلانين'}`;
    return `<div class="shop-card ${t.allowed.includes(x.level) ? 'owned' : ''}"><div class="shop-big">${x.label}</div><div class="sn">سرعة الرمي</div><small>${note}</small>${status}</div>`;
  }).join('');
  return `<p class="shop-note">زر سرعة الرمي داخل اللعبة يتنقل بس بين السرعات المفتوحة إلك.</p><div class="grid">${cards}</div>`;
}

function storeSizesHTML() {
  const sizes = (state.shop && state.shop.sizes) || [];
  const ownedIdx = state.profile.sizeOwned || 0;
  const cards = sizes.map((x, i) => {
    let status;
    if (i === 0) status = '<button class="btn" disabled>✓ مجاني</button>';
    else if (ownedIdx >= i) status = '<button class="btn" disabled>✓ مملوك</button>';
    else if (ownedIdx < i - 1) status = '<button class="btn" disabled>اشتري اللي قبله أول</button>';
    else status = `<button class="btn ${state.profile.coins >= x.price ? 'btn-hot' : ''}" data-buy-size="${i}"><img src="${COIN}" alt="" class="ic-coin" /> ${fmt(x.price)}</button>`;
    return `<div class="shop-card ${ownedIdx >= i ? 'owned' : ''} ${ownedIdx === i ? 'equipped' : ''}"><div class="shop-big">🫧 ${fmt(x.mass)}</div><div class="sn">تبدأ بكتلة ${fmt(x.mass)}</div>${status}</div>`;
  }).join('');
  return `<p class="shop-note">كل مرة تبدأ جولة (مو الانتقام) تبدأ بأكبر حجم عندك. هسه: <b>${fmt(state.profile.startMass || 20)}</b></p><div class="grid">${cards}</div>`;
}

async function buyThrow(level) {
  const item = state.shop.throws.find((x) => x.level === level);
  if (state.profile.coins < item.price) { toast(`تحتاج ${fmt(item.price - state.profile.coins)} عملة MF زيادة`); return; }
  try {
    const res = await api(`/battle/throws/${level}/buy`, { method: 'POST' });
    setProfile(res.profile);
    haptic('medium');
    sfx('buy');
    toast(`🎯 صارت عندك سرعة الرمي ${item.label}`);
    renderStore('throws');
  } catch (e) { toast(e.message); }
}

async function adThrow(level, btn) {
  btn.disabled = true;
  try {
    await showAd(state.ads && state.ads.rewardBlockId, { demo: DEMO, base: API, hash: tgHash() });
    const res = await api(`/battle/throws/${level}/ad`, { method: 'POST' });
    setProfile(res.profile);
    const t = res.profile.throws;
    if (level === 5 && t.x50Ads) toast('👍 باقي إعلان واحد ويفتح ×50');
    else toast(`🎯 انفتح ${SPEED_LABELS[level]} لمدة ${state.shop.throwAdMinutes || 15} دقيقة`);
    haptic('medium');
    renderStore('throws');
  } catch (e) {
    btn.disabled = false;
    toast(e.message || 'ما اكو إعلان هسه، جرّب بعد شوية');
  }
}

async function buySize(index) {
  const item = state.shop.sizes[index];
  if (state.profile.coins < item.price) { toast(`تحتاج ${fmt(item.price - state.profile.coins)} عملة MF زيادة`); return; }
  try {
    const res = await api(`/battle/sizes/${index}/buy`, { method: 'POST' });
    setProfile(res.profile);
    haptic('medium');
    sfx('buy');
    toast(`🫧 صرت تبدأ بكتلة ${fmt(item.mass)}`);
    renderStore('sizes');
  } catch (e) { toast(e.message); }
}

function renderLevels() {
  const p = state.profile;
  const rows = (state.levels || []).map((l) => {
    const done = p.level > l.level;
    const cur = p.level === l.level;
    const next = state.levels.find((x) => x.level === l.level + 1);
    const span = next ? next.xp - l.xp : 0;
    const inLevel = cur ? Math.max(0, p.xp - l.xp) : 0;
    const pct = cur && span ? Math.round((inLevel / span) * 100) : done ? 100 : 0;
    return `<div class="lv-row ${done ? 'done' : ''} ${cur ? 'cur' : ''}">
      <span class="lv-n">${l.level}</span>
      <div class="lv-mid"><b>لفل ${l.level}</b><small>${l.level === 1 ? 'البداية' : `يحتاج ${fmt(l.xp)} خبرة`}${cur && next ? ` · عندك ${fmt(inLevel)} من ${fmt(span)}` : ''}</small><i><em style="width:${pct}%"></em></i></div>
      <span class="lv-gift">${l.reward ? `<img src="${COIN}" alt="" class="ic-coin" /> ${fmt(l.reward)}` : '—'}${done ? ' ✓' : ''}</span>
    </div>`;
  }).join('');
  panelEl.innerHTML = `${panelHead('⭐ اللفلات')}<div class="p-body">
    <p class="shop-note">تاخذ خبرة من الأكل بالأونلاين (أكبر = أكثر) ومن وقت اللعب. كل لفل تطلعه يعطيك عملات MF، وكل 5 لفلات جائزة كبيرة.</p>
    <div class="lv-list">${rows}</div></div>`;
  bindPanelClose();
  const cur = panelEl.querySelector('.lv-row.cur');
  if (cur) cur.scrollIntoView({ block: 'center' });
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
      sfx('buy');
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
        sfx('equip');
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
      ? `<div class="lb-list">${res.rows.map((r) => `<div class="lb-row ${r.me ? 'me' : ''} ${r.rank <= 3 ? `r${r.rank}` : ''}"><span class="rk">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>${personPic(r, 32)}<span class="nm">${esc(r.name)}</span><span class="vl">${t.unit(r.value)}</span></div>`).join('')}</div>`
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
    ${sw('sound', '🔊 الأصوات', 'أصوات الأزرار واللعبة')}
    ${seg('quality', '✨ جودة اللعب', 'خفيف للأجهزة الضعيفة', [['low', 'خفيف'], ['medium', 'متوسط'], ['high', 'قوي']])}
    ${seg('joystick', '🕹️ الجويستك', 'ثابت بمكانه أو يتحرك ويه إصبعك', [['fixed', 'ثابت'], ['floating', 'متحرك']])}
    <div class="set-wide"><button class="controls-btn" data-controls>🎛️ إعدادات التحكم — رتّب الأزرار، حجمها وشفافيتها</button></div>
  </div></div>`;
  bindPanelClose();
  panelEl.querySelectorAll('[data-sw]').forEach((b) => {
    b.onclick = () => {
      const k = b.getAttribute('data-sw');
      s[k] = !s[k];
      if (k === 'sound') setSoundEnabled(s[k]);
      sfx('toggle');
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
      sfx('toggle');
      panelEl.querySelectorAll(`[data-seg="${k}"]`).forEach((x) => x.classList.toggle('on', x === b));
      haptic('light');
      saveSettingsSoon();
    };
  });
  panelEl.querySelector('[data-controls]').onclick = () => { sfx('open'); openEditor(); };
}

// ───────────── Control layout editor ─────────────
function openEditor(onClose) {
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
    const r = placeIn(SAFE, c, p);
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
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
    const hw = (c.w * p.s) / 2 / SAFE.w;
    const hh = (c.h * p.s) / 2 / SAFE.h;
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
        layout[c.id].x = from.x + (pt.x - start.x) / SAFE.w;
        layout[c.id].y = from.y + (pt.y - start.y) / SAFE.h;
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
    if (onClose) onClose(state.profile.layout);
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
async function loadHome() {
  const res = await api('/battle');
  state.player = res.player;
  state.profile = res.profile;
  state.skins = res.skins;
  state.packs = res.packs || {};
  state.shop = res.shop || { throws: [], sizes: [] };
  state.levels = res.levels || [];
  state.wsUrl = res.wsUrl || null;
  state.week = res.week;
  state.ads = res.ads || null;
}

let refreshing = false;
async function refreshLobby() {
  if (refreshing) return;
  refreshing = true;
  try {
    await loadHome();
    state.weekly = null;
    if (!state.game && panelEl.hidden && dialogEl.hidden) renderLobby();
  } catch (e) { /* offline for a moment: keep what is shown */ } finally {
    refreshing = false;
  }
}

async function boot() {
  fit();
  if (!API) return message('الإعداد ناقص', 'لازم تكتب عنوان سيرفر الروليت بملف config.js', false);
  if (!DEMO && !(tg && tg.initData)) {
    return message('افتح من داخل البوت', 'MF Battle يشتغل من داخل بوت الروليت بتيليجرام. افتح البوت واضغط على قسم MF Battle.', false);
  }
  screenEl.innerHTML = '<div class="center-msg"><img src="assets/mf-coin.svg" alt="" /><div class="spin"></div></div>';
  try {
    await Promise.all([loadHome(), loadSkinImages()]);
    setSoundEnabled(state.profile.settings.sound !== false);
    renderLobby();
    // Keep the lobby fresh (coins, level, best, ranking) without leaving and coming back.
    setInterval(() => { if (!state.game && panelEl.hidden && dialogEl.hidden && !document.hidden) refreshLobby(); }, 30000);
  } catch (e) {
    if (e.code === 'BATTLE_COMING_SOON') message('قريباً ⚔️', 'MF Battle قيد التجهيز، ترقبوه!');
    else message('تعذّر الاتصال', esc(e.message));
  }
}

// ───────────── Demo data (open the page with ?demo=1 to preview without the bot) ─────────────
const demo = {
  player: { telegramId: 1, name: 'عمر', username: 'omar', photoUrl: null },
  profile: { coins: 3250, skin: 'zoro', ownedSkins: ['fly', 'mf', 'zoro'], settings: { darkMode: true, chat: true, sound: true, quality: 'medium', joystick: 'fixed' }, layout: {}, bestMass: 67976, level: 7, xp: 1920, levelXp: 1800, nextXp: 2450, kills: 312, totalMatches: 1923, totalSeconds: 98000, throws: { owned: 1, allowed: [0, 1], x20Until: null, x50Until: null, x50Ads: 0 }, sizeOwned: 0, startMass: 20 },
};
const DEMO_SKINS = [
  ['fly', 'الذبانة', 0, 'common'], ['mf', 'MF', 0, 'common'],
  ['joyboy', 'جوي بوي', 2999, 'mythic', 'onepiece'], ['roger', 'روجر', 2499, 'mythic', 'onepiece'], ['kaido', 'كايدو', 1499, 'legendary', 'onepiece'],
  ['zoro', 'زورو', 1299, 'legendary', 'onepiece'], ['sanji', 'سانجي', 999, 'legendary', 'onepiece'], ['imu', 'إيمو ساما', 499, 'rare', 'onepiece'],
  ['whitebeard', 'اللحية البيضاء', 349, 'rare', 'onepiece'], ['usopp', 'أوسوب', 149, 'common', 'onepiece'],
].map(([id, ar, price, rarity, pack]) => ({ id, name: { ar, en: id }, price, rarity, pack, onSale: true }));
const DEMO_SHOP = {
  throws: [{ level: 0, label: '×1', price: 0 }, { level: 1, label: '×2', price: 0 }, { level: 2, label: '×5', price: 400 }, { level: 3, label: '×10', price: 900 }, { level: 4, label: '×20', ads: 1, minutes: 15 }, { level: 5, label: '×50', ads: 2, minutes: 15 }],
  sizes: [{ mass: 20, price: 0 }, { mass: 50, price: 300 }, { mass: 100, price: 800 }, { mass: 200, price: 1800 }, { mass: 400, price: 3500 }],
  throwAdMinutes: 15,
};
const DEMO_LEVELS = Array.from({ length: 50 }, (_, i) => ({ level: i + 1, xp: 50 * i * i, reward: i ? ((i + 1) % 5 === 0 ? (i + 1) * 60 : (i + 1) * 15) : 0 }));
function demoAllowed(t) {
  const out = [];
  for (let l = 0; l <= t.owned; l++) out.push(l);
  if (t.x20Until && new Date(t.x20Until) > new Date()) out.push(4);
  if (t.x50Until && new Date(t.x50Until) > new Date()) out.push(5);
  return out;
}
const DEMO_NAMES = ['SASUKE', 'KONAN', 'عمر', 'BROKEN', 'CherryYT', 'دندون', 'زيد', 'mhmd'];
async function demoApi(path, opts) {
  await new Promise((r) => setTimeout(r, 120));
  const p = demo.profile;
  const reset = new Date(Date.now() + 3.4 * 86400000).toISOString();
  if (path === '/battle') return { ok: true, player: demo.player, profile: p, skins: DEMO_SKINS, packs: { onepiece: { name: { ar: 'حزمة ون بيس' }, days: 7, endsAt: null } }, shop: DEMO_SHOP, levels: DEMO_LEVELS, wsUrl: null, week: { key: 'demo', resetsAt: reset }, ads: { rewardBlockId: 'demo-reward', interstitialBlockId: 'int-52362' } };
  const bt = path.match(/^\/battle\/throws\/(\d)\/(buy|ad)$/);
  if (bt) {
    const lv = Number(bt[1]);
    if (bt[2] === 'buy') {
      const item = DEMO_SHOP.throws[lv];
      if (p.coins < item.price) { const e = new Error('ما عندك عملات MF كافية'); throw e; }
      p.coins -= item.price; p.throws.owned = lv;
    } else if (lv === 4) p.throws.x20Until = new Date(Date.now() + 900000).toISOString();
    else if (p.throws.x50Ads >= 1) { p.throws.x50Until = new Date(Date.now() + 900000).toISOString(); p.throws.x50Ads = 0; } else p.throws.x50Ads = 1;
    p.throws.allowed = demoAllowed(p.throws);
    return { ok: true, profile: p };
  }
  const bs = path.match(/^\/battle\/sizes\/(\d)\/buy$/);
  if (bs) {
    const i = Number(bs[1]); const item = DEMO_SHOP.sizes[i];
    if (p.coins < item.price) { const e = new Error('ما عندك عملات MF كافية'); throw e; }
    p.coins -= item.price; p.sizeOwned = i; p.startMass = item.mass;
    return { ok: true, profile: p };
  }
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
