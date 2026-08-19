// One codebase, several deployable apps — the umbrella layout.
// storefront and admin share the `main` datastore and the catalog module; only
// storefront installs a theme, only admin installs checkout.
import { defineApp, composeWorkspace } from 'ketjs'
import { catalog, inventory, checkout, defaultTheme as theme } from 'ketsuite'

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
