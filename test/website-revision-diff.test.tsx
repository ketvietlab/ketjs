import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  type RevisionDiff,
  type RevisionRow,
  revisionsScreen,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const entry = { id: 'p1', title: 'Trang', siteId: 'site1', type: 'website.page' } as never

const revision = (version: number): RevisionRow => ({
  id: `r${version}`,
  version,
  kind: 'revision',
  authorId: 'mai',
  createdAt: `2026-09-0${version}T00:00:00.000Z`,
})

const render = (rows: RevisionRow[], diff: RevisionDiff | null = null) =>
  renderToString(revisionsScreen(translate, entry, rows, {}, '', '/admin/website/pages', diff))

/**
 * The list was dates and authors: to see what a revision changed, someone had
 * to restore it and look. diffRevisions could answer that from the day it was
 * written, and no screen asked.
 */
test('revisions: with one revision there is nothing to compare, and no form offering to', () => {
  const html = render([revision(1)])
  assert.equal(html.includes('revisions.compare'), false)
})

test('revisions: two or more offers the comparison', () => {
  const html = render([revision(2), revision(1)])
  assert.match(html, /revisions\.compare/u)
  assert.match(html, /name="from"/u)
  assert.match(html, /name="to"/u)
})

test('revisions: a move says where it came from as well as where it went', () => {
  const html = render([revision(2), revision(1)], {
    fromVersion: 1,
    toVersion: 2,
    identified: true,
    changes: [{ id: 'n1', type: 'website.hero', change: 'moved', path: '1', from: '0' }],
  })
  assert.match(html, /0 → 1/u)
})

test('revisions: an edit names the settings that changed', () => {
  const html = render([revision(2), revision(1)], {
    fromVersion: 1,
    toVersion: 2,
    identified: true,
    changes: [
      { id: 'n1', type: 'website.hero', change: 'settings', path: '0', fields: ['heading', 'image'] },
    ],
  })
  assert.match(html, /heading, image/u)
})

test('revisions: two identical revisions say so rather than showing an empty table', () => {
  const html = render([revision(2), revision(1)], {
    fromVersion: 1,
    toVersion: 2,
    identified: true,
    changes: [],
  })
  assert.match(html, /revisions\.noChanges/u)
})

test('revisions: a comparison with no identity to work with warns instead of lying', () => {
  const html = render([revision(2), revision(1)], {
    fromVersion: 1,
    toVersion: 2,
    identified: false,
    changes: [{ id: 'n1', type: 'website.hero', change: 'added', path: '0' }],
  })
  // Legacy content compares as wholesale added and removed, and a reader has
  // to be told that rather than shown a rewrite that never happened.
  assert.match(html, /revisions\.unidentified/u)
})
