// The backend UI.
//
// Deliberately NOT a theme. A storefront theme is a stranger's code, so it is
// written in a restricted language that cannot run (D3, D18). A backend screen is
// ours: it needs forms, filters and real interaction, so it is written in `html`
// with islands like any trusted view. Letting a third party replace a backend
// template is precisely the mechanism that made Odoo's upgrades painful.
//
// What a third party — or a design team — does own here is the stylesheet and the
// tokens. See design/HANDOFF.md.

import { defineModule } from 'ketjs'

export default defineModule({
  name: 'backend',
  version: '0.1.0',
  app: true,
  title: 'Quản trị',
  summary: 'Màn hình quản lý ứng dụng, trang và cài đặt.',
  category: 'Hệ thống',
})

export { appsScreen, pagesScreen, settingsScreen, emptyState, errorState } from './screens.ts'
export type { AppRow, PageRow, Screen } from './screens.ts'
export { CASES, cataloguePage } from './catalogue.ts'
