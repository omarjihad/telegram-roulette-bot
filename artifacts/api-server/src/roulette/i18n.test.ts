import { describe, expect, it } from 'vitest';
import { currentLang, parseLang, pick, runWithLang, t, userLang } from './i18n';

describe('server language helper', () => {
  it('defaults to Arabic and only accepts en as English', () => {
    expect(currentLang()).toBe('ar');
    expect(parseLang('en')).toBe('en');
    expect(parseLang('fr')).toBe('ar');
    expect(parseLang(undefined)).toBe('ar');
    expect(userLang({ language: 'en' })).toBe('en');
    expect(userLang(null)).toBe('ar');
  });

  it('follows the language of the current request, including across awaits', async () => {
    expect(t('مرحبا', 'Hello')).toBe('مرحبا');
    await runWithLang('en', async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(t('مرحبا', 'Hello')).toBe('Hello');
    });
    expect(t('مرحبا', 'Hello')).toBe('مرحبا');
  });

  it('picks a bilingual text for a given user language', () => {
    expect(pick({ ar: 'ع', en: 'E' }, 'en')).toBe('E');
    expect(pick('same', 'en')).toBe('same');
  });
});
