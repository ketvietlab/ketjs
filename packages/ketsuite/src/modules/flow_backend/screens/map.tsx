import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Framed, inline, linkButton } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

export type EpicMapScreenOptions = {
  projectName: string
  epicTitle: string
  epicHref: string
  epicsHref: string
  map: JSXChild
}

/** The dependency atlas remains the workspace; its frame only restores identity and escape paths. */
export const mapScreen = (_: Translator, frame: Frame, options: EpicMapScreenOptions): TemplateResult => (
  <Framed
    translator={_}
    title={options.epicTitle}
    subtitle={options.projectName}
    frame={frame}
    actions={inline([
      linkButton({
        href: options.epicHref,
        label: _('flow_backend.epics.document'),
        variant: 'secondary',
      }),
      linkButton({
        href: options.epicsHref,
        label: _('flow_backend.epics.backToProject'),
        variant: 'tertiary',
      }),
    ])}
    body={options.map}
  />
)
