import { defineModule } from 'ketjs'
import { routes } from './routes.ts'
import { menus } from './menus.ts'

/**
 * The catalogue, in the admin — kept out of `product`.
 *
 * `product` must not depend on `backend`. A catalogue is a catalogue whether or
 * not this deployment ships an admin UI, and requiring one would mean a headless
 * API could not have products. But a screen in the admin genuinely needs both.
 *
 * So it is a bridge, and it installs itself once both sides are there — what
 * `install: 'auto'` was built for, and what Odoo does with `sale_stock` and its
 * kin. Install only product and there is no screen and no link; install the admin
 * too and both appear without anyone asking.
 *
 * It owns the page as well as the link. A bridge that contributed only a button
 * would be a bridge that ships a link to a 404.
 */
export default defineModule({
  name: 'product_backend',
  version: '0.1.0',
  depends: ['product', 'backend'],
  install: 'auto',
  app: true,
  title: 'Sản phẩm trong quản trị',
  summary: 'Màn hình danh mục sản phẩm và lối vào từ thanh điều hướng.',
  category: 'Hệ thống',
  routes,
  menus,
  messages: {
    vi: {
      'app.title': 'Sản phẩm trong quản trị',
      'app.summary': 'Màn hình danh mục sản phẩm và lối vào từ thanh điều hướng.',
      'menu.app': 'Sản phẩm',
      'menu.catalogue': 'Danh mục',
      'menu.templates': 'Mẫu sản phẩm',
      'chrome.search': 'Tìm sản phẩm…',
      'openCatalogue': 'Mở danh mục',
      'screen.title': 'Danh mục sản phẩm',
      'screen.empty.message': 'Chưa có sản phẩm nào.',
      'screen.empty.hint': 'Tạo mẫu sản phẩm đầu tiên để bắt đầu.',
      'col.name': 'Tên',
      'col.type': 'Loại',
      'col.uom': 'Đơn vị',
      'col.variants': 'Biến thể',
      'col.category': 'Nhóm',
      'type.goods': 'Hàng hoá',
      'type.service': 'Dịch vụ',
    },
    en: {
      'app.title': 'Products in admin',
      'app.summary': 'The catalogue screen, and the way into it.',
      'menu.app': 'Products',
      'menu.catalogue': 'Catalogue',
      'menu.templates': 'Templates',
      'chrome.search': 'Search products…',
      'openCatalogue': 'Open catalogue',
      'screen.title': 'Product catalogue',
      'screen.empty.message': 'No products yet.',
      'screen.empty.hint': 'Create the first template to begin.',
      'col.name': 'Name',
      'col.type': 'Type',
      'col.uom': 'Unit',
      'col.variants': 'Variants',
      'col.category': 'Category',
      'type.goods': 'Goods',
      'type.service': 'Service',
    },
  },
  fills: {
    // KTL, addressing joints by name — the same language a storefront theme uses.
    'backend:app-card.actions': `{% if app.name == 'product' %}<a data-ui="app-action" href="/admin/products">{{ 'product_backend.openCatalogue' | _ }}</a>{% endif %}`,
  },
})

export { productsScreen } from './screens.ts'
export type { TemplateRow } from './screens.ts'
