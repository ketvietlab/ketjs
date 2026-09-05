import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { RecordPage, type RecordPageProps } from './record-page.tsx'

export type FormPageProps = RecordPageProps

/** @deprecated Use RecordPage. */
export const FormPage = (props: FormPageProps): TemplateResult => <RecordPage {...props} />
