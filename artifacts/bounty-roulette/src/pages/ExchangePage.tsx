import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGrid, PlusCircle, ClipboardList, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { locale, tr } from '../i18n';
import { api, ApiError } from '../services/api';
import { getTelegramWebApp, haptic } from '../hooks/useTelegramWebApp';
import { ImageViewer } from '../components/ImageViewer';
import { adErrorMessage } from '../components/AdTaskCard';
import { claimAfterAd, showRewardedAd } from '../services/adsgram';
import {
  ExchangeCurrency,
  ExchangeListingDetail,
  ExchangeListingSummary,
  ExchangeMode,
  ExchangeStatus,
  MediationTicketView,
  ReportReason,
} from '../types';

type ExTab = 'browse' | 'post' | 'mediation' | 'mine';
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

/** Small copy for the listing cards: loads fast even on a weak connection. */
const makeThumb = (file: File) => compressImage(file, 480, 0.72);

/** Shrinks a photo to ~1280px JPEG before upload so posts stay light on slow connections. */
async function compressImage(file: File, maxSide = 1280, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
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

export function ExchangePage({
  onBack,
  initialListingId,
  initialOfferId,
}: {
  onBack: () => void;
  initialListingId?: string | null;
  // From "request a middleman" under an accepted offer in the bot.
  initialOfferId?: string | null;
}) {
  const [stage, setStage] = useState<'loading' | 'intro' | 'main' | 'locked' | 'error'>('loading');
  const [status, setStatus] = useState<ExchangeStatus | null>(null);
  const [tab, setTab] = useState<ExTab>('browse');
  const [openId, setOpenId] = useState<string | null>(initialListingId ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<ExchangeListingDetail | null>(null);
  const [mediationFor, setMediationFor] = useState<MediationPrefill | null>(null);
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
        // Links to one post (from report alerts) or from an accepted offer skip the rules screen.
        else setStage(initialListingId || initialOfferId ? 'main' : 'intro');
      })
      .catch(() => !cancelled && setStage('error'));
    return () => {
      cancelled = true;
    };
  }, [loadStatus, initialListingId, initialOfferId]);

  useEffect(() => {
    if (!initialOfferId) return;
    setTab('mediation');
    api
      .get<{ target: { telegramId: number; username: string | null; listingId: string } }>(`/mediation/offer/${initialOfferId}`)
      .then((r) => setMediationFor({ telegramId: r.target.telegramId, username: r.target.username, listingId: r.target.listingId }))
      .catch((err) => flash(errText(err)));
  }, [initialOfferId, flash]);

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
    setEditing(null);
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
        title={
          editing
            ? tr('✏️ تعديل المنشور', '✏️ Edit post')
            : tab === 'browse'
            ? tr('🔄 قسم التبادل', '🔄 Exchange')
            : tab === 'post'
            ? tr('➕ اعرض حسابك', '➕ Post your account')
            : tab === 'mediation'
            ? tr('🛡️ الوساطة', '🛡️ Middleman')
            : tr('📋 منشوراتي', '📋 My posts')
        }
        onBack={onBack}
      />
      {s.comingSoon && <div className="games-soon-banner">{tr('🧪 وضع الاختبار: القسم ظاهر للمطورين فقط.', '🧪 Test mode: only developers can see this section.')}</div>}

      {editing ? (
        <>
          <button className="btn btn-secondary" onClick={() => { setOpenId(editing.id); setEditing(null); }}>{tr('↩️ إلغاء التعديل', '↩️ Cancel editing')}</button>
          <PostForm
            key={editing.id}
            status={s}
            flash={flash}
            initial={editing}
            onPosted={() => { const id = editing.id; setEditing(null); setRefreshKey((k) => k + 1); setOpenId(id); }}
          />
        </>
      ) : null}
      {!editing && tab === 'browse' && <ListingGrid refreshKey={refreshKey} onOpen={setOpenId} emptyAction={() => goTab('post')} />}
      {!editing && tab === 'post' && <PostForm status={s} flash={flash} onPosted={posted} />}
      {!editing && tab === 'mediation' && <MediationPanel flash={flash} prefill={mediationFor} onPrefillUsed={() => setMediationFor(null)} />}
      {!editing && tab === 'mine' && <MyListings refreshKey={refreshKey} status={s} onOpen={setOpenId} onNew={() => goTab('post')} />}

      {openId && (
        <ListingDetail
          id={openId}
          status={s}
          flash={flash}
          onClose={() => setOpenId(null)}
          onChanged={() => { setRefreshKey((k) => k + 1); void loadStatus(); }}
          onEdit={(l) => { setOpenId(null); setEditing(l); window.scrollTo(0, 0); }}
          onRequestMediator={(prefill) => { setMediationFor(prefill); goTab('mediation'); }}
        />
      )}

      <nav className="bottom-nav ex-nav">
        {([
          ['browse', tr('الحسابات', 'Accounts'), <LayoutGrid size={22} key="i" />],
          ['post', tr('اعرض حسابك', 'Post'), <PlusCircle size={22} key="i" />],
          ['mediation', tr('الوساطة', 'Middleman'), <ShieldCheck size={22} key="i" />],
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
        <span className="ex-views">👁️ {l.views}</span>
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

type FormPhoto = { url: string; file?: File; id?: string };

/** New post, or (with `initial`) editing one: photos already on it are kept unless removed. */
function PostForm({ status, flash, onPosted, initial }: { status: ExchangeStatus; flash: Flash; onPosted: () => void; initial?: ExchangeListingDetail }) {
  const [mode, setMode] = useState<ExchangeMode>(initial?.mode ?? 'both');
  const [photos, setPhotos] = useState<FormPhoto[]>(() => initial?.images.map((url) => ({ url, id: url.split('/').pop() })) ?? []);
  const [cover, setCover] = useState(0);
  const [details, setDetails] = useState(initial?.details ?? '');
  // Selected payment methods, in the order they were picked, each with its own price.
  const [prices, setPrices] = useState<{ currency: ExchangeCurrency; amount: string }[]>(
    () => initial?.prices.map((p) => ({ currency: p.currency, amount: String(p.amount) })) ?? []
  );
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => photos.forEach((p) => p.file && URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(list: FileList | null) {
    if (!list) return;
    const room = status.maxImages - photos.length;
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (picked.length > room) flash(tr(`الحد الأقصى ${status.maxImages} صور`, `${status.maxImages} photos at most`));
    setPhotos((cur) => [...cur, ...picked.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  function removePhoto(i: number) {
    if (photos[i].file) URL.revokeObjectURL(photos[i].url);
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
      if (mode !== 'trade') form.append('prices', JSON.stringify(prices.map((p) => ({ currency: p.currency, amount: Number(p.amount) }))));
      if (initial) {
        // Final photo order, cover first: "e:<id>" keeps a photo, "n:<k>" is the k-th new upload.
        const ordered = [photos[cover], ...photos.filter((_, i) => i !== cover)];
        const order: string[] = [];
        let k = 0;
        for (const p of ordered) {
          if (p.file) {
            form.append('images', await compressImage(p.file), `photo-${k + 1}.jpg`);
            form.append('thumbs', await makeThumb(p.file), `thumb-${k + 1}.jpg`);
            order.push(`n:${k++}`);
          } else {
            order.push(`e:${p.id}`);
          }
        }
        form.append('order', JSON.stringify(order));
        await api.form(`/exchange/listings/${initial.id}`, form, 'PATCH');
      } else {
        // Posting costs one ad watched to the end (skipped while a recent one still counts).
        const ad = await api.get<{ ok: true; required: boolean; blockId: string | null }>('/exchange/post-ad');
        if (ad.required && ad.blockId) {
          try {
            await showRewardedAd(ad.blockId);
            await claimAfterAd('/exchange/post-ad');
          } catch (err) {
            flash(adErrorMessage(err));
            return;
          }
        }
        form.append('cover', String(cover));
        for (const [i, p] of photos.entries()) {
          form.append('images', await compressImage(p.file!), `photo-${i + 1}.jpg`);
          form.append('thumbs', await makeThumb(p.file!), `thumb-${i + 1}.jpg`);
        }
        await api.form('/exchange/listings', form);
      }
      haptic('heavy');
      flash(initial ? tr('✅ تم حفظ التعديلات', '✅ Changes saved') : tr('✅ تم نشر حسابك بنجاح، يبقى معروضاً 4 أيام', '✅ Your account is posted for 4 days'));
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
        {busy ? tr('جاري الحفظ...', 'Saving...') : initial ? tr('💾 حفظ التعديلات', '💾 Save changes') : tr('📺 شاهد إعلان وانشر الحساب', '📺 Watch an ad and post')}
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

function ListingDetail({
  id,
  status,
  flash,
  onClose,
  onChanged,
  onEdit,
  onRequestMediator,
}: {
  id: string;
  status: ExchangeStatus;
  flash: Flash;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (l: ExchangeListingDetail) => void;
  onRequestMediator: (prefill: MediationPrefill) => void;
}) {
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
                <span>👁️ {listing.views} {tr('مشاهدة', 'views')}</span>
                {listing.canModerate && listing.reportsCount !== undefined && <span>🚩 {listing.reportsCount}</span>}
              </div>
              {listing.status === 'active' && <div className="ex-expiry">⏰ {tr('ينحذف تلقائياً بعد', 'Removed automatically in')} {timeLeft(listing.expiresAt)}</div>}

              {!listing.isMine && listing.status === 'active' && (
                <div className="ex-actions">
                  <button className="btn btn-primary" onClick={() => setOffering(true)}>{tr('💌 تقديم عرض عن طريق البوت', '💌 Make an offer through the bot')}</button>
                  <button className="btn btn-secondary" onClick={() => setWarning(true)}>{tr('💬 تواصل مع صاحب الحساب', '💬 Contact the owner')}</button>
                  <button
                    className="btn btn-secondary ex-mediator-btn"
                    onClick={() => onRequestMediator({ username: listing.owner.username, telegramId: listing.owner.telegramId, listingId: listing.id })}
                  >
                    {tr('🛡️ طلب وسيط ويّا صاحب الحساب', '🛡️ Request a middleman with the owner')}
                  </button>
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
                  <button className="btn btn-primary" onClick={() => onEdit(listing)}>{tr('✏️ تعديل المنشور', '✏️ Edit post')}</button>
                  <button
                    className="btn btn-secondary"
                    disabled={busy || !listing.canRenew}
                    onClick={() => void act(() => api.post(`/exchange/listings/${listing.id}/renew`), tr('🔄 تم التجديد، يبقى معروض 4 أيام ثانية', '🔄 Renewed for another 4 days'))}
                  >
                    {listing.canRenew ? tr('🔄 تجديد 4 أيام', '🔄 Renew for 4 days') : tr('🔄 التجديد يتفعل بآخر يوم', '🔄 Renewal opens in the last day')}
                  </button>
                </div>
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

        {zoom && <ImageViewer src={zoom} onClose={() => setZoom(null)} />}

        {warning && listing && (
          <div className="modal-backdrop" onClick={() => setWarning(false)}>
            <div className="modal-card ex-warning" onClick={(e) => e.stopPropagation()}>
              <div className="ex-warning-icon">⚠️</div>
              <h2>{tr('احذر! لا تثق بأحد وتعامل بوسيط فقط!', "Careful! Trust no one and deal through a middleman only!")}</h2>
              <p className="card-sub">{tr('أي تبادل بدون وسيط على مسؤوليتك، وإذا تمت سرقتك ستُحظر من البوت لأنه تم تنبيهك.', "Any deal without a middleman is at your own risk. If you get scammed you'll be banned, because you were warned.")}</p>
              <button
                className="btn btn-primary"
                onClick={() => onRequestMediator({ username: listing.owner.username, telegramId: listing.owner.telegramId, listingId: listing.id })}
              >
                {tr('🛡️ اطلب وسيط من وسطاء MF', '🛡️ Get an MF middleman')}
              </button>
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

type MediationPrefill = { username?: string | null; telegramId?: number; listingId?: string | null };
type MediationData = { enabled: boolean; windowMinutes: number; tickets: MediationTicketView[] };
type Partner = { telegramId: number; username: string | null; name: string | null; photoUrl: string | null };
const OPEN_TICKET = ['waiting_join', 'waiting_mediator', 'in_progress'];

function ticketStatusLabel(status: MediationTicketView['status']) {
  switch (status) {
    case 'waiting_join': return tr('⏳ بانتظار طلبات الانضمام', '⏳ Waiting for join requests');
    case 'waiting_mediator': return tr('📣 بانتظار وسيط', '📣 Waiting for a middleman');
    case 'in_progress': return tr('🤝 الوسيط استلمها', '🤝 Taken by a middleman');
    case 'completed': return tr('✅ مكتملة', '✅ Completed');
    case 'expired': return tr('⌛ انتهى وقتها', '⌛ Expired');
    default: return tr('🚫 ملغية', '🚫 Cancelled');
  }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function TicketCard({ ticket, flash, onCancel, busy }: { ticket: MediationTicketView; flash: Flash; onCancel: () => void; busy: boolean }) {
  const now = useNow(ticket.status === 'waiting_join');
  const left = Math.max(0, new Date(ticket.expiresAt).getTime() - now);
  const mm = String(Math.floor(left / 60000)).padStart(2, '0');
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  const shareText = ticket.groupLink
    ? tr(
        `اطلب انضمام لكروب وسطاء MF من هذا الرابط حتى نكمل التبادل (تذكرة #${ticket.number}):\n${ticket.groupLink}`,
        `Ask to join the MF middleman group with this link so we can finish the trade (ticket #${ticket.number}):\n${ticket.groupLink}`
      )
    : '';

  return (
    <div className={`card ex-ticket ex-ticket-${ticket.status}`}>
      <div className="ex-ticket-head">
        <strong>🎫 {tr('تذكرة', 'Ticket')} <bdi dir="ltr">#{ticket.number}</bdi></strong>
        <span className="ex-ticket-status">{ticketStatusLabel(ticket.status)}</span>
      </div>

      {ticket.status === 'waiting_join' && (
        <>
          <div className="ex-ticket-timer">
            <span>{tr('الوقت المتبقي', 'Time left')}</span>
            <b dir="ltr">{mm}:{ss}</b>
          </div>
          <div className="ex-ticket-steps">
            <div className={`ex-ticket-step ${ticket.me.requested ? 'done' : ''}`}>
              <span className="ex-step-dot">{ticket.me.requested ? '✓' : '1'}</span>
              <div>
                <b>{tr('اطلب انضمام للكروب', 'Ask to join the group')}</b>
                <div className="ex-step-btns">
                  <button className="btn btn-primary" onClick={() => openTgLink(ticket.groupLink!)}>{tr('🚪 طلب انضمام', '🚪 Request to join')}</button>
                </div>
              </div>
            </div>
            <div className={`ex-ticket-step ${ticket.other.requested ? 'done' : ''}`}>
              <span className="ex-step-dot">{ticket.other.requested ? '✓' : '2'}</span>
              <div>
                <b>{tr('ارسل الرابط لطرفك الثاني', 'Send the link to the other side')}</b>
                <div className="card-sub" style={{ margin: '2px 0 6px' }}>
                  <bdi>{ticket.other.name}</bdi> — {ticket.other.requested ? tr('طلب انضمام ✅', 'asked to join ✅') : tr('ما طلب بعد ⏳', 'not yet ⏳')}
                </div>
                <div className="ex-step-btns">
                  <button
                    className="btn btn-secondary"
                    onClick={() => void copyText(shareText).then((ok) => flash(ok ? tr('🔗 تم نسخ الرابط، دزه لطرفك', '🔗 Link copied, send it to them') : ticket.groupLink!))}
                  >
                    {tr('🔗 نسخ الرابط', '🔗 Copy link')}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p className="card-sub ex-hint">{tr('⚠️ إذا ما طلبتوا انضمام ثنينكم خلال 15 دقيقة تنلغي التذكرة تلقائياً.', "⚠️ If you don't both ask to join within 15 minutes, the ticket is cancelled automatically.")}</p>
          {ticket.isRequester && (
            <button className="btn ex-danger-btn" disabled={busy} onClick={onCancel}>{tr('إلغاء التذكرة', 'Cancel ticket')}</button>
          )}
        </>
      )}

      {ticket.status === 'waiting_mediator' && (
        <div className="ex-ticket-wait">
          <div className="ex-ticket-pulse">📣</div>
          <p>{tr('ثنينكم طلبتوا انضمام ✅\nتم تنبيه الوسطاء، أول وسيط يستلم التذكرة يقبلكم بالكروب.', 'You both asked to join ✅\nThe middlemen were notified; the first one to take the ticket lets you in.')}</p>
        </div>
      )}

      {ticket.status === 'in_progress' && (
        <div className="ex-ticket-wait">
          <div style={{ fontSize: 38 }}>🤝</div>
          <p>
            {tr('راح يتوسطلكم:', 'Your middleman:')} <b><bdi>{ticket.mediator}</bdi></b>
            <br />
            {tr('تم قبولكم بالكروب، كمّلوا التبادل هناك فقط.', "You're in the group; finish the trade there only.")}
          </p>
        </div>
      )}
    </div>
  );
}

function MediationPanel({ flash, prefill, onPrefillUsed }: { flash: Flash; prefill: MediationPrefill | null; onPrefillUsed: () => void }) {
  const [data, setData] = useState<MediationData | null>(null);
  const [username, setUsername] = useState('');
  const [listingId, setListingId] = useState<string | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<MediationData>('/mediation'));
    } catch {
      setData({ enabled: false, windowMinutes: 15, tickets: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = data?.tickets.find((t) => OPEN_TICKET.includes(t.status) && t.status !== 'in_progress') ?? data?.tickets.find((t) => t.status === 'in_progress');
  // Live updates while waiting on the other side or a middleman.
  useEffect(() => {
    if (!active || active.status === 'in_progress') return;
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [active, load]);

  async function lookup(name = username, telegramId?: number) {
    if (busy) return;
    if (!telegramId && !name.trim()) return flash(tr('اكتب يوزر طرفك الثاني', 'Enter the other side’s username'));
    setBusy(true);
    try {
      const res = await api.post<{ partner: Partner }>('/mediation/lookup', telegramId ? { telegramId } : { username: name });
      setPartner(res.partner);
    } catch (err) {
      setPartner(null);
      flash(errText(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!prefill || !data?.enabled) return;
    setUsername(prefill.username ? '@' + prefill.username : '');
    setListingId(prefill.listingId ?? null);
    onPrefillUsed();
    void lookup(prefill.username ?? '', prefill.telegramId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, data?.enabled]);

  async function create() {
    if (!partner || busy) return;
    setBusy(true);
    try {
      await api.post('/mediation/tickets', { telegramId: partner.telegramId, listingId });
      haptic('heavy');
      setPartner(null);
      setUsername('');
      setListingId(null);
      await load();
      window.scrollTo(0, 0);
    } catch (err) {
      flash(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    if (!window.confirm(tr('إلغاء التذكرة؟', 'Cancel the ticket?'))) return;
    setBusy(true);
    try {
      await api.post(`/mediation/tickets/${id}/cancel`);
      await load();
    } catch (err) {
      flash(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="card ex-empty"><p>{tr('يتم التحميل...', 'Loading...')}</p></div>;
  const history = data.tickets.filter((t) => t !== active);
  const blocking = active && active.status !== 'in_progress';

  return (
    <div className="ex-form">
      <div className="ex-med-hero">
        <div className="ex-med-icon">🛡️</div>
        <div>
          <b>{tr('وسيط مضمون لتبادلك', 'A trusted middleman for your trade')}</b>
          <span>{tr('اطلب وسيط من وسطاء MF وكمّل التبادل بأمان', 'Request an MF middleman and trade safely')}</span>
        </div>
      </div>

      {!data.enabled ? (
        <div className="card ex-empty"><div style={{ fontSize: 40 }}>🔧</div><p>{tr('الوساطة غير مفعّلة حالياً، ارجع بعدين.', 'Mediation is not available right now, check back later.')}</p></div>
      ) : (
        <>
          {active && <TicketCard ticket={active} flash={flash} busy={busy} onCancel={() => void cancel(active.id)} />}

          {!blocking && (
            <div className="card ex-form-card">
              <label className="ex-label">{tr('👤 منو طرفك الثاني؟', '👤 Who is the other side?')}</label>
              <div className="ex-med-search">
                <input
                  className="ex-input"
                  dir="ltr"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setPartner(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && void lookup()}
                  placeholder="@username"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <button className="btn btn-primary" disabled={busy} onClick={() => void lookup()}>{tr('بحث', 'Find')}</button>
              </div>
              <p className="card-sub ex-hint" style={{ textAlign: 'start', margin: 0 }}>{tr('لازم طرفك يكون فاتح البوت مرة وحدة على الأقل.', 'The other side must have opened the bot at least once.')}</p>

              {partner && (
                <div className="ex-med-confirm">
                  <div className="ex-med-avatar">
                    {partner.photoUrl ? <img src={partner.photoUrl} alt="" /> : <span>{(partner.name || partner.username || '?').charAt(0).toUpperCase()}</span>}
                  </div>
                  <div className="ex-med-who">
                    <span>{tr('هل طرفك هو:', 'Is the other side:')}</span>
                    <b><bdi>{partner.name || partner.username}</bdi></b>
                    {partner.username && <small dir="ltr">@{partner.username}</small>}
                  </div>
                  <div className="ex-row-btns" style={{ width: '100%' }}>
                    <button className="btn btn-secondary" onClick={() => setPartner(null)}>{tr('لا', 'No')}</button>
                    <button className="btn btn-primary" disabled={busy} onClick={() => void create()}>{busy ? '...' : tr('نعم، اطلب وسيط', 'Yes, request')}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card ex-rules">
            <h3>{tr('📋 شلون تشتغل الوساطة', '📋 How it works')}</h3>
            <ul>
              <li><span className="ex-rule-icon">1</span><span>{tr('اكتب يوزر طرفك وأكد إنه هو.', 'Enter the other side’s username and confirm it’s them.')}</span></li>
              <li><span className="ex-rule-icon">2</span><span>{tr('اطلب انضمام لكروب الوساطة، ودز الرابط لطرفك حتى يطلب هو هم.', 'Ask to join the mediation group and send the link to the other side so they ask too.')}</span></li>
              <li><span className="ex-rule-icon">3</span><span>{tr(`عندكم ${data.windowMinutes} دقيقة، وإلا تنلغي التذكرة.`, `You have ${data.windowMinutes} minutes, or the ticket is cancelled.`)}</span></li>
              <li><span className="ex-rule-icon">4</span><span>{tr('أول وسيط يستلم التذكرة يقبلكم بالكروب ويتوسطلكم.', 'The first middleman to take the ticket lets you in and handles the trade.')}</span></li>
            </ul>
          </div>

          {history.length > 0 && (
            <div className="card">
              <h3 className="card-title" style={{ marginTop: 0 }}>{tr('🗂️ تذاكري السابقة', '🗂️ My previous tickets')}</h3>
              <div className="ex-ticket-history">
                {history.map((t) => (
                  <div key={t.id} className="ex-ticket-row">
                    <span><bdi dir="ltr">#{t.number}</bdi> · <bdi>{t.other.name}</bdi></span>
                    <span className="ex-ticket-status">{ticketStatusLabel(t.status)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
