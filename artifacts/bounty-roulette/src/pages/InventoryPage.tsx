import React, { useRef, useState } from 'react';
import { tr } from '../i18n';
import { api, ApiError } from '../services/api';
import { InventoryItem } from '../types';
import { LoadingScreen, EmptyState, StatusBadge, SectionHero } from '../components/Common';
import { useCountdown } from '../hooks/useCountdown';
import { haptic, getTelegramWebApp, openSharePicker } from '../hooks/useTelegramWebApp';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { DeliveryContactGate } from '../components/DeliveryContactGate';
import { claimAfterAd, showRewardedAd } from '../services/adsgram';
import { adErrorMessage } from '../components/AdTaskCard';

function ExpiryLabel({ expiresAt }: { expiresAt: string | null }) {
  const { label, isReady } = useCountdown(expiresAt);
  if (!expiresAt) return null;
  if (isReady) return <span className="expiry-chip expiry-chip-over">{tr('⌛ انتهت الصلاحية', '⌛ Expired')}</span>;
  const urgent = new Date(expiresAt).getTime() - Date.now() < 3 * 60 * 60 * 1000;
  return <span className={`expiry-chip ${urgent ? 'expiry-chip-urgent' : ''}`}>⏳ {label}</span>;
}

type Task = NonNullable<InventoryItem['task']>;

function Progress({ value, total }: { value: number; total: number }) {
  return (
    <div className="task-progress" aria-label={`${value} / ${total}`}>
      <div className="task-progress-track">
        <div className="task-progress-fill" style={{ width: `${Math.min(100, (value / Math.max(1, total)) * 100)}%` }} />
      </div>
      <span className="task-progress-count">{Math.min(value, total)}/{total}</span>
    </div>
  );
}

/**
 * Claiming a gift step by step: watch an ad, share the card with 3 friends, then invite.
 * Only the current task is explained; the next ones stay locked ("مهمة 2", "مهمة 3").
 */
function ClaimSteps({ task, onAd, adBusy, onCopy, onShare, sharing }: {
  task: Task;
  onAd: () => void;
  adBusy: boolean;
  onCopy: () => void;
  onShare: () => void;
  sharing?: boolean;
}) {
  const step = task.step ?? 1;
  const shares = task.shares ?? 0;
  const sharesRequired = task.sharesRequired ?? 3;
  if (task.status === 'expired') {
    return <div className="claim-steps-note claim-steps-expired">{tr('⌛ انتهت مهلة مهام الاستلام', '⌛ The claim tasks have expired')}</div>;
  }
  const row = (n: number, icon: string, title: string, body: React.ReactNode) => {
    const done = step > n;
    const current = step === n;
    const locked = step < n;
    // A finished task leaves the list so only what's left to do shows.
    if (done) return null;
    return (
      <div className={`claim-step ${done ? 'claim-step-done' : ''} ${current ? 'claim-step-current' : ''} ${locked ? 'claim-step-locked' : ''}`} key={n}>
        <div className="claim-step-dot">{done ? '✓' : locked ? '🔒' : n}</div>
        <div className="claim-step-main">
          <div className="claim-step-title">
            {locked ? tr(`مهمة ${n}`, `Task ${n}`) : <>{icon} {tr(`مهمة ${n}: `, `Task ${n}: `)}{title}</>}
          </div>
          {current && body}
          {locked && <div className="claim-step-hint">{tr('تنفتح بعد ما تكمل المهمة اللي قبلها', 'Unlocks after the previous task')}</div>}
        </div>
      </div>
    );
  };
  return (
    <div className="claim-steps">
      <div className="claim-steps-head">{tr('🎯 كمّل المهام حتى تستلم الجائزة', '🎯 Finish the tasks to claim this prize')}</div>
      {step > 1 && step < 4 && (
        <div className="claim-step-hint">{tr(`✅ أكملت ${step - 1} من 3 مهام`, `✅ ${step - 1} of 3 tasks done`)}</div>
      )}
      {row(1, '📺', tr('شاهد إعلان', 'Watch an ad'), (
        <button className="btn btn-primary claim-step-btn" disabled={adBusy} onClick={onAd}>
          {adBusy ? tr('جاري عرض الإعلان...', 'Showing the ad...') : tr('📺 شاهد الإعلان', '📺 Watch the ad')}
        </button>
      ))}
      {row(2, '📤', tr(`أرسل رسالة المشاركة لـ ${sharesRequired} من أصدقائك`, `Send the share message to ${sharesRequired} friends`), (
        <>
          <div className="claim-step-hint">
            {tr(
              'اضغط مشاركة واختار صديق واحد كل مرة (المحادثات الخاصة بس)، وكررها 3 مرات. كل إرسال ينحسب والعدّاد يتحدّث خلال ثواني.',
              'Tap share and pick one friend each time (private chats only), 3 times. Every send counts; the counter updates within seconds.'
            )}
          </div>
          <Progress value={shares} total={sharesRequired} />
          <button className="btn btn-primary claim-step-btn" onClick={onShare} disabled={sharing}>
            {sharing ? tr('📤 جاري التجهيز...', '📤 Preparing...') : tr('📤 مشاركة مع أصدقائي', '📤 Share with my friends')}
          </button>
        </>
      ))}
      {row(3, '👥', tr(`ادعُ ${task.requiredCount} أشخاص برابطك`, `Invite ${task.requiredCount} people with your link`), (
        <>
          <div className="claim-step-hint">{tr('كل شخص يدخل البوت من رابطك ويكمل الاشتراك ينحسب.', 'Everyone who joins the bot through your link and completes sign-up counts.')}</div>
          <Progress value={task.creditedCount} total={task.requiredCount} />
          {task.link && (
            <>
              <div className="claim-step-link" dir="ltr">{task.link}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary claim-step-btn" onClick={onCopy}>{tr('📋 نسخ', '📋 Copy')}</button>
                <button className="btn btn-primary claim-step-btn" onClick={onShare} disabled={sharing}>{tr('📤 مشاركة', '📤 Share')}</button>
              </div>
            </>
          )}
        </>
      ))}
      {step >= 4 && <div className="claim-steps-note">{tr('✅ أكملت كل المهام، تگدر تستلم الجائزة الحين', '✅ All tasks done — you can claim the prize now')}</div>}
    </div>
  );
}

function TaskProgress({ task, onCopy, onShare, sharing }: {
  task: Task;
  onCopy: () => void;
  onShare: () => void;
  sharing?: boolean;
}) {
  if (task.status === 'completed') {
    return (
      <div style={{ marginTop: 10, fontSize: 13, color: 'var(--accent-2)' }}>
        {tr(`✅ أكملت ${task.creditedCount}/${task.requiredCount} دعوات — تكدر تستلم الجائزة الحين`, `✅ ${task.creditedCount}/${task.requiredCount} invites done — you can claim the prize now`)}
      </div>
    );
  }
  if (task.status === 'expired') {
    return <div style={{ marginTop: 10, fontSize: 13, color: 'var(--danger)' }}>{tr('⌛ انتهت مهلة مهمة الدعوات', '⌛ The invite task has expired')}</div>;
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.6 }}>
        {tr(`🎯 ادعُ ${task.requiredCount} أشخاص عن طريق رابطك الخاص بهذي الجائزة عشان تكدر تستلمها. إذا ما كملت قبل ما يخلص الوقت، الجائزة ترجع لمخزون البوت.`, `🎯 Invite ${task.requiredCount} people with this prize’s own link to claim it. If you don’t finish before time runs out, the prize goes back to the bot.`)}
      </div>
      <div className="task-progress" aria-label={`${task.creditedCount} / ${task.requiredCount}`}>
        <div className="task-progress-track">
          <div
            className="task-progress-fill"
            style={{ width: `${Math.min(100, (task.creditedCount / Math.max(1, task.requiredCount)) * 100)}%` }}
          />
        </div>
        <span className="task-progress-count">{task.creditedCount}/{task.requiredCount}</span>
      </div>
      {task.link && (
        <>
          <div
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--card-border)',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 12,
              wordBreak: 'break-all',
              marginBottom: 8,
              color: 'var(--text-dim)',
            }}
          >
            {task.link}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: 13 }} onClick={onCopy}>
              {tr('📋 نسخ', '📋 Copy')}
            </button>
            <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 13 }} onClick={onShare} disabled={sharing}>
              {sharing ? tr('📤 جاري الإرسال...', '📤 Sending...') : tr('📤 مشاركة', '📤 Share')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function InventoryPage() {
  const { data: items, error, refetch } = useCachedFetch<InventoryItem[]>('inventory', async () => {
    const res = await api.get<{ ok: true; items: InventoryItem[] }>('/inventory');
    return res.items;
  });
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deliveryItem, setDeliveryItem] = useState<InventoryItem | null>(null);

  const [sharingId, setSharingId] = useState<string | null>(null);
  const unansweredShare = useRef<{ userPrizeId: string; preparedId: string } | null>(null);
  const [adId, setAdId] = useState<string | null>(null);

  async function watchAd(item: InventoryItem) {
    if (!item.task || adId) return;
    setAdId(item.id);
    try {
      await showRewardedAd(item.task.adBlockId || '');
      await claimAfterAd('/inventory/claim-steps/ad', { userPrizeId: item.id });
      haptic('medium');
      setToast(tr('✅ تمت المهمة الأولى', '✅ First task done'));
      await refetch();
    } catch (err) {
      setToast(adErrorMessage(err));
    } finally {
      setAdId(null);
    }
  }

  function copyLink(link: string) {
    navigator.clipboard?.writeText(link).then(() => {
      setToast(tr('تم نسخ الرابط ✅', 'Link copied ✅'));
      haptic('light');
    });
  }

  function reportShare(userPrizeId: string, preparedMessageId: string) {
    // Counts toward the "share with friends" task; Telegram's own report may add more.
    void api
      .post('/inventory/claim-steps/share-sent', { userPrizeId, preparedMessageId })
      .catch(() => undefined)
      .finally(() => {
        void refetch();
        window.setTimeout(() => void refetch(), 2500);
      });
  }

  async function shareLink(userPrizeId: string) {
    setSharingId(userPrizeId);
    haptic('light');
    try {
      const res = await api.post<{ ok: true; preparedMessageId: string }>('/inventory/share-card', { userPrizeId });
      const tg = getTelegramWebApp();
      if (!tg?.shareMessage) {
        setToast(tr('نسخة تيليجرام عندك قديمة وما تدعم المشاركة المباشرة، حدّث التطبيق وجرب مرة ثانية.', 'Your Telegram version is too old for direct sharing. Update the app and try again.'));
        return;
      }
      // A previous share Telegram never answered for (some apps don't) counts now.
      const previous = unansweredShare.current;
      if (previous) {
        unansweredShare.current = null;
        reportShare(previous.userPrizeId, previous.preparedId);
      }
      const preparedId = res.preparedMessageId;
      unansweredShare.current = { userPrizeId, preparedId };
      void openSharePicker(preparedId).then((sent) => {
        if (unansweredShare.current?.preparedId !== preparedId) return;
        unansweredShare.current = null;
        // null: Telegram never answered; the window most likely went out, so it counts.
        if (sent !== false) {
          setToast(tr('تم إرسال الجائزة ✅', 'Prize sent ✅'));
          haptic('light');
          reportShare(userPrizeId, preparedId);
        }
      });
    } catch (err) {
      setToast(
        err instanceof ApiError && err.code !== 'SEND_FAILED' && err.code !== 'UNKNOWN'
          ? err.message
          : tr('تعذر تجهيز بطاقة المشاركة، حاول مرة ثانية.', 'Could not prepare the share card, please try again.')
      );
    } finally {
      setSharingId(null);
    }
  }

  async function claim(item: InventoryItem) {
    setClaimingId(item.id);
    haptic('light');
    try {
      await api.post('/inventory/claim', { userPrizeId: item.id });
      setToast(tr('تم إرسال طلب الاستلام، بانتظار المراجعة ⏳', 'Claim request sent, awaiting review ⏳'));
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'EXPIRED') setToast(tr('عذراً، انتهت صلاحية هذه الجائزة.', 'Sorry, this prize has expired.'));
        else if (err.code === 'ALREADY_REQUESTED') setToast(tr('تم إرسال الطلب مسبقاً.', 'The request was already sent.'));
        else if (err.code === 'REFERRALS_REQUIRED') setToast(tr('لازم تكمل عدد الدعوات المطلوب أولاً.', 'You need to complete the required invites first.'));
        else if (err.code === 'TELEGRAM_ONLY') setToast(err.message);
        else if (err.code === 'DELIVERY_CONTACT_REQUIRED') {
          setDeliveryItem(item);
        }
        else setToast(tr('صار خطأ، حاول مرة ثانية.', 'Something went wrong, please try again.'));
      } else {
        setToast(tr('صار خطأ، حاول مرة ثانية.', 'Something went wrong, please try again.'));
      }
    } finally {
      setClaimingId(null);
    }
  }

  if (!items && error) return <LoadingScreen label={tr('تعذر التحميل، حاول لاحقاً', 'Could not load, try again later')} />;
  if (!items) return <LoadingScreen />;
  if (deliveryItem) {
    return (
      <DeliveryContactGate
        onBack={() => setDeliveryItem(null)}
        onVerified={() => {
          const itemToRetry = deliveryItem;
          setDeliveryItem(null);
          void claim(itemToRetry);
        }}
      />
    );
  }

  return (
    <div>
      <SectionHero art="inventory" title={tr('🎒 المخزون', '🎒 Inventory')} subtitle={tr('جوائزك هنا: كمّل مهامها واستلمها قبل ما تنتهي', 'Your prizes: finish their tasks and claim them before they expire')} />

      {items.length === 0 && (
        <EmptyState icon="🎒" title={tr('حقيبتك فارغة حالياً', 'Your inventory is empty')} subtitle={tr('روح للفرة المجانية ودور عشان تربح جوائز', 'Go to the free spin and spin to win prizes')} />
      )}

      {items.map((item) => {
        const canClaim = item.status === 'active' && (!item.task || item.task.status === 'completed');
        return (
          <div className={`card inventory-card ${item.status === 'active' ? 'inventory-card-active' : ''}`} key={item.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="inventory-prize-icon"
                    style={{ objectFit: 'cover' }}
                  />
                ) : (
                  <div className="inventory-prize-icon">{item.icon}</div>
                )}
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{item.prizeName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {item.source === 'referral'
                      ? tr('🎁 هدية من رابط', '🎁 Gift link')
                      : item.source === 'store'
                      ? tr('🏪 من المتجر', '🏪 From the store')
                      : tr('🎰 من الفرة المجانية', '🎰 From the free spin')}
                  </div>
                </div>
              </div>
              <StatusBadge status={item.status} />
            </div>

            {item.status === 'active' && item.task?.steps && (
              <ClaimSteps
                task={item.task}
                onAd={() => void watchAd(item)}
                adBusy={adId === item.id}
                onCopy={() => item.task?.link && copyLink(item.task.link)}
                onShare={() => shareLink(item.id)}
                sharing={sharingId === item.id}
              />
            )}
            {item.status === 'active' && item.task && !item.task.steps && (
              <TaskProgress
                task={item.task}
                onCopy={() => item.task?.link && copyLink(item.task.link)}
                onShare={() => shareLink(item.id)}
                sharing={sharingId === item.id}
              />
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <ExpiryLabel expiresAt={item.expiresAt} />
              {item.status === 'active' && canClaim && (
                <button
                  className="btn btn-primary"
                  style={{ width: 'auto', padding: '10px 22px' }}
                  disabled={claimingId === item.id}
                  onClick={() => claim(item)}
                >
                  {claimingId === item.id ? '...' : tr('📦 استلام', '📦 Claim')}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}