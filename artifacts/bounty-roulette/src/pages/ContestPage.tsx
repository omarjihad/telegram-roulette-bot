import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../services/api';
import { ContestResponse } from '../types';
import { LoadingScreen } from '../components/Common';
import { useCachedFetch, invalidateCache } from '../hooks/useCachedFetch';
import { getTelegramWebApp, haptic } from '../hooks/useTelegramWebApp';
import { useCountdown } from '../hooks/useCountdown';

const READ_SECONDS = 7;

function openLink(url: string) {
  const tg = getTelegramWebApp();
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

function openProfile(link: string | null) {
  if (!link) return;
  if (link.startsWith('https://t.me/')) openLink(link);
  // No @username: best effort by numeric ID through Telegram's own URI scheme.
  else window.location.href = link;
}

function RaceStatus({ data }: { data: ContestResponse }) {
  const { label: raw } = useCountdown(data.endsAt);
  const [hh, mm, ss] = raw.split(':');
  const units = [
    { value: String(Math.floor(Number(hh) / 24)), label: 'يوم' },
    { value: String(Number(hh) % 24).padStart(2, '0'), label: 'ساعة' },
    { value: mm, label: 'دقيقة' },
    { value: ss, label: 'ثانية' },
  ];
  if (data.winner) {
    return (
      <div className="race-status race-status-ended">
        <div className="race-status-title">🏁 انتهى السباق</div>
        <div>
          🏆 الفائز: <bdi>{data.winner.name}</bdi> بـ {data.winner.score} دعوة
          {data.winner.isMe ? ' — مبروك، أنت الفائز! 🎉' : ''}
        </div>
      </div>
    );
  }
  if (data.noWinner) {
    return (
      <div className="race-status race-status-nowinner">
        <div className="race-status-title">🏁 انتهى السباق دون فائز</div>
        <div>
          {data.noWinner.reason === 'min_not_reached'
            ? `لم يصل مجموع الدعوات إلى الحد الأدنى: ${data.noWinner.totalInvites} من أصل ${data.minTotalInvites} دعوة.`
            : 'تم إنهاء السباق من قبل الإدارة.'}
        </div>
      </div>
    );
  }
  if (data.closed) {
    return (
      <div className="race-status race-status-ended">
        <div className="race-status-title">⏳ انتهى وقت السباق</div>
        <div>توقّف احتساب الدعوات، وسيُعلن الفائز قريباً.</div>
      </div>
    );
  }
  if (!data.endsAt) return null;
  return (
    <div className="race-status">
      <div className="race-status-title">⏱️ ينتهي السباق بعد</div>
      {/* One box per unit, so Arabic labels and numbers never get reordered by RTL. */}
      <div className="race-countdown">
        {units.map((unit) => (
          <div className="race-unit" key={unit.label}>
            <strong>{unit.value}</strong>
            <span>{unit.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TotalProgress({ data }: { data: ContestResponse }) {
  const pct = Math.min(100, (data.totalInvites / Math.max(1, data.minTotalInvites)) * 100);
  const reached = data.totalInvites >= data.minTotalInvites;
  return (
    <div className="race-total">
      <div className="race-total-head">
        <span>🎯 مجموع دعوات المتسابقين</span>
        <strong>{data.totalInvites} من {data.minTotalInvites}</strong>
      </div>
      <div className="task-progress-track race-total-track"><div className="task-progress-fill" style={{ width: `${pct}%` }} /></div>
      <div className="race-total-note">
        {reached ? '✅ تم بلوغ الحد الأدنى، وسيفوز صاحب المركز الأول.' : `يجب الوصول إلى ${data.minTotalInvites} دعوة على الأقل ليكون هناك فائز.`}
      </div>
    </div>
  );
}

function NftCard({ prize }: { prize: ContestResponse['prize'] }) {
  return (
    <div className="nft-card">
      <button className="nft-art" onClick={() => openLink(prize.nftUrl)} aria-label="عرض الهدية">
        <img src={prize.imageUrl} alt={prize.name} />
        <span className="nft-badge">🏆 جائزة المركز الأول</span>
      </button>
      <div className="nft-body">
        <div className="nft-title">
          {prize.name} <span>{prize.number}</span>
        </div>
        <div className="nft-sub">هدية NFT حقيقية على تيليجرام · القيمة <bdi>{prize.valueUsd}</bdi></div>
        <div className="nft-attrs">
          {prize.attributes.map((a) => (
            <div className="nft-attr" key={a.label}>
              <span className="nft-attr-label">{a.label}</span>
              <span className="nft-attr-value">{a.value}</span>
              <span className="nft-attr-rarity">{a.rarity}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => openLink(prize.nftUrl)}>🎁 عرض الهدية</button>
      </div>
    </div>
  );
}

function Intro({ data, onJoined }: { data: ContestResponse; onJoined: () => void }) {
  const [left, setLeft] = useState(READ_SECONDS);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      await api.post('/contest/join');
      haptic('medium');
      onJoined();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
      setJoining(false);
    }
  }

  return (
    <div className="contest-page">
      <div className="contest-hero">
        <div className="contest-hero-icon">🏆</div>
        <h2>سباق الدعوات</h2>
        <p>ادعُ أصدقاءك، وتصدّر القائمة، واربح هدية NFT</p>
      </div>

      <RaceStatus data={data} />
      {!data.winner && !data.noWinner && <TotalProgress data={data} />}

      <NftCard prize={data.prize} />

      <div className="card contest-explain">
        <h3 className="card-title">كيف يعمل السباق؟</h3>
        <ol className="contest-steps">
          <li><span>1</span><div><strong>سيتم إعطاؤك رابط خاص بك</strong>انشره في القنوات والمجموعات وبين أصدقائك.</div></li>
          <li><span>2</span><div><strong>كل شخص ينضم عبر رابطك = +1</strong>بشرط أن يكون جديداً، وأن يشترك في القنوات الإجبارية ويُكمل التحقق (الكابتشا).</div></li>
          <li><span>3</span><div><strong>إذا حظر البوت = −1</strong>تُحذف دعوته ويُخصم من نقاطك.</div></li>
          <li><span>4</span><div><strong>كن المتصدر واربح 🏆</strong>يفوز بالهدية صاحب المركز الأول فقط، فاحرص على أن تكون الأول.</div></li>
          <li><span>5</span><div><strong>الحد الأدنى {data.minTotalInvites} دعوة</strong>يجب أن يصل مجموع دعوات جميع المتسابقين إلى {data.minTotalInvites} دعوة على الأقل، وإلا ينتهي السباق دون فائز.</div></li>
        </ol>
      </div>

      <div className="card">
        <h3 className="card-title">📋 شروط السباق</h3>
        <ul className="contest-rules">
          {data.rules.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>

      {error && <p className="wheel-error">{error}</p>}
      <button className="btn btn-primary contest-continue" disabled={left > 0 || joining} onClick={join}>
        {left > 0 ? `اقرأ الشرح… المتابعة بعد ${left}` : joining ? 'جارٍ التحضير...' : '✅ متابعة'}
      </button>
    </div>
  );
}

function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const initial = name.replace('@', '').charAt(0).toUpperCase() || '؟';
  return photoUrl
    ? <img className="lb-avatar" src={photoUrl} alt="" />
    : <div className="lb-avatar lb-avatar-fallback">{initial}</div>;
}

function Board({ data }: { data: ContestResponse }) {
  const [toast, setToast] = useState<string | null>(null);
  const link = data.link ?? '';

  function copy() {
    navigator.clipboard?.writeText(link).then(
      () => setToast('✅ تم نسخ الرابط'),
      () => setToast('انسخ الرابط يدوياً'),
    );
    window.setTimeout(() => setToast(null), 2000);
  }

  function share() {
    const text = `🏆 ادخل البوت من رابطي وساعدني أربح هدية ${data.prize.name} NFT!`;
    openLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  }

  const [first, ...rest] = data.leaderboard;

  return (
    <div className="contest-page">
      <div className="contest-hero contest-hero-small">
        <div className="contest-hero-icon">🏆</div>
        <h2>سباق الدعوات</h2>
        <p>{data.participants} متسابق · يفوز صاحب المركز الأول فقط</p>
      </div>

      <RaceStatus data={data} />
      {!data.winner && !data.noWinner && <TotalProgress data={data} />}

      <NftCard prize={data.prize} />

      <div className="card contest-me">
        <div className="contest-me-stats">
          <div><span>نقاطك</span><strong>{data.myScore}</strong></div>
          <div><span>ترتيبك</span><strong>{data.myRank ? `#${data.myRank}` : '—'}</strong></div>
          <div><span>بالانتظار</span><strong>{data.myPending}</strong></div>
        </div>
        <div className="contest-link-label">🔗 رابطك الخاص</div>
        <div className="contest-link">{link || 'الرابط غير متوفر حالياً'}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={copy} disabled={!link}>📋 نسخ</button>
          <button className="btn btn-primary" onClick={share} disabled={!link}>📤 مشاركة</button>
        </div>
        {data.myPending > 0 && (
          <p className="contest-note">⏳ {data.myPending} شخص انضم عبر رابطك ولم يُكمل الاشتراك أو التحقق بعد.</p>
        )}
      </div>

      <div className="card leaderboard">
        <h3 className="card-title">🏅 المتصدرين (أول 25)</h3>
        <p className="card-sub" style={{ marginTop: 0 }}>اضغط على أي متسابق لفتح حسابه</p>
        {!first ? (
          <p className="card-sub" style={{ textAlign: 'center', padding: '12px 0' }}>لا يوجد متسابقون بعد، كن أول من يتصدّر! 🚀</p>
        ) : (
          <>
            <button className={`lb-leader ${first.isMe ? 'lb-me' : ''}`} onClick={() => openProfile(first.profileLink)}>
              <div className="lb-crown">👑</div>
              <Avatar name={first.name} photoUrl={first.photoUrl} />
              <div className="lb-leader-name"><bdi>{first.name}</bdi>{first.isMe ? ' (أنت)' : ''}</div>
              <div className="lb-leader-score">{first.score} دعوة</div>
              <div className="lb-leader-tag">
                {data.winner ? `🏆 فاز بـ ${data.prize.name}` : data.noWinner ? '🥇 المركز الأول' : `🏆 في طريقه لربح ${data.prize.name}`}
              </div>
            </button>
            <div className="lb-list">
              {rest.map((row) => (
                <button key={row.rank} className={`lb-row lb-rank-${row.rank} ${row.isMe ? 'lb-me' : ''}`} onClick={() => openProfile(row.profileLink)}>
                  <span className="lb-rank">{row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}</span>
                  <Avatar name={row.name} photoUrl={row.photoUrl} />
                  <span className="lb-name"><bdi>{row.name}</bdi>{row.isMe ? ' (أنت)' : ''}</span>
                  <span className="lb-score">{row.score}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3 className="card-title">📋 شروط السباق</h3>
        <ul className="contest-rules">
          {data.rules.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export function ContestPage() {
  const { data, error, refetch } = useCachedFetch<ContestResponse>('contest', () => api.get<ContestResponse>('/contest'));

  if (!data && error) return <LoadingScreen label="تعذر التحميل، حاول لاحقاً" />;
  if (!data) return <LoadingScreen />;
  if (!data.joined) {
    return (
      <Intro
        data={data}
        onJoined={() => {
          invalidateCache('contest');
          void refetch();
        }}
      />
    );
  }
  return <Board data={data} />;
}
