import { defineModule } from 'ketjs'

/**
 * What product adds to the admin, kept out of product.
 *
 * `product` must not depend on `backend`. A catalogue is a catalogue whether or
 * not this deployment ships an admin UI, and making it require one would mean a
 * headless API could not have products. But the button on the app card genuinely
 * needs both modules to exist.
 *
 * So it is a bridge, and it installs itself once both sides are there — which is
 * exactly what `install: 'auto'` was built for, and what Odoo does with
 * `sale_stock` and its kin. Install only product and this is not there; install
 * the admin too and the button appears without anyone asking.
 *
 * Discovered by CI: putting the fill in `product` made every test that composes a
 * catalogue without an admin fail with E_MISSING_DEPENDENCY.
 */
export default defineModule({
  name: 'product_backend',
  version: '0.1.0',
  depends: ['product', 'backend'],
  install: 'auto',
  app: true,
  title: 'Sản phẩm trong quản trị',
  summary: 'Thêm lối vào danh mục từ màn hình ứng dụng.',
  category: 'Hệ thống',
  messages: {
    vi: { 'app.title': 'Sản phẩm trong quản trị', 'openCatalogue': 'Mở danh mục' },
    en: { 'app.title': 'Products in admin', 'openCatalogue': 'Open catalogue' },
  },
  fills: {
    // KTL, addressing a joint by name — the same language a storefront theme uses.
    'backend:app-card.actions': `{% if app.name == 'product' %}<a data-ui="app-action" href="/admin/products">{{ 'product_backend.openCatalogue' | _ }}</a>{% endif %}`,
  },
})
