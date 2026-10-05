import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { renderStudioPublic } from '@ketvietlab/ketsuite'
import { embedAssetPath } from '../packages/ketsuite/src/modules/website_backend/studio/public.ts'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const SCRIPT = '/_ket/asset/cosmetic_usage_care/customer-portal-view.mjs'
const STYLE = '/_ket/asset/cosmetic_usage_care/customer-portal.css'

/**
 * A deployment module can draw one page of its own inside the site's header and footer, in the site's
 * look, and the visitor reaches it with the site's own customer sign-in. The page brings a script and
 * a stylesheet; only files the application serves can be named, never another origin.
 */
test('Studio embed: a module page wears the site frame and loads only its own assets', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'embed-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: 'initial',
    values: { preset: 'cosmetics', account: 'shown' },
  })
  const entry = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
  await fixture('website.publishEntry', { id: 'page-site-a', expectedRevisionId: entry.revisionId })
  const home = (await fixture('website.getEntryByPath', { siteId: 'site-a', path: '/' })) as Row
  const appearance = home.appearance as Record<string, unknown>
  assert.ok(appearance, 'the published home carries the look')

  const draw = (embed: Record<string, unknown>) =>
    renderStudioPublic({
      site: { id: 'site-a', title: 'site-a' },
      locale: 'vi',
      menu: [],
      page: { id: 'care', path: '/cham-soc', title: 'Chăm sóc da', type: 'website.customerEmbed' },
      fields: { seo: { title: 'Chăm sóc da', description: '', canonical: '', indexing: 'noindex' }, embed },
      appearance,
      meta: {},
      sections: [],
    })
  const read = (embed: Record<string, unknown>) => String(draw(embed)?.body ?? '').replace(/<!--.*?-->/g, '')

  const page = read({ script: SCRIPT, style: STYLE })
  assert.match(page, /data-theme-preset="cosmetics"/, 'the page wears the site look')
  assert.match(
    page,
    /<link rel="stylesheet" href="\/_ket\/asset\/cosmetic_usage_care\/customer-portal\.css">/,
  )
  assert.match(
    page,
    /<script type="module" src="\/_ket\/asset\/cosmetic_usage_care\/customer-portal-view\.mjs"><\/script>/,
  )
  assert.match(page, /data-embed-root/)
  assert.match(page, /<meta name="robots" content="noindex">/)
  assert.match(page, /customer-account\.mjs/, 'the header keeps its account link and script')
  assert.match(page, /href="\/account\/login\?returnTo=%2Fcham-soc" data-customer-account/)

  // A script that is not the application's own is refused outright.
  for (const script of [
    'https://evil.test/x.mjs',
    '//evil.test/x.mjs',
    '/_ket/asset/../secret.mjs',
    `${SCRIPT}?x=1`,
    '/_ket/asset/a/b.js',
    '',
    undefined,
  ])
    assert.equal(embedAssetPath(script, 'mjs'), null, String(script))
  assert.equal(embedAssetPath(STYLE, 'css'), STYLE)
  assert.equal(embedAssetPath(STYLE, 'mjs'), null)
  assert.doesNotMatch(read({ script: SCRIPT, style: 'https://evil.test/x.css' }), /evil\.test/)
  // No valid script means no page at all, so the route answers 404 rather than a blank 200.
  assert.equal(draw({ script: 'https://evil.test/x.mjs' }), null)
  assert.equal(draw({}), null)
})

/** The type is the application's to draw: an editor cannot save a page of it and pick its assets. */
test('Studio embed: an editor cannot store a page of the embed type', async (t) => {
  const { app } = await bootWebsiteStudio()
  t.after(() => app.close())
  const saved = (
    await app.fixture.call<Row>(
      'website.saveEntry',
      {
        id: 'embed-forged',
        siteId: 'site-a',
        type: 'website.customerEmbed',
        title: 'Forged',
        path: '/forged',
        slug: 'forged',
        fields: { embed: { script: SCRIPT } },
        layout: [],
      },
      { scope: { company: 'studio-a', branches: null } },
    )
  ).value
  assert.equal(saved?.ok, false)
  assert.match(JSON.stringify(saved), /invalidContentType/)
})
