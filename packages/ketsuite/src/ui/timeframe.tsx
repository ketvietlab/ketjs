// The period a screen reports on. The Design System owns the one implementation
// (`data-operations/timeframe-filter`); this keeps the admin's original call shape.

import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { TimeframeFilter } from '@ketvietlab/design-system'
import type { TimeframeFilterProps, TimeframeOption } from '@ketvietlab/design-system'

/** Hooks are declared by the Design System component this delegates to. */
export const HOOKS = [] as const

export type { TimeframeOption }
export type TimeframeFilterOptions = TimeframeFilterProps

export const timeframeFilter = (o: TimeframeFilterOptions): TemplateResult => TimeframeFilter(o)
