import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { pageIdentityContent, type PageIdentityKind } from './page-shell.tsx'

export const HOOKS = [
  'record-page',
  'record-page-context',
  'record-page-header',
  'record-page-title-row',
  'record-page-heading',
  'record-page-title',
  'record-page-subline',
  'record-page-status',
  'record-page-description',
  'record-page-actions',
  'record-page-meta',
  'record-page-controller',
  'record-page-navigation',
  'record-page-layout',
  'record-page-body',
  'record-page-aside',
] as const

export type RecordPageSlots = {
  header: string
  body: string
  fragmentTitle?: string
}

export type RecordPageProps = {
  title: string
  body: JSXChild
  context?: JSXChild
  variant?: 'operational'
  scope?: string | null
  description?: string | null
  status?: JSXChild
  actions?: JSXChild
  meta?: JSXChild
  controller?: JSXChild
  navigation?: JSXChild
  aside?: JSXChild
  asideLabel?: string | null
  slots?: RecordPageSlots
}

type CompatibilityKind = Extract<PageIdentityKind, 'form-page'>

export const recordPage = (props: RecordPageProps, compatibilityKind?: CompatibilityKind): TemplateResult => {
  const kind = compatibilityKind ?? 'form-page'
  if (props.slots?.fragmentTitle !== undefined)
    return (
      <ket-fragments data-title={props.slots.fragmentTitle}>
        <template data-ket-slot={props.slots.header}>
          {pageIdentityContent(kind, { ...props, groupDescription: true })}
        </template>
        <template data-ket-slot={props.slots.body}>{props.body}</template>
      </ket-fragments>
    )
  return (
    <section
      data-ui={kind}
      data-scope={props.scope ?? null}
      data-has-aside={String(props.aside !== undefined)}
      data-variant={props.variant ?? null}
      data-pattern="record"
    >
      {props.context !== undefined && <div data-ui={`${kind}-context`}>{props.context}</div>}
      <header data-ui={`${kind}-header`} data-ket-slot={props.slots?.header}>
        {pageIdentityContent(kind, { ...props, groupDescription: true })}
      </header>
      {props.controller !== undefined && <div data-ui={`${kind}-controller`}>{props.controller}</div>}
      {props.navigation !== undefined && <div data-ui={`${kind}-navigation`}>{props.navigation}</div>}
      <div data-ui={`${kind}-layout`}>
        <div data-ui={`${kind}-body`} data-ket-slot={props.slots?.body}>
          {props.body}
        </div>
        {props.aside !== undefined && (
          <aside data-ui={`${kind}-aside`} aria-label={props.asideLabel ?? null}>
            {props.aside}
          </aside>
        )}
      </div>
    </section>
  )
}

/** One durable subject: create, edit, inspect or advance its workflow. */
export const RecordPage = (props: RecordPageProps): TemplateResult => recordPage(props)
