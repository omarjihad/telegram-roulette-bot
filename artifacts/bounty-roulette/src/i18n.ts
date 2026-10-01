import { useEffect, useState } from 'react';

/**
 * Two languages: Arabic (default, right-to-left) and English (left-to-right).
 * Texts are written inline as tr('عربي', 'English') so both versions sit side by side.
 */
export type Lang = 'ar' | 'en';

const STORAGE_KEY = 'mf-lang';

function readStored(): Lang | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'ar' ? v : null;
  } catch {
    return null;
  }
}

let current: Lang = readStored() ?? 'ar';
const listeners = new Set<() => void>();

export function hasStoredLang() {
  return readStored() !== null;
}

export function getLang(): Lang {
  return current;
}

function applyDocument() {
  if (typeof document === 'undefined') return; // e.g. server-side tests importing shared files
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'en' ? 'ltr' : 'rtl';
  document.title = current === 'en' ? 'MF Bounty Rush Roulette' : 'عجلة حظ باونتي راش';
}
applyDocument();

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode / blocked storage: the choice still applies for this session.
  }
  applyDocument();
  listeners.forEach((fn) => fn());
}

/** Picks the text for the current language. */
export function tr(ar: string, en: string): string {
  return current === 'en' ? en : ar;
}

/** Re-renders the calling component whenever the language changes. */
export function useLang() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { lang: current, setLang, tr };
}

/** Locale for numbers/dates. */
export function locale() {
  return current === 'en' ? 'en-GB' : 'ar-EG';
}
