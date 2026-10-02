// Operational list pages may expose one short line of guidance below the title.
// Other page patterns keep their compact identity contract.

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
  // Each line fails the type check if a non-list page ever takes a description.
  // @ts-expect-error a page header has no description
  Page({ title: 'T', description: 'D', body })
  // @ts-expect-error a page header has no description
  PageHeader({ title: 'T', description: 'D' })
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

test('design system: list pages render an optional description hook', () => {
  const listHtml = renderToString(
    ListPage({ variant: 'operational', title: 'Đơn hàng', description: 'Ghi chú', body }),
  )
  assert.match(listHtml, /data-kv-page-identity="description"[^>]*>[\s\S]*?Ghi chú/)

  for (const [name, render] of Object.entries(headers)) {
    const html = render()
    assert.match(
      html,
      /data-kv-page-identity="title"[^>]*>(?:<!--[^>]*-->)*Đơn hàng/,
      `${name} renders its title`,
    )
    if (name !== 'ListPage')
      assert.doesNotMatch(
        html,
        /-description"|data-kv-page-identity="description"/,
        `${name} has no description`,
      )
  }
})

test('design system: the hook contract lists list page description', () => {
  assert.ok(HOOKS.includes('list-page-description'))
})
