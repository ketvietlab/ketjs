// A page header is a title and its actions, never a description (LAYOUT.md L5).
//
// Screens passed a one-line description to some page patterns and not others, so
// the header was one line tall on one screen and two on the next, and the
// controls under it jumped when a user switched between them. Dropping the prop
// from every page pattern keeps one header height; these tests hold the line.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  BoardPage,
  DashboardPage,
  FormPage,
  HOOKS,
  ListPage,
  Page,
  PageHeader,
  RecordPage,
  WorkspacePage,
} from '@ketvietlab/design-system'

const body = '<p>Body</p>'

const headers = {
  Page: () => renderToString(Page({ title: 'Đơn hàng', body })),
  PageHeader: () => renderToString(PageHeader({ title: 'Đơn hàng' })),
  ListPage: () => renderToString(ListPage({ variant: 'operational', title: 'Đơn hàng', body })),
  FormPage: () => renderToString(FormPage({ variant: 'operational', title: 'Đơn hàng', body })),
  RecordPage: () => renderToString(RecordPage({ variant: 'operational', title: 'Đơn hàng', body })),
  WorkspacePage: () => renderToString(WorkspacePage({ variant: 'operational', title: 'Đơn hàng', body })),
  DashboardPage: () => renderToString(DashboardPage({ variant: 'operational', title: 'Đơn hàng', body })),
  BoardPage: () => renderToString(BoardPage({ variant: 'operational', title: 'Đơn hàng', body })),
}

test('design system: no page pattern accepts a description', () => {
  // Each line fails the type check if its pattern ever takes a description again.
  // @ts-expect-error a page header has no description
  Page({ title: 'T', description: 'D', body })
  // @ts-expect-error a page header has no description
  PageHeader({ title: 'T', description: 'D' })
  // @ts-expect-error a page header has no description
  ListPage({ title: 'T', description: 'D', body })
  // @ts-expect-error a page header has no description
  FormPage({ title: 'T', description: 'D', body })
  // @ts-expect-error a page header has no description
  RecordPage({ title: 'T', description: 'D', body })
  // @ts-expect-error a page header has no description
  WorkspacePage({ title: 'T', description: 'D', body })
  // @ts-expect-error a page header has no description
  DashboardPage({ title: 'T', description: 'D', body })
  // @ts-expect-error a page header has no description
  BoardPage({ title: 'T', description: 'D', body })
})

test('design system: page headers render no description hook', () => {
  for (const [name, render] of Object.entries(headers)) {
    const html = render()
    assert.match(
      html,
      /data-kv-page-identity="title"[^>]*>(?:<!--[^>]*-->)*Đơn hàng/,
      `${name} renders its title`,
    )
    assert.doesNotMatch(
      html,
      /-description"|data-kv-page-identity="description"/,
      `${name} has no description`,
    )
  }
})

test('design system: the hook contract lists no page description', () => {
  assert.deepEqual(
    HOOKS.filter((hook) => /(^|-)page-description$/.test(hook)),
    [],
  )
})
