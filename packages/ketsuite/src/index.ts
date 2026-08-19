// KetSuite — the application suite that runs on Ket.
//
// Every module here is written against the same contract a third-party module
// has: published joints, declared effects, view models. Nothing in this package
// may reach into the framework's internals, which is what keeps the framework
// honest — if the suite needs something, so does everyone else.

export { default as catalog } from './modules/catalog/index.ts'
export { default as inventory } from './modules/inventory/index.ts'
export { default as checkout } from './modules/checkout/index.ts'
export { default as defaultTheme } from './themes/default/index.ts'
