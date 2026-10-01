import React from 'react';
import { tr } from '../i18n';
import { Gift, Frown, CheckCircle } from 'lucide-react';

export function WinModal({
  prizeName,
  prizeKey,
  onClose,
}: {
  prizeName: string;
  prizeKey?: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 44, margin: '0 auto 16px', display: 'flex', justifyContent: 'center' }}>🎉</div>
        <h2 style={{ margin: '12px 0 6px', fontSize: 24, color: 'var(--accent)' }}>{tr('مبروك!', 'Congratulations!')}</h2>
        <p style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-main)', margin: '0 0 16px', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
          {prizeName}
        </p>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 20, fontWeight: 700 }}>
          {tr('تقدر تستلمها الآن من المخزون 🎒 خلال 24 ساعة قبل ما تنتهي.', 'Claim it from your inventory 🎒 within 24 hours before it expires.')}
        </p>
        <button className="btn btn-primary" onClick={onClose}>
          {tr('تم', 'Done')}
        </button>
      </div>
    </div>
  );
}

export function BetterLuckModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 44, margin: '0 auto 16px', display: 'flex', justifyContent: 'center' }}>🍀</div>
        <h2 style={{ margin: '12px 0 6px', fontSize: 24, color: 'var(--text-main)' }}>{tr('حظ أوفر 🍀', 'Better luck 🍀')}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 15, marginBottom: 24, fontWeight: 700 }}>
          {tr('جرب حظك مرة ثانية بعد ما تجي الفرة المجانية القادمة.', 'Try again when your next free spin is ready.')}
        </p>
        <button className="btn btn-primary" onClick={onClose}>{tr('رجوع', 'Back')}</button>
      </div>
    </div>
  );
}