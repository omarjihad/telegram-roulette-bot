import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { locale, tr } from '../i18n';
import { getTelegramWebApp } from '../hooks/useTelegramWebApp';

/** A picture opened full screen, with a back button (and Telegram's own back button). */
export function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const back = getTelegramWebApp()?.BackButton;
    if (!back) return;
    const handler = () => closeRef.current();
    back.onClick(handler);
    back.show();
    return () => {
      back.offClick(handler);
      back.hide();
    };
  }, []);
  return (
    <div className="ex-zoom" onClick={onClose}>
      <button
        type="button"
        className="ex-zoom-back"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        {locale().startsWith('ar') ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        {tr('رجوع', 'Back')}
      </button>
      <img src={src} alt="" />
    </div>
  );
}
