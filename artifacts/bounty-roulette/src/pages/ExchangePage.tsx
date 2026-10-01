import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Repeat, DollarSign, ShoppingCart, ClipboardList } from 'lucide-react';
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

type ExTab = 'swap' | 'sell' | 'buy' | 'mine';
type Flash = (text: string) => void;

const LOADING_MS = 2000;
const MAX_REPORT_MEDIA = 4;

function modeLabel(mode: ExchangeMode) {
  if (mode === 'trade') return tr('تبديل فقط', 'Trade only');
  if (mode === 'sell') return tr('للبيع', 'For sale');
  return tr('يقبل بدل وبيع', 'Trade or sale');
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

function priceText(l: { price: number | null; currency: ExchangeCurrency | null }) {
  return l.price === null ? null : `${l.price.toLocaleString(locale())} ${currencyLabel(l.currency)}`;
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
    { icon: '✅', text: tr('يجب أن يكون الحساب ملكك، والصور والمعلومات حقيقية.', 'The account must be yours, with real photos and info.') },
    { icon: '🔐', text: tr('لا تعطِ إيميل أو باسورد حسابك لأي أحد قبل حضور الوسيط.', "Don't give your account email or password to anyone before the middleman is there.") },
    { icon: '📵', text: tr('ممنوع تكرار نشر نفس الحساب أو نشر روابط وإعلانات.', 'No reposting the same account, links or ads.') },
    { icon: '⚖️', text: tr('أي منشور مخالف يُحذف وصاحبه قد يُحظر، والبوت غير مسؤول عن أي تعامل بدون وسيط.', 'Posts that break the rules are removed and their owners may be banned. The bot is not responsible for any deal made without a middleman.') },
  ];
}

export function ExchangePage({ onBack, initialListingId }: { onBack: () => void; initialListingId?: string | null }) {
  const [stage, setStage] = useState<'loading' | 'intro' | 'main' | 'locked' | 'error'>('loading');
  const [status, setStatus] = useState<ExchangeStatus | null>(null);
  const [tab, setTab] = useState<ExTab>('swap');
  const [swapView, setSwapView] = useState<'browse' | 'post'>('browse');
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
  }, [stage, tab, swapView]);

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
    if (t === 'swap') setSwapView('browse');
  };

  return (
    <div className="ex-page ex-main">
      <ExHeader
        title={tab === 'swap' ? tr('🔄 التبديل', '🔄 Trade') : tab === 'sell' ? tr('💰 البيع', '💰 Sell') : tab === 'buy' ? tr('🛒 الشراء', '🛒 Buy') : tr('📋 منشوراتي', '📋 My posts')}
        onBack={onBack}
      />
      {s.comingSoon && <div className="games-soon-banner">{tr('🧪 وضع الاختبار: القسم ظاهر للمطورين فقط.', '🧪 Test mode: only developers can see this section.')}</div>}

      {tab === 'swap' && (
        <>
          <div className="ex-segment">
            <button className={swapView === 'browse' ? 'active' : ''} onClick={() => setSwapView('browse')}>{tr('🔁 تبديل حسابي', '🔁 Trade my account')}</button>
            <button className={swapView === 'post' ? 'active' : ''} onClick={() => setSwapView('post')}>{tr('➕ عرض حسابي', '➕ Post my account')}</button>
          </div>
          {swapView === 'browse' ? (
            <ListingGrid section="trade" refreshKey={refreshKey} onOpen={setOpenId} emptyAction={() => setSwapView('post')} />
          ) : (
            <PostForm status={s} defaultMode="trade" flash={flash} onPosted={() => { setRefreshKey((k) => k + 1); void loadStatus(); goTab('mine'); }} />
          )}
        </>
      )}
      {tab === 'sell' && (
        <PostForm status={s} defaultMode="sell" flash={flash} onPosted={() => { setRefreshKey((k) => k + 1); void loadStatus(); goTab('mine'); }} />
      )}
      {tab === 'buy' && <ListingGrid section="buy" refreshKey={refreshKey} onOpen={setOpenId} emptyAction={() => goTab('sell')} />}
      {tab === 'mine' && <MyListings refreshKey={refreshKey} status={s} onOpen={setOpenId} onNew={() => goTab('sell')} />}

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
          ['swap', tr('التبديل', 'Trade'), <Repeat size={22} key="i" />],
          ['sell', tr('البيع', 'Sell'), <DollarSign size={22} key="i" />],
          ['buy', tr('الشراء', 'Buy'), <ShoppingCart size={22} key="i" />],
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

function ListingCard({ l, onOpen }: { l: ExchangeListingSummary; onOpen: (id: string) => void }) {
  const price = priceText(l);
  return (
    <button className={`ex-card ${l.pinned ? 'ex-card-pinned' : ''}`} onClick={() => { haptic('light'); onOpen(l.id); }}>
      <div className="ex-card-img">
        {l.coverUrl ? <img src={l.coverUrl} alt="" loading="lazy" /> : <span>🎮</span>}
        {l.pinned && <span className="ex-pin">📌</span>}
        {l.imageCount > 1 && <span className="ex-count">🖼️ {l.imageCount}</span>}
      </div>
      <div className="ex-card-body">
        <ModeBadge mode={l.mode} />
        <div className="ex-card-price">{price ?? tr('🔁 تبديل', '🔁 Trade')}</div>
        <div className="ex-card-details" dir="auto">{l.details}</div>
      </div>
    </button>
  );
}

function ListingGrid({ section, refreshKey, onOpen, emptyAction }: { section: 'trade' | 'buy'; refreshKey: number; onOpen: (id: string) => void; emptyAction: () => void }) {
  const [items, setItems] = useState<ExchangeListingSummary[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (p: number) => {
    const res = await api.get<{ items: ExchangeListingSummary[]; hasMore: boolean }>(`/exchange/listings?section=${section}&page=${p}`);
    setItems((cur) => (p === 1 || !cur ? res.items : [...cur, ...res.items]));
    setHasMore(res.hasMore);
    setPage(p);
  }, [section]);

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
        <p>{section === 'trade' ? tr('لا توجد حسابات للتبديل حالياً.', 'No accounts up for trade yet.') : tr('لا توجد حسابات للبيع حالياً.', 'No accounts for sale yet.')}</p>
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
        <div className="ex-grid">{items.map((l) => <ListingCard key={l.id} l={l} onOpen={onOpen} />)}</div>
      )}
    </>
  );
}

function PostForm({ status, defaultMode, flash, onPosted }: { status: ExchangeStatus; defaultMode: ExchangeMode; flash: Flash; onPosted: () => void }) {
  const [mode, setMode] = useState<ExchangeMode>(defaultMode);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [details, setDetails] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<ExchangeCurrency | null>(null);
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

  async function submit() {
    if (busy) return;
    if (photos.length === 0) return flash(tr('أضف صورة واحدة على الأقل', 'Add at least one photo'));
    if (details.trim().length < 10) return flash(tr('اكتب تفاصيل الحساب (10 أحرف على الأقل)', 'Write the account details (at least 10 characters)'));
    if (mode !== 'trade' && (!Number(price) || Number(price) <= 0)) return flash(tr('اكتب السعر', 'Enter the price'));
    if (mode !== 'trade' && !currency) return flash(tr('اختر العملة', 'Choose the currency'));
    setBusy(true);
    try {
      const form = new FormData();
      form.append('mode', mode);
      form.append('details', details.trim());
      if (mode !== 'trade') {
        form.append('price', price);
        form.append('currency', currency!);
      }
      for (const [i, p] of photos.entries()) form.append('images', await compressImage(p.file), `photo-${i + 1}.jpg`);
      await api.form('/exchange/listings', form);
      haptic('heavy');
      flash(tr('✅ تم نشر حسابك بنجاح', '✅ Your account is posted'));
      onPosted();
    } catch (err) {
      flash(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const modes: { key: ExchangeMode; icon: string; title: string; sub: string }[] = [
    { key: 'trade', icon: '🔁', title: tr('تبديل فقط', 'Trade only'), sub: tr('يظهر في قسم التبديل', 'Shown in Trade') },
    { key: 'sell', icon: '💰', title: tr('بيع', 'Sell'), sub: tr('يظهر في قسم الشراء', 'Shown in Buy') },
    { key: 'both', icon: '⚖️', title: tr('بدل وبيع', 'Both'), sub: tr('يظهر في القسمين', 'Shown in both') },
  ];

  return (
    <div className="ex-form">
      <div className="card ex-form-card">
        <label className="ex-label">{tr('📍 أين تريد عرض حسابك؟', '📍 Where do you want to show it?')}</label>
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
        <div className="ex-photos">
          {photos.map((p, i) => (
            <div key={p.url} className="ex-photo">
              <img src={p.url} alt="" />
              <button aria-label={tr('حذف', 'Remove')} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((cur) => cur.filter((_, j) => j !== i)); }}>✕</button>
              {i === 0 && <span className="ex-cover-tag">{tr('الغلاف', 'Cover')}</span>}
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
          <label className="ex-label">{tr('💵 السعر والعملة', '💵 Price and currency')}</label>
          <input className="ex-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} placeholder={tr('السعر', 'Price')} />
          <div className="ex-currencies">
            {status.currencies.map((c) => (
              <button key={c} className={`ex-chip ${currency === c ? 'active' : ''}`} onClick={() => setCurrency(c)}>{currencyLabel(c)}</button>
            ))}
          </div>
        </div>
      )}

      <p className="card-sub ex-hint">{tr('⚠️ بنشرك للحساب أنت توافق على التعامل عن طريق وسيط فقط.', '⚠️ By posting you agree to deal through a middleman only.')}</p>
      <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
        {busy ? tr('جاري النشر...', 'Posting...') : tr('🚀 نشر الحساب', '🚀 Post the account')}
      </button>
    </div>
  );
}

function ListingDetail({ id, status, flash, onClose, onChanged }: { id: string; status: ExchangeStatus; flash: Flash; onClose: () => void; onChanged: () => void }) {
  const [listing, setListing] = useState<ExchangeListingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgIndex, setImgIndex] = useState(0);
  const [zoom, setZoom] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const [reporting, setReporting] = useState(false);
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
            {listing.images.length > 0 && (
              <div className="ex-gallery">
                <div
                  className="ex-gallery-track"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    setImgIndex(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
                  }}
                >
                  {listing.images.map((src) => (
                    <img key={src} src={src} alt="" onClick={() => setZoom(src)} />
                  ))}
                </div>
                {listing.images.length > 1 && <span className="ex-gallery-index">{imgIndex + 1}/{listing.images.length}</span>}
              </div>
            )}
            <div className="ex-detail-body">
              <div className="ex-detail-row">
                <ModeBadge mode={listing.mode} />
                {listing.pinned && <span className="ex-badge ex-badge-pin">📌 {tr('مثبت', 'Pinned')}</span>}
                {listing.status === 'removed' && <span className="ex-badge ex-badge-removed">{tr('محذوف', 'Removed')}</span>}
              </div>
              <div className="ex-detail-price">{priceText(listing) ?? tr('🔁 تبديل فقط', '🔁 Trade only')}</div>
              <p className="ex-detail-text" dir="auto">{listing.details}</p>
              <div className="ex-detail-meta">
                <span>👤 <bdi>{listing.ownerName ?? tr('مستخدم', 'User')}</bdi></span>
                <span>🕒 {new Date(listing.createdAt).toLocaleDateString(locale())}</span>
                {listing.canModerate && listing.reportsCount !== undefined && <span>🚩 {listing.reportsCount}</span>}
              </div>

              {!listing.isMine && listing.status === 'active' && (
                <div className="ex-actions">
                  <button className="btn btn-primary" onClick={() => setWarning(true)}>{tr('💬 تواصل مع صاحب الحساب', '💬 Contact the owner')}</button>
                  <button className="btn btn-secondary" onClick={() => openTgLink(middlemen)}>{tr('🛡️ وسطاء MF', '🛡️ MF middlemen')}</button>
                  <button className="btn ex-report-btn" onClick={() => setReporting(true)}>{tr('🚩 إبلاغ عن المنشور', '🚩 Report this post')}</button>
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
