import { compileKtl } from '../theme/ktl/compile.ts'
import type { CompileOpts, Scope } from '../theme/ktl/compile.ts'
import { parseReportMarkup } from './markup.ts'

export { parseReportMarkup, renderReportHtml } from './markup.ts'
export type { ReportDocument, ReportElement, ReportNode, ReportTag } from './markup.ts'
export { renderPdf } from './render.ts'
export type { PdfRenderOptions } from './render.ts'
export { parseTrueType } from './font.ts'
export type { TrueTypeFont } from './font.ts'
export { parseImage } from './image.ts'
export type { PdfImage } from './image.ts'

/** Static Inter shipped with the framework for deterministic server-side PDF output. */
export const interFontUrl = (weight: 'regular' | 'semibold' | 'bold' = 'regular'): URL =>
  new URL(
    `./assets/Inter-${weight === 'semibold' ? 'SemiBold' : weight === 'bold' ? 'Bold' : 'Regular'}.ttf`,
    import.meta.url,
  )

export function compileReportTemplate(source: string, opts: Omit<CompileOpts, 'mode'> = {}) {
  const template = compileKtl(source, { ...opts, mode: 'report' })
  return {
    render(scope: Scope) {
      return parseReportMarkup(template.render(scope))
    },
  }
}
