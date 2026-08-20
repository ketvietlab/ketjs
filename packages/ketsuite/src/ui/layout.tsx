// The frame a screen sits in, and the shared arrangements inside it.

import { each } from 'ketjs-view'
import type { JSXChild, TemplateResult } from 'ketjs-view'
import type { MenuNode, Translator } from 'ketjs'
import { sidebar } from './nav.tsx'
import type { Indicator, Viewer } from './nav.tsx'
import { listChrome } from './chrome.tsx'
import type { ListChrome } from './chrome.tsx'
import { actionButton } from './primitives.tsx'

export const HOOKS = [
  'shell',
  'main',
  'topbar',
  'title',
  'content',
  'app-groups',
  'app-group',
  'group-title',
  'app-grid',
  'app-card',
  'app-title',
  'app-summary',
  'app-meta',
  'app-meta-value',
  'app-actions',
  'tokens',
  'token-list',
  'token',
  'token-name',
  'token-value',
] as const

export type Extras = {
  'topbar.end'?: JSXChild
  'sidebar.foot'?: JSXChild
  'apps.footer'?: JSXChild
  'nav.items'?: JSXChild
  'app-card.actions'?: Record<string, JSXChild>
}

export type Frame = {
  viewer?: Viewer | null
  indicators?: Indicator[]
  menuFilter?: string | null
  extras?: Extras
  menu?: MenuNode[]
  chrome?: ListChrome | null
}

export const shell = (
  _: Translator,
  title: string,
  body: TemplateResult,
  frame: Frame = {},
): TemplateResult => {
  const { viewer = null, extras = {}, menu = [], indicators = [] } = frame
  return (
    <div data-ui="shell">
      {sidebar(_, {
        menu,
        viewer,
        indicators,
        menuFilter: frame.menuFilter,
        navItems: extras['nav.items'],
        footItems: extras['sidebar.foot'],
      })}
      <main data-ui="main">
        <header data-ui="topbar">
          {frame.chrome ? listChrome(_, title, frame.chrome) : <h1 data-ui="title">{title}</h1>}
          {extras['topbar.end'] ?? ''}
        </header>
        <div data-ui="content">{body}</div>
      </main>
    </div>
  )
}

export const framed = (_: Translator, title: string, frame: Frame, body: TemplateResult): TemplateResult =>
  shell(_, title, body, frame)

export type CardMeta = { term: string; value: string; kind: 'depends' | 'dependents' | 'neutral' }

export const appCard = (options: {
  key: string
  state: string
  title: string
  summary: string
  meta: CardMeta[]
  action: { label: string; action: string; disabled?: boolean }
  extra?: JSXChild
}): TemplateResult => (
  <article data-ui="app-card" data-state={options.state} data-app={options.key}>
    <h3 data-ui="app-title">{options.title}</h3>
    <p data-ui="app-summary">{options.summary}</p>
    <dl data-ui="app-meta">
      {each(
        options.meta,
        (item) => `${item.kind}:${item.term}`,
        (item) => (
          <>
            <dt>{item.term}</dt>
            <dd data-ui="app-meta-value" data-kind={item.kind}>
              {item.value}
            </dd>
          </>
        ),
      )}
    </dl>
    <div data-ui="app-actions">
      {actionButton(options.action)}
      {options.extra ?? ''}
    </div>
  </article>
)

export const card = appCard

export const cardGroups = <T,>(options: {
  groups: Array<{ key: string; title: string; items: readonly T[] }>
  id: (item: T) => unknown
  card: (item: T) => TemplateResult
  footer?: JSXChild
}): TemplateResult => (
  <div data-ui="app-groups">
    {each(
      options.groups,
      (group) => group.key,
      (group) => (
        <section data-ui="app-group" data-category={group.key}>
          <h2 data-ui="group-title">{group.title}</h2>
          <div data-ui="app-grid">{each(group.items, options.id, (item) => options.card(item))}</div>
        </section>
      ),
    )}
    {options.footer ?? ''}
  </div>
)

export const definitionList = (options: {
  title: string
  items: Array<{ key: string; term: string; value: string }>
}): TemplateResult => (
  <section data-ui="tokens">
    <h2 data-ui="group-title">{options.title}</h2>
    <dl data-ui="token-list">
      {each(
        options.items,
        (item) => item.key,
        (item) => (
          <div data-ui="token">
            <dt data-ui="token-name">{item.term}</dt>
            <dd data-ui="token-value">{item.value}</dd>
          </div>
        ),
      )}
    </dl>
  </section>
)
