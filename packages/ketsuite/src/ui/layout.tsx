// The frame a screen sits in, and the shared arrangements inside it.

import { each } from 'ketjs-view'
import type { JSXChild, TemplateResult } from 'ketjs-view'
import { NAVIGATION_TYPE, fragment, isNavigationRequest, page, withHeaders } from 'ketjs'
import type { MenuNode, Route, ServeContext, Translator } from 'ketjs'
import { sidebar, sidebarMain } from './nav.tsx'
import type { Indicator, Viewer } from './nav.tsx'
import { listChrome } from './chrome.tsx'
import type { ListChrome } from './chrome.tsx'
import { actionButton } from './primitives.tsx'
import { icon } from './icons.ts'
import { recordWorkspace } from './record.tsx'

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
  'context-switcher',
  'context-company',
  'context-branch',
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
  navigation?: boolean
}

const topbarContent = (_: Translator, title: string, frame: Frame): TemplateResult => {
  const { viewer = null, extras = {} } = frame
  return (
    <>
      {frame.chrome ? listChrome(_, title, frame.chrome) : <h1 data-ui="title">{title}</h1>}
      {!!viewer?.contextPath && (
        <a
          data-ui="context-switcher"
          href={viewer.contextPath}
          title={`${viewer.companyName ?? viewer.company ?? ''}${viewer.branchName ? ` · ${viewer.branchName}` : ''}`}
        >
          <span data-ui="context-company">{viewer.companyName ?? viewer.company}</span>
          {!!viewer.branchName && <span data-ui="context-branch">{viewer.branchName}</span>}
        </a>
      )}
      {extras['topbar.end'] ?? ''}
    </>
  )
}

export const shell = (
  _: Translator,
  title: string,
  body: TemplateResult,
  frame: Frame = {},
): TemplateResult => {
  const { viewer = null, extras = {}, menu = [], indicators = [] } = frame
  const sidebarOptions = {
    menu,
    viewer,
    indicators,
    menuFilter: frame.menuFilter,
    navItems: extras['nav.items'],
    footItems: extras['sidebar.foot'],
  }
  if (frame.navigation)
    return (
      <ket-fragments data-title={title}>
        <template data-ket-slot="backend.sidebar-main">{sidebarMain(_, sidebarOptions)}</template>
        <template data-ket-slot="backend.topbar">{topbarContent(_, title, frame)}</template>
        <template data-ket-slot="backend.content">{body}</template>
      </ket-fragments>
    )
  return (
    <div data-ui="shell">
      {sidebar(_, sidebarOptions)}
      <main data-ui="main">
        <header data-ui="topbar" data-ket-slot="backend.topbar">
          {topbarContent(_, title, frame)}
        </header>
        <div data-ui="content" data-ket-slot="backend.content">
          {body}
        </div>
      </main>
    </div>
  )
}

export const backendPage = async (
  ctx: ServeContext,
  req: Parameters<Route>[1],
  options: { lang: string; title: string; body: TemplateResult; status?: number },
) => {
  if (isNavigationRequest(req))
    return withHeaders(fragment(options.body, { status: options.status, type: NAVIGATION_TYPE }), {
      vary: 'X-Ket-Navigation',
    })
  return withHeaders(
    page({
      body: ctx.document({
        lang: options.lang,
        title: options.title,
        head: await ctx.styles(req),
        body: options.body,
      }),
      status: options.status,
    }),
    { vary: 'X-Ket-Navigation' },
  )
}

/**
 * Every operational page gets the same bordered header/body sheet as accounting.
 * A screen that already supplies a richer record workspace is flattened by CSS,
 * so its domain-specific identity, facts, tabs, and collaboration rail remain the
 * only visible workspace rather than being wrapped in a second card.
 */
export const framed = (_: Translator, title: string, frame: Frame, body: TemplateResult): TemplateResult =>
  shell(
    _,
    title,
    recordWorkspace({
      pageFrame: true,
      title,
      imageFallback: icon('layout-grid'),
      body,
    }),
    frame,
  )

/** JSX entry point for backend screens; `framed` remains for extension compatibility. */
export const framedPage = (options: {
  translator: Translator
  title: string
  frame: Frame
  body: TemplateResult
}): TemplateResult => framed(options.translator, options.title, options.frame, options.body)

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
