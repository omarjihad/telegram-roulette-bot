import React, { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { previewBotLink } from '../services/preview';

/** Shown on the website version: everything is a preview, the real thing is in Telegram. */
export function PreviewBanner() {
  const [link, setLink] = useState('https://t.me/MfRuLiTbot');
  useEffect(() => {
    void previewBotLink().then(setLink);
  }, []);
  return (
    <div className="preview-banner">
      <div>
        <strong>{tr('🌐 نسخة العرض من الموقع', '🌐 Website preview')}</strong>
        <span>{tr('هذه نسخة للعرض فقط. السحب والدعوات والإعلانات تعمل داخل تيليجرام فقط.', 'This is a view-only preview. Withdrawals, invites and ads work only inside Telegram.')}</span>
      </div>
      <a className="btn btn-primary" href={link} target="_blank" rel="noopener noreferrer">
        {tr('افتح في تيليجرام', 'Open in Telegram')}
      </a>
    </div>
  );
}
