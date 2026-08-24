// One codebase, several deployments — the umbrella layout.
// storefront and admin share the `main` datastore and the catalog module; only
// storefront selects a theme, only admin composes checkout.
import { defineDeployment, composeWorkspace } from '@ketvietlab/ketjs'
import { catalog, inventory, checkout, defaultTheme as theme } from '@ketvietlab/ketsuite'

export const storefront = defineDeployment({
  name: 'storefront',
  modules: [catalog, inventory],
  theme,
  datastore: 'main',
})

export const admin = defineDeployment({
  name: 'admin',
  modules: [catalog, inventory, checkout],
  datastore: 'main',
  headless: true,
})

export const deployments = [storefront, admin]
export const workspace = () => composeWorkspace(deployments)
