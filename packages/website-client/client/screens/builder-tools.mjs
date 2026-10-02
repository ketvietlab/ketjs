import { html } from '@ketvietlab/ketjs-view'
import { fragments, icon } from '../ui.mjs'
export const BUILDER_PANELS = ['structure', 'library', 'page-settings', 'styles', 'history']
export const builderPanel = (value) => (BUILDER_PANELS.includes(value) ? value : 'structure')
export const builderQuery = (query = {}) => ({ ...query, panel: builderPanel(query.panel) })
export function createBuilderTools(ctx, editor) {
  return {
    navigation: () =>
      html`<nav class="website-builder-panels" aria-label=${ctx.tr('website.tools.panels')}>${fragments(BUILDER_PANELS.map((key) => html`<a href=${ctx.href('builder', { id: editor.draft().entry.id }, { panel: key, node: ctx.route().query.node })} title=${ctx.tr(`website.tools.${key}`)} aria-label=${ctx.tr(`website.tools.${key}`)} aria-current=${builderPanel(ctx.route().query.panel) === key ? 'page' : null}><span class="website-builder-tool-icon">${icon({ structure: 'list', library: 'plus', 'page-settings': 'settings', styles: 'sliders-horizontal', history: 'calendar' }[key])}</span><span class="website-builder-tool-label">${ctx.tr(`website.tools.${key}`)}</span></a>`))}</nav>`,
  }
}
