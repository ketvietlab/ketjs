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
import { messages } from './messages.ts'
import { routes } from './routes.ts'
import { joints } from './joints.ts'
import { menus } from './menus.ts'

export default defineModule({
  name: 'backend',
  version: '0.1.0',
  app: true,
  title: 'Quản trị',
  summary: 'Màn hình quản lý ứng dụng, trang và cài đặt.',
  category: 'Hệ thống',
  // The screen you would use to put something back. A deployment that let you
  // remove it would let you remove your way out of ever fixing it.
  removable: false,
  // Its own files, its own stylesheets, its own routes. The app used to name all
  // three by reaching into this directory, which meant it went on serving them
  // after the module was switched off.
  assets: new URL('./design/', import.meta.url),
  styles: ['tokens.css', 'admin.css'],
  routes,
  menus,
  joints,
  messages,
})

// The screens this module owns: data assembly, no markup.
export { appsScreen, pagesScreen, pageColumns, settingsScreen } from './screens.ts'
export type { AppRow, PageRow, Screen } from './screens.ts'
export { PAGE_SIZE, colsHref, colsOf, pageOf, pager, searchOf, withParam } from './paging.ts'
export { joints } from './joints.ts'
export { menus } from './menus.ts'
export { CASES, cataloguePage } from './catalogue.ts'
export { messages } from './messages.ts'
export { routes, viewerOf } from './routes.ts'

/**
 * The kit, re-exported.
 *
 * It is not this module's — it lives in `ketsuite/ui` so a module can use a button
 * without depending on the admin. These are here so an existing caller keeps
 * working and so `import backend, { badge } from 'ketsuite/backend'` still reads
 * naturally on a backend screen.
 */
export {
  shell,
  framed,
  listChrome,
  topbarSearch,
  emptyState,
  errorState,
  dataTable,
  visibleColumns,
  badge,
  avatar,
  person,
  initials,
  icon,
  hasIcon,
  appCard,
  card,
  cardGroups,
  definitionList,
  actionButton,
  code,
  inline,
  button,
  linkButton,
  iconButton,
  actionGroup,
  tag,
  countBadge,
  notice,
  loadingState,
  stack,
  section,
  surface,
  cardGrid,
  contentCard,
  metric,
  kanbanCard,
  kanbanGrid,
  recordList,
  breadcrumbs,
  tabs,
  mediaPanel,
  HOOKS,
  OWNERS,
} from '../../ui/index.ts'
export type {
  Cell,
  Column,
  DataTable,
  Tone,
  Frame,
  Extras,
  Facet,
  ListChrome,
  Pager,
  ViewKind,
  Indicator,
  Viewer,
  CardMeta,
  ActionVariant,
  ActionSize,
  ButtonSpec,
  LinkButtonSpec,
  NoticeTone,
  Breadcrumb,
  Tab,
  MediaItem,
  MediaPanelProps,
} from '../../ui/index.ts'
