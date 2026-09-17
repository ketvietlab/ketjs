// How the role form lays out the permission catalogue.
//
// The catalogue is keyed by module, and a module name is a code, not something
// a store manager reads. This names each module that carries bundles and puts
// it in a business group, so the form reads as sections a person recognises
// with one row per area. A module missing here still shows, under "Khác", with
// its code tidied — a new module is never silently ungrantable.

export type PermissionGroup =
  | 'sales'
  | 'store'
  | 'inventory'
  | 'finance'
  | 'hospitality'
  | 'people'
  | 'system'
  | 'other'

export const permissionGroupOrder: readonly PermissionGroup[] = [
  'sales',
  'store',
  'inventory',
  'finance',
  'hospitality',
  'people',
  'system',
  'other',
]

export const permissionGroupLabels: Record<PermissionGroup, { vi: string; en: string }> = {
  sales: { vi: 'Bán hàng & Khách hàng', en: 'Sales & customers' },
  store: { vi: 'Cửa hàng', en: 'Store' },
  inventory: { vi: 'Kho & Sản xuất', en: 'Inventory & manufacturing' },
  finance: { vi: 'Kế toán & Mua hàng', en: 'Accounting & purchasing' },
  hospitality: { vi: 'Lưu trú', en: 'Hospitality' },
  people: { vi: 'Nhân sự & Lịch', en: 'People & calendar' },
  system: { vi: 'Hệ thống', en: 'System' },
  other: { vi: 'Khác', en: 'Other' },
}

type Area = { group: PermissionGroup; vi: string; en: string }

export const permissionAreas: Record<string, Area> = {
  sale: { group: 'sales', vi: 'Bán hàng', en: 'Sales' },
  crm: { group: 'sales', vi: 'CRM', en: 'CRM' },
  crm_sale: { group: 'sales', vi: 'CRM · Đơn bán', en: 'CRM · Sales orders' },
  partner: { group: 'sales', vi: 'Khách hàng', en: 'Contacts' },
  partner_mail_backend: { group: 'sales', vi: 'Thư khách hàng', en: 'Contact mail' },
  loyalty: { group: 'sales', vi: 'Khách hàng thân thiết', en: 'Loyalty' },
  loyalty_sale: { group: 'sales', vi: 'Thân thiết · Đơn bán', en: 'Loyalty · Sales' },
  pos: { group: 'store', vi: 'POS', en: 'Point of sale' },
  loyalty_pos: { group: 'store', vi: 'Thân thiết · POS', en: 'Loyalty · POS' },
  pricing: { group: 'store', vi: 'Giá bán', en: 'Pricing' },
  stock: { group: 'inventory', vi: 'Kho', en: 'Inventory' },
  stock_staff_channel: { group: 'inventory', vi: 'Kho · Ứng dụng nhân viên', en: 'Inventory · Staff app' },
  stock_mail_backend: { group: 'inventory', vi: 'Thư kho', en: 'Inventory mail' },
  product: { group: 'inventory', vi: 'Sản phẩm', en: 'Products' },
  product_media: { group: 'inventory', vi: 'Hình ảnh sản phẩm', en: 'Product media' },
  product_mail_backend: { group: 'inventory', vi: 'Thư sản phẩm', en: 'Product mail' },
  manufacturing: { group: 'inventory', vi: 'Sản xuất', en: 'Manufacturing' },
  quality: { group: 'inventory', vi: 'Chất lượng', en: 'Quality' },
  uom: { group: 'inventory', vi: 'Đơn vị tính', en: 'Units of measure' },
  storage: { group: 'inventory', vi: 'Tệp lưu trữ', en: 'File storage' },
  account: { group: 'finance', vi: 'Kế toán', en: 'Accounting' },
  account_staff_channel: {
    group: 'finance',
    vi: 'Kế toán · Ứng dụng nhân viên',
    en: 'Accounting · Staff app',
  },
  purchase: { group: 'finance', vi: 'Mua hàng', en: 'Purchasing' },
  hospitality_core: { group: 'hospitality', vi: 'Lưu trú', en: 'Hospitality' },
  hospitality_billing: { group: 'hospitality', vi: 'Thanh toán lưu trú', en: 'Hospitality billing' },
  hr: { group: 'people', vi: 'Nhân sự', en: 'HR' },
  attendance: { group: 'people', vi: 'Chấm công', en: 'Attendance' },
  calendar: { group: 'people', vi: 'Lịch', en: 'Calendar' },
  activity: { group: 'people', vi: 'Hoạt động', en: 'Activities' },
  company: { group: 'system', vi: 'Công ty & Chi nhánh', en: 'Companies & branches' },
  address: { group: 'system', vi: 'Địa chỉ', en: 'Addresses' },
  user: { group: 'system', vi: 'Người dùng', en: 'Users' },
  oauth: { group: 'system', vi: 'Ứng dụng kết nối', en: 'Connected apps' },
  mail: { group: 'system', vi: 'Thư và thông báo', en: 'Mail' },
  mail_transport: { group: 'system', vi: 'Kênh gửi thư', en: 'Mail delivery' },
  flow: { group: 'system', vi: 'Quy trình', en: 'Flows' },
  website: { group: 'system', vi: 'Website', en: 'Website' },
  website_form: { group: 'system', vi: 'Website · Biểu mẫu', en: 'Website · Forms' },
  website_form_mail: { group: 'system', vi: 'Website · Thư biểu mẫu', en: 'Website · Form mail' },
  website_menu: { group: 'system', vi: 'Website · Menu', en: 'Website · Menus' },
  website_search: { group: 'system', vi: 'Website · Tìm kiếm', en: 'Website · Search' },
  website_seo: { group: 'system', vi: 'Website · SEO', en: 'Website · SEO' },
}

/** What a capability hands out, read at a glance: running the system, or seeing what should stay private. */
export const capabilityTone = (capability: string): 'admin' | 'sensitive' | null =>
  capability === 'configure' || capability === 'security'
    ? 'admin'
    : capability === 'sensitive' || capability === 'cash-control'
      ? 'sensitive'
      : null

export const permissionArea = (
  module: string,
  lang: 'vi' | 'en',
): { group: PermissionGroup; label: string } => {
  const area = permissionAreas[module]
  return area
    ? { group: area.group, label: area[lang] }
    : { group: 'other', label: module.replaceAll('_', ' ') }
}
