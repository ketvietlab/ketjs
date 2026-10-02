import { builderPanel, builderQuery } from './builder-tools.mjs'
import { html } from '@ketvietlab/ketjs-view'
import {
  ActionGroup,
  Button,
  IconButton,
  LinkButton,
  Menu,
  Popover,
  Stack,
  Section,
} from '@ketvietlab/design-system'
import { h, commandValue, icon } from '../ui.mjs'
// The current shared icon catalogue has no device glyphs. Keep these native SVG glyphs local.
const deviceIcon = (device) =>
  html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    device === 'desktop'
      ? html`<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>`
      : device === 'tablet'
        ? html`<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>`
        : html`<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>`
  }</svg>`

export function builderToolbar(ctx, { entry, draft, previewWidth, zoom, busy, canWrite }) {
  const tr = ctx.tr
  const command = (key, extra = {}) =>
    h(Button, {
      label: tr(`website.builder.${key}`),
      name: 'command',
      value: commandValue(`builder.${key}`),
      size: 'compact',
      ...extra,
    })
  const devices = () =>
    h(ActionGroup, {
      label: tr('website.builder.devices'),
      actions: ['desktop', 'tablet', 'mobile'].map((device) =>
        h(IconButton, {
          icon: deviceIcon(device),
          label: tr(`website.workspace.device.${device}`),
          pressed: previewWidth === device,
          variant: previewWidth === device ? 'primary' : 'tertiary',
          size: 'compact',
          name: 'command',
          value: commandValue('builder.viewport', { device }),
        }),
      ),
    })
  const zoomTools =
    () => html`<div class="website-builder-zoom" role="group" aria-label=${tr('website.builder.zoom')}>
    ${h(IconButton, { icon: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14"/></svg>`, label: tr('website.builder.zoomOut'), name: 'command', value: commandValue('builder.zoom', { by: '-10' }), size: 'compact', variant: 'tertiary', disabled: zoom <= 50 })}
    <output class="website-builder-zoom-value" aria-live="polite">${zoom}%</output>
    ${h(IconButton, { icon: icon('plus'), label: tr('website.builder.zoomIn'), name: 'command', value: commandValue('builder.zoom', { by: '10' }), size: 'compact', variant: 'tertiary', disabled: zoom >= 150 })}
  </div>`
  const undo = (redo = false) =>
    h(IconButton, {
      label: tr(redo ? 'website.builder.redo' : 'website.builder.undo'),
      name: 'command',
      value: commandValue(redo ? 'builder.redo' : 'builder.undo'),
      icon: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d=${redo ? 'm15 5 5 5-5 5M20 10h-9a6 6 0 0 0-6 6v3' : 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 6 6v3'} /></svg>`,
      variant: 'tertiary',
      size: 'compact',
      disabled: redo ? !draft.future.length : !draft.past.length,
    })
  const details = {
    id: 'details',
    label: tr('website.builder.details'),
    href: ctx.href('entry-details', { id: entry.id }),
  }
  const save = () => command('save', { disabled: !canWrite || !draft.dirty || busy })
  const publish = (mobile = false) =>
    command('publish', {
      label: tr(mobile ? 'website.builder.publishShort' : 'website.builder.publish'),
      variant: 'primary',
      disabled: busy || !ctx.can('website.publish') || (draft.dirty && !canWrite),
    })
  const query = { ...builderQuery(ctx.route().query) }
  if (query.panel) query.panel = builderPanel(query.panel)
  const mobileTools = h(Popover, {
    id: 'builder-mobile-tools',
    label: tr('website.builder.more'),
    trigger: html`<span class="website-builder-more-trigger" aria-label=${tr('website.builder.more')}><span aria-hidden="true">⋯</span><span class="website-builder-drag-sr">${tr('website.builder.more')}</span></span>`,
    open: query.tools === 'open',
    placement: 'bottom-end',
    openHref: ctx.href('builder', { id: entry.id }, { ...query, tools: 'open' }),
    closeHref: ctx.href('builder', { id: entry.id }, { ...query, tools: undefined }),
    closeLabel: tr('website.search.close'),
    body: h(Stack, {
      items: [
        h(Section, { title: tr('website.builder.devices'), body: devices() }),
        h(Section, { title: tr('website.builder.zoom'), body: zoomTools() }),
        h(ActionGroup, { label: tr('website.builder.historyActions'), actions: [undo(), undo(true)] }),
        command('schedule', {
          label: tr('website.entryPublish.schedule'),
          value: commandValue('builder.openSchedule'),
          disabled: busy || !ctx.can('website.publish'),
        }),
        h(LinkButton, { label: details.label, href: details.href, size: 'compact' }),
        h(LinkButton, {
          label: tr('website.builder.dialog.commands'),
          href: ctx.href(
            'builder',
            { id: entry.id },
            { ...builderQuery(ctx.route().query), tools: undefined, dialog: 'commands' },
          ),
          size: 'compact',
        }),
      ],
    }),
  })
  return html`<div class="website-builder-toolbar-desktop">${h(ActionGroup, {
    label: tr('website.builder.actions'),
    actions: [
      command('preview', { disabled: busy }),
      devices(),
      zoomTools(),
      undo(),
      undo(true),
      save(),
      command('schedule', {
        label: tr('website.entryPublish.schedule'),
        value: commandValue('builder.openSchedule'),
        disabled: busy || !ctx.can('website.publish'),
      }),
      publish(),
      h(Menu, {
        id: 'builder-more',
        label: tr('website.builder.more'),
        trigger: '⋯',
        size: 'compact',
        align: 'end',
        items: [
          details,
          {
            id: 'commands',
            label: tr('website.builder.dialog.commands'),
            href: ctx.href(
              'builder',
              { id: entry.id },
              { ...builderQuery(ctx.route().query), dialog: 'commands' },
            ),
          },
        ],
      }),
    ],
  })}</div><div class="website-builder-toolbar-mobile" role="group" aria-label=${tr('website.builder.actions')}>
    ${command('preview', { disabled: busy, variant: 'tertiary' })}${save()}${publish(true)}${mobileTools}
  </div>`
}
