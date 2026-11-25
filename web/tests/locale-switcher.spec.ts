import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import en from '@/i18n/locales/en'

describe('LocaleSwitcher header variant', () => {
  it('applies the header variant class', () => {
    const wrapper = mount(LocaleSwitcher, {
      props: { variant: 'header' },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
    })
    expect(wrapper.find('.locale-switcher').classes()).toContain('locale-switcher--header')
    expect(wrapper.find('.cshell-select').classes()).toContain('locale-switcher__select--header')
    wrapper.unmount()
  })
})
