import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../services/api';
import { LoadingScreen } from '../components/Common';
import { MeResponse } from '../types';

interface AdminPrize {
  key: string;
  name: string;
  icon: string;
  imageUrl?: string | null;
  storePrice?: number | null;
  baseWeight: number;
  dailyWeight: number;
  pointsWeight: number;
  stock: number;
  dailyStock: number;
  pointsStock: number;
  isUnlimited: boolean;
  dailyIsUnlimited: boolean;
  pointsIsUnlimited: boolean;
  isActive: boolean;
  deliveredCount: number;
  pendingCount: number;
  dailyPendingCount?: number;
  pointsPendingCount?: number;
}

interface Withdrawal {
  _id: string;
  telegramId: number;
  username?: string;
  prizeNameSnapshot: string;
  requestedAt: string;
  status?: string;
}

type AdminTab = 'prizes' | 'withdrawals' | 'forcedChats' | 'tasks' | 'bans' | 'developers' | 'broadcast' | 'stats' | 'settings' | 'demo' | 'people' | 'delivery' | 'gifts' | 'race';

export function AdminPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<AdminTab>('prizes');

  return (
    <div className="app-shell" style={{ paddingBottom: 100 }}>
      <div className="app-content">
        <div className="header-row">
          <h2 style={{ margin: 0, color: 'var(--accent)' }}>لوحة القيادة</h2>
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px', background: 'rgba(229, 57, 53, 0.2)', border: '1px solid var(--danger)', color: 'var(--danger)' }} onClick={onClose}>
            إغلاق
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', background: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)' }}>
          {(['prizes', 'withdrawals', 'race', 'forcedChats', 'tasks', 'bans', 'developers', 'broadcast', 'stats', 'settings', 'demo', 'people', 'delivery', 'gifts'] as AdminTab[]).map((t) => (
            <button
              key={t}
              className={`pill`}
              style={{ flex: 1, minWidth: 90, justifyContent: 'center', background: tab === t ? 'linear-gradient(135deg, var(--accent), var(--accent-3))' : 'transparent', color: tab === t ? '#3e2723' : 'var(--text-dim)', border: tab === t ? 'none' : '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', padding: '10px 14px' }}
              onClick={() => setTab(t)}
            >
              {t === 'prizes'
                ? 'الجوائز'
                : t === 'withdrawals'
                ? 'الطلبات'
                : t === 'forcedChats'
                ? 'الاشتراك'
                : t === 'tasks'
                ? 'المهام'
                : t === 'bans'
                ? 'الحظر'
                : t === 'developers'
                ? 'المطورين'
                : t === 'broadcast'
                ? 'الإذاعة'
                : t === 'stats'
                ? 'الإحصائيات'
                : t === 'demo'
                ? 'الرابط التجريبي'
                : t === 'people'
                ? 'كشف الأشخاص'
                : t === 'delivery'
                ? 'حساب التسليم'
                : t === 'gifts'
                ? 'روابط الهدايا'
                : t === 'race'
                ? '🏆 السباق'
                : 'الإعدادات'}
            </button>
          ))}
        </div>

        {tab === 'prizes' && <PrizesTab />}
        {tab === 'withdrawals' && <WithdrawalsTab />}
        {tab === 'forcedChats' && <ForcedChatsTab />}
        {tab === 'tasks' && <TasksAdminTab />}
        {tab === 'bans' && <BansTab />}
        {tab === 'developers' && <DevelopersTab />}
        {tab === 'broadcast' && <BroadcastTab />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'demo' && <DemoModeTab />}
        {tab === 'people' && <PeopleLookupTab />}
        {tab === 'delivery' && <DeliveryAccountTab />}
        {tab === 'gifts' && <GiftLinksTab />}
        {tab === 'race' && <RaceAdminTab />}
      </div>
    </div>
  );
}

interface DeliveryAccountStatus {
  configured: boolean;
  username: string | null;
  firstName: string | null;
  phoneMasked: string | null;
  lastConnectedAt: string | null;
}

function DeliveryAccountTab() {
  const [account, setAccount] = useState<DeliveryAccountStatus | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordHint, setPasswordHint] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ ok: true; account: DeliveryAccountStatus }>('/admin/delivery-account');
    setAccount(res.account);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'تعذر تحميل الحساب'));
  }, []);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/delivery-account/login/start', { phone });
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر إرسال الكود');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{
        ok: true;
        needsPassword?: boolean;
        passwordHint?: string | null;
        username?: string | null;
      }>('/admin/delivery-account/login/verify', { code, password: password || undefined });
      if (result.needsPassword) {
        setPasswordHint(result.passwordHint || 'كلمة مرور التحقق');
        return;
      }
      setCodeSent(false);
      setCode('');
      setPassword('');
      setPasswordHint(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر إكمال تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount() {
    if (!window.confirm('متأكد تريد فصل حساب التسليم؟ لن تُحذف حسابات المستخدمين.')) return;
    setBusy(true);
    try {
      await api.del('/admin/delivery-account');
      setAccount(null);
      setCodeSent(false);
      setPasswordHint(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر فصل الحساب');
    } finally {
      setBusy(false);
    }
  }

  if (!account) return <LoadingScreen />;

  return (
    <div>
      <div className="card">
        <h3 className="card-title">📦 حساب Telegram للتسليم</h3>
        <p className="card-sub">
          سجّل الدخول برقم الهاتف والكود هنا. جلسة الحساب تُشفّر قبل حفظها في قاعدة البيانات، ولا يظهر رقم الهاتف للمستخدمين.
        </p>
        {account.configured ? (
          <>
            <div style={{ marginTop: 12, lineHeight: 1.8 }}>
              <div><strong>{account.username ? `@${account.username.replace(/^@/, '')}` : account.firstName || 'حساب Telegram'}</strong></div>
              <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>الهاتف: {account.phoneMasked}</div>
            </div>
            <button className="btn btn-secondary" style={{ marginTop: 14 }} disabled={busy} onClick={removeAccount}>
              فصل الحساب
            </button>
          </>
        ) : (
          <>
            <input className="input" placeholder="+9647xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={codeSent || busy} />
            {!codeSent ? (
              <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !phone.trim()} onClick={sendCode}>
                إرسال كود Telegram
              </button>
            ) : (
              <>
                <input className="input" style={{ marginTop: 10 }} placeholder="الكود الذي وصلك" value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
                {passwordHint !== null && (
                  <input className="input" style={{ marginTop: 10 }} type="password" placeholder={`كلمة مرور التحقق${passwordHint ? ` — التلميح: ${passwordHint}` : ''}`} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
                )}
                <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !code.trim() || (passwordHint !== null && !password)} onClick={verifyCode}>
                  تأكيد وإضافة الحساب
                </button>
              </>
            )}
          </>
        )}
        {error && <div style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}

interface GiftLinkRow {
  token: string;
  rewardType: 'points' | 'daily_spin' | 'prize' | 'guaranteed_daily_prize';
  pointsAmount: number | null;
  prizeNameSnapshot: string | null;
  maxRedemptions: number;
  redemptionCount: number;
  status: 'unused' | 'redeemed' | 'expired' | 'revoked';
  link: string | null;
  createdAt: string;
  expiresAt: string | null;
}

interface RaceAdminState {
  enabled: boolean;
  round: number;
  endsAt: string | null;
  closed: boolean;
  winner: { telegramId: number; name: string; score: number; announcedAt: string } | null;
  participants: number;
  joinedCount: number;
  top: Array<{ rank: number; name: string; score: number }>;
  sectionLink: string | null;
  prize: { name: string; number: string };
}

/** datetime-local wants local time without a zone. */
function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RaceAdminTab() {
  const [state, setState] = useState<RaceAdminState | null>(null);
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await api.get<{ ok: true; contest: RaceAdminState }>('/admin/contest');
    setState(res.contest);
    setEndsAt(toLocalInput(res.contest.endsAt));
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function run(path: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const res = await api.post<{ ok: true; contest: RaceAdminState }>(path, body);
      setState(res.contest);
      setEndsAt(toLocalInput(res.contest.endsAt));
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard?.writeText(text);
    window.alert('تم النسخ');
  }

  if (!state) return <LoadingScreen />;
  const endsAtIso = endsAt ? new Date(endsAt).toISOString() : null;

  return (
    <div>
      <div className="card" style={{ borderColor: state.enabled ? undefined : 'var(--danger)' }}>
        <h3 className="card-title">{state.enabled ? '🟢 السباق مفعّل' : '⛔ السباق متوقف'}</h3>
        <p className="card-sub">
          {state.enabled
            ? 'إيقاف السباق يخفيه من البوت بالكامل (التبويب، كارت الرئيسية، الروابط) ويوقف حساب الدعوات. النقاط والروابط تبقى محفوظة.'
            : 'السباق مخفي عن الكل والدعوات ما تنحسب. فعّله حتى يرجع يظهر ويكمل من نفس النقاط.'}
        </p>
        <button
          className={state.enabled ? 'btn btn-secondary' : 'btn btn-primary'}
          style={state.enabled ? { background: 'rgba(229, 57, 53, 0.2)', border: '1px solid var(--danger)', color: 'var(--danger)' } : undefined}
          disabled={busy}
          onClick={() =>
            void run(
              '/admin/contest/enabled',
              { enabled: !state.enabled },
              state.enabled ? 'إيقاف السباق وإخفاؤه من البوت؟' : undefined
            )
          }
        >
          {state.enabled ? '⛔ إيقاف السباق' : '✅ تفعيل السباق'}
        </button>
      </div>

      <div className="card">
        <h3 className="card-title">🏆 سباق الدعوات — الجولة {state.round}</h3>
        <p className="card-sub">
          الحالة: {state.winner ? '🏁 تم إعلان الفائز' : state.closed ? '⏳ انتهى الوقت، بانتظار إعلان الفائز' : '🟢 شغال'}
          {' · '}{state.participants} متسابق عنده دعوات · {state.joinedCount} شخص أخذ رابط
        </p>
        {state.winner && (
          <p style={{ fontWeight: 800 }}>
            🏆 الفائز: <bdi>{state.winner.name}</bdi> ({state.winner.telegramId}) بـ {state.winner.score} دعوة
          </p>
        )}
        <div className="admin-race-top">
          {state.top.length === 0 && <p className="card-sub">ماكو دعوات محسوبة بعد.</p>}
          {state.top.map((row) => (
            <div key={row.rank}>
              <span>#{row.rank} <bdi>{row.name}</bdi></span>
              <strong>{row.score}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">🔗 رابط قسم السباق</h3>
        <p className="card-sub">انشر هذا الرابط، وأي شخص يضغطه ينفتح عنده قسم السباق مباشرة.</p>
        <p style={{ direction: 'ltr', wordBreak: 'break-all', fontSize: 13 }}>{state.sectionLink ?? 'حدد BOT_USERNAME بالسيرفر'}</p>
        {state.sectionLink && (
          <button className="btn btn-secondary" onClick={() => void copy(state.sectionLink!)}>📋 نسخ الرابط</button>
        )}
      </div>

      <div className="card">
        <h3 className="card-title">⏱️ تاريخ الانتهاء</h3>
        <p className="card-sub">عند هذا الوقت تتوقف الدعوات تلقائياً وتنقفل النتائج. اتركه فارغ حتى يبقى السباق مفتوح.</p>
        <input
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid #64748b', marginBottom: 10, fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void run('/admin/contest/ends-at', { endsAt: endsAtIso })}>
            💾 حفظ التاريخ
          </button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => void run('/admin/contest/ends-at', { endsAt: null })}>
            إزالة
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">📣 إعلان الفائز</h3>
        <p className="card-sub">
          ينهي السباق فوراً ويعلن المركز الأول فائزاً بـ {state.prize.name} {state.prize.number}. يوصل للفائز إشعار، ولكل المشاركين رسالة بالنتيجة.
        </p>
        <button
          className="btn btn-primary"
          disabled={busy || Boolean(state.winner) || state.top.length === 0}
          onClick={() => void run('/admin/contest/announce', undefined, `إعلان ${state.top[0]?.name ?? ''} فائزاً وإنهاء السباق؟`)}
        >
          🏆 إعلان الفائز الآن
        </button>
      </div>

      <div className="card">
        <h3 className="card-title">🔄 جولة جديدة</h3>
        <p className="card-sub">تبدي جولة جديدة من الصفر (النقاط تتصفر، والروابط الخاصة تبقى نفسها). التاريخ أعلاه يصير تاريخ انتهاء الجولة الجديدة.</p>
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void run('/admin/contest/new-round', { endsAt: endsAtIso }, 'بدء جولة جديدة وتصفير المتصدرين؟')}
        >
          🔄 بدء جولة جديدة
        </button>
      </div>
    </div>
  );
}

function GiftLinksTab() {
  const [gifts, setGifts] = useState<GiftLinkRow[] | null>(null);
  const [prizes, setPrizes] = useState<AdminPrize[]>([]);
  const [rewardType, setRewardType] = useState<GiftLinkRow['rewardType']>('points');
  const [pointsAmount, setPointsAmount] = useState('10');
  const [prizeKey, setPrizeKey] = useState('');
  const [expiresInHours, setExpiresInHours] = useState('72');
  const [maxRedemptions, setMaxRedemptions] = useState('1');
  const [deductTelegramId, setDeductTelegramId] = useState('');
  const [deductAmount, setDeductAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [deductBusy, setDeductBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [giftRes, prizeRes] = await Promise.all([
      api.get<{ ok: true; gifts: GiftLinkRow[] }>('/admin/gifts'),
      api.get<{ ok: true; prizes: AdminPrize[] }>('/admin/prizes'),
    ]);
    setGifts(giftRes.gifts);
    setPrizes(prizeRes.prizes);
    if (!prizeKey && prizeRes.prizes[0]) setPrizeKey(prizeRes.prizes[0].key);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'تعذر تحميل روابط الهدايا'));
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/gifts', {
        rewardType,
        pointsAmount: rewardType === 'points' ? Number(pointsAmount) : undefined,
        prizeKey: rewardType === 'prize' || rewardType === 'guaranteed_daily_prize' ? prizeKey : undefined,
        expiresInHours: expiresInHours.trim() ? Number(expiresInHours) : null,
        maxRedemptions: Number(maxRedemptions),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر إنشاء رابط الهدية');
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: string | null) {
    if (!link) return;
    await navigator.clipboard?.writeText(link);
    window.alert('تم نسخ رابط الهدية');
  }

  async function revoke(token: string) {
    if (!window.confirm('إلغاء رابط الهدية؟')) return;
    setBusy(true);
    try {
      await api.del(`/admin/gifts/${encodeURIComponent(token)}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر إلغاء الرابط');
    } finally {
      setBusy(false);
    }
  }

  async function deductPoints() {
    const telegramId = deductTelegramId.trim();
    const amount = Number(deductAmount);
    if (!telegramId || !Number.isFinite(amount) || amount <= 0) {
      setError('اكتب Telegram ID وعدد نقاط صحيحين.');
      return;
    }
    if (!window.confirm(`خصم ${amount} نقطة من الحساب ${telegramId}؟`)) return;

    setDeductBusy(true);
    setError(null);
    try {
      const response = await api.post<{
        ok: true;
        result: { deducted: number; remainingBalance: number; username?: string; firstName?: string };
      }>('/admin/points/deduct', { telegramId, amount });
      window.alert(`تم خصم ${response.result.deducted} نقطة.\nالرصيد المتبقي: ${response.result.remainingBalance}`);
      setDeductAmount('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر خصم النقاط');
    } finally {
      setDeductBusy(false);
    }
  }

  if (!gifts) return <LoadingScreen />;
  return (
    <div>
      <div className="card">
        <h3 className="card-title">🧹 مسح نقاط من حساب</h3>
        <p className="card-sub">اكتب Telegram ID وعدد النقاط التي تريد خصمها مباشرة. هذا لا ينشئ رابط هدية.</p>
        <input
          className="input"
          style={{ marginTop: 10 }}
          inputMode="numeric"
          value={deductTelegramId}
          onChange={(event) => setDeductTelegramId(event.target.value)}
          placeholder="Telegram ID"
        />
        <input
          className="input"
          style={{ marginTop: 10 }}
          type="number"
          min="0.01"
          step="0.1"
          value={deductAmount}
          onChange={(event) => setDeductAmount(event.target.value)}
          placeholder="عدد النقاط المراد خصمها"
        />
        <button className="btn btn-secondary" style={{ marginTop: 10, width: '100%' }} disabled={deductBusy} onClick={() => void deductPoints()}>
          {deductBusy ? 'جاري الخصم...' : 'مسح النقاط'}
        </button>
      </div>
      <div className="card">
        <h3 className="card-title">🎁 إنشاء رابط هدية</h3>
         <p className="card-sub">حدد عدد المستخدمين المسموح لهم بالرابط. عند الوصول للعدد يغلق الرابط تلقائياً.</p>
        <select className="input" value={rewardType} onChange={(event) => setRewardType(event.target.value as GiftLinkRow['rewardType'])}>
          <option value="points">نقاط</option>
          <option value="daily_spin">فرة يومية إضافية</option>
          <option value="prize">جائزة محددة</option>
          <option value="guaranteed_daily_prize">فرة يومية مضمونة بجائزة</option>
        </select>
        {rewardType === 'points' && (
          <input className="input" style={{ marginTop: 10 }} type="number" min="1" value={pointsAmount} onChange={(event) => setPointsAmount(event.target.value)} placeholder="عدد النقاط" />
        )}
        {(rewardType === 'prize' || rewardType === 'guaranteed_daily_prize') && (
          <select className="input" style={{ marginTop: 10 }} value={prizeKey} onChange={(event) => setPrizeKey(event.target.value)}>
            {prizes.map((prize) => <option key={prize.key} value={prize.key}>{prize.icon} {prize.name}</option>)}
          </select>
        )}
        <input className="input" style={{ marginTop: 10 }} type="number" min="1" value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} placeholder="عدد المستخدمين المسموح لهم" />
        <input className="input" style={{ marginTop: 10 }} type="number" min="1" value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)} placeholder="مدة الصلاحية بالساعات (فارغ = بدون انتهاء)" />
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || ((rewardType === 'prize' || rewardType === 'guaranteed_daily_prize') && !prizeKey)} onClick={() => void create()}>
          إنشاء ونسخ الرابط
        </button>
        {error && <div style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</div>}
      </div>
      {gifts.map((gift) => (
        <div className="card" key={gift.token}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong>
              {gift.rewardType === 'points'
                ? `💎 ${gift.pointsAmount} نقطة`
                : gift.rewardType === 'daily_spin'
                ? '🎰 فرة يومية إضافية'
                : gift.rewardType === 'guaranteed_daily_prize'
                ? `🎰 فرة مضمونة: ${gift.prizeNameSnapshot || 'جائزة'}`
                : `🎁 ${gift.prizeNameSnapshot || 'جائزة'}`}
            </strong>
            <span className={`status-badge ${gift.status === 'unused' ? 'status-active' : gift.status === 'redeemed' ? 'status-approved' : 'status-expired'}`}>
              {gift.status === 'unused' ? 'جاهز' : gift.status === 'redeemed' ? 'مستخدم' : gift.status === 'revoked' ? 'ملغى' : 'منتهي'}
            </span>
          </div>
          <div className="card-sub" style={{ marginTop: 6 }}>المستخدمون: {gift.redemptionCount}/{gift.maxRedemptions}</div>
          {gift.link && <div style={{ direction: 'ltr', wordBreak: 'break-all', fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>{gift.link}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {gift.link && gift.status === 'unused' && <button className="btn btn-secondary" onClick={() => void copy(gift.link)}>📋 نسخ</button>}
            {gift.status === 'unused' && <button className="btn btn-secondary" onClick={() => void revoke(gift.token)}>إلغاء الرابط</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

interface DemoModeSettings {
  demoModeEnabled: boolean;
  maintenanceMode: boolean;
  demoAccessLink: string | null;
  demoAccessTokenUpdatedAt?: string | null;
}

function DemoModeTab() {
  const [settings, setSettings] = useState<DemoModeSettings | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await api.get<{ ok: true; settings: DemoModeSettings }>('/admin/settings');
    setSettings(res.settings);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function toggle() {
    if (!settings) return;
    if (settings.demoModeEnabled && !window.confirm('إيقاف وضع التجربة سيوقف الصيانة أيضاً. متابعة؟')) return;
    setBusy(true);
    try {
      await api.post('/admin/settings/demo-mode', { enabled: !settings.demoModeEnabled });
      await load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'تعذر تغيير وضع التجربة');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (settings?.demoAccessLink) {
      await navigator.clipboard?.writeText(settings.demoAccessLink);
      window.alert('تم نسخ الرابط التجريبي');
    }
  }

  if (!settings) return <LoadingScreen />;
  return (
    <div>
      <div className="card">
        <h3 className="card-title">🧪 الرابط التجريبي</h3>
        <p className="card-sub">
          عند التفعيل يدخل البوت تلقائياً في الصيانة. الرابط يسمح بالدخول المؤقت للاختبار، ويقبل الإحالات من الحسابات القديمة وحتى الحساب نفسه.
        </p>
        <button className="btn btn-primary" disabled={busy} onClick={() => void toggle()}>
          {settings.demoModeEnabled ? '⛔ إيقاف التجربة وإغلاق الصيانة' : '✅ تفعيل الرابط التجريبي'}
        </button>
      </div>
      {settings.demoModeEnabled && settings.demoAccessLink && (
        <div className="card">
          <h3 className="card-title">🔗 رابط الدخول المؤقت</h3>
          <p style={{ direction: 'ltr', wordBreak: 'break-all', fontSize: 13 }}>{settings.demoAccessLink}</p>
          <button className="btn btn-secondary" onClick={() => void copyLink()}>📋 نسخ الرابط</button>
          <p className="card-sub" style={{ marginBottom: 0 }}>يتغير الرابط تلقائياً كل 30 دقيقة.</p>
        </div>
      )}
    </div>
  );
}

interface LookupUser {
  telegramId: number;
  username?: string;
  firstName?: string;
  createdAt: string;
  totalSpins: number;
  spinCredits: number;
  spinPoints: number;
  spinPointsSpent: number;
  pendingReferrals: number;
  qualifiedReferrals: number;
  claimTasks: number;
  completedTasks: number;
  completedSubscriptionTasks: number;
  inventory: number;
  dailyStreakDay: number;
  dailyLastClaimAt?: string | null;
  isBanned: boolean;
}

interface LookupReferral {
  id: string;
  status: string;
  createdAt: string;
  qualifiedAt?: string;
  invitee: { telegramId?: number; username?: string; firstName?: string } | null;
}

function PeopleLookupTab() {
  const [query, setQuery] = useState('');
  const [user, setUser] = useState<LookupUser | null>(null);
  const [referrals, setReferrals] = useState<LookupReferral[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    setReferrals(null);
    try {
      const res = await api.get<{ ok: true; user: LookupUser }>(`/admin/users/lookup?query=${encodeURIComponent(query.trim())}`);
      setUser(res.user);
    } catch (err) {
      setUser(null);
      setError(err instanceof ApiError ? err.message : 'تعذر العثور على المستخدم');
    } finally {
      setBusy(false);
    }
  }

  async function loadReferrals() {
    if (!user) return;
    setBusy(true);
    try {
      const res = await api.get<{ ok: true; referrals: LookupReferral[] }>(`/admin/users/${user.telegramId}/referrals`);
      setReferrals(res.referrals);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر تحميل الإحالات');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h3 className="card-title">🔎 كشف الأشخاص</h3>
        <p className="card-sub">اكتب اليوزر أو أيدي تليجرام حتى تظهر كل إحصائياته.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void lookup(); }} placeholder="@username أو Telegram ID" style={{ ...inputStyle, flex: 1 }} />
          <button className="btn btn-primary" disabled={busy} onClick={() => void lookup()}>كشف</button>
        </div>
      </div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      {user && (
        <>
          <div className="card">
            <h3 className="card-title">{user.username ? '@' + user.username : user.firstName || 'مستخدم'} · {user.telegramId}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <StatBox label="عدد الفرات" value={user.spinCredits} />
              <StatBox label="مجموع العجلات" value={user.totalSpins} />
              <StatBox label="نقاط عجلة النقاط" value={user.spinPoints} />
              <StatBox label="النقاط المصروفة" value={user.spinPointsSpent} />
              <StatBox label="الإحالات المؤهلة" value={user.qualifiedReferrals} />
              <StatBox label="الإحالات المعلقة" value={user.pendingReferrals} />
              <StatBox label="مهام الجوائز المكتملة" value={user.completedTasks} />
              <StatBox label="مهام الاشتراك المكتملة" value={user.completedSubscriptionTasks} />
              <StatBox label="المخزون" value={user.inventory} />
              <StatBox label="ستريك اليومي" value={user.dailyStreakDay} />
            </div>
            <button className="btn btn-secondary" style={{ marginTop: 12, width: '100%' }} disabled={busy} onClick={() => void loadReferrals()}>
              📋 جلب الإحالات
            </button>
          </div>
          {referrals && (
            <div className="card">
              <h3 className="card-title">إحالات المستخدم ({referrals.length})</h3>
              {referrals.length === 0 && <p className="card-sub">لا توجد إحالات.</p>}
              {referrals.map((referral) => (
                <div className="list-item" key={referral.id}>
                  <span>{referral.invitee?.username ? '@' + referral.invitee.username : referral.invitee?.firstName || referral.invitee?.telegramId || 'مستخدم'}</span>
                  <span className={`status-badge ${referral.status === 'qualified' ? 'status-approved' : 'status-pending'}`}>{referral.status === 'qualified' ? 'مؤهلة' : referral.status}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface AdminTask {
  _id: string;
  title: string;
  taskType: 'subscription' | 'folder' | 'profile_name' | 'profile_bio';
  chatId: string;
  verificationChatId?: string;
  chatType: 'channel' | 'group' | 'unknown';
  inviteLink?: string;
  folderLink?: string;
  profileRequirement?: string;
  rewardPoints: number;
  isActive: boolean;
}

function TasksAdminTab() {
  const [tasks, setTasks] = useState<AdminTask[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ ok: true; tasks: AdminTask[] }>('/admin/tasks');
    setTasks(res.tasks);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'تعذر تحميل المهام'));
  }, []);

  async function addTask() {
    const selected = window.prompt('نوع المهمة:\n1 = اشتراك قناة/كروب\n2 = مجلد Telegram\n3 = شعار MF بجانب الاسم\n4 = @mfbisnes في البايو', '1');
    const taskType = selected === '2' ? 'folder' : selected === '3' ? 'profile_name' : selected === '4' ? 'profile_bio' : 'subscription';
    const chatId = taskType === 'subscription' ? window.prompt('أدخل @يوزرنيم القناة/الكروب أو الـID:\nيجب أن يكون البوت مشرفاً بها.') : undefined;
    const verificationChatId = taskType === 'folder' ? window.prompt('أدخل قناة التحقق @username أو الـID:\nيجب أن يكون البوت مشرفاً بها.') : undefined;
    const folderLink = taskType === 'folder' ? window.prompt('أدخل رابط المجلد من Telegram (https://t.me/addlist/...)') : undefined;
    if (taskType === 'subscription' && !chatId) return;
    if (taskType === 'folder' && (!verificationChatId || !folderLink)) return;
    const title = window.prompt('اسم المهمة:', chatId || (taskType === 'profile_name' ? 'ضع شعار MF بجانب اسمك' : taskType === 'profile_bio' ? 'ضع @mfbisnes في البايو' : 'مهمة جديدة')) || chatId || 'مهمة جديدة';
    const rewardPoints = Number(window.prompt('مكافأة المهمة بالنقاط:', '1'));
    if (!Number.isFinite(rewardPoints) || rewardPoints < 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/tasks', { taskType, chatId, verificationChatId, folderLink, title, rewardPoints });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل إضافة المهمة');
    } finally {
      setBusy(false);
    }
  }

  async function editTask(task: AdminTask) {
    const title = window.prompt('اسم المهمة:', task.title);
    if (title === null) return;
    const rewardPoints = Number(window.prompt('المكافأة بالنقاط:', String(task.rewardPoints)));
    if (!Number.isFinite(rewardPoints) || rewardPoints < 0) return;
    setBusy(true);
    try {
      await api.patch(`/admin/tasks/${task._id}`, { title, rewardPoints });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل تعديل المهمة');
    } finally {
      setBusy(false);
    }
  }

  async function removeTask(task: AdminTask) {
    if (!window.confirm(`حذف مهمة "${task.title}"؟`)) return;
    setBusy(true);
    try {
      await api.del(`/admin/tasks/${task._id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل حذف المهمة');
    } finally {
      setBusy(false);
    }
  }

  if (!tasks) return <LoadingScreen />;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => void addTask()}>➕ إضافة مهمة اشتراك</button>
      </div>
       <p className="card-sub">مهمة المجلد تستخدم قناة تحقق منفصلة. مهام الاسم والبايو تحتاج اتصال حساب التسليم حتى يتم فحصها دورياً.</p>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      {tasks.length === 0 && <p style={{ color: 'var(--text-dim)' }}>لا توجد مهام مضافة.</p>}
      {tasks.map((task) => (
        <div className="card" key={task._id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div>
              <strong>{task.title}</strong>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                {task.taskType === 'folder'
                  ? `📁 مجلد · قناة التحقق ${task.verificationChatId || task.chatId}`
                  : task.taskType === 'profile_name'
                  ? '🔤 مهمة شعار MF'
                  : task.taskType === 'profile_bio'
                  ? '📝 مهمة البايو @mfbisnes'
                  : `${task.chatType === 'channel' ? '📢 قناة' : '👥 كروب'} · ${task.chatId}`}
                {' · '}+{task.rewardPoints} نقطة
              </div>
            </div>
            <span className={`status-badge ${task.isActive ? 'status-active' : 'status-expired'}`}>{task.isActive ? 'مفعلة' : 'موقوفة'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => void editTask(task)}>✏️ تعديل</button>
            <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => void api.patch(`/admin/tasks/${task._id}`, { isActive: !task.isActive }).then(load)}>⏯ تشغيل/إيقاف</button>
            <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => void removeTask(task)}>🗑 حذف</button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ForcedChat {
  chatId: string;
  title?: string;
  type: 'channel' | 'group' | 'unknown';
  inviteLink?: string;
  isActive: boolean;
}

function ForcedChatsTab() {
  const [chats, setChats] = useState<ForcedChat[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ ok: true; chats: ForcedChat[] }>('/admin/forced-chats');
    setChats(res.chats);
  }

  useEffect(() => {
    load();
  }, []);

  async function addChat() {
    const input = window.prompt('أدخل @يوزرنيم القناة/الكروب، أو رابط تيليجرام، أو الـID:\n\n⚠️ يجب أن يكون البوت أدمن بها أولاً.');
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/forced-chats', { input });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
    } finally {
      setBusy(false);
    }
  }

  async function removeChat(chatId: string) {
    if (!window.confirm('متأكد تريد حذف هذي القناة/الكروب من الاشتراك الإجباري؟')) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/admin/forced-chats/${encodeURIComponent(chatId)}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    if (!window.confirm('متأكد تريد حذف كل القنوات والكروبات من الاشتراك الإجباري؟')) return;
    setBusy(true);
    try {
      await api.post('/admin/forced-chats/clear', {});
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!chats) return <LoadingScreen />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={addChat}>
          ➕ إضافة قناة/كروب
        </button>
        {chats.length > 0 && (
          <button className="btn btn-secondary" disabled={busy} onClick={clearAll}>
            🗑 مسح الكل
          </button>
        )}
      </div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      {chats.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-dim)' }}>ماكو قنوات/كروبات مضافة</p>}
      {chats.map((c) => (
        <div className="card" key={c.chatId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 800 }}>{c.title || c.chatId}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {c.type === 'channel' ? '📢 قناة' : c.type === 'group' ? '👥 كروب' : '❓ غير معروف'} · {c.chatId}
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto', padding: '8px 14px' }}
              disabled={busy}
              onClick={() => removeChat(c.chatId)}
            >
              🗑️ حذف
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface BannedUser {
  telegramId: number;
  username?: string;
  banReason?: string;
}

function BansTab() {
  const [users, setUsers] = useState<BannedUser[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ ok: true; users: BannedUser[] }>('/admin/bans');
    setUsers(res.users);
  }

  useEffect(() => {
    load();
  }, []);

  async function banSomeone() {
    const lookup = window.prompt('أدخل @يوزرنيم أو الأيدي الرقمي للشخص المراد حظره:');
    if (!lookup) return;
    const reason = window.prompt('سبب الحظر (اختياري):') || undefined;
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/bans', { lookup, reason });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
    } finally {
      setBusy(false);
    }
  }

  async function unban(telegramId: number) {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/bans/unban', { lookup: String(telegramId) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
    } finally {
      setBusy(false);
    }
  }

  async function unbanAll() {
    if (!window.confirm('متأكد تريد فك الحظر عن الجميع؟')) return;
    setBusy(true);
    try {
      await api.post('/admin/bans/unban-all', {});
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!users) return <LoadingScreen />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={banSomeone}>
          🚫 حظر شخص
        </button>
        {users.length > 0 && (
          <button className="btn btn-secondary" disabled={busy} onClick={unbanAll}>
            ✅ فك حظر الجميع
          </button>
        )}
      </div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      {users.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-dim)' }}>ماكو أي شخص محظور 🎉</p>}
      {users.map((u) => (
        <div className="card" key={u.telegramId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 800 }}>{u.username ? '@' + u.username : `ID: ${u.telegramId}`}</div>
              {u.banReason && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>السبب: {u.banReason}</div>}
            </div>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto', padding: '8px 14px' }}
              disabled={busy}
              onClick={() => unban(u.telegramId)}
            >
              ✅ فك الحظر
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface Developer {
  telegramId: number;
  username?: string;
  role: 'owner' | 'developer';
  createdAt: string | null;
}

function DevelopersTab() {
  const [devs, setDevs] = useState<Developer[] | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [devsRes, meRes] = await Promise.all([
      api.get<{ ok: true; developers: Developer[] }>('/admin/developers'),
      api.get<MeResponse>('/me'),
    ]);
    setDevs(devsRes.developers);
    setIsOwner(meRes.adminRole === 'owner');
  }

  useEffect(() => {
    load();
  }, []);

  async function addDeveloper() {
    const lookup = window.prompt('أدخل @يوزرنيم أو الأيدي الرقمي للمطور الجديد:');
    if (!lookup) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/developers', { lookup });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
    } finally {
      setBusy(false);
    }
  }

  async function removeDeveloper(telegramId: number) {
    if (!window.confirm('متأكد تريد تحذف هذا المطور؟')) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/admin/developers/${telegramId}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
    } finally {
      setBusy(false);
    }
  }

  if (!devs) return <LoadingScreen />;

  return (
    <div>
      {isOwner && (
        <button className="btn btn-primary" style={{ marginBottom: 12 }} disabled={busy} onClick={addDeveloper}>
          ➕ إضافة مطور
        </button>
      )}
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      {devs.map((d) => (
        <div className="card" key={d.telegramId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 800 }}>{d.username ? '@' + d.username : `ID: ${d.telegramId}`}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {d.role === 'owner' ? '👑 المالك' : '🛠️ مطور'} · ID: {d.telegramId}
                {d.createdAt ? ` · انضم بتاريخ ${new Date(d.createdAt).toLocaleDateString('ar-EG')}` : ''}
              </div>
            </div>
            {isOwner && d.role !== 'owner' && (
              <button
                className="btn btn-secondary"
                style={{ width: 'auto', padding: '8px 14px' }}
                disabled={busy}
                onClick={() => removeDeveloper(d.telegramId)}
              >
                🗑️ حذف
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Mirrors server/src/workers/seed.ts — the 15 standard prizes already used by the wheel.
// Picking one here just autofills the form; nothing is created until "إنشاء الجائزة" is
// pressed, and any field can still be edited by hand afterward.
const PRESET_PRIZES = [
  { key: 'gems_3000', name: 'حساب 3000 جوهرة', icon: '💎', baseWeight: '30', stock: '1000' },
  { key: 'stars_15', name: '15 نجمة', icon: '⭐', baseWeight: '30', stock: '1000' },
  { key: 'asia_credit_1', name: 'رصيد آسيا 1', icon: '📱', baseWeight: '24.8993', stock: '500' },
  { key: 'gems_5000', name: '5000 جوهرة', icon: '💎', baseWeight: '9', stock: '500' },
  { key: 'stars_25', name: '25 نجمة', icon: '⭐', baseWeight: '5.9', stock: '500' },
  { key: 'asia_credit_5', name: 'رصيد آسيا 5', icon: '📱', baseWeight: '0.1', stock: '50' },
  { key: 'extreme_account_20', name: 'حساب 20 Extreme', icon: '⚡', baseWeight: '0.0001', stock: '2' },
  { key: 'asia_credit_300', name: 'رصيد آسيا 300', icon: '📱', baseWeight: '0.0001', stock: '2' },
  { key: 'asia_credit_140', name: 'رصيد آسيا 140', icon: '📱', baseWeight: '0.0005', stock: '3' },
  { key: 'nft_normal', name: 'NFT عادي', icon: '🎁', baseWeight: '0.01', stock: '10' },
  { key: 'stars_200', name: '200 نجمة', icon: '⭐', baseWeight: '0.05', stock: '20' },
  { key: 'stars_400', name: '400 نجمة', icon: '⭐', baseWeight: '0.01', stock: '10' },
  { key: 'stars_1000', name: '1000 نجمة', icon: '⭐', baseWeight: '0.005', stock: '5' },
  { key: 'gems_7000', name: '7000 جوهرة', icon: '💎', baseWeight: '0.005', stock: '5' },
  { key: 'nft_black', name: 'NFT Black', icon: '🖤', baseWeight: '0.01', stock: '5' },
];

function PrizesTab() {
  const [prizes, setPrizes] = useState<AdminPrize[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    key: '',
    name: '',
    icon: '',
    baseWeight: '',
    dailyWeight: '',
    pointsWeight: '',
    stock: '',
    dailyStock: '',
    pointsStock: '',
    isUnlimited: false,
    dailyIsUnlimited: false,
    pointsIsUnlimited: false,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  async function load() {
    const res = await api.get<{ ok: true; prizes: AdminPrize[] }>('/admin/prizes');
    setPrizes(res.prizes);
  }

  useEffect(() => {
    load();
  }, []);

  async function adjustStock(key: string, action: 'add' | 'remove', mode: 'daily' | 'points') {
    const modeLabel = mode === 'daily' ? 'العجلة اليومية' : 'عجلة النقاط';
    const amountStr = window.prompt(`${modeLabel} — ${action === 'add' ? 'كم تريد أن تضيف؟' : 'كم تريد أن تنقص؟'}`);
    const amount = Number(amountStr);
    if (!amount || amount <= 0) return;
    setBusyKey(key);
    try {
      await api.post(`/admin/prizes/${key}/stock/${action}`, { amount, mode });
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleActive(prize: AdminPrize) {
    setBusyKey(prize.key);
    try {
      await api.post(`/admin/prizes/${prize.key}/active`, { isActive: !prize.isActive });
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function editWeight(prize: AdminPrize, mode: 'daily' | 'points') {
    const current = mode === 'daily' ? prize.dailyWeight : prize.pointsWeight;
    const limit = mode === 'daily' ? 100 : 30;
    const value = window.prompt(`نسبة الجائزة في ${mode === 'daily' ? 'العجلة اليومية' : 'عجلة النقاط'} (من أصل ${limit}%):`, String(current));
    if (value === null) return;
    const weight = Number(value);
    if (!Number.isFinite(weight) || weight < 0) {
      window.alert('أدخل رقماً صحيحاً من 0 أو أكبر.');
      return;
    }
    setBusyKey(prize.key);
    try {
      await api.patch(`/admin/prizes/${prize.key}`, { [`${mode}Weight`]: weight });
      await load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'فشل تعديل النسبة.');
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadImage(key: string, file: File) {
    if (file.size > 5 * 1024 * 1024) {
      window.alert('حجم الصورة أكبر من 5 ميغابايت. اختر صورة أصغر.');
      return;
    }
    setBusyKey(key);
    try {
      await api.upload(`/admin/prizes/${key}/image`, file);
      await load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'فشل رفع الصورة، حاول مرة ثانية.');
    } finally {
      setBusyKey(null);
    }
  }

  async function clearImage(key: string) {
    setBusyKey(key);
    try {
      await api.del(`/admin/prizes/${key}/image`);
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function submitNewPrize(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const baseWeight = Number(form.baseWeight || form.dailyWeight);
    const dailyWeight = Number(form.dailyWeight);
    const pointsWeight = Number(form.pointsWeight);
    const stock = Number(form.stock || form.dailyStock);
    const dailyStock = Number(form.dailyStock);
    const pointsStock = Number(form.pointsStock);
    if (!form.key.trim() || !form.name.trim()) {
      setFormError('الاسم والمفتاح مطلوبين.');
      return;
    }
    if (![baseWeight, dailyWeight, pointsWeight].every((value) => Number.isFinite(value) && value >= 0)) {
      setFormError('نسب العجلة اليومية وعجلة النقاط لازم تكون أرقاماً من 0 أو أكبر.');
      return;
    }
    if ((!form.dailyIsUnlimited && (!Number.isFinite(dailyStock) || dailyStock < 0)) || (!form.pointsIsUnlimited && (!Number.isFinite(pointsStock) || pointsStock < 0))) {
      setFormError('أدخل مخزون العجلتين، أو فعّل المخزون اللامتناهي لكل عجلة.');
      return;
    }
    if (form.icon && prizes?.some((p) => p.icon === form.icon)) {
      const proceed = window.confirm('هذا الإيموجي مستخدم بجائزة ثانية مسبقاً. تريد تكمل بنفس الإيموجي؟');
      if (!proceed) return;
    }

    setFormBusy(true);
    try {
      await api.post('/admin/prizes', {
        key: form.key.trim(),
        name: form.name.trim(),
        icon: form.icon.trim() || '🎁',
        baseWeight,
        dailyWeight,
        pointsWeight,
        stock: form.dailyIsUnlimited ? 0 : dailyStock,
        dailyStock: form.dailyIsUnlimited ? 0 : dailyStock,
        pointsStock: form.pointsIsUnlimited ? 0 : pointsStock,
        isUnlimited: form.dailyIsUnlimited,
        dailyIsUnlimited: form.dailyIsUnlimited,
        pointsIsUnlimited: form.pointsIsUnlimited,
      });
      setForm({ key: '', name: '', icon: '', baseWeight: '', dailyWeight: '', pointsWeight: '', stock: '', dailyStock: '', pointsStock: '', isUnlimited: false, dailyIsUnlimited: false, pointsIsUnlimited: false });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
    } finally {
      setFormBusy(false);
    }
  }

  if (!prizes) return <LoadingScreen />;

  const usedIcons = new Map<string, number>();
  prizes.forEach((p) => usedIcons.set(p.icon, (usedIcons.get(p.icon) ?? 0) + 1));

  return (
    <div>
      <button className="btn btn-primary" style={{ marginBottom: 12 }} onClick={() => setShowForm((s) => !s)}>
        {showForm ? '✕ إلغاء' : '➕ إضافة جائزة جديدة'}
      </button>

      {showForm && (
        <form className="card" onSubmit={submitNewPrize}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 6 }}>
                🎁 اختر جائزة جاهزة (يعبي الاسم والإيموجي والنسبة تلقائياً) — أو اتركها فارغة وسوي جائزة مخصصة
              </label>
              <select
                style={inputStyle}
                defaultValue=""
                onChange={(e) => {
                  const preset = PRESET_PRIZES.find((p) => p.key === e.target.value);
                  if (preset) {
                   setForm({
                     ...form,
                     ...preset,
                     dailyWeight: preset.baseWeight,
                     pointsWeight: '',
                     dailyStock: preset.stock,
                     pointsStock: preset.stock,
                     isUnlimited: false,
                     dailyIsUnlimited: false,
                     pointsIsUnlimited: false,
                   });
                  }
                }}
              >
                <option value="">— جائزة مخصصة (أدخل كل شي يدوياً) —</option>
                {PRESET_PRIZES.map((p) => (
                  <option key={p.key} value={p.key} disabled={prizes?.some((existing) => existing.key === p.key)}>
                    {p.icon} {p.name}
                    {prizes?.some((existing) => existing.key === p.key) ? ' (موجودة مسبقاً)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <input
              placeholder="المفتاح (key) — إنجليزي، مثل gems_3000"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              style={inputStyle}
            />
            <input
              placeholder="اسم الجائزة (بدون إيموجي) — مثل 3000 جوهرة"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={inputStyle}
            />
            <input
              placeholder="الإيموجي — مثل 💎"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              style={inputStyle}
            />
              <input
                placeholder="نسبة العجلة اليومية من 100 — مثل 30"
                value={form.dailyWeight}
                onChange={(e) => setForm({ ...form, dailyWeight: e.target.value, baseWeight: e.target.value })}
                style={inputStyle}
                inputMode="decimal"
              />
              <input
                placeholder="نسبة عجلة النقاط من 30 — مثل 2"
                value={form.pointsWeight}
                onChange={(e) => setForm({ ...form, pointsWeight: e.target.value })}
                style={inputStyle}
                inputMode="decimal"
              />
            <div style={{ marginTop: -4, color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 }}>
              النسبة اليومية من أصل 100٪، ونسبة عجلة النقاط من أصل 30٪؛ الباقي يكون حظ أوفر ولا ينتقل تلقائياً لجائزة ثانية.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.dailyIsUnlimited} onChange={(e) => setForm({ ...form, dailyIsUnlimited: e.target.checked, isUnlimited: e.target.checked })} />
              مخزون يومي لا نهائي
            </label>
            {!form.dailyIsUnlimited && (
              <input
                placeholder="المخزون الابتدائي للعجلة اليومية"
                value={form.dailyStock}
                onChange={(e) => setForm({ ...form, dailyStock: e.target.value, stock: e.target.value })}
                style={inputStyle}
                inputMode="numeric"
              />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.pointsIsUnlimited} onChange={(e) => setForm({ ...form, pointsIsUnlimited: e.target.checked })} />
              مخزون عجلة النقاط لا نهائي
            </label>
            {!form.pointsIsUnlimited && (
              <input
                placeholder="المخزون الابتدائي لعجلة النقاط"
                value={form.pointsStock}
                onChange={(e) => setForm({ ...form, pointsStock: e.target.value })}
                style={inputStyle}
                inputMode="numeric"
              />
            )}
            {formError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{formError}</div>}
            <button className="btn btn-primary" disabled={formBusy} type="submit">
              {formBusy ? '...' : '✅ إنشاء الجائزة'}
            </button>
          </div>
        </form>
      )}

      {prizes.map((p) => (
        <div className="card" key={p.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt=""
                  style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }}
                />
              ) : (
                <span
                  style={{ fontSize: 22, cursor: 'pointer' }}
                  title="اضغط لتغيير الإيموجي"
                  onClick={() => editPrizeIcon(p, load, setBusyKey)}
                >
                  {p.icon}
                </span>
              )}
              {p.name}
              {usedIcons.get(p.icon)! > 1 && (
                <span style={{ fontSize: 11, color: 'var(--danger)' }} title="هذا الإيموجي مكرر بجائزة ثانية">
                  ⚠️ مكرر
                </span>
              )}
            </div>
            <span className={`status-badge ${p.isActive ? 'status-active' : 'status-expired'}`}>
              {p.isActive ? 'مفعّلة' : 'موقوفة'}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', margin: '8px 0' }}>
             اليومية: {p.dailyIsUnlimited ? '∞' : p.dailyStock} (نسبة {p.dailyWeight}%) · النقاط: {p.pointsIsUnlimited ? '∞' : p.pointsStock} (نسبة {p.pointsWeight}%) · مُسلَّم: {p.deliveredCount}
          </div>
           <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
             <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busyKey === p.key} onClick={() => editWeight(p, 'daily')}>
               ✏️ نسبة اليومية
             </button>
             <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busyKey === p.key} onClick={() => editWeight(p, 'points')}>
               ✏️ نسبة النقاط
             </button>
           </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <label className="btn btn-secondary" style={{ cursor: busyKey === p.key ? 'default' : 'pointer', opacity: busyKey === p.key ? 0.6 : 1 }}>
              📷 {p.imageUrl ? 'تغيير الصورة' : 'إضافة صورة'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                disabled={busyKey === p.key}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // allow re-selecting the same file next time
                  if (file) uploadImage(p.key, file);
                }}
              />
            </label>
            {p.imageUrl && (
              <button className="btn btn-secondary" disabled={busyKey === p.key} onClick={() => clearImage(p.key)}>
                🗑 حذف الصورة
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span
              style={{
                fontSize: 13,
                padding: '4px 10px',
                borderRadius: 8,
                background: p.storePrice ? 'rgba(213,155,255,0.15)' : 'rgba(255,255,255,0.06)',
                color: p.storePrice ? 'var(--accent-glow)' : 'var(--text-dim)',
              }}
            >
              {p.storePrice ? `🏪 بالمتجر: ${p.storePrice} فرة` : '🏪 مو موجودة بالمتجر'}
            </span>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: 12 }}
              disabled={busyKey === p.key}
              onClick={() => editStorePrice(p, load, setBusyKey)}
            >
              {p.storePrice ? '✏️ تعديل السعر' : '➕ أضفها للمتجر'}
            </button>
          </div>
           <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
               <button className="btn btn-secondary" disabled={busyKey === p.key || p.dailyIsUnlimited} onClick={() => adjustStock(p.key, 'add', 'daily')}>
                 ➕ يومي
               </button>
               <button className="btn btn-secondary" disabled={busyKey === p.key || p.dailyIsUnlimited} onClick={() => adjustStock(p.key, 'remove', 'daily')}>
                 ➖ يومي
               </button>
               <button className="btn btn-secondary" disabled={busyKey === p.key || p.pointsIsUnlimited} onClick={() => adjustStock(p.key, 'add', 'points')}>
                 ➕ نقاط
               </button>
               <button className="btn btn-secondary" disabled={busyKey === p.key || p.pointsIsUnlimited} onClick={() => adjustStock(p.key, 'remove', 'points')}>
                 ➖ نقاط
               </button>
            </div>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 8 }}
            disabled={busyKey === p.key}
            onClick={() => toggleActive(p)}
          >
            {p.isActive ? '⏸ إيقاف الجائزة' : '▶️ تفعيل الجائزة'}
          </button>
           {p.dailyStock === 0 && !p.dailyIsUnlimited && (
            <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 14, fontWeight: 'bold' }}>
               نفد مخزون العجلة اليومية
            </div>
          )}
           {p.pointsStock === 0 && !p.pointsIsUnlimited && (
             <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 14, fontWeight: 'bold' }}>
               نفد مخزون عجلة النقاط
             </div>
           )}
        </div>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#334155',
  border: '1px solid #475569',
  borderRadius: 10,
  padding: '10px 12px',
  color: 'var(--text-main)',
  fontSize: 14,
};

async function editPrizeIcon(
  prize: AdminPrize,
  reload: () => Promise<void>,
  setBusyKey: (k: string | null) => void
) {
  const icon = window.prompt('اكتب الإيموجي الجديد لهذي الجائزة (سطر واحد فقط):', prize.icon);
  if (!icon || !icon.trim()) return;
  setBusyKey(prize.key);
  try {
    await api.patch(`/admin/prizes/${prize.key}`, { icon: icon.trim() });
  } finally {
    setBusyKey(null);
  }
  await reload();
}

async function editStorePrice(
  prize: AdminPrize,
  reload: () => Promise<void>,
  setBusyKey: (k: string | null) => void
) {
  const raw = window.prompt(
    'سعر هذي الجائزة بالمتجر (بعدد الفرات) — اترك الخانة فارغة عشان تشيلها من المتجر:',
    prize.storePrice ? String(prize.storePrice) : ''
  );
  if (raw === null) return; // cancelled
  const trimmed = raw.trim();
  const storePrice = trimmed === '' ? null : Number(trimmed);
  if (storePrice !== null && (!Number.isFinite(storePrice) || storePrice <= 0)) {
    window.alert('السعر لازم يكون رقم موجب.');
    return;
  }
  setBusyKey(prize.key);
  try {
    await api.post(`/admin/prizes/${prize.key}/store-price`, { storePrice });
  } catch (err) {
    window.alert(err instanceof ApiError ? err.message : 'فشل تحديث السعر');
  } finally {
    setBusyKey(null);
  }
  await reload();
}

function WithdrawalsTab() {
  const [items, setItems] = useState<Withdrawal[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ ok: true; items: Withdrawal[] }>('/admin/withdrawals');
    setItems(res.items);
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(id: string) {
    setBusyId(id);
    try {
      await api.post(`/admin/withdrawals/${id}/approve`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt('اكتب سبب الرفض:');
    if (!reason) return;
    setBusyId(id);
    try {
      await api.post(`/admin/withdrawals/${id}/reject`, { reason });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (!items) return <LoadingScreen />;
  if (items.length === 0) return <p style={{ textAlign: 'center', color: 'var(--text-dim)' }}>لا توجد طلبات معلقة 🎉</p>;

  return (
    <div>
      {items.map((w) => (
        <div className="card" key={w._id}>
          <div style={{ fontWeight: 800 }}>#{w._id} · {w.prizeNameSnapshot}</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', margin: '6px 0' }}>
            {w.username ? '@' + w.username : '-'} | ID: {w.telegramId}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busyId === w._id} onClick={() => approve(w._id)}>
              ✅ قبول
            </button>
            <button className="btn btn-secondary" disabled={busyId === w._id} onClick={() => reject(w._id)}>
              ❌ رفض
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsTab() {
  const [settings, setSettings] = useState<{ maintenanceMode: boolean; shareImageUrl?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await api.get<{ ok: true; settings: { maintenanceMode: boolean; shareImageUrl?: string | null } }>(
      '/admin/settings'
    );
    setSettings(res.settings);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleMaintenance() {
    if (!settings) return;
    await api.post('/admin/settings/maintenance', { enabled: !settings.maintenanceMode });
    await load();
  }

  async function uploadShareImage(file: File) {
    setBusy(true);
    try {
      await api.upload('/admin/settings/share-image', file);
      await load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'فشل رفع الصورة');
    } finally {
      setBusy(false);
    }
  }

  async function clearShareImage() {
    setBusy(true);
    try {
      await api.del('/admin/settings/share-image');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <LoadingScreen />;

  return (
    <>
      <div className="card">
        <h3 className="card-title">🔧 وضع الصيانة</h3>
        <p className="card-sub">عند التفعيل، يمنع المستخدمون العاديون من استخدام البوت.</p>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={toggleMaintenance}>
          {settings.maintenanceMode ? 'إيقاف وضع الصيانة' : 'تفعيل وضع الصيانة'}
        </button>
      </div>

      <div className="card">
        <h3 className="card-title">📤 صورة بطاقة المشاركة</h3>
        <p className="card-sub">
          هذي الصورة تنرسل مع رسالة "ربحت جائزة" الي يبعتها البوت للمستخدم عشان يحولها لأصدقائه. إذا ما حطيت صورة، تنرسل الرسالة نص بس.
        </p>
        {settings.shareImageUrl && (
          <img
            src={settings.shareImageUrl}
            alt=""
            style={{ width: '100%', maxWidth: 260, borderRadius: 12, margin: '10px 0', display: 'block' }}
          />
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <label className="btn btn-secondary" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {settings.shareImageUrl ? '📷 تغيير الصورة' : '📷 رفع صورة'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) uploadShareImage(file);
              }}
            />
          </label>
          {settings.shareImageUrl && (
            <button className="btn btn-secondary" disabled={busy} onClick={clearShareImage}>
              🗑 حذف الصورة
            </button>
          )}
        </div>
      </div>

      <DuplicatePrizesCard />
      <ResetGameStateCard />
    </>
  );
}

interface DuplicatePrizeDoc {
  id: string;
  name: string;
  stock: number;
  isActive: boolean;
  updatedAt: string;
}
interface DuplicatePrizeReport {
  key: string;
  docs: DuplicatePrizeDoc[];
}

function DuplicatePrizesCard() {
  const [checking, setChecking] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicatePrizeReport[] | null>(null);
  const [fixedSummary, setFixedSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setError(null);
    setFixedSummary(null);
    try {
      const res = await api.get<{ ok: true; duplicates: DuplicatePrizeReport[] }>('/admin/prizes/check-duplicates');
      setDuplicates(res.duplicates);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل الفحص');
    } finally {
      setChecking(false);
    }
  }

  async function fix() {
    if (!window.confirm('هذا يدمج كل جائزة مكررة بنسخة وحدة (يحتفظ بأحدث تعديل ويجمع المخزون)، ويحذف الباقي. متأكد؟')) return;
    setFixing(true);
    setError(null);
    try {
      const res = await api.post<{ ok: true; results: { key: string; deletedCount: number }[] }>('/admin/prizes/fix-duplicates');
      setFixedSummary(`✅ تم إصلاح ${res.results.length} جائزة مكررة.`);
      setDuplicates([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل الإصلاح');
    } finally {
      setFixing(false);
    }
  }

  return (
    <div className="card">
      <h3 className="card-title">🔍 فحص تكرار الجوائز</h3>
      <p className="card-sub">
        إذا صار خطأ بإنشاء الفهرس الفريد بالماضي، ممكن يصير عندك نسختين من نفس الجائزة بقاعدة
        البيانات — وهذا يسبب "العجلة تعرض جائزة والحقيبة تعطي جائزة ثانية". هذا الفحص آمن 100%
        (قراءة بس، ما يغير شي إلا إذا ضغطت "إصلاح").
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-secondary" disabled={checking} onClick={check}>
          {checking ? 'جاري الفحص...' : '🔍 فحص الآن'}
        </button>
        {duplicates && duplicates.length > 0 && (
          <button className="btn" style={{ background: 'var(--danger)', color: '#fff' }} disabled={fixing} onClick={fix}>
            {fixing ? 'جاري الإصلاح...' : `⚠️ إصلاح ${duplicates.length} جائزة مكررة`}
          </button>
        )}
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</p>}
      {fixedSummary && <p style={{ color: 'var(--success)', fontSize: 13, marginTop: 10 }}>{fixedSummary}</p>}

      {duplicates !== null && duplicates.length === 0 && !fixedSummary && (
        <p style={{ color: 'var(--success)', fontSize: 13, marginTop: 10 }}>✅ ماكو تكرار — هذا مو سبب المشكلة.</p>
      )}

      {duplicates && duplicates.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {duplicates.map((d) => (
            <div key={d.key} style={{ marginBottom: 10, fontSize: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>🔑 {d.key}</div>
              {d.docs.map((doc) => (
                <div key={doc.id} style={{ color: 'var(--text-dim)', paddingRight: 10 }}>
                  • {doc.name} — مخزون: {doc.stock} — {doc.isActive ? 'مفعّلة' : 'موقوفة'} — آخر تعديل:{' '}
                  {new Date(doc.updatedAt).toLocaleString('ar-EG')}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResetGameStateCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doReset() {
    const step1 = window.confirm(
      'هل انت متأكد؟\n\nهذا الإجراء يمسح نهائياً:\n• جوائز كل المستخدمين الموجودة بالمخزون\n• عدد فرات كل شخص (يرجع للصفر)\n• كل الإحالات وطلبات السحب وسجل الفرات\n\nولا يلمس: الجوائز نفسها (الأسماء والصور والنسب والمخزون بالمتجر) ولا الإعدادات.\n\nهذا الإجراء لا يمكن التراجع عنه!'
    );
    if (!step1) return;

    const typed = window.prompt('اكتب كلمة RESET بالضبط (حروف إنجليزية كبيرة) عشان تأكد:');
    if (typed !== 'RESET') {
      if (typed !== null) window.alert('ما طابقت الكلمة المطلوبة — تم الإلغاء، ما انمسح أي شي.');
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{ ok: true; summary: Record<string, number> }>('/admin/reset-game-state', {
        confirm: 'RESET',
      });
      setResult(res.summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل تنفيذ إعادة التصفير');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--danger)' }}>
      <h3 className="card-title" style={{ color: 'var(--danger)' }}>
        ⚠️ إعادة تصفير البوت
      </h3>
      <p className="card-sub">
        يمسح جوائز المستخدمين، عدد الفرات، والإحالات — بدون ما يلمس الجوائز نفسها (الصور، الأسماء،
        النسب، أسعار المتجر). إجراء خطير وما ينرجع.
      </p>
      <button
        className="btn"
        style={{ marginTop: 12, background: 'var(--danger)', color: '#fff' }}
        disabled={busy}
        onClick={doReset}
      >
        {busy ? 'جاري التصفير...' : '⚠️ إعادة تصفير كامل'}
      </button>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim)' }}>
          ✅ تم: حذف {result.userPrizesDeleted} جائزة من المخزونات، {result.referralsDeleted} إحالة،{' '}
          {result.withdrawalsDeleted} طلب سحب، {result.spinsDeleted} سجل فرة — وصفّر {result.usersReset} مستخدم.
        </div>
      )}
    </div>
  );
}

type BroadcastScope = 'all' | 'channels' | 'direct';
interface BroadcastButtonForm {
  text: string;
  url: string;
}
interface BroadcastResult {
  sent: number;
  failed: number;
  blocked: number;
  total: number;
}

function BroadcastTab() {
  const [scope, setScope] = useState<BroadcastScope>('all');
  const [message, setMessage] = useState('');
  const [directIds, setDirectIds] = useState('');
  const [buttons, setButtons] = useState<BroadcastButtonForm[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addButton() {
    if (buttons.length >= 5) return;
    setButtons([...buttons, { text: '', url: '' }]);
  }

  function updateButton(i: number, field: 'text' | 'url', value: string) {
    setButtons(buttons.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)));
  }

  function removeButton(i: number) {
    setButtons(buttons.filter((_, idx) => idx !== i));
  }

  async function send() {
    setError(null);
    setResult(null);

    if (!message.trim()) {
      setError('اكتب محتوى الرسالة أولاً.');
      return;
    }
    let telegramIds: number[] | undefined;
    if (scope === 'direct') {
      telegramIds = directIds
        .split(/[\s,]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (telegramIds.length === 0) {
        setError('اكتب آيديات تليجرام صحيحة (وحدة أو أكثر، مفصولة بفاصلة أو سطر جديد).');
        return;
      }
    }
    const validButtons = buttons.filter((b) => b.text.trim() && b.url.trim()).map((b) => ({ text: b.text.trim(), url: b.url.trim() }));

    const scopeLabel = scope === 'all' ? 'كل المستخدمين' : scope === 'channels' ? 'القنوات والكروبات' : `${telegramIds!.length} مستخدم محدد`;
    if (!window.confirm(`تأكيد إرسال الإذاعة إلى: ${scopeLabel}؟`)) return;

    setSending(true);
    try {
      const res = await api.post<{ ok: true; result: BroadcastResult }>('/admin/broadcast', {
        message: message.trim(),
        scope,
        telegramIds,
        buttons: validButtons.length > 0 ? validButtons : undefined,
      });
      setResult(res.result);
      setMessage('');
      setButtons([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل إرسال الإذاعة');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card">
      <h3 className="card-title">📣 إذاعة جديدة</h3>

      <label style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 6, marginTop: 10 }}>
        لمن تريد إرسال الإذاعة؟
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['all', 'channels', 'direct'] as BroadcastScope[]).map((s) => (
          <button
            key={s}
            className="pill"
            style={{ cursor: 'pointer', border: 'none', background: scope === s ? 'var(--accent)' : undefined }}
            onClick={() => setScope(s)}
          >
            {s === 'all' ? '👥 الكل' : s === 'channels' ? '📢 القنوات والكروبات' : '👤 مستخدمين محددين'}
          </button>
        ))}
      </div>

      {scope === 'direct' && (
        <textarea
          placeholder="آيديات تليجرام، وحدة بكل سطر أو مفصولة بفاصلة"
          value={directIds}
          onChange={(e) => setDirectIds(e.target.value)}
          style={{ ...inputStyle, minHeight: 70, marginBottom: 12 }}
        />
      )}

      <label style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 6 }}>محتوى الرسالة</label>
      <textarea
        placeholder="اكتب محتوى الرسالة..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        style={{ ...inputStyle, minHeight: 110, marginBottom: 12 }}
      />

      <label style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 6 }}>
        أزرار (اختياري — حتى 5 أزرار)
      </label>
      {buttons.map((b, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            placeholder="اسم الزر"
            value={b.text}
            onChange={(e) => updateButton(i, 'text', e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            placeholder="الرابط"
            value={b.url}
            onChange={(e) => updateButton(i, 'url', e.target.value)}
            style={{ ...inputStyle, flex: 2 }}
          />
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '0 12px' }} onClick={() => removeButton(i)}>
            ✕
          </button>
        </div>
      ))}
      {buttons.length < 5 && (
        <button className="btn btn-secondary" style={{ marginBottom: 12 }} onClick={addButton}>
          ➕ إضافة زر
        </button>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      <button className="btn btn-primary" disabled={sending} onClick={send} style={{ marginTop: 8 }}>
        {sending ? 'جاري الإرسال...' : '🚀 إرسال الإذاعة'}
      </button>

      {result && (
        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-dim)' }}>
          ✅ تم الإرسال: {result.sent} | ❌ فشل: {result.failed} | 🚫 محظور/حظر البوت: {result.blocked} | الإجمالي: {result.total}
        </div>
      )}
    </div>
  );
}

interface DashboardStats {
  users: { total: number; newToday: number; newThisWeek: number; newThisMonth: number; banned: number };
  spins: { total: number };
  points: {
    available: number;
    spent: number;
    topUsers: Array<{ telegramId: number; username?: string; firstName?: string; points: number }>;
  };
  wheels: { daily: number; points: number };
  prizes: {
    delivered: number;
    pending: number;
    expired: number;
    perPrize: Array<{ key: string; name: string; stock: number | string; delivered: number; pending: number; isActive: boolean }>;
  };
  referrals: { total: number; qualified: number; rejected: number };
  withdrawals: { pending: number; approved: number; delivered: number; rejected: number };
  channels: number;
  developers: number;
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 900 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    api.get<{ ok: true; stats: DashboardStats }>('/admin/stats').then((res) => setStats(res.stats));
  }, []);

  if (!stats) return <LoadingScreen />;

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 } as const;

  return (
    <>
      <div className="card">
        <h3 className="card-title">🪙 النقاط والعجلات</h3>
        <div style={grid}>
          <StatBox label="النقاط الموجودة" value={stats.points.available} />
          <StatBox label="النقاط المصروفة" value={stats.points.spent} />
          <StatBox label="العجلة اليومية" value={stats.wheels.daily} />
          <StatBox label="عجلة النقاط" value={stats.wheels.points} />
          <StatBox label="كل العجلات" value={stats.spins.total} />
        </div>
        <h4 style={{ marginBottom: 8 }}>🏆 أكثر المستخدمين نقاطاً</h4>
        {stats.points.topUsers.map((user, index) => (
          <div className="list-item" key={user.telegramId}>
            <span>#{index + 1} {user.username ? '@' + user.username : user.firstName || user.telegramId}</span>
            <strong>{user.points} نقطة</strong>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="card-title">👥 المستخدمون</h3>
        <div style={grid}>
          <StatBox label="الإجمالي" value={stats.users.total} />
          <StatBox label="جدد اليوم" value={stats.users.newToday} />
          <StatBox label="هذا الأسبوع" value={stats.users.newThisWeek} />
          <StatBox label="هذا الشهر" value={stats.users.newThisMonth} />
          <StatBox label="محظورين" value={stats.users.banned} />
          <StatBox label="السحبات" value={stats.spins.total} />
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">🎁 الجوائز</h3>
        <div style={grid}>
          <StatBox label="مُسلَّمة" value={stats.prizes.delivered} />
          <StatBox label="قيد التحضير" value={stats.prizes.pending} />
          <StatBox label="منتهية" value={stats.prizes.expired} />
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">👥 الإحالات</h3>
        <div style={grid}>
          <StatBox label="الإجمالي" value={stats.referrals.total} />
          <StatBox label="مؤهلة" value={stats.referrals.qualified} />
          <StatBox label="مرفوضة" value={stats.referrals.rejected} />
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">📋 طلبات السحب</h3>
        <div style={grid}>
          <StatBox label="معلقة" value={stats.withdrawals.pending} />
          <StatBox label="مقبولة" value={stats.withdrawals.approved} />
          <StatBox label="تم تسليمها" value={stats.withdrawals.delivered} />
          <StatBox label="مرفوضة" value={stats.withdrawals.rejected} />
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">⚙️ عام</h3>
        <div style={grid}>
          <StatBox label="القنوات والكروبات" value={stats.channels} />
          <StatBox label="المطورين" value={stats.developers} />
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">📦 مخزون كل جائزة</h3>
        {stats.prizes.perPrize.map((p) => (
          <div className="list-item" key={p.key}>
            <span>
              {p.name} {!p.isActive && <span style={{ color: 'var(--danger)', fontSize: 11 }}>(موقوفة)</span>}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              مخزون: {p.stock} | مُسلَّم: {p.delivered} | قيد التحضير: {p.pending}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
