// KetSuite — the application suite that runs on Ket.
//
// Every module here is written against the same contract a third-party module has:
// published joints, declared effects, view models, the public entry point. If the
// suite ever needs something deeper, so does everyone else — and it should be
// exported rather than smuggled. The dependency audit enforces exactly that.

// website vertical
export { default as website } from './modules/website/index.ts'
export { default as websiteMenu } from './modules/website_menu/index.ts'
export { default as websiteSeo } from './modules/website_seo/index.ts'
export { default as websiteSearch } from './modules/website_search/index.ts'
export { default as paperTheme } from './themes/paper/index.ts'
export type { SectionPlacement } from './modules/website/types.ts'

// units of measure — product depends on it
export { default as uom } from './modules/uom/index.ts'
export { convertQty, roundTo, compareQty, isZero, UomError } from './modules/uom/convert.ts'
export type { Unit } from './modules/uom/convert.ts'

// product vertical
export { default as product } from './modules/product/index.ts'
export { default as productBackend } from './modules/product_backend/index.ts'
export { default as partner } from './modules/partner/index.ts'
export { default as company } from './modules/company/index.ts'
export { default as user } from './modules/user/index.ts'
export { hashPassword, verifyPassword, needsRehash } from './modules/user/password.ts'
export { permittedFor } from './modules/user/roles.ts'
export { PARTNER_KINDS, PARTNER_ROLES, ADDRESS_USES } from './modules/partner/types.ts'
export type { PartnerKind, PartnerRole, AddressUse } from './modules/partner/types.ts'
export { PRODUCT_TYPES } from './modules/product/types.ts'
export type { ProductType } from './modules/product/types.ts'

// commerce — demo-grade scaffolding, kept until the vertical is written for real
export { default as catalog } from './modules/catalog/index.ts'
export { default as inventory } from './modules/inventory/index.ts'
export { default as checkout } from './modules/checkout/index.ts'
export { default as defaultTheme } from './themes/default/index.ts'
