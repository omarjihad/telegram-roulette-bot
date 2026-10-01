import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * User-facing language. Mini App requests carry it in the X-Lang header (see app.ts); bot
 * messages and notifications use the language saved on the user. Arabic is the default.
 */
export type Lang = 'ar' | 'en';
/** A text in both languages, or a plain string that is the same for everyone. */
export type Bilingual = string | { ar: string; en: string };

const requestLang = new AsyncLocalStorage<Lang>();

export function parseLang(value: unknown): Lang {
  return value === 'en' ? 'en' : 'ar';
}

export function runWithLang<T>(lang: Lang, fn: () => T): T {
  return requestLang.run(lang, fn);
}

/** Language of the current Mini App request (Arabic outside a request). */
export function currentLang(): Lang {
  return requestLang.getStore() ?? 'ar';
}

/** Picks Arabic or English, for the current request unless a language is given. */
export function t(ar: string, en: string, lang: Lang = currentLang()): string {
  return lang === 'en' ? en : ar;
}

export function pick(text: Bilingual, lang: Lang): string {
  return typeof text === 'string' ? text : text[lang];
}

export function userLang(user?: { language?: string | null } | null): Lang {
  return parseLang(user?.language);
}
