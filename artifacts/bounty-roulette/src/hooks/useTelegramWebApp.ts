import { useEffect, useState } from 'react';

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: Record<string, unknown>;
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  };
  openTelegramLink?: (url: string) => void;
  colorScheme?: 'light' | 'dark';
  // Opens Telegram's native "choose chat(s) to send to" dialog for a message the bot
  // prepared server-side via the Bot API's savePreparedInlineMessage. Requires a Telegram
  // client on WebApp API version 7.8+; older clients simply don't have this method, so
  // callers must check `tg.shareMessage` is defined before calling it.
  shareMessage?: (messageId: string, callback?: (sent: boolean) => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function useTelegramWebApp() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor?.('#150826');
      tg.setBackgroundColor?.('#150826');
      tg.disableVerticalSwipes?.();
    }
    setReady(true);
  }, []);

  return { ready, tg: getTelegramWebApp() };
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  getTelegramWebApp()?.HapticFeedback?.impactOccurred(style);
}
