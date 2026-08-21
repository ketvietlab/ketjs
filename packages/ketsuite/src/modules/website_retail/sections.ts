import type { SectionDef } from 'ketjs'

export const sections: Record<string, SectionDef> = {
  'website_retail.products': {
    title: 'Lưới sản phẩm',
    settings: { heading: 'text?', limit: 'int?', categoryId: 'id?' },
  },
  'website_retail.cart': {
    title: 'Giỏ hàng',
    settings: { heading: 'text?', checkoutLabel: 'text?' },
  },
}
