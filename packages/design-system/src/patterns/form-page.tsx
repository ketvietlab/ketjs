import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'form-page',
  'form-page-header',
  'form-page-title-row',
  'form-page-heading',
  'form-page-title',
  'form-page-subline',
  'form-page-status',
  'form-page-description',
  'form-page-actions',
  'form-page-meta',
  'form-page-controller',
  'form-page-navigation',
  'form-page-layout',
  'form-page-body',
  'form-page-aside',
] as const

export type FormPageSlots = {
  header: string
  body: string
  /** Present only when returning the two slots as a fragment response. */
  fragmentTitle?: string
}

export type FormPageProps = {
  title: string
  body: JSXChild
  scope?: string | null
  description?: string | null
  status?: JSXChild
  actions?: JSXChild
  meta?: JSXChild
  controller?: JSXChild
  navigation?: JSXChild
  aside?: JSXChild
  asideLabel?: string | null
  slots?: FormPageSlots
}

/**
 * The baseline for an operational create or edit screen.
 *
 * Applications own translated copy, fields and business actions. This pattern
 * keeps record identity and the primary decision together, gives the form one
 * stable reading column, and reserves an optional rail for durable context.
 */
const formPageHeader = (props: FormPageProps): TemplateResult => (
  <>
    <div data-ui="form-page-title-row">
      <div data-ui="form-page-heading">
        <h1 data-ui="form-page-title">{props.title}</h1>
        {(!!props.description || props.status !== undefined) && (
          <div data-ui="form-page-subline">
            {!!props.description && <p data-ui="form-page-description">{props.description}</p>}
            {props.status !== undefined && <span data-ui="form-page-status">{props.status}</span>}
          </div>
        )}
      </div>
      {props.actions !== undefined && <div data-ui="form-page-actions">{props.actions}</div>}
    </div>
    {props.meta !== undefined && <div data-ui="form-page-meta">{props.meta}</div>}
  </>
)

export const FormPage = (props: FormPageProps): TemplateResult => {
  if (props.slots?.fragmentTitle !== undefined)
    return (
      <ket-fragments data-title={props.slots.fragmentTitle}>
        <template data-ket-slot={props.slots.header}>{formPageHeader(props)}</template>
        <template data-ket-slot={props.slots.body}>{props.body}</template>
      </ket-fragments>
    )
  return (
    <section
      data-ui="form-page"
      data-scope={props.scope ?? null}
      data-has-aside={String(props.aside !== undefined)}
    >
      <header data-ui="form-page-header" data-ket-slot={props.slots?.header}>
        {formPageHeader(props)}
      </header>
      {props.controller !== undefined && <div data-ui="form-page-controller">{props.controller}</div>}
      {props.navigation !== undefined && <div data-ui="form-page-navigation">{props.navigation}</div>}
      <div data-ui="form-page-layout">
        <div data-ui="form-page-body" data-ket-slot={props.slots?.body}>
          {props.body}
        </div>
        {props.aside !== undefined && (
          <aside data-ui="form-page-aside" aria-label={props.asideLabel ?? null}>
            {props.aside}
          </aside>
        )}
      </div>
    </section>
  )
}
