import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGrid, PlusCircle, ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';
import { locale, tr } from '../i18n';
import { api, ApiError } from '../services/api';
import { getTelegramWebApp, haptic } from '../hooks/useTelegramWebApp';
import {
  ExchangeCurrency,
  ExchangeListingDetail,
  ExchangeListingSummary,
  ExchangeMode,
  ExchangeStatus,
  ReportReason,
} from '../types';

type ExTab = 'browse' | 'post' | 'mine';
type Price = { currency: ExchangeCurrency; amount: number };
type Flash = (text: string) => void;

const LOADING_MS = 2000;
const MAX_REPORT_MEDIA = 4;

function modeLabel(mode: ExchangeMode) {
  if (mode === 'trade') return tr('تبديل فقط', 'Trade only');
  if (mode === 'sell') return tr('بيع فقط', 'Sale only');
  return tr('يقبل بيع وتبديل', 'Sale or trade');
}

function currencyLabel(c: ExchangeCurrency | null) {
  switch (c) {
    case 'usd': return tr('دولار', 'USD');
    case 'asia': return tr('اسيا', 'Asia');
    case 'zain': return tr('زين', 'Zain');
    case 'master': return tr('ماستر', 'Master');
    case 'ton': return tr('تون', 'TON');
    case 'pound': return tr('جنيه', 'Pound');
    case 'riyal': return tr('ريال', 'Riyal');
    default: return '';
  }
}

function reasonLabel(r: ReportReason) {
  switch (r) {
    case 'scammer': return tr('🦹 سرّاق / نصّاب', '🦹 Scammer / thief');
    case 'no_middleman': return tr('🚫 لا يقبل وسيط', '🚫 Refuses a middleman');
    case 'not_owner': return tr('🙅 ليس حسابه', "🙅 Not their account");
    case 'fake_info': return tr('🖼️ معلومات أو صور مزيفة', '🖼️ Fake info or photos');
    default: return tr('❓ سبب آخر', '❓ Something else');
  }
}

function priceText(p: Price) {
  return `${p.amount.toLocaleString(locale())} ${currencyLabel(p.currency)}`;
}

/** "3 days 4 hours" until a post is removed automatically. */
function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return tr('انتهى', 'expired');
  const h = Math.floor(ms / 3600e3);
  const d = Math.floor(h / 24);
  const hh = h % 24;
  if (d > 0) return tr(`${d} يوم و ${hh} ساعة`, `${d}d ${hh}h`);
  if (h > 0) return tr(`${h} ساعة`, `${h}h`);
  return tr(`${Math.max(1, Math.floor(ms / 60e3))} دقيقة`, `${Math.max(1, Math.floor(ms / 60e3))}m`);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  }
}

function errText(err: unknown) {
  return err instanceof ApiError ? err.message : tr('حدث خطأ، حاول مرة أخرى.', 'Something went wrong, please try again.');
}

function openTgLink(url: string) {
  const tg = getTelegramWebApp();
  if (url.startsWith('https://t.me/') && tg?.openTelegramLink) tg.openTelegramLink(url);
  else if (url.startsWith('https://')) window.open(url, '_blank');
  // No @username: best effort by numeric ID through Telegram's own URI scheme.
  else window.location.href = url;
}

/** Shrinks a photo to ~1280px JPEG before upload so posts stay light on slow connections. */
async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function rules(): { icon: string; text: string }[] {
  return [
    { icon: '🤝', text: tr('يجب أن تقبل التعامل عن طريق وسيط.', 'You must accept dealing through a middleman.') },
    { icon: '🛡️', text: tr('لا تثق بأي أحد غير وسطاء MF المعتمدين.', "Don't trust anyone except the approved MF middlemen.") },
    { icon: '⛔', text: tr('ممنوع التبادل بدون وسيط، وإذا تمت سرقتك ستُحظر من البوت لأن البوت نبّهك مسبقاً.', 'Trading without a middleman is forbidden. If you get scammed you will be banned from the bot, because the bot warned you beforehand.') },
    { icon: '🗑️', text: tr('عند بيع الحساب أو تبديله يجب حذفه من القسم.', 'Once the account is sold or traded you must delete it from the section.') },
    { icon: '⏰', text: tr('كل منشور ينحذف تلقائياً بعد 4 أيام من عرضه، وتقدر تعرضه من جديد.', 'Every post is removed automatically 4 days after it goes up; you can post it again.') },
    { icon: '✅', text: tr('يجب أن يكون الحساب ملكك، والصور والمعلومات حقيقية.', 'The account must be yours, with real photos and info.') },
    { icon: '🔐', text: tr('لا تعطِ إيميل أو باسورد حسابك لأي أحد قبل حضور الوسيط.', "Don't give your account email or password to anyone before the middleman is there.") },
    { icon: '📵', text: tr('ممنوع تكرار نشر نفس الحساب أو نشر روابط وإعلانات.', 'No reposting the same account, links or ads.') },
    { icon: '⚖️', text: tr('أي منشور مخالف يُحذف وصاحبه قد يُحظر، والبوت غير مسؤول عن أي تعامل بدون وسيط.', 'Posts that break the rules are removed and their owners may be banned. The bot is not responsible for any deal made without a middleman.') },
  ];
}

export function ExchangePage({ onBack, initialListingId }: { onBack: () => void; initialListingId?: string | null }) {
  const [stage, setStage] = useState<'loading' | 'intro' | 'main' | 'locked' | 'error'>('loading');
  const [status, setStatus] = useState<ExchangeStatus | null>(null);
  const [tab, setTab] = useState<ExTab>('browse');
  const [openId, setOpenId] = useState<string | null>(initialListingId ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = useCallback<Flash>((text) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const loadStatus = useCallback(async () => {
    const s = await api.get<ExchangeStatus>('/exchange');
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadStatus(), new Promise((r) => window.setTimeout(r, LOADING_MS))])
      .then(([s]) => {
        if (cancelled) return;
        if (!s.allowed) setStage('locked');
        // Links to one post (from report alerts) skip the rules screen.
        else setStage(initialListingId ? 'main' : 'intro');
      })
      .catch(() => !cancelled && setStage('error'));
    return () => {
      cancelled = true;
    };
  }, [loadStatus, initialListingId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage, tab]);

  if (stage === 'loading') {
    return (
      <div className="ex-loading">
        <div className="ex-loading-icon">🔄</div>
        <div className="ex-spinner" />
        <div className="ex-loading-text">{tr('يتم التحميل...', 'Loading...')}</div>
      </div>
    );
  }

  if (stage === 'locked' || stage === 'error') {
    return (
      <div className="ex-page">
        <ExHeader title={tr('🔄 قسم التبادل', '🔄 Exchange')} onBack={onBack} />
        <div className="card ex-empty">
          <div style={{ fontSize: 46 }}>{stage === 'locked' ? '🔜' : '⚠️'}</div>
          <p>{stage === 'locked' ? tr('قريباً! قسم التبادل قيد التجهيز.', 'Coming soon! The exchange is being prepared.') : tr('تعذر التحميل، حاول لاحقاً', 'Could not load, try again later')}</p>
        </div>
      </div>
    );
  }

  if (stage === 'intro') {
    return (
      <div className="ex-page">
        <ExHeader title={tr('🔄 قسم التبادل', '🔄 Exchange')} onBack={onBack} />
        <div className="ex-intro-hero">
          <div className="ex-intro-icon">🤝</div>
          <p>{tr('يمكنك تبديل حسابك في لعبة باونتي راش مع المستخدمين الآخرين من البوت باستعمال وسيط مضمون وبسهولة أكبر.', 'Trade your Bounty Rush account with other bot users through a trusted middleman, more easily than ever.')}</p>
        </div>
        <div className="card ex-rules">
          <h3>{tr('📜 شروط قسم التبادل', '📜 Exchange rules')}</h3>
          <ul>
            {rules().map((r) => (
              <li key={r.text}><span className="ex-rule-icon">{r.icon}</span><span>{r.text}</span></li>
            ))}
          </ul>
        </div>
        <button className="btn btn-primary ex-agree" onClick={() => { haptic('medium'); setStage('main'); }}>
          {tr('✅ تم، أوافق على الشروط', '✅ Done, I agree to the rules')}
        </button>
      </div>
    );
  }

  const s = status!;
  const goTab = (t: ExTab) => {
    setOpenId(null);
    setTab(t);
  };
  const posted = () => {
    setRefreshKey((k) => k + 1);
    void loadStatus();
    goTab('mine');
  };

  return (
    <div className="ex-page ex-main">
      <ExHeader
        title={tab === 'browse' ? tr('🔄 قسم التبادل', '🔄 Exchange') : tab === 'post' ? tr('➕ اعرض حسابك', '➕ Post your account') : tr('📋 منشوراتي', '📋 My posts')}
        onBack={onBack}
      />
      {s.comingSoon && <div className="games-soon-banner">{tr('🧪 وضع الاختبار: القسم ظاهر للمطورين فقط.', '🧪 Test mode: only developers can see this section.')}</div>}

      {tab === 'browse' && <ListingGrid refreshKey={refreshKey} onOpen={setOpenId} emptyAction={() => goTab('post')} />}
      {tab === 'post' && <PostForm status={s} flash={flash} onPosted={posted} />}
      {tab === 'mine' && <MyListings refreshKey={refreshKey} status={s} onOpen={setOpenId} onNew={() => goTab('post')} />}

      {openId && (
        <ListingDetail
          id={openId}
          status={s}
          flash={flash}
          onClose={() => setOpenId(null)}
          onChanged={() => { setRefreshKey((k) => k + 1); void loadStatus(); }}
        />
      )}

      <nav className="bottom-nav ex-nav">
        {([
          ['browse', tr('الحسابات', 'Accounts'), <LayoutGrid size={22} key="i" />],
          ['post', tr('اعرض حسابك', 'Post'), <PlusCircle size={22} key="i" />],
          ['mine', tr('منشوراتي', 'My posts'), <ClipboardList size={22} key="i" />],
        ] as [ExTab, string, React.ReactNode][]).map(([key, label, icon]) => (
          <button key={key} className={`nav-item ${tab === key ? 'active' : ''}`} onClick={() => { haptic('light'); goTab(key); }}>
            <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ExHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="header-row">
      <h2 className="page-title" style={{ margin: 0 }}>{title}</h2>
      <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={onBack}>{tr('رجوع', 'Back')}</button>
    </div>
  );
}

function ModeBadge({ mode }: { mode: ExchangeMode }) {
  return <span className={`ex-badge ex-badge-${mode}`}>{modeLabel(mode)}</span>;
}

function ListingCard({ l, onOpen, showExpiry = false }: { l: ExchangeListingSummary; onOpen: (id: string) => void; showExpiry?: boolean }) {
  const first = l.prices[0];
  return (
    <button className={`ex-card ${l.pinned ? 'ex-card-pinned' : ''}`} onClick={() => { haptic('light'); onOpen(l.id); }}>
      <div className="ex-card-img">
        {l.coverUrl ? <img src={l.coverUrl} alt="" loading="lazy" /> : <span>🎮</span>}
        {l.pinned && <span className="ex-pin">📌</span>}
        {l.imageCount > 1 && <span className="ex-count">🖼️ {l.imageCount}</span>}
      </div>
      <div className="ex-card-body">
        <ModeBadge mode={l.mode} />
        <div className="ex-card-price">
          {first ? priceText(first) : tr('🔁 تبديل', '🔁 Trade')}
          {l.prices.length > 1 && <span className="ex-more-prices" dir="ltr">+{l.prices.length - 1}</span>}
        </div>
        <div className="ex-card-details" dir="auto">{l.details}</div>
        {showExpiry && <div className="ex-card-expiry">⏰ {timeLeft(l.expiresAt)}</div>}
      </div>
    </button>
  );
}

function ListingGrid({ refreshKey, onOpen, emptyAction }: { refreshKey: number; onOpen: (id: string) => void; emptyAction: () => void }) {
  const [items, setItems] = useState<ExchangeListingSummary[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (p: number) => {
    const res = await api.get<{ items: ExchangeListingSummary[]; hasMore: boolean }>(`/exchange/listings?page=${p}`);
    setItems((cur) => (p === 1 || !cur ? res.items : [...cur, ...res.items]));
    setHasMore(res.hasMore);
    setPage(p);
  }, []);

  useEffect(() => {
    setItems(null);
    setError(false);
    load(1).catch(() => setError(true));
  }, [load, refreshKey]);

  if (error) return <div className="card ex-empty"><p>{tr('تعذر التحميل، حاول لاحقاً', 'Could not load, try again later')}</p></div>;
  if (!items) return <div className="ex-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="ex-card ex-skeleton" />)}</div>;
  if (items.length === 0) {
    return (
      <div className="card ex-empty">
        <div style={{ fontSize: 44 }}>📭</div>
        <p>{tr('لا توجد حسابات معروضة حالياً.', 'No accounts posted yet.')}</p>
        <button className="btn btn-primary" onClick={emptyAction}>{tr('➕ اعرض حسابك أول واحد', '➕ Be the first to post')}</button>
      </div>
    );
  }
  return (
    <>
      <div className="ex-grid">{items.map((l) => <ListingCard key={l.id} l={l} onOpen={onOpen} />)}</div>
      {hasMore && (
        <button
          className="btn btn-secondary"
          disabled={loadingMore}
          onClick={() => { setLoadingMore(true); load(page + 1).catch(() => {}).finally(() => setLoadingMore(false)); }}
        >
          {loadingMore ? tr('يتم التحميل...', 'Loading...') : tr('عرض المزيد', 'Show more')}
        </button>
      )}
    </>
  );
}

function MyListings({ refreshKey, status, onOpen, onNew }: { refreshKey: number; status: ExchangeStatus; onOpen: (id: string) => void; onNew: () => void }) {
  const [items, setItems] = useState<ExchangeListingSummary[] | null>(null);
  useEffect(() => {
    setItems(null);
    api.get<{ items: ExchangeListingSummary[] }>('/exchange/listings/mine').then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [refreshKey]);

  return (
    <>
      <div className="ex-mine-head">
        <span>{tr(`منشوراتك المعروضة: ${status.myActive} من ${status.maxActive}`, `Your active posts: ${status.myActive} of ${status.maxActive}`)}</span>
        <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 14px' }} onClick={onNew}>{tr('➕ منشور جديد', '➕ New post')}</button>
      </div>
      <p className="card-sub ex-hint">{tr('🗑️ تذكير: عند بيع أو تبديل حسابك احذفه من هنا.', '🗑️ Reminder: delete your post here once the account is sold or traded.')}</p>
      {!items ? (
        <div className="ex-grid">{[0, 1].map((i) => <div key={i} className="ex-card ex-skeleton" />)}</div>
      ) : items.length === 0 ? (
        <div className="card ex-empty"><div style={{ fontSize: 44 }}>🗂️</div><p>{tr('لم تعرض أي حساب بعد.', "You haven't posted an account yet.")}</p></div>
      ) : (
        <div className="ex-grid">{items.map((l) => <ListingCard key={l.id} l={l} onOpen={onOpen} showExpiry />)}</div>
      )}
    </>
  );
}

function PostForm({ status, flash, onPosted }: { status: ExchangeStatus; flash: Flash; onPosted: () => void }) {
  const [mode, setMode] = useState<ExchangeMode>('both');
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [cover, setCover] = useState(0);
  const [details, setDetails] = useState('');
  // Selected payment methods, in the order they were picked, each with its own price.
  const [prices, setPrices] = useState<{ currency: ExchangeCurrency; amount: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(list: FileList | null) {
    if (!list) return;
    const room = status.maxImages - photos.length;
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (picked.length > room) flash(tr(`الحد الأقصى ${status.maxImages} صور`, `${status.maxImages} photos at most`));
    setPhotos((cur) => [...cur, ...picked.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  function removePhoto(i: number) {
    URL.revokeObjectURL(photos[i].url);
    setPhotos((cur) => cur.filter((_, j) => j !== i));
    setCover((c) => (i === c ? 0 : i < c ? c - 1 : c));
  }

  function toggleCurrency(c: ExchangeCurrency) {
    setPrices((cur) => (cur.some((p) => p.currency === c) ? cur.filter((p) => p.currency !== c) : [...cur, { currency: c, amount: '' }]));
  }

  async function submit() {
    if (busy) return;
    if (photos.length === 0) return flash(tr('أضف صورة واحدة على الأقل', 'Add at least one photo'));
    if (details.trim().length < 10) return flash(tr('اكتب تفاصيل الحساب (10 أحرف على الأقل)', 'Write the account details (at least 10 characters)'));
    if (mode !== 'trade') {
      if (prices.length === 0) return flash(tr('اختر طريقة دفع واحدة على الأقل', 'Choose at least one payment method'));
      const missing = prices.find((p) => !(Number(p.amount) > 0));
      if (missing) return flash(tr(`اكتب السعر بـ${currencyLabel(missing.currency)}`, `Enter the price in ${currencyLabel(missing.currency)}`));
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('mode', mode);
      form.append('details', details.trim());
      form.append('cover', String(cover));
      if (mode !== 'trade') form.append('prices', JSON.stringify(prices.map((p) => ({ currency: p.currency, amount: Number(p.amount) }))));
      for (const [i, p] of photos.entries()) form.append('images', await compressImage(p.file), `photo-${i + 1}.jpg`);
      await api.form('/exchange/listings', form);
      haptic('heavy');
      flash(tr('✅ تم نشر حسابك بنجاح، يبقى معروضاً 4 أيام', '✅ Your account is posted for 4 days'));
      onPosted();
    } catch (err) {
      flash(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const modes: { key: ExchangeMode; icon: string; title: string; sub: string }[] = [
    { key: 'both', icon: '⚖️', title: tr('بيع وتبديل', 'Sale & trade'), sub: tr('يقبل الاثنين', 'Accepts both') },
    { key: 'sell', icon: '💰', title: tr('بيع فقط', 'Sale only'), sub: tr('بسعر', 'For a price') },
    { key: 'trade', icon: '🔁', title: tr('تبديل فقط', 'Trade only'), sub: tr('بدون سعر', 'No price') },
  ];

  return (
    <div className="ex-form">
      <div className="card ex-form-card">
        <label className="ex-label">{tr('📍 شنو تريد تسوي بحسابك؟', '📍 What do you want to do with it?')}</label>
        <div className="ex-modes">
          {modes.map((m) => (
            <button key={m.key} className={`ex-mode ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)}>
              <span className="ex-mode-icon">{m.icon}</span>
              <strong>{m.title}</strong>
              <span>{m.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card ex-form-card">
        <label className="ex-label">{tr(`🖼️ صور الحساب (${photos.length}/${status.maxImages})`, `🖼️ Account photos (${photos.length}/${status.maxImages})`)}</label>
        {photos.length > 1 && <p className="card-sub ex-hint" style={{ textAlign: 'start' }}>{tr('⭐ اضغط على أي صورة حتى تخليها الغلاف', '⭐ Tap any photo to make it the cover')}</p>}
        <div className="ex-photos">
          {photos.map((p, i) => (
            <div key={p.url} className={`ex-photo ${i === cover ? 'ex-photo-cover' : ''}`} onClick={() => setCover(i)}>
              <img src={p.url} alt="" />
              <button aria-label={tr('حذف', 'Remove')} onClick={(e) => { e.stopPropagation(); removePhoto(i); }}>✕</button>
              {i === cover && <span className="ex-cover-tag">⭐ {tr('الغلاف', 'Cover')}</span>}
            </div>
          ))}
          {photos.length < status.maxImages && (
            <button className="ex-photo ex-photo-add" onClick={() => fileRef.current?.click()}>
              <span>＋</span>
              <small>{tr('إضافة', 'Add')}</small>
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      <div className="card ex-form-card">
        <label className="ex-label">{tr('📝 تفاصيل الحساب', '📝 Account details')}</label>
        <textarea
          className="ex-input ex-textarea"
          maxLength={1500}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={tr('مثال: لفل الحساب، الشخصيات المميزة، المهارات، الربط...', 'e.g. account level, rare characters, skills, linked to...')}
        />
        <div className="ex-counter">{details.length}/1500</div>
      </div>

      {mode !== 'trade' && (
        <div className="card ex-form-card">
          <label className="ex-label">{tr('💵 طرق الدفع والسعر', '💵 Payment methods and price')}</label>
          <p className="card-sub ex-hint" style={{ textAlign: 'start' }}>{tr('تكدر تختار أكثر من طريقة، ولكل وحدة سعرها', 'Pick as many as you accept, each with its own price')}</p>
          <div className="ex-currencies">
            {status.currencies.map((c) => (
              <button key={c} className={`ex-chip ${prices.some((p) => p.currency === c) ? 'active' : ''}`} onClick={() => toggleCurrency(c)}>
                {prices.some((p) => p.currency === c) ? '✓ ' : ''}{currencyLabel(c)}
              </button>
            ))}
          </div>
          {prices.map((p) => (
            <div key={p.currency} className="ex-price-row">
              <span className="ex-price-cur">{currencyLabel(p.currency)}</span>
              <input
                className="ex-input"
                inputMode="decimal"
                value={p.amount}
                onChange={(e) => {
                  const amount = e.target.value.replace(/[^\d.]/g, '');
                  setPrices((cur) => cur.map((x) => (x.currency === p.currency ? { ...x, amount } : x)));
                }}
                placeholder={tr('السعر', 'Price')}
              />
              <button className="ex-price-x" onClick={() => toggleCurrency(p.currency)} aria-label={tr('حذف', 'Remove')}>✕</button>
            </div>
          ))}
        </div>
      )}

      <p className="card-sub ex-hint">{tr('⚠️ بنشرك للحساب أنت توافق على التعامل عن طريق وسيط فقط. ⏰ المنشور ينحذف تلقائياً بعد 4 أيام.', '⚠️ By posting you agree to deal through a middleman only. ⏰ Posts are removed automatically after 4 days.')}</p>
      <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
        {busy ? tr('جاري النشر...', 'Posting...') : tr('🚀 نشر الحساب', '🚀 Post the account')}
      </button>
    </div>
  );
}

/** Photo carousel: swipe either way, and it wraps around at both ends. */
function Gallery({ images, onZoom }: { images: string[]; onZoom: (src: string) => void }) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const moved = useRef(false);
  const n = images.length;
  const go = (step: number) => setIndex((i) => (i + step + n) % n);
  // The strip is laid out left-to-right in both languages, so a swipe toward the left
  // always brings the next photo and a swipe toward the right the previous one.
  return (
    <div className="ex-gallery" dir="ltr">
      <div
        className="ex-gallery-view"
        onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; moved.current = false; }}
        onTouchMove={(e) => {
          if (!start.current || n < 2) return;
          const dx = e.touches[0].clientX - start.current.x;
          if (Math.abs(dx) > 8) moved.current = true;
          setDrag(dx);
        }}
        onTouchEnd={() => {
          if (start.current && n > 1) {
            const fast = Date.now() - start.current.t < 250 && Math.abs(drag) > 20;
            if (drag < -50 || (fast && drag < 0)) go(1);
            else if (drag > 50 || (fast && drag > 0)) go(-1);
          }
          start.current = null;
          setDrag(0);
        }}
      >
        <div className="ex-gallery-strip" style={{ transform: `translateX(calc(${-index * 100}% + ${drag}px))`, transition: drag ? 'none' : 'transform 0.28s ease' }}>
          {images.map((src) => (
            <img key={src} src={src} alt="" draggable={false} onClick={() => { if (!moved.current) onZoom(src); }} />
          ))}
        </div>
      </div>
      {n > 1 && (
        <>
          <button className="ex-gallery-arrow ex-gallery-prev" onClick={() => go(-1)} aria-label={tr('السابقة', 'Previous')}><ChevronLeft size={22} /></button>
          <button className="ex-gallery-arrow ex-gallery-next" onClick={() => go(1)} aria-label={tr('التالية', 'Next')}><ChevronRight size={22} /></button>
          <div className="ex-gallery-dots">
            {images.map((src, i) => <span key={src} className={i === index ? 'on' : ''} onClick={() => setIndex(i)} />)}
          </div>
          <span className="ex-gallery-index">{index + 1}/{n}</span>
        </>
      )}
    </div>
  );
}

function OfferModal({ listingId, mode, maxImages, flash, onClose }: { listingId: string; mode: ExchangeMode; maxImages: number; flash: Flash; onClose: () => void }) {
  // A sale-only post takes money offers, a trade-only post takes accounts, "both" lets the sender choose.
  const [kind, setKind] = useState<'buy' | 'trade'>(mode === 'trade' ? 'trade' : 'buy');
  const [message, setMessage] = useState('');
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isTrade = kind === 'trade';
  const maxLength = isTrade ? 1500 : 500;

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(list: FileList | null) {
    if (!list) return;
    const room = maxImages - photos.length;
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (picked.length > room) flash(tr(`الحد الأقصى ${maxImages} صور`, `${maxImages} photos at most`));
    setPhotos((cur) => [...cur, ...picked.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  async function send() {
    if (busy) return;
    if (message.trim().length < 2) return flash(isTrade ? tr('اكتب تفاصيل حسابك', 'Describe your account') : tr('اكتب عرضك', 'Write your offer'));
    setBusy(true);
    try {
      const form = new FormData();
      form.append('kind', kind);
      form.append('message', message.trim());
      if (isTrade) for (const [i, p] of photos.entries()) form.append('images', await compressImage(p.file), `offer-${i + 1}.jpg`);
      await api.form(`/exchange/listings/${listingId}/offer`, form);
      haptic('heavy');
      flash(tr('✅ وصل عرضك لصاحب الحساب عن طريق البوت، راح يوصلك رده', '✅ Your offer was sent through the bot; you will get the reply'));
      onClose();
    } catch (err) {
      flash(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card ex-report ex-offer" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('💌 قدّم عرضك', '💌 Make an offer')}</h3>
        {mode === 'both' && (
          <div className="ex-offer-kinds">
            <button className={kind === 'buy' ? 'active' : ''} onClick={() => setKind('buy')}>{tr('💰 عرض شراء', '💰 Buy offer')}</button>
            <button className={kind === 'trade' ? 'active' : ''} onClick={() => setKind('trade')}>{tr('🔁 أبدل بحسابي', '🔁 Trade my account')}</button>
          </div>
        )}
        <p className="card-sub">
          {isTrade
            ? tr('ضيف صور حسابك وتفاصيله، والبوت يوصلها لصاحب الحساب ويّا العرض.', "Add your account's photos and details; the bot sends them to the owner with your offer.")
            : tr('البوت يوصل عرضك لصاحب الحساب، وإذا قبله يوصلك إشعار ويّا يوزره.', 'The bot delivers your offer to the owner. If they accept, you get notified with their username.')}
        </p>
        {isTrade && (
          <>
            <label className="ex-label">{tr(`🖼️ صور حسابك (${photos.length}/${maxImages})`, `🖼️ Your account photos (${photos.length}/${maxImages})`)}</label>
            <div className="ex-photos">
              {photos.map((p, i) => (
                <div key={p.url} className="ex-photo">
                  <img src={p.url} alt="" />
                  <button aria-label={tr('حذف', 'Remove')} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((cur) => cur.filter((_, j) => j !== i)); }}>✕</button>
                </div>
              ))}
              {photos.length < maxImages && (
                <button className="ex-photo ex-photo-add" onClick={() => fileRef.current?.click()}><span>＋</span><small>{tr('إضافة', 'Add')}</small></button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </>
        )}
        <textarea
          className="ex-input ex-textarea"
          maxLength={maxLength}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={isTrade ? tr('تفاصيل حسابك: اللفل، الشخصيات، المهارات، الربط...', 'Your account: level, characters, skills, linked to...') : tr('مثال: أشتريه بـ 20 دولار اسيا', 'e.g. I’ll buy it for $20')}
        />
        <div className="ex-counter">{message.length}/{maxLength}</div>
        <div className="ex-row-btns">
          <button className="btn btn-secondary" onClick={onClose}>{tr('إلغاء', 'Cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void send()}>{busy ? tr('جاري الإرسال...', 'Sending...') : tr('📤 إرسال العرض', '📤 Send offer')}</button>
        </div>
      </div>
    </div>
  );
}

function ListingDetail({ id, status, flash, onClose, onChanged }: { id: string; status: ExchangeStatus; flash: Flash; onClose: () => void; onChanged: () => void }) {
  const [listing, setListing] = useState<ExchangeListingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [offering, setOffering] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ listing: ExchangeListingDetail }>(`/exchange/listings/${id}`).then((r) => setListing(r.listing)).catch((err) => setError(errText(err)));
  }, [id]);
  useEffect(load, [load]);

  const middlemen = `https://t.me/${status.middlemanGroup}`;

  async function act(fn: () => Promise<unknown>, done: string, close = false) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      flash(done);
      onChanged();
      if (close) onClose();
      else load();
    } catch (err) {
      flash(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ex-sheet-backdrop" onClick={onClose}>
      <div className="ex-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ex-sheet-top">
          <button className="ex-close" onClick={onClose} aria-label={tr('إغلاق', 'Close')}>✕</button>
        </div>
        {!listing ? (
          <div className="ex-empty" style={{ padding: 40 }}>{error ?? tr('يتم التحميل...', 'Loading...')}</div>
        ) : (
          <>
            {listing.images.length > 0 && <Gallery images={listing.images} onZoom={setZoom} />}
            <div className="ex-detail-body">
              <div className="ex-detail-row">
                <ModeBadge mode={listing.mode} />
                {listing.pinned && <span className="ex-badge ex-badge-pin">📌 {tr('مثبت', 'Pinned')}</span>}
                {listing.status === 'removed' && <span className="ex-badge ex-badge-removed">{tr('محذوف', 'Removed')}</span>}
              </div>
              {listing.prices.length > 0 ? (
                <div className="ex-detail-prices">
                  {listing.prices.map((p) => <span key={p.currency} className="ex-detail-price">{priceText(p)}</span>)}
                </div>
              ) : (
                <div className="ex-detail-price">{tr('🔁 تبديل فقط', '🔁 Trade only')}</div>
              )}
              <p className="ex-detail-text" dir="auto">{listing.details}</p>
              <div className="ex-detail-meta">
                <span>👤 <bdi>{listing.ownerName ?? tr('مستخدم', 'User')}</bdi></span>
                <span>🕒 {new Date(listing.createdAt).toLocaleDateString(locale())}</span>
                {listing.canModerate && listing.reportsCount !== undefined && <span>🚩 {listing.reportsCount}</span>}
              </div>
              {listing.status === 'active' && <div className="ex-expiry">⏰ {tr('ينحذف تلقائياً بعد', 'Removed automatically in')} {timeLeft(listing.expiresAt)}</div>}

              {!listing.isMine && listing.status === 'active' && (
                <div className="ex-actions">
                  <button className="btn btn-primary" onClick={() => setOffering(true)}>{tr('💌 تقديم عرض عن طريق البوت', '💌 Make an offer through the bot')}</button>
                  <button className="btn btn-secondary" onClick={() => setWarning(true)}>{tr('💬 تواصل مع صاحب الحساب', '💬 Contact the owner')}</button>
                  <button className="btn btn-secondary" onClick={() => openTgLink(middlemen)}>{tr('🛡️ وسطاء MF', '🛡️ MF middlemen')}</button>
                  <button className="btn ex-report-btn" onClick={() => setReporting(true)}>{tr('🚩 إبلاغ عن المنشور', '🚩 Report this post')}</button>
                </div>
              )}

              {listing.shareLink && listing.status === 'active' && (
                <button
                  className="btn btn-secondary ex-copy-btn"
                  onClick={() => {
                    void copyText(listing.shareLink!).then((ok) =>
                      flash(ok ? tr('🔗 تم نسخ رابط المنشور، دزه لأي شخص', '🔗 Post link copied, send it to anyone') : listing.shareLink!)
                    );
                  }}
                >
                  {tr('🔗 نسخ رابط المنشور', '🔗 Copy post link')}
                </button>
              )}

              {listing.isMine && listing.status === 'active' && (
                <div className="ex-actions">
                  <button
                    className="btn ex-danger-btn"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(tr('هل تم بيع أو تبديل الحساب؟ سيتم حذف المنشور نهائياً.', 'Was the account sold or traded? The post will be deleted for good.'))) return;
                      void act(() => api.del(`/exchange/listings/${listing.id}`), tr('🗑️ تم حذف المنشور', '🗑️ Post deleted'), true);
                    }}
                  >
                    {tr('🗑️ حذف منشوري (تم البيع/التبديل)', '🗑️ Delete my post (sold/traded)')}
                  </button>
                </div>
              )}

              {listing.canModerate && listing.status === 'active' && (
                <div className="ex-admin">
                  <div className="ex-admin-title">{tr('👑 أدوات المطور', '👑 Developer tools')}</div>
                  <div className="ex-admin-grid">
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => void act(() => api.post(`/admin/exchange/listings/${listing.id}/pin`, { pinned: !listing.pinned }), listing.pinned ? tr('تم إلغاء التثبيت', 'Unpinned') : tr('📌 تم التثبيت', '📌 Pinned'))}
                    >
                      {listing.pinned ? tr('📌 إلغاء التثبيت', '📌 Unpin') : tr('📌 تثبيت', '📌 Pin')}
                    </button>
                    <button
                      className="btn ex-danger-btn"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(tr('سبب الحذف (يصل لصاحب المنشور، اختياري):', 'Removal reason (sent to the owner, optional):'));
                        if (reason === null) return;
                        void act(() => api.post(`/admin/exchange/listings/${listing.id}/remove`, { reason }), tr('🗑️ تم حذف المنشور', '🗑️ Post removed'), true);
                      }}
                    >
                      {tr('🗑️ حذف المنشور', '🗑️ Remove post')}
                    </button>
                    <button
                      className="btn ex-danger-btn"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(tr('حظر صاحب المنشور من البوت وحذف كل منشوراته؟', 'Ban the owner from the bot and remove all their posts?'))) return;
                        void act(() => api.post(`/admin/exchange/listings/${listing.id}/ban-owner`), tr('🚫 تم حظر صاحب المنشور', '🚫 Owner banned'), true);
                      }}
                    >
                      {tr('🚫 حظر صاحب المنشور', '🚫 Ban the owner')}
                    </button>
                    <button className="btn btn-secondary" onClick={() => openTgLink(listing.owner.profileLink)}>{tr('👤 بروفايل صاحبه', "👤 Owner's profile")}</button>
                  </div>
                  <div className="ex-admin-id">ID: {listing.owner.telegramId}{listing.owner.username && <> • <bdi>@{listing.owner.username}</bdi></>}</div>
                </div>
              )}
            </div>
          </>
        )}

        {zoom && (
          <div className="ex-zoom" onClick={() => setZoom(null)}>
            <img src={zoom} alt="" />
          </div>
        )}

        {warning && listing && (
          <div className="modal-backdrop" onClick={() => setWarning(false)}>
            <div className="modal-card ex-warning" onClick={(e) => e.stopPropagation()}>
              <div className="ex-warning-icon">⚠️</div>
              <h2>{tr('احذر! لا تثق بأحد وتعامل بوسيط فقط!', "Careful! Trust no one and deal through a middleman only!")}</h2>
              <p className="card-sub">{tr('أي تبادل بدون وسيط على مسؤوليتك، وإذا تمت سرقتك ستُحظر من البوت لأنه تم تنبيهك.', "Any deal without a middleman is at your own risk. If you get scammed you'll be banned, because you were warned.")}</p>
              <button className="btn btn-primary" onClick={() => openTgLink(middlemen)}>{tr('🛡️ اطلب وسيط من وسطاء MF', '🛡️ Get an MF middleman')}</button>
              <button className="btn btn-secondary" onClick={() => { setWarning(false); openTgLink(listing.owner.profileLink); }}>{tr('💬 فهمت، تواصل مع صاحب الحساب', '💬 Got it, contact the owner')}</button>
            </div>
          </div>
        )}

        {offering && listing && <OfferModal listingId={listing.id} mode={listing.mode} maxImages={status.maxImages} flash={flash} onClose={() => setOffering(false)} />}

        {reporting && listing && (
          <ReportFlow listingId={listing.id} reasons={status.reasons} flash={flash} onClose={() => setReporting(false)} />
        )}
      </div>
    </div>
  );
}

function ReportFlow({ listingId, reasons, flash, onClose }: { listingId: string; reasons: ReportReason[]; flash: Flash; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [media, setMedia] = useState<{ file: File; url: string }[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function addMedia(list: FileList | null) {
    if (!list) return;
    const room = MAX_REPORT_MEDIA - media.length;
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (picked.some((f) => f.size > 20 * 1024 * 1024)) flash(tr('حجم الملف كبير جداً (20MB كحد أقصى)', 'File too large (20MB max)'));
    setMedia((cur) => [...cur, ...picked.filter((f) => f.size <= 20 * 1024 * 1024).slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  async function send() {
    if (busy || !reason) return;
    if (description.trim().length < 5) return flash(tr('اكتب وصفاً للبلاغ', 'Write a description for the report'));
    setBusy(true);
    try {
      const form = new FormData();
      form.append('reason', reason);
      form.append('description', description.trim());
      for (const [i, m] of media.entries()) {
        if (m.file.type.startsWith('image/')) form.append('media', await compressImage(m.file), `evidence-${i + 1}.jpg`);
        else form.append('media', m.file, m.file.name);
      }
      await api.form(`/exchange/listings/${listingId}/report`, form);
      haptic('heavy');
      flash(tr('✅ تم إرسال البلاغ للمطورين، شكراً لك', '✅ Report sent to the developers, thank you'));
      onClose();
    } catch (err) {
      flash(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card ex-report" onClick={(e) => e.stopPropagation()}>
        <div className="ex-steps">{[1, 2, 3].map((n) => <span key={n} className={n <= step ? 'on' : ''} />)}</div>
        {step === 1 && (
          <>
            <h3>{tr('🚩 اخترت المنشور للإبلاغ عنه، اختر نوع البلاغ', '🚩 You chose to report this post. Pick the report type')}</h3>
            <div className="ex-reasons">
              {reasons.map((r) => (
                <button key={r} className={`ex-reason ${reason === r ? 'active' : ''}`} onClick={() => setReason(r)}>{reasonLabel(r)}</button>
              ))}
            </div>
            <button className="btn btn-primary" disabled={!reason} onClick={() => setStep(2)}>{tr('التالي', 'Next')}</button>
          </>
        )}
        {step === 2 && (
          <>
            <h3>{tr('📎 أضف صور أو فيديو إن وجد', '📎 Add photos or a video if you have any')}</h3>
            <p className="card-sub">{tr(`اختياري، حتى ${MAX_REPORT_MEDIA} ملفات`, `Optional, up to ${MAX_REPORT_MEDIA} files`)}</p>
            <div className="ex-photos">
              {media.map((m, i) => (
                <div key={m.url} className="ex-photo">
                  {m.file.type.startsWith('video/') ? <div className="ex-video-tile">🎬</div> : <img src={m.url} alt="" />}
                  <button onClick={() => { URL.revokeObjectURL(m.url); setMedia((cur) => cur.filter((_, j) => j !== i)); }}>✕</button>
                </div>
              ))}
              {media.length < MAX_REPORT_MEDIA && (
                <button className="ex-photo ex-photo-add" onClick={() => fileRef.current?.click()}><span>＋</span><small>{tr('إضافة', 'Add')}</small></button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addMedia(e.target.files); e.target.value = ''; }} />
            <div className="ex-row-btns">
              <button className="btn btn-secondary" onClick={() => setStep(1)}>{tr('رجوع', 'Back')}</button>
              <button className="btn btn-primary" onClick={() => setStep(3)}>{media.length ? tr('التالي', 'Next') : tr('تخطي', 'Skip')}</button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h3>{tr('✍️ أضف وصفاً للبلاغ', '✍️ Describe the problem')}</h3>
            <textarea
              className="ex-input ex-textarea"
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tr('اشرح ما حدث بالتفصيل...', 'Explain what happened in detail...')}
            />
            <div className="ex-row-btns">
              <button className="btn btn-secondary" onClick={() => setStep(2)}>{tr('رجوع', 'Back')}</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void send()}>{busy ? tr('جاري الإرسال...', 'Sending...') : tr('📤 إرسال البلاغ', '📤 Send report')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
