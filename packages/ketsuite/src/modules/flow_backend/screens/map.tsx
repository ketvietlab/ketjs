import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Framed, Section } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

export const mapScreen = (_: Translator, frame: Frame, epicTitle: string, map: JSXChild): TemplateResult => (
  <Framed translator={_} title={epicTitle} frame={frame} body={<Section title={epicTitle} body={map} />} />
)
