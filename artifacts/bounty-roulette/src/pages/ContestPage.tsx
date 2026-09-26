import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../services/api';
import { ContestResponse } from '../types';
import { LoadingScreen } from '../components/Common';
import { useCachedFetch, invalidateCache } from '../hooks/useCachedFetch';
import { getTelegramWebApp, haptic } from '../hooks/useTelegramWebApp';

const READ_SECONDS = 7;

function openLink(url: string) {
  const tg = getTelegramWebApp();
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
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
        <p>ادعُ أصدقاءك، تصدّر القائمة، واربح هدية NFT</p>
      </div>

      <NftCard prize={data.prize} />

      <div className="card contest-explain">
        <h3 className="card-title">شلون يشتغل السباق؟</h3>
        <ol className="contest-steps">
          <li><span>1</span><div><strong>راح ينعطيك رابط خاص بيك</strong>انشره بالقنوات والكروبات ولأصدقائك.</div></li>
          <li><span>2</span><div><strong>كل شخص يدخل من رابطك = +1</strong>بشرط يكون جديد، ويشترك بالقنوات الإجبارية ويكمل الكابتشا.</div></li>
          <li><span>3</span><div><strong>إذا حظر البوت = −1</strong>دعوته تنحذف وتنقص من نقاطك.</div></li>
          <li><span>4</span><div><strong>كن المتصدر واربح 🏆</strong>المركز الأول فقط يربح الهدية، فحاول تكون رقم 1.</div></li>
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
        {left > 0 ? `اقرأ الشرح… متابعة بعد ${left}` : joining ? 'جاري التحضير...' : '✅ متابعة'}
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
        <p>{data.participants} متسابق · المركز الأول فقط يربح</p>
      </div>

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
          <p className="contest-note">⏳ {data.myPending} شخص دخل من رابطك وبعده ما كمّل الاشتراك أو الكابتشا.</p>
        )}
      </div>

      <div className="card leaderboard">
        <h3 className="card-title">🏅 المتصدرين (أول 25)</h3>
        {!first ? (
          <p className="card-sub" style={{ textAlign: 'center', padding: '12px 0' }}>ماكو متسابقين بعد، كن أول واحد يتصدر! 🚀</p>
        ) : (
          <>
            <div className={`lb-leader ${first.isMe ? 'lb-me' : ''}`}>
              <div className="lb-crown">👑</div>
              <Avatar name={first.name} photoUrl={first.photoUrl} />
              <div className="lb-leader-name"><bdi>{first.name}</bdi>{first.isMe ? ' (أنت)' : ''}</div>
              <div className="lb-leader-score">{first.score} دعوة</div>
              <div className="lb-leader-tag">🏆 يربح {data.prize.name} حالياً</div>
            </div>
            <div className="lb-list">
              {rest.map((row) => (
                <div key={row.rank} className={`lb-row lb-rank-${row.rank} ${row.isMe ? 'lb-me' : ''}`}>
                  <span className="lb-rank">{row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}</span>
                  <Avatar name={row.name} photoUrl={row.photoUrl} />
                  <span className="lb-name"><bdi>{row.name}</bdi>{row.isMe ? ' (أنت)' : ''}</span>
                  <span className="lb-score">{row.score}</span>
                </div>
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
