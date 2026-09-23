import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { ActionGroup } from '../../primitives/actions/index.tsx'
import { Section } from '../../layouts/layout/index.tsx'
import { DescriptionList, Person, Status } from '../display/index.tsx'
import type { KeyValueProps, PersonProps } from '../display/index.tsx'
import type { Tone } from '../../primitives/status/index.tsx'

export const HOOKS = ['record-summary', 'record-summary-main', 'record-actions', 'record-rail'] as const

export type RecordSummaryProps = {
  title: JSXChild
  subtitle?: JSXChild
  person?: PersonProps
  status?: { label: string; tone?: Tone; detail?: string }
  facts?: readonly (KeyValueProps & { id: string })[]
}

export const RecordSummary = (props: RecordSummaryProps): TemplateResult => (
  <header data-ui="record-summary">
    <div data-ui="record-summary-main">
      <h2>{props.title}</h2>
      {props.subtitle !== undefined && <p>{props.subtitle}</p>}
      {props.person && <Person {...props.person} />}
    </div>
    {props.status && <Status {...props.status} />}
    {props.facts && <DescriptionList items={props.facts} columns={3} />}
  </header>
)

export const RecordActions = (props: { label?: string; actions: readonly JSXChild[] }): TemplateResult => (
  <nav data-ui="record-actions" aria-label={props.label ?? 'Record actions'}>
    <ActionGroup actions={props.actions} />
  </nav>
)

export type RecordRailSection = { id: string; title: string; body: JSXChild; actions?: JSXChild }
export const RecordRail = (props: {
  label?: string
  sections: readonly RecordRailSection[]
}): TemplateResult => (
  <aside data-ui="record-rail" aria-label={props.label ?? 'Record context'}>
    {each(
      props.sections,
      (section) => section.id,
      (section) => (
        <Section title={section.title} body={section.body} actions={section.actions} />
      ),
    )}
  </aside>
)
