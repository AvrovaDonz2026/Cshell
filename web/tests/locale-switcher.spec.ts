import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import LocaleSwitcher from '@/components/LocaleSwitcher.vue';
import en from '@/i18n/locales/en';
import zh from '@/i18n/locales/zh';
import ru from '@/i18n/locales/ru';
import { availableLocales, i18n, setLocale } from '@/i18n';

describe('locale integration', () => {
  it('registers structurally complete translations for every available locale', () => {
    const shape = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(shape);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, shape(child)]),
        );
      }
      return typeof value;
    };
    expect(availableLocales).toEqual(['en', 'zh', 'ru']);
    const russianShape = shape(ru) as Record<string, unknown>;
    const englishShape = shape(en) as Record<string, unknown>;
    const russianShell = russianShape.shell as Record<string, unknown>;
    const englishShell = englishShape.shell as Record<string, unknown>;
    const russianLocale = russianShell.locale as Record<string, unknown>;
    const englishLocale = englishShell.locale as Record<string, unknown>;
    delete russianLocale.ru;
    delete englishLocale.ru;
    expect(shape(zh)).toEqual(shape(en));
    expect(russianShape).toEqual(englishShape);
    expect(shape(ru)).toEqual(shape(en));
    expect(Object.keys(i18n.global.messages.value)).toEqual(
      expect.arrayContaining(availableLocales),
    );
  });

  it('updates and persists Russian locale selection', () => {
    localStorage.setItem('cshell_locale', 'ru');
    setLocale('ru');
    expect(i18n.global.locale.value).toBe('ru');
    expect(localStorage.getItem('cshell_locale')).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
  });
});

describe('LocaleSwitcher header variant', () => {
  it('applies the header variant class', () => {
    const wrapper = mount(LocaleSwitcher, {
      props: { variant: 'header' },
      global: {
        plugins: [
          createI18n({ legacy: false, locale: 'en', messages: { en } }),
        ],
      },
    });
    expect(wrapper.find('.locale-switcher').classes()).toContain(
      'locale-switcher--header',
    );
    expect(wrapper.find('.cshell-select').classes()).toContain(
      'locale-switcher__select--header',
    );
    wrapper.unmount();
  });

  it('offers and selects Russian, persisting the selected locale', async () => {
    localStorage.clear();
    setLocale('en');
    const wrapper = mount(LocaleSwitcher, {
      global: { plugins: [i18n] },
    });
    await wrapper.find('button').trigger('click');
    const russianOption = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.trim() === 'Русский');
    expect(document.body.textContent).toContain('Русский');
    expect(russianOption).not.toBeNull();
    await (russianOption as HTMLElement).click();
    expect(wrapper.find('button').text()).toBe('Русский');
    expect(localStorage.getItem('cshell_locale')).toBe('ru');
    wrapper.unmount();
  });
});
