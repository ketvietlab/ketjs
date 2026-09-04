import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { recordPage, type RecordPageProps, type RecordPageSlots } from './record-page.tsx'

export const HOOKS = [
  'form-page',
  'form-page-context',
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

export type FormPageSlots = RecordPageSlots
export type FormPageProps = RecordPageProps

/** @deprecated Use RecordPage. Retained while application call sites migrate. */
export const FormPage = (props: FormPageProps): TemplateResult => recordPage(props, 'form-page')
