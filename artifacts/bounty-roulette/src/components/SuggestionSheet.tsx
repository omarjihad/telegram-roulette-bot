import React, { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { api, ApiError } from '../services/api';
import { haptic } from '../hooks/useTelegramWebApp';

interface MySuggestion {
  seq: number;
  text: string;
  status: 'pending' | 'accepted' | 'rejected';
  reward: { type: 'none' | 'points' | 'daily_spin' | 'prize'; points?: number | null; prizeName?: string | null } | null;
  note: string | null;
  createdAt: string;
}

function rewardLabel(r: MySuggestion['reward']) {
  if (!r || r.type === 'none') return null;
  if (r.type === 'points') return tr(`🎁 ربحت ${r.points} نقطة`, `🎁 You won ${r.points} points`);
  if (r.type === 'daily_spin') return tr('🎁 ربحت فرة يومية إضافية', '🎁 You won an extra daily spin');
  return tr(`🎁 ربحت: ${r.prizeName} (بالحقيبة)`, `🎁 You won: ${r.prizeName} (in your inventory)`);
}

/** "Suggest a feature": write an idea for the bot, and see the answers to earlier ones. */
export function SuggestionSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<MySuggestion[] | null>(null);
  const [limits, setLimits] = useState({ min: 10, max: 1000 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await api.get<{ ok: true; items: MySuggestion[]; min: number; max: number }>('/suggestions');
    setItems(res.items);
    setLimits({ min: res.min, max: res.max });
  }
  useEffect(() => {
    load().catch(() => setItems([]));
  }, []);

  async function send() {
    if (busy) return;
    if (text.trim().length < limits.min) {
      setMsg({ ok: false, text: tr(`اكتب اقتراحك بوضوح (${limits.min} أحرف على الأقل)`, `Describe your idea (at least ${limits.min} characters)`) });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/suggestions', { text: text.trim() });
      haptic('medium');
      setText('');
      setMsg({ ok: true, text: tr('✅ وصل اقتراحك للإدارة. إذا انقبل ممكن تربح جائزة!', '✅ Your idea reached the team. If it’s accepted you may win a reward!') });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : tr('تعذر الإرسال، حاول مرة ثانية', 'Could not send, please try again') });
    } finally {
      setBusy(false);
    }
  }

  const statusBadge = (s: MySuggestion['status']) =>
    s === 'pending'
      ? <span className="status-badge status-pending">{tr('قيد المراجعة', 'Under review')}</span>
      : s === 'accepted'
      ? <span className="status-badge status-approved">{tr('مقبول ✅', 'Accepted ✅')}</span>
      : <span className="status-badge status-rejected">{tr('ما انقبل', 'Not accepted')}</span>;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card suggest-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 44 }}>💡</div>
        <h2 style={{ margin: '4px 0 6px' }}>{tr('اقترح ميزة', 'Suggest a feature')}</h2>
        <p className="card-sub" style={{ marginTop: 0 }}>
          {tr('عندك فكرة تخلي البوت أحلى؟ اكتبها هنا. إذا عجبتنا وأضفناها، ممكن تربح جائزة 🎁', 'Have an idea to make the bot better? Write it here. If we like it and add it, you may win a reward 🎁')}
        </p>
        <textarea
          className="suggest-input"
          value={text}
          maxLength={limits.max}
          onChange={(e) => setText(e.target.value)}
          placeholder={tr('مثلاً: أريد لعبة جديدة بقسم الألعاب…', 'For example: add a new game to the games section…')}
        />
        <div className="suggest-count">{text.trim().length}/{limits.max}</div>
        {msg && <div className={msg.ok ? 'suggest-msg ok' : 'suggest-msg'}>{msg.text}</div>}
        <button className="btn btn-primary" disabled={busy} onClick={() => void send()}>
          {busy ? '...' : tr('📨 إرسال الاقتراح', '📨 Send suggestion')}
        </button>

        {items && items.length > 0 && (
          <div className="suggest-list">
            <h3>{tr('اقتراحاتي', 'My suggestions')}</h3>
            {items.map((s) => (
              <div className="suggest-item" key={s.seq}>
                <div className="suggest-item-head">
                  <span className="suggest-seq">#{s.seq}</span>
                  {statusBadge(s.status)}
                </div>
                <p>{s.text}</p>
                {rewardLabel(s.reward) && <div className="suggest-reward">{rewardLabel(s.reward)}</div>}
                {s.note && <div className="suggest-note">📝 {s.note}</div>}
              </div>
            ))}
          </div>
        )}
        <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={onClose}>{tr('إغلاق', 'Close')}</button>
      </div>
    </div>
  );
}
