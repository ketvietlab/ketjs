// The frame a screen sits in, and the shared arrangements inside it.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { NAVIGATION_TYPE, fragment, isNavigationRequest, page, withHeaders } from '@ketvietlab/ketjs'
import type { MenuNode, Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import {
  ListPage as DesignSystemListPage,
  RecordPage as DesignSystemRecordPage,
  WorkspacePage as DesignSystemWorkspacePage,
} from '@ketvietlab/design-system'
import { sidebar, sidebarMain } from './nav.tsx'
import type { Indicator, Viewer } from './nav.tsx'
import { listChrome } from './chrome.tsx'
import type { ListChrome } from './chrome.tsx'
import { pageContextFromFrame } from './navigation.tsx'

export const HOOKS = [
  'shell',
  'main',
  'topbar',
  'content',
  'group-title',
  'tokens',
  'token-list',
  'token',
  'token-name',
  'token-value',
] as const

export type Extras = {
  runtime?: JSXChild
  'topbar.end'?: JSXChild
  'sidebar.foot'?: JSXChild
  'nav.items'?: JSXChild
}

export type Frame = {
  viewer?: Viewer | null
  indicators?: Indicator[]
  menuFilter?: string | null
  extras?: Extras
  menu?: MenuNode[]
  chrome?: ListChrome | null
  navigation?: boolean
  /** False when the body opens with its own heading, so the topbar does not repeat it. */
  titled?: boolean
  /** False when a self-titled workspace replaces the shared topbar. */
  topbar?: boolean
}

/**
 * The topbar shows the page's name only when nothing below it does.
 *
 * A framed screen already opens with `record-heading`, so putting the title in the
 * bar too printed it twice, one line apart, in a different size — the second one
 * adding nothing. A list's chrome owns the row instead.
 */
const topbarContent = (_: Translator, title: string, frame: Frame): TemplateResult => {
  const { extras = {} } = frame
  return (
    <>
      {frame.chrome ? (
        listChrome(_, title, frame.chrome, frame.titled !== false)
      ) : frame.titled === false ? (
        ''
      ) : (
        <h1 data-ui="title">{title}</h1>
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
        <template data-ket-slot="backend.topbar">
          {frame.topbar === false ? '' : topbarContent(_, title, frame)}
        </template>
        <template data-ket-slot="backend.content">{body}</template>
      </ket-fragments>
    )
  return (
    <div data-ui="shell" data-kv-design-system>
      {sidebar(_, sidebarOptions)}
      <main data-ui="main">
        {extras.runtime ?? ''}
        {frame.topbar === false ? (
          ''
        ) : (
          <header data-ui="topbar" data-ket-slot="backend.topbar">
            {topbarContent(_, title, frame)}
          </header>
        )}
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
 * Compatibility frame for operational screens that have not yet selected a more
 * specific page pattern. It keeps the operational workspace semantics used by
 * boards and reports, while the compact RecordWorkspace header avoids repeating
 * the module identity as a breadcrumb, kicker and large glyph. A richer
 * RecordWorkspace nested in the body keeps its own record header; the
 * compatibility heading is flattened for that case in record.css.
 */
export type OperationalScreenOptions = {
  translator: Translator
  title: string
  frame: Frame
  body: TemplateResult
  /** The section above the title. Defaults to the active root's name. */
  kicker?: string | null
  /** One line on what this screen is for. Worth writing; there is no sensible default. */
  subtitle?: string | null
  /** A semantic glyph. Defaults to the active root's. */
  icon?: string | null
  /**
   * A column beside the body, for what accompanies a screen rather than
   * continues it — an activity feed, a summary. `recordWorkspace` has had the
   * slot all along; this only passes it through, so a full-page screen can use
   * the same rail a record detail does instead of stacking the aside under the
   * content and calling it a sidebar.
   */
  aside?: JSXChild
  asideLabel?: string | null
  /**
   * What this screen offers beside its title — the one thing you came here to
   * start. It shares the row with a list's chrome rather than replacing it, so a
   * screen can both filter and offer an action; a screen with neither leaves the
   * row out entirely.
   */
  actions?: JSXChild
}

const operationalActions = (options: OperationalScreenOptions): JSXChild | undefined =>
  options.frame.extras?.['topbar.end'] !== undefined || options.actions !== undefined ? (
    <>
      {options.actions ?? ''}
      {options.frame.extras?.['topbar.end'] ?? ''}
    </>
  ) : undefined

const operationalShell = (options: OperationalScreenOptions, body: TemplateResult): TemplateResult =>
  shell(options.translator, options.title, body, { ...options.frame, titled: false, topbar: false })

export const listScreen = (options: OperationalScreenOptions): TemplateResult =>
  operationalShell(
    options,
    <DesignSystemListPage
      variant="operational"
      context={pageContextFromFrame(options.title, options.frame)}
      eyebrow={options.kicker}
      title={options.title}
      description={options.subtitle}
      actions={operationalActions(options)}
      controls={
        options.frame.chrome
          ? listChrome(options.translator, options.title, options.frame.chrome, false)
          : undefined
      }
      body={options.body}
    />,
  )

export const recordScreen = (options: OperationalScreenOptions): TemplateResult =>
  operationalShell(
    options,
    <DesignSystemRecordPage
      variant="operational"
      context={pageContextFromFrame(options.title, options.frame)}
      title={options.title}
      description={options.subtitle}
      actions={operationalActions(options)}
      controller={
        options.frame.chrome
          ? listChrome(options.translator, options.title, options.frame.chrome, false)
          : undefined
      }
      body={options.body}
      aside={options.aside}
      asideLabel={options.asideLabel}
    />,
  )

export const workspaceScreen = (
  options: OperationalScreenOptions & { layout?: 'flow' | 'canvas' },
): TemplateResult =>
  operationalShell(
    options,
    <DesignSystemWorkspacePage
      variant="operational"
      layout={options.layout ?? 'flow'}
      context={pageContextFromFrame(options.title, options.frame)}
      eyebrow={options.kicker}
      title={options.title}
      description={options.subtitle}
      actions={operationalActions(options)}
      controls={
        options.frame.chrome
          ? listChrome(options.translator, options.title, options.frame.chrome, false)
          : undefined
      }
      body={options.body}
    />,
  )

/** @deprecated Select ListScreen, RecordScreen or WorkspaceScreen. */
export const framedPage = (options: OperationalScreenOptions): TemplateResult => {
  return workspaceScreen(options)
}

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
