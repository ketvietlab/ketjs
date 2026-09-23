import type { ComponentGroup } from './specimens.tsx'
import { componentGroups as specimenGroups } from './specimens.tsx'

export type CatalogueMaturity = 'stable' | 'deprecated'
export type CatalogueState =
  | 'default'
  | 'disabled'
  | 'loading'
  | 'empty'
  | 'invalid'
  | 'responsive'
  | 'selected'

export type GovernedComponentGroup = ComponentGroup & {
  owner: string
  maturity: CatalogueMaturity
  states: readonly CatalogueState[]
}

export const groupGovernance: Readonly<
  Record<string, Pick<GovernedComponentGroup, 'owner' | 'maturity' | 'states'>>
> = Object.freeze({
  actions: { owner: 'Actions', maturity: 'stable', states: ['default', 'disabled', 'loading'] },
  status: { owner: 'Status', maturity: 'stable', states: ['default'] },
  feedback: { owner: 'Feedback', maturity: 'stable', states: ['default', 'empty', 'loading'] },
  fields: { owner: 'Forms', maturity: 'stable', states: ['default', 'disabled', 'invalid', 'responsive'] },
  'field-states': {
    owner: 'Forms',
    maturity: 'stable',
    states: ['default', 'disabled', 'invalid', 'responsive'],
  },
  layouts: { owner: 'Layout', maturity: 'stable', states: ['default', 'selected', 'responsive'] },
  'application-structure': {
    owner: 'Page patterns',
    maturity: 'stable',
    states: ['default', 'responsive'],
  },
  navigation: { owner: 'Navigation', maturity: 'stable', states: ['default', 'selected', 'responsive'] },
  interactions: {
    owner: 'Interaction foundations',
    maturity: 'stable',
    states: ['default', 'disabled', 'loading', 'responsive'],
  },
  'form-controls': {
    owner: 'Forms',
    maturity: 'stable',
    states: ['default', 'disabled', 'loading', 'empty', 'invalid', 'responsive', 'selected'],
  },
  'data-operations': {
    owner: 'Data operations',
    maturity: 'stable',
    states: ['default', 'selected', 'loading', 'empty', 'invalid', 'responsive'],
  },
  'record-workspace': {
    owner: 'Record composition',
    maturity: 'stable',
    states: ['default', 'loading', 'empty', 'invalid', 'responsive'],
  },
  patterns: { owner: 'Page patterns', maturity: 'stable', states: ['default', 'empty', 'responsive'] },
})

export const componentGroups: readonly GovernedComponentGroup[] = specimenGroups.map((group) => {
  const governance = groupGovernance[group.id]
  if (!governance) throw new Error(`Missing catalogue governance for ${group.id}.`)
  return { ...group, ...governance }
})
