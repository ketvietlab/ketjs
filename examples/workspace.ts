// One codebase, several deployable apps — the umbrella layout.
// storefront and admin share the `main` datastore and the catalog module; only
// storefront installs a theme, only admin installs checkout.

import { defineApp, composeWorkspace } from '../src/kernel/workspace.ts'
import catalog from './modules/catalog/index.ts'
import inventory from './modules/inventory/index.ts'
import checkout from './modules/checkout/index.ts'
import theme from './themes/default/index.ts'

export const storefront = defineApp({
  name: 'storefront',
  modules: [catalog, inventory],
  theme,
  datastore: 'main',
})

export const admin = defineApp({
  name: 'admin',
  modules: [catalog, inventory, checkout],
  datastore: 'main',
  headless: true,
})

export const apps = [storefront, admin]
export const workspace = () => composeWorkspace(apps)
