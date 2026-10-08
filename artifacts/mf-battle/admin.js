// MF Battle developer panel (developers only): tournaments, gifts to a player, broadcast,
// numbers, and switches. Opens from the lobby's "🛠 المطور" button.
//
// ctx: { panelEl, api, toast, esc, fmt, panelHead, bindPanelClose, showDialog, closeDialog, haptic, sfx, skinSVG }

let ctx = null;
let data = null;
let tab = 'tour';
let player = null; // the player found in the gifts tab
let tick = 0;

const TABS = [
  ['tour', '🏆 البطولة'],
  ['gift', '🎁 الهدايا'],
  ['cast', '📢 الإذاعة'],
  ['stats', '📊 الإحصائيات'],
  ['cmd', '⚙️ أوامر'],
];
const MODES = {
  longest: { name: 'أطول وقت متصدر', how: 'أكثر واحد يبقى الأول بالترتيب خلال وقت البطولة يفوز.' },
  final: { name: 'متصدر النهاية', how: 'اللي يكون الأول بالترتيب بآخر ثانية من البطولة يفوز.' },
};
const QUICK_MINUTES = [[10, '10 د'], [30, '30 د'], [60, 'ساعة'], [180, '3 ساعات'], [1440, 'يوم']];

const dur = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}س ${m}د` : m ? `${m}د ${r}ث` : `${r}ث`;
};
const left = (end) => {
  const s = Math.max(0, Math.floor((new Date(end).getTime() - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export async function openAdminPanel(c) {
  ctx = c;
  ctx.panelEl.innerHTML = `${ctx.panelHead('🛠 لوحة المطور')}<div class="p-body"><div class="center-msg"><div class="spin"></div></div></div>`;
  ctx.bindPanelClose();
  await load();
}

async function load() {
  try {
    data = await ctx.api('/battle/admin');
    render();
  } catch (e) {
    ctx.toast(e.message);
  }
}

function render() {
  if (!ctx || ctx.panelEl.hidden || !data) return;
  clearInterval(tick);
  const tabs = TABS.map(([k, label]) => `<button class="tab ${k === tab ? 'on' : ''}" data-atab="${k}">${label}</button>`).join('');
  let body = '';
  if (tab === 'tour') body = tourHTML();
  else if (tab === 'gift') body = giftHTML();
  else if (tab === 'cast') body = castHTML();
  else if (tab === 'stats') body = statsHTML();
  else body = cmdHTML();
  ctx.panelEl.innerHTML = `${ctx.panelHead('🛠 لوحة المطور')}<div class="tabs">${tabs}</div><div class="p-body adm">${body}</div>`;
  ctx.bindPanelClose();
  ctx.panelEl.querySelectorAll('[data-atab]').forEach((b) => {
    b.onclick = () => { ctx.sfx('open'); tab = b.getAttribute('data-atab'); render(); };
  });
  if (tab === 'tour') bindTour();
  else if (tab === 'gift') bindGift();
  else if (tab === 'cast') bindCast();
  else if (tab === 'cmd') bindCmd();
}

const q = (sel) => ctx.panelEl.querySelector(sel);
const qa = (sel) => ctx.panelEl.querySelectorAll(sel);

/** Asks first; runs fn on yes. */
function confirmDo(title, text, yes, fn) {
  const box = ctx.showDialog(`<h3>${title}</h3><p>${text}</p><div class="row"><button class="btn btn-hot" data-yes>${yes}</button><button class="btn" data-no>رجوع</button></div>`);
  box.querySelector('[data-no]').onclick = ctx.closeDialog;
  box.querySelector('[data-yes]').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await fn();
    } finally {
      ctx.closeDialog();
    }
  };
}

// ───────────── Tournament ─────────────
function tourHTML() {
  const t = data.tournament;
  if (t) {
    const m = MODES[t.mode] || { name: t.mode, how: '' };
    const rows = (t.top || []).map((e, i) => `<div class="adm-row"><b>${i + 1}</b><span>${ctx.esc(e.name)}</span><small>⏱️ ${dur(e.leadSeconds)} · ⚖️ ${ctx.fmt(e.bestMass)}</small></div>`).join('');
    return `<div class="adm-card live">
        <div class="adm-title">🟢 بطولة شغالة · ${m.name}</div>
        <div class="adm-big" data-left>${left(t.endsAt)}</div>
        <small>${m.how}</small>
        ${t.prize ? `<div class="adm-now">🎁 ${ctx.esc(t.prize)}</div>` : ''}
        <div class="adm-now">👑 المتصدر هسه: <b>${t.current ? `${ctx.esc(t.current.name)} (${ctx.fmt(t.current.mass)})` : '—'}</b></div>
      </div>
      <div class="adm-card"><div class="adm-title">📊 وقت التصدر</div>${rows || '<small>محد تصدر بعد.</small>'}</div>
      <div class="adm-btns">
        <button class="btn btn-hot" data-end>⏹ إنهاء الآن وإعلان الفائز</button>
        <button class="btn" data-cancel>✖ إلغاء بدون فائز</button>
      </div>`;
  }
  const hist = (data.history || []).map((h) => {
    const m = MODES[h.mode] || { name: h.mode };
    const w = h.status === 'cancelled' ? 'ملغية' : h.winner ? `🥇 ${ctx.esc(h.winner.name)} · ⏱️ ${dur(h.winner.leadSeconds)}` : 'بدون فائز';
    return `<div class="adm-row"><span>${new Date(h.startedAt).toLocaleDateString('ar-IQ')}</span><small>${m.name} · ${h.minutes} د</small><b>${w}</b></div>`;
  }).join('');
  return `<div class="adm-card">
      <div class="adm-title">⏱️ مدة البطولة (بالدقائق)</div>
      <div class="adm-line"><input class="adm-input" type="number" min="1" max="10080" value="30" data-min /></div>
      <div class="seg wrap">${QUICK_MINUTES.map(([v, l]) => `<button data-quick="${v}">${l}</button>`).join('')}</div>
    </div>
    <div class="adm-card">
      <div class="adm-title">🎁 الجائزة / وصف البطولة <small>(اختياري)</small></div>
      <textarea class="adm-input adm-text short" maxlength="300" placeholder="مثلاً: الفائز ياخذ 5000 عملة MF وسكن جوي بوي" data-prize></textarea>
    </div>
    <div class="adm-card">
      <div class="adm-title">🎯 نوع البطولة</div>
      <div class="adm-modes">${Object.entries(MODES).map(([k, m], i) => `<button class="adm-mode ${i === 0 ? 'on' : ''}" data-mode="${k}"><b>${m.name}</b><small>${m.how}</small></button>`).join('')}</div>
    </div>
    ${data.public ? '' : '<p class="shop-note">⚠️ اللعبة بعدها للمطورين بس، فالإذاعة راح توصل للمطورين. افتحها للكل من «أوامر».</p>'}
    <div class="adm-btns">
      <button class="btn btn-hot" data-start="1">🚀 بدء البطولة + نشر إذاعة</button>
      <button class="btn btn-violet" data-start="0">▶ بدء فقط</button>
    </div>
    ${hist ? `<div class="adm-card"><div class="adm-title">🗂️ آخر البطولات</div>${hist}</div>` : ''}`;
}

function bindTour() {
  const t = data.tournament;
  if (t) {
    tick = setInterval(() => {
      const el = q('[data-left]');
      if (!el) return clearInterval(tick);
      el.textContent = left(t.endsAt);
      if (new Date(t.endsAt).getTime() <= Date.now()) { clearInterval(tick); setTimeout(load, 12000); }
    }, 1000);
    q('[data-end]').onclick = () => confirmDo('⏹ إنهاء البطولة', 'تنتهي هسه، ينعلن الفائز وتوصل رسالة للمطورين وللفائز.', 'إنهاء', async () => {
      try { await ctx.api('/battle/admin/tournament/end', { method: 'POST' }); ctx.toast('🏁 خلصت البطولة'); await load(); } catch (e) { ctx.toast(e.message); }
    });
    q('[data-cancel]').onclick = () => confirmDo('✖ إلغاء البطولة', 'تنلغي بدون فائز وبدون رسائل.', 'إلغاء البطولة', async () => {
      try { await ctx.api('/battle/admin/tournament/cancel', { method: 'POST' }); ctx.toast('انلغت البطولة'); await load(); } catch (e) { ctx.toast(e.message); }
    });
    return;
  }
  let mode = 'longest';
  qa('[data-quick]').forEach((b) => { b.onclick = () => { q('[data-min]').value = b.getAttribute('data-quick'); ctx.sfx('toggle'); }; });
  qa('[data-mode]').forEach((b) => {
    b.onclick = () => {
      mode = b.getAttribute('data-mode');
      qa('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
      ctx.sfx('toggle');
    };
  });
  qa('[data-start]').forEach((b) => {
    b.onclick = () => {
      const minutes = Math.floor(Number(q('[data-min]').value));
      if (!(minutes >= 1 && minutes <= 10080)) return ctx.toast('اكتب مدة من 1 إلى 10080 دقيقة');
      const broadcast = b.getAttribute('data-start') === '1';
      const prize = q('[data-prize]').value.trim();
      confirmDo(
        '🏆 بدء بطولة',
        `المدة: <b>${dur(minutes * 60)}</b><br>النوع: <b>${MODES[mode].name}</b><br>${prize ? `الجائزة: <b>${ctx.esc(prize)}</b><br>` : ''}${broadcast ? '📢 تنرسل إذاعة بالبطولة.' : 'بدون إذاعة.'}`,
        'ابدأ',
        async () => {
          try {
            const res = await ctx.api('/battle/admin/tournament', { method: 'POST', body: { minutes, mode, broadcast, prize } });
            ctx.haptic('medium');
            ctx.sfx('buy');
            ctx.toast(res.broadcast ? `🚀 بدت البطولة · الإذاعة لـ ${ctx.fmt(res.broadcast.total)} ${res.broadcast.to === 'all' ? 'مستخدم' : 'مطور'}` : '🚀 بدت البطولة');
            await load();
          } catch (e) { ctx.toast(e.message); }
        }
      );
    };
  });
}

// ───────────── Gifts ─────────────
function giftHTML() {
  const p = player;
  const skins = data.skins.map((s) => `<option value="${s.id}">${ctx.esc(s.name)}</option>`).join('');
  const throws = data.throws.map((x) => `<option value="${x.level}">${x.label} دائمي</option>`).join('');
  const sizes = data.sizes.map((x) => `<option value="${x.index}">تبدأ بـ ${x.mass}</option>`).join('');
  const card = p
    ? `<div class="adm-card adm-player">
        <div class="adm-title">👤 ${ctx.esc(p.name)} ${p.username ? `<small>@${ctx.esc(p.username)}</small>` : ''} <small>${p.telegramId}</small></div>
        <div class="adm-stats">
          <span>🪙 <b>${ctx.fmt(p.coins)}</b></span><span>⭐ لفل <b>${p.level}</b></span><span>🍴 <b>${ctx.fmt(p.kills)}</b> أكلة</span>
          <span>⚖️ أفضل <b>${ctx.fmt(p.bestMass)}</b></span><span>🎮 <b>${ctx.fmt(p.totalMatches)}</b></span>
          <span>🎯 ×${[1, 2, 5, 10][p.throwOwned] || 2}${p.x20Forever ? ' · ×20∞' : ''}${p.x50Forever ? ' · ×50∞' : ''}</span>
        </div>
        <div class="adm-skins">${p.ownedSkins.map((id) => ctx.skinSVG(id, 34)).join('')}</div>
      </div>
      <div class="adm-card">
        <div class="adm-title">🎁 شنو تنطيه؟</div>
        <div class="adm-gifts">
          <div class="adm-line"><span>🎭 سكن</span><select class="adm-input" data-v="skin">${skins}</select><button class="btn btn-violet" data-give="skin">انطي</button></div>
          <div class="adm-line"><span>⚡ مايكرو</span><select class="adm-input" data-v="throw">${throws}</select><button class="btn btn-violet" data-give="throw">انطي</button></div>
          <div class="adm-line"><span>🫧 حجم</span><select class="adm-input" data-v="size">${sizes}</select><button class="btn btn-violet" data-give="size">انطي</button></div>
          <div class="adm-line"><span>🪙 عملات</span><input class="adm-input" type="number" value="1000" data-v="coins" /><button class="btn btn-hot" data-give="coins">انطي</button></div>
        </div>
        <label class="adm-check"><input type="checkbox" data-notify checked /> يوصله إشعار من البوت</label>
        <small>للسحب اكتب العملات بالسالب (مثلاً ‎-500).</small>
      </div>`
    : '<p class="shop-note">اكتب آيدي اللاعب أو يوزره وابحث، بعدين اختار الهدية.</p>';
  return `<div class="adm-card"><div class="adm-line"><input class="adm-input wide" placeholder="آيدي أو @يوزر" data-user value="${p ? p.telegramId : ''}" /><button class="btn btn-cyan" data-find>🔍 بحث</button></div></div>${card}`;
}

function bindGift() {
  q('[data-find]').onclick = async () => {
    const user = q('[data-user]').value.trim();
    if (!user) return ctx.toast('اكتب الآيدي أو اليوزر');
    try {
      player = (await ctx.api(`/battle/admin/player?user=${encodeURIComponent(user)}`)).player;
      render();
    } catch (e) { player = null; ctx.toast(e.message); render(); }
  };
  qa('[data-give]').forEach((b) => {
    b.onclick = async () => {
      const kind = b.getAttribute('data-give');
      const value = q(`[data-v="${kind}"]`).value;
      b.disabled = true;
      try {
        const res = await ctx.api('/battle/admin/grant', { method: 'POST', body: { user: String(player.telegramId), kind, value, notify: q('[data-notify]').checked } });
        player = res.player;
        ctx.haptic('medium');
        ctx.sfx('buy');
        ctx.toast(`✅ انطيته ${res.note}`);
        render();
      } catch (e) { b.disabled = false; ctx.toast(e.message); }
    };
  });
}

// ───────────── Broadcast ─────────────
function castHTML() {
  return `<div class="adm-card">
      <div class="adm-title">📢 نص الإذاعة</div>
      <textarea class="adm-input adm-text" maxlength="3500" placeholder="اكتب رسالتك…" data-text></textarea>
      <div class="seg wrap" data-to>
        <button class="on" data-v="all">كل مستخدمي البوت</button>
        <button data-v="players">لاعبي MF Battle</button>
        <button data-v="developers">المطورين (تجربة)</button>
      </div>
      <label class="adm-check"><input type="checkbox" data-btn checked /> زر «⚔️ ادخل MF Battle» تحت الرسالة</label>
    </div>
    <div class="adm-btns"><button class="btn btn-hot" data-send>📢 إرسال</button></div>`;
}

function bindCast() {
  let to = 'all';
  qa('[data-to] button').forEach((b) => {
    b.onclick = () => { to = b.getAttribute('data-v'); qa('[data-to] button').forEach((x) => x.classList.toggle('on', x === b)); ctx.sfx('toggle'); };
  });
  q('[data-send]').onclick = () => {
    const text = q('[data-text]').value.trim();
    if (!text) return ctx.toast('اكتب نص الإذاعة');
    const button = q('[data-btn]').checked;
    const who = { all: 'كل مستخدمي البوت', players: 'لاعبي MF Battle', developers: 'المطورين' }[to];
    confirmDo('📢 إرسال الإذاعة', `توصل إلى: <b>${who}</b>`, 'إرسال', async () => {
      try {
        const res = await ctx.api('/battle/admin/broadcast', { method: 'POST', body: { text, to, button } });
        ctx.toast(`📢 تنرسل هسه لـ ${ctx.fmt(res.total)} شخص`);
        q('[data-text]').value = '';
      } catch (e) { ctx.toast(e.message); }
    });
  };
}

// ───────────── Stats ─────────────
function statsHTML() {
  const s = data.stats;
  const box = (label, value) => `<div class="adm-stat"><b>${value}</b><small>${label}</small></div>`;
  const list = (rows, unit) => rows.map((r, i) => `<div class="adm-row"><b>${i + 1}</b><span>${ctx.esc(r.name)}</span><small>${ctx.fmt(r.value)} ${unit}</small></div>`).join('') || '<small>—</small>';
  const skins = data.skins.map((k) => `<span class="adm-skin">${ctx.skinSVG(k.id, 30)}<b>${ctx.fmt(s.skins[k.id] || 0)}</b></span>`).join('');
  return `<div class="adm-grid">
      ${box('🟢 يلعبون هسه', ctx.fmt(s.online))}
      ${box('👥 كل اللاعبين', ctx.fmt(s.profiles))}
      ${box('🆕 جدد اليوم', ctx.fmt(s.newToday))}
      ${box('🆕 جدد بالأسبوع', ctx.fmt(s.newWeek))}
      ${box('📅 لعبوا هذا الأسبوع', ctx.fmt(s.weekPlayers))}
      ${box('🎮 كل المباريات', ctx.fmt(s.matches))}
      ${box('⏱️ ساعات اللعب', ctx.fmt(s.hours))}
      ${box('🍴 كل الأكلات', ctx.fmt(s.kills))}
      ${box('🪙 عملات عند اللاعبين', ctx.fmt(s.coins))}
    </div>
    <div class="adm-two">
      <div class="adm-card"><div class="adm-title">🍴 أكثر أكلات</div>${list(s.topKills, '')}</div>
      <div class="adm-card"><div class="adm-title">⚖️ أكبر كتلة</div>${list(s.topMass, '')}</div>
    </div>
    <div class="adm-card"><div class="adm-title">🎭 كم واحد يملك كل سكن</div><div class="adm-skins">${skins}</div></div>`;
}

// ───────────── Commands ─────────────
function cmdHTML() {
  const link = data.link
    ? `<div class="adm-card adm-link"><div class="adm-title">🔗 رابط اللعبة المباشر</div><div class="adm-line"><input class="adm-input wide ltr" readonly value="${ctx.esc(data.link)}" data-link /><button class="btn btn-cyan" data-copy>📋 نسخ</button></div><small>تكدر تنشره بأي مكان: اللي يضغطه تنفتح عنده اللعبة (للمطورين، أو للكل إذا فتحتها).</small></div>`
    : '';
  return `${link}<div class="set-list">
      <div class="set-row"><div class="lbl">🌍 اللعبة مفتوحة للكل<small>${data.public ? 'هسه: كل مستخدمي البوت يكدرون يلعبون' : 'هسه: المطورين بس'}</small></div><button class="switch ${data.public ? 'on' : ''}" data-public role="switch" aria-checked="${data.public}"></button></div>
      <div class="set-row"><div class="lbl">🔄 تحديث الأرقام<small>يجيب آخر الإحصائيات والبطولة</small></div><button class="btn btn-cyan" data-reload>تحديث</button></div>
      <div class="set-row"><div class="lbl">🎁 هدية للاعب<small>سكن، مايكرو دائمي، حجم بداية أو عملات</small></div><button class="btn" data-goto="gift">الهدايا</button></div>
      <div class="set-row"><div class="lbl">🏆 بطولة جديدة<small>حدد المدة والنوع وابدأ</small></div><button class="btn" data-goto="tour">البطولة</button></div>
    </div>`;
}

function bindCmd() {
  q('[data-public]').onclick = () => {
    const open = !data.public;
    confirmDo(open ? '🌍 فتح اللعبة للكل' : '🔒 قفل اللعبة', open ? 'كل مستخدمي البوت يكدرون يدخلون MF Battle، وتطلع إلهم بالروليت.' : 'ترجع للمطورين بس.', open ? 'افتحها' : 'اقفلها', async () => {
      try { await ctx.api('/battle/admin/public', { method: 'POST', body: { open } }); data.public = open; ctx.toast(open ? '🌍 انفتحت اللعبة للكل' : '🔒 صارت للمطورين بس'); render(); } catch (e) { ctx.toast(e.message); }
    });
  };
  q('[data-reload]').onclick = () => { ctx.sfx('open'); load(); };
  const copyBtn = q('[data-copy]');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const input = q('[data-link]');
      try {
        await navigator.clipboard.writeText(data.link);
        ctx.toast('✅ انتسخ الرابط');
      } catch (e) {
        // Clipboard blocked: select the text so a long press copies it.
        input.focus();
        input.select();
        ctx.toast('اضغط على الرابط مطولاً حتى تنسخه');
      }
    };
  }
  qa('[data-goto]').forEach((b) => { b.onclick = () => { tab = b.getAttribute('data-goto'); render(); }; });
}
