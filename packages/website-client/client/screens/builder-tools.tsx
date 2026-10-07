import { fragments, icon } from '../ui.tsx'
import type { StudioContext } from '../types.ts'
import type { BuilderEditor } from './builder-types.ts'

export const BUILDER_PANELS = ['structure', 'library', 'page-settings', 'styles', 'history']
export const builderPanel = (value: string | undefined): string =>
  value && BUILDER_PANELS.includes(value) ? value : 'structure'
/** The builder's query with a known panel; a key set to `undefined` drops it from the link. */
export const builderQuery = (
  query: Record<string, string | undefined> = {},
): Record<string, string | undefined> & { panel: string } => ({
  ...query,
  panel: builderPanel(query.panel),
})
export function createBuilderTools(ctx: StudioContext, editor: Omit<BuilderEditor, 'templates'>) {
  return {
    navigation: () => (
      <nav class="website-builder-panels" aria-label={ctx.tr('website.tools.panels')}>
        {fragments(
          BUILDER_PANELS.filter(
            (key) =>
              !editor.draft().entry.catalog ||
              (editor.draft().entry.catalog?.mode === 'product'
                ? key === 'structure'
                : ['structure', 'library', 'styles'].includes(key)),
          ).map((key) => (
            <a
              href={ctx.href(
                'builder',
                { id: editor.draft().entry.id },
                { panel: key, node: ctx.route().query.node },
              )}
              title={ctx.tr(`website.tools.${key}`)}
              aria-label={ctx.tr(`website.tools.${key}`)}
              aria-current={builderPanel(ctx.route().query.panel) === key ? 'page' : null}
            >
              <span class="website-builder-tool-icon">
                {icon(
                  (
                    {
                      structure: 'list',
                      library: 'layout-grid',
                      'page-settings': 'settings',
                      styles: 'sliders-horizontal',
                      history: 'calendar',
                    } as Record<string, string>
                  )[key],
                )}
              </span>
              <span class="website-builder-tool-label">{ctx.tr(`website.tools.${key}`)}</span>
            </a>
          )),
        )}
      </nav>
    ),
  }
}
