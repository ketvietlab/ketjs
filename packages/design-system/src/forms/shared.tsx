export type FieldIssue = { path: string; message: string }

export const issueFor = (issues: readonly FieldIssue[] | undefined, name: string): string | null =>
  issues?.find((issue) => issue.path === name)?.message ?? null

export { FieldFrame, describedBy } from '../primitives/field/frame.tsx'
export type { FieldFrameProps } from '../primitives/field/frame.tsx'
