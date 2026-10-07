import { jsx, jsxs } from './jsx-runtime.ts'
import type { JSXComponent } from './jsx-runtime.ts'
import type { TemplateResult } from './render.ts'

export { Fragment } from './jsx-runtime.ts'
export type { JSX, JSXChild, JSXComponent, IntrinsicProps } from './jsx-runtime.ts'

/** The development transform passes whether the children were written out in source. */
export function jsxDEV(
  type: string | JSXComponent<never>,
  properties: Record<string, unknown> | null,
  key?: unknown,
  isStaticChildren?: boolean,
): TemplateResult {
  return isStaticChildren
    ? jsxs(type as Parameters<typeof jsxs>[0], properties, key)
    : jsx(type as Parameters<typeof jsx>[0], properties, key)
}
