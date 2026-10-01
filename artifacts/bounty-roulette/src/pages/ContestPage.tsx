import React, { useEffect, useState } from 'react';
import { tr } from '../i18n';
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
    { value: String(Math.floor(Number(hh) / 24)), label: tr('يوم', 'days') },
    { value: String(Number(hh) % 24).padStart(2, '0'), label: tr('ساعة', 'hours') },
    { value: mm, label: tr('دقيقة', 'min') },
    { value: ss, label: tr('ثانية', 'sec') },
  ];
  if (data.winner) {
    return (
      <div className="race-status race-status-ended">
        <div className="race-status-title">{tr('🏁 انتهى السباق', '🏁 The race is over')}</div>
        <div>
          {tr('🏆 الفائز:', '🏆 Winner:')} <bdi>{data.winner.name}</bdi> {tr(`بـ ${data.winner.score} دعوة`, `with ${data.winner.score} invites`)}
          {data.winner.isMe ? tr(' — مبروك، أنت الفائز! 🎉', ' — congratulations, you won! 🎉') : ''}
        </div>
      </div>
    );
  }
  if (data.noWinner) {
    return (
      <div className="race-status race-status-nowinner">
        <div className="race-status-title">{tr('🏁 انتهى السباق دون فائز', '🏁 The race ended with no winner')}</div>
        <div>
          {data.noWinner.reason === 'min_not_reached'
            ? tr(`لم يصل مجموع الدعوات إلى الحد الأدنى: ${data.noWinner.totalInvites} من أصل ${data.minTotalInvites} دعوة.`, `Total invites didn’t reach the minimum: ${data.noWinner.totalInvites} of ${data.minTotalInvites}.`)
            : tr('تم إنهاء السباق من قبل الإدارة.', 'The race was ended by the admins.')}
        </div>
      </div>
    );
  }
  if (data.closed) {
    return (
      <div className="race-status race-status-ended">
        <div className="race-status-title">{tr('⏳ انتهى وقت السباق', '⏳ Race time is up')}</div>
        <div>{tr('توقّف احتساب الدعوات، وسيُعلن الفائز قريباً.', 'Invites no longer count; the winner will be announced soon.')}</div>
      </div>
    );
  }
  if (!data.endsAt) return null;
  return (
    <div className="race-status">
      <div className="race-status-title">{tr('⏱️ ينتهي السباق بعد', '⏱️ The race ends in')}</div>
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
        <span>{tr('🎯 مجموع دعوات المتسابقين', '🎯 Total invites, all contestants')}</span>
        <strong>{data.totalInvites} {tr('من', 'of')} {data.minTotalInvites}</strong>
      </div>
      <div className="task-progress-track race-total-track"><div className="task-progress-fill" style={{ width: `${pct}%` }} /></div>
      <div className="race-total-note">
        {reached ? tr('✅ تم بلوغ الحد الأدنى، وسيفوز صاحب المركز الأول.', '✅ Minimum reached — first place will win.') : tr(`يجب الوصول إلى ${data.minTotalInvites} دعوة على الأقل ليكون هناك فائز.`, `At least ${data.minTotalInvites} invites are needed for there to be a winner.`)}
      </div>
    </div>
  );
}

function NftCard({ prize }: { prize: ContestResponse['prize'] }) {
  return (
    <div className="nft-card">
      <button className="nft-art" onClick={() => openLink(prize.nftUrl)} aria-label={tr('عرض الهدية', 'View the gift')}>
        <img src={prize.imageUrl} alt={prize.name} />
        <span className="nft-badge">{tr('🏆 جائزة المركز الأول', '🏆 First-place prize')}</span>
      </button>
      <div className="nft-body">
        <div className="nft-title">
          {prize.name} <span>{prize.number}</span>
        </div>
        <div className="nft-sub">{tr('هدية NFT حقيقية على تيليجرام · القيمة', 'A real Telegram NFT gift · value')} <bdi>{prize.valueUsd}</bdi></div>
        <div className="nft-attrs">
          {prize.attributes.map((a) => (
            <div className="nft-attr" key={a.label}>
              <span className="nft-attr-label">{a.label}</span>
              <span className="nft-attr-value">{a.value}</span>
              <span className="nft-attr-rarity">{a.rarity}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => openLink(prize.nftUrl)}>{tr('🎁 عرض الهدية', '🎁 View the gift')}</button>
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
      setError(err instanceof ApiError ? err.message : tr('صار خطأ، حاول مرة ثانية.', 'Something went wrong, please try again.'));
      setJoining(false);
    }
  }

  return (
    <div className="contest-page">
      <div className="contest-hero">
        <div className="contest-hero-icon">🏆</div>
        <h2>{tr('سباق الدعوات', 'Invite race')}</h2>
        <p>{tr('ادعُ أصدقاءك، وتصدّر القائمة، واربح هدية NFT', 'Invite friends, top the leaderboard and win an NFT gift')}</p>
      </div>

      <RaceStatus data={data} />
      {!data.winner && !data.noWinner && <TotalProgress data={data} />}

      <NftCard prize={data.prize} />

      <div className="card contest-explain">
        <h3 className="card-title">{tr('كيف يعمل السباق؟', 'How does the race work?')}</h3>
        <ol className="contest-steps">
          <li><span>1</span><div><strong>{tr('سيتم إعطاؤك رابط خاص بك', 'You’ll get your own link')}</strong>{tr('انشره في القنوات والمجموعات وبين أصدقائك.', 'Share it in channels, groups and with friends.')}</div></li>
          <li><span>2</span><div><strong>{tr('كل شخص ينضم عبر رابطك = +1', 'Everyone who joins through your link = +1')}</strong>{tr('بشرط أن يكون جديداً، وأن يشترك في القنوات الإجبارية ويُكمل التحقق (الكابتشا).', 'As long as they’re new, join the required channels and pass the check (captcha).')}</div></li>
          <li><span>3</span><div><strong>{tr('إذا حظر البوت = −1', 'If they block the bot = −1')}</strong>{tr('تُحذف دعوته ويُخصم من نقاطك.', 'Their invite is removed from your score.')}</div></li>
          <li><span>4</span><div><strong>{tr('كن المتصدر واربح 🏆', 'Be first and win 🏆')}</strong>{tr('يفوز بالهدية صاحب المركز الأول فقط، فاحرص على أن تكون الأول.', 'Only first place wins the gift, so aim for the top.')}</div></li>
          <li><span>5</span><div><strong>{tr(`الحد الأدنى ${data.minTotalInvites} دعوة`, `Minimum ${data.minTotalInvites} invites`)}</strong>{tr(`يجب أن يصل مجموع دعوات جميع المتسابقين إلى ${data.minTotalInvites} دعوة على الأقل، وإلا ينتهي السباق دون فائز.`, `All contestants together must reach at least ${data.minTotalInvites} invites, otherwise the race ends with no winner.`)}</div></li>
        </ol>
      </div>

      <div className="card">
        <h3 className="card-title">{tr('📋 شروط السباق', '📋 Race rules')}</h3>
        <ul className="contest-rules">
          {data.rules.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>

      {error && <p className="wheel-error">{error}</p>}
      <button className="btn btn-primary contest-continue" disabled={left > 0 || joining} onClick={join}>
        {left > 0 ? tr(`اقرأ الشرح… المتابعة بعد ${left}`, `Read the rules… continue in ${left}`) : joining ? tr('جارٍ التحضير...', 'Getting ready...') : tr('✅ متابعة', '✅ Continue')}
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
      () => setToast(tr('✅ تم نسخ الرابط', '✅ Link copied')),
      () => setToast(tr('انسخ الرابط يدوياً', 'Copy the link manually')),
    );
    window.setTimeout(() => setToast(null), 2000);
  }

  function share() {
    const text = tr(`🏆 ادخل البوت من رابطي وساعدني أربح هدية ${data.prize.name} NFT!`, `🏆 Join the bot through my link and help me win a ${data.prize.name} NFT!`);
    openLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  }

  const [first, ...rest] = data.leaderboard;

  return (
    <div className="contest-page">
      <div className="contest-hero contest-hero-small">
        <div className="contest-hero-icon">🏆</div>
        <h2>{tr('سباق الدعوات', 'Invite race')}</h2>
        <p>{tr(`${data.participants} متسابق · يفوز صاحب المركز الأول فقط`, `${data.participants} contestants · only first place wins`)}</p>
      </div>

      <RaceStatus data={data} />
      {!data.winner && !data.noWinner && <TotalProgress data={data} />}

      <NftCard prize={data.prize} />

      <div className="card contest-me">
        <div className="contest-me-stats">
          <div><span>{tr('نقاطك', 'Your score')}</span><strong>{data.myScore}</strong></div>
          <div><span>{tr('ترتيبك', 'Your rank')}</span><strong>{data.myRank ? `#${data.myRank}` : '—'}</strong></div>
          <div><span>{tr('بالانتظار', 'Pending')}</span><strong>{data.myPending}</strong></div>
        </div>
        <div className="contest-link-label">{tr('🔗 رابطك الخاص', '🔗 Your personal link')}</div>
        <div className="contest-link">{link || tr('الرابط متاح داخل تيليجرام فقط', 'Your link is available inside Telegram only')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={copy} disabled={!link}>{tr('📋 نسخ', '📋 Copy')}</button>
          <button className="btn btn-primary" onClick={share} disabled={!link}>{tr('📤 مشاركة', '📤 Share')}</button>
        </div>
        {data.myPending > 0 && (
          <p className="contest-note">⏳ {tr(`${data.myPending} شخص انضم عبر رابطك ولم يُكمل الاشتراك أو التحقق بعد.`, `${data.myPending} people joined through your link but haven’t finished the subscriptions or the check yet.`)}</p>
        )}
      </div>

      <div className="card leaderboard">
        <h3 className="card-title">{tr('🏅 المتصدرين (أول 25)', '🏅 Leaderboard (top 25)')}</h3>
        <p className="card-sub" style={{ marginTop: 0 }}>{tr('اضغط على أي متسابق لفتح حسابه', 'Tap a contestant to open their profile')}</p>
        {!first ? (
          <p className="card-sub" style={{ textAlign: 'center', padding: '12px 0' }}>{tr('لا يوجد متسابقون بعد، كن أول من يتصدّر! 🚀', 'No contestants yet — be the first to lead! 🚀')}</p>
        ) : (
          <>
            <button className={`lb-leader ${first.isMe ? 'lb-me' : ''}`} onClick={() => openProfile(first.profileLink)}>
              <div className="lb-crown">👑</div>
              <Avatar name={first.name} photoUrl={first.photoUrl} />
              <div className="lb-leader-name"><bdi>{first.name}</bdi>{first.isMe ? tr(' (أنت)', ' (you)') : ''}</div>
              <div className="lb-leader-score">{first.score} {tr('دعوة', 'invites')}</div>
              <div className="lb-leader-tag">
                {data.winner ? tr(`🏆 فاز بـ ${data.prize.name}`, `🏆 Won the ${data.prize.name}`) : data.noWinner ? tr('🥇 المركز الأول', '🥇 First place') : tr(`🏆 في طريقه لربح ${data.prize.name}`, `🏆 On track to win the ${data.prize.name}`)}
              </div>
            </button>
            <div className="lb-list">
              {rest.map((row) => (
                <button key={row.rank} className={`lb-row lb-rank-${row.rank} ${row.isMe ? 'lb-me' : ''}`} onClick={() => openProfile(row.profileLink)}>
                  <span className="lb-rank">{row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}</span>
                  <Avatar name={row.name} photoUrl={row.photoUrl} />
                  <span className="lb-name"><bdi>{row.name}</bdi>{row.isMe ? tr(' (أنت)', ' (you)') : ''}</span>
                  <span className="lb-score">{row.score}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3 className="card-title">{tr('📋 شروط السباق', '📋 Race rules')}</h3>
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

  if (!data && error) return <LoadingScreen label={tr('تعذر التحميل، حاول لاحقاً', 'Could not load, try again later')} />;
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
