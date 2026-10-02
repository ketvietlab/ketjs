import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose } from '@ketvietlab/ketjs'
import backend from '@ketvietlab/ketsuite/backend'
import {
  address,
  company,
  livedoc,
  paperTheme,
  partner,
  storage,
  user,
  website,
  websiteBackend,
  websiteForm,
  websiteMenu,
  websiteSearch,
  websiteSeo,
} from '@ketvietlab/ketsuite'

const manifest = compose([
  address,
  partner,
  company,
  storage,
  backend,
  website,
  websiteMenu,
  websiteSeo,
  websiteSearch,
  websiteForm,
  livedoc,
  user,
  websiteBackend,
  paperTheme,
])

/**
 * The Studio at /website replaced a server-rendered admin under /admin/website. Its
 * screens are deleted; what they called is not, because the Studio calls it too.
 */
test('website admin: the Studio is the only way in, and the old screens stay gone', () => {
  const old = Object.keys(manifest.routes).filter((route) => route.startsWith('/admin/website'))
  assert.deepEqual(old, [], 'no route may revive the old UI')
  const menus = Object.entries(manifest.menus).filter(
    ([key, menu]) => key.startsWith('website') || String(menu.path ?? '').startsWith('/admin/website'),
  )
  assert.deepEqual(
    menus.map(([key, menu]) => [key, menu.path]),
    [['website', '/website']],
  )
})

test('website admin: the domain APIs the old screens called stay registered', () => {
  for (const key of [
    'website.saveSiteMember',
    'website.removeSiteMember',
    'website.saveDomain',
    'website.saveRedirect',
    'website.restoreRevision',
    'website.activatePublication',
    'website.rollbackPublication',
    'website_seo.saveEntrySeo',
    'website_form.exportSubmissions',
    'website_form.purgeSubmissions',
    'website_form.readSubmission',
  ])
    assert.ok(manifest.functions[key], `${key} must stay registered`)
  // The search-filter bar belonged to the old lists; the Studio searches for itself.
  for (const key of [
    'applySearchFilter',
    'saveSearchFavorite',
    'deleteSearchFavorite',
    'setDefaultSearchFavorite',
  ])
    assert.equal(manifest.functions[`website_backend.${key}`], undefined)
})
