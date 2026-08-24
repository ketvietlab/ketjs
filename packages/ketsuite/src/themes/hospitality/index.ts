import { defineTheme, loadTemplates } from '@ketvietlab/ketjs'
import { tokens } from './tokens.ts'

export default defineTheme({
  name: 'theme_hospitality',
  group: 'hospitality',
  version: '0.1.0',
  depends: ['website', 'website_menu', 'website_form', 'website_hospitality'],
  title: 'Theme Hospitality',
  summary: 'Theme KTL thanh lịch cho khách sạn, resort và lưu trú.',
  messages: {
    vi: {
      'app.title': 'Theme Hospitality',
      'app.summary': 'Theme KTL thanh lịch cho khách sạn, resort và lưu trú.',
      'app.category': 'Giao diện',
    },
    en: {
      'app.title': 'Hospitality theme',
      'app.summary': 'An elegant KTL theme for hotels, resorts and stays.',
      'app.category': 'Appearance',
    },
  },
  assets: new URL('./assets/', import.meta.url),
  styles: ['theme.css'],
  templates: loadTemplates(new URL('./templates/', import.meta.url)),
  tokens,
})
