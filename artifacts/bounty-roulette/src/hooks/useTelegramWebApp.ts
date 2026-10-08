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
  onEvent?: (event: string, handler: (...args: unknown[]) => void) => void;
  offEvent?: (event: string, handler: (...args: unknown[]) => void) => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
}

/** Telegram's low-level bridge (the WebApp object is built on top of it). */
interface TelegramWebView {
  postEvent: (eventType: string, callback?: unknown, eventData?: unknown) => void;
  onEvent: (eventType: string, handler: (eventType: string, eventData: unknown) => void) => void;
  offEvent: (eventType: string, handler: (eventType: string, eventData: unknown) => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp; WebView?: TelegramWebView };
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

/**
 * Opens Telegram's "send to chats" picker for a prepared inline message and reports
 * whether it was sent. WebApp.shareMessage stays locked forever ("already opened") when a
 * Telegram app never sends back the result, so every later share fails until the Mini App
 * is reopened. This talks to the bridge directly instead, so each share opens again.
 * Resolves true when sent, false when cancelled, null when Telegram never answered.
 */
export function openSharePicker(preparedId: string, timeoutMs = 30_000): Promise<boolean | null> {
  const tg = window.Telegram;
  const view = tg?.WebView;
  if (!view?.postEvent || !view.onEvent) {
    // Old bridge: fall back to the official method.
    return new Promise((resolve) => {
      try {
        tg?.WebApp.shareMessage?.(preparedId, (sent) => resolve(sent));
      } catch {
        resolve(null);
      }
    });
  }
  return new Promise((resolve) => {
    let done = false;
    let backTimer: number | undefined;
    const finish = (value: boolean | null) => {
      if (done) return;
      done = true;
      view.offEvent('prepared_message_sent', onSent);
      view.offEvent('prepared_message_failed', onFailed);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
      window.clearTimeout(timer);
      window.clearTimeout(backTimer);
      resolve(value);
    };
    const onSent = () => finish(true);
    const onFailed = () => finish(false);
    // Back in the Mini App after the picker closed: if Telegram still said nothing a moment
    // later, don't keep the person waiting.
    const onBack = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(backTimer);
      backTimer = window.setTimeout(() => finish(null), 1500);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    view.onEvent('prepared_message_sent', onSent);
    view.onEvent('prepared_message_failed', onFailed);
    // Listen only after the picker had a moment to open, so its own opening doesn't count.
    window.setTimeout(() => {
      if (done) return;
      document.addEventListener('visibilitychange', onBack);
      window.addEventListener('focus', onBack);
    }, 800);
    view.postEvent('web_app_send_prepared_message', false, { id: preparedId });
  });
}

/**
 * The Telegram launch data as a URL hash, so a page on another site (MF Battle on
 * Cloudflare) opened from the Mini App is still signed in as this Telegram user.
 */
/** MF Battle's address with the Telegram launch data, so the game signs the same person in. */
export function battleHref(battleUrl: string): string {
  const hash = telegramLaunchHash();
  return `${battleUrl.replace(/\/+$/, '')}/${hash ? `#${hash}` : ''}`;
}

export function telegramLaunchHash(): string {
  const tg = window.Telegram?.WebApp as (TelegramWebApp & { version?: string; platform?: string; themeParams?: Record<string, string> }) | undefined;
  if (!tg?.initData) return '';
  return [
    `tgWebAppData=${encodeURIComponent(tg.initData)}`,
    `tgWebAppVersion=${encodeURIComponent(tg.version ?? '')}`,
    `tgWebAppPlatform=${encodeURIComponent(tg.platform ?? '')}`,
    `tgWebAppThemeParams=${encodeURIComponent(JSON.stringify(tg.themeParams ?? {}))}`,
  ].join('&');
}
