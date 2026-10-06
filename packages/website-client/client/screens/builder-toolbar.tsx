import { builderPanel, builderQuery } from './builder-tools.tsx'
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
import { commandValue, icon } from '../ui.tsx'
import type { Entry, StudioContext, Viewport } from '../types.ts'
import type { BuilderDraft } from './builder-types.ts'
import type { ButtonProps } from '@ketvietlab/design-system'

export type BuilderToolbarProps = {
  entry: Entry
  draft: BuilderDraft
  previewWidth: Viewport
  zoom: number
  busy: boolean
  canWrite: boolean
  interactive?: boolean
}

// The current shared icon catalogue has no device glyphs. Keep these native SVG glyphs local.
const deviceIcon = (device: Viewport) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {device === 'desktop' ? (
      <>
        <rect x="3" y="3" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 16v5" />
      </>
    ) : device === 'tablet' ? (
      <>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    ) : (
      <>
        <rect x="6" y="2" width="12" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    )}
  </svg>
)

export function builderToolbar(
  ctx: StudioContext,
  { entry, draft, previewWidth, zoom, busy, canWrite, interactive }: BuilderToolbarProps,
) {
  const tr = ctx.tr
  const command = (key: string, extra: Partial<ButtonProps> = {}) => (
    <Button
      label={tr(`website.builder.${key}`)}
      name="command"
      value={commandValue(`builder.${key}`)}
      size="compact"
      {...extra}
    />
  )
  const devices = () => (
    <ActionGroup
      label={tr('website.builder.devices')}
      actions={(['desktop', 'tablet', 'mobile'] as const).map((device) => (
        <IconButton
          icon={deviceIcon(device)}
          label={tr(`website.workspace.device.${device}`)}
          pressed={previewWidth === device}
          variant={previewWidth === device ? 'primary' : 'tertiary'}
          size="compact"
          name="command"
          value={commandValue('builder.viewport', { device })}
        />
      ))}
    />
  )
  const zoomTools = () => (
    <div class="website-builder-zoom" role="group" aria-label={tr('website.builder.zoom')}>
      <IconButton
        icon={
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M5 12h14" />
          </svg>
        }
        label={tr('website.builder.zoomOut')}
        name="command"
        value={commandValue('builder.zoom', { by: '-10' })}
        size="compact"
        variant="tertiary"
        disabled={zoom <= 50}
      />
      <output class="website-builder-zoom-value" aria-live="polite">
        {zoom}%
      </output>
      <IconButton
        icon={icon('plus')}
        label={tr('website.builder.zoomIn')}
        name="command"
        value={commandValue('builder.zoom', { by: '10' })}
        size="compact"
        variant="tertiary"
        disabled={zoom >= 150}
      />
    </div>
  )
  const undo = (redo = false) => (
    <IconButton
      label={tr(redo ? 'website.builder.redo' : 'website.builder.undo')}
      name="command"
      value={commandValue(redo ? 'builder.redo' : 'builder.undo')}
      icon={
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path
            d={redo ? 'm15 5 5 5-5 5M20 10h-9a6 6 0 0 0-6 6v3' : 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 6 6v3'}
          />
        </svg>
      }
      variant="tertiary"
      size="compact"
      disabled={redo ? !draft.future.length : !draft.past.length}
    />
  )
  const details = {
    id: 'details',
    label: tr('website.builder.details'),
    href: ctx.href('entry-details', { id: entry.id }),
  }
  const save = () =>
    command('save', {
      label: entry.catalog
        ? tr(
            entry.catalog.mode === 'product'
              ? 'website.catalog.saveOverride'
              : 'website.catalog.saveTemplate',
          )
        : tr('website.builder.save'),
      disabled: !canWrite || !draft.dirty || busy,
    })
  const publish = (mobile = false) =>
    command('publish', {
      label: tr(mobile ? 'website.builder.publishShort' : 'website.builder.publish'),
      variant: 'primary',
      disabled: busy || !ctx.can('website.publish') || (draft.dirty && !canWrite),
    })
  const query = { ...builderQuery(ctx.route().query) }
  if (query.panel) query.panel = builderPanel(query.panel)
  const mobileTools = (
    <Popover
      id="builder-mobile-tools"
      label={tr('website.builder.more')}
      trigger={
        <span class="website-builder-more-trigger">
          <span aria-hidden="true">⋯</span>
          <span class="website-builder-drag-sr">{tr('website.builder.more')}</span>
        </span>
      }
      open={query.tools === 'open'}
      placement="bottom-end"
      openHref={ctx.href('builder', { id: entry.id }, { ...query, tools: 'open' })}
      closeHref={ctx.href('builder', { id: entry.id }, { ...query, tools: undefined })}
      closeLabel={tr('website.search.close')}
      body={
        <Stack
          items={[
            <Section title={tr('website.builder.devices')} body={devices()} />,
            <Section title={tr('website.builder.zoom')} body={zoomTools()} />,
            <ActionGroup label={tr('website.builder.historyActions')} actions={[undo(), undo(true)]} />,
            entry.catalog
              ? null
              : command('schedule', {
                  label: tr('website.entryPublish.schedule'),
                  value: commandValue('builder.openSchedule'),
                  disabled: busy || !ctx.can('website.publish'),
                }),
            entry.catalog ? null : <LinkButton label={details.label} href={details.href} size="compact" />,
            <LinkButton
              label={tr('website.builder.dialog.commands')}
              href={ctx.href(
                'builder',
                { id: entry.id },
                { ...builderQuery(ctx.route().query), tools: undefined, dialog: 'commands' },
              )}
              size="compact"
            />,
          ]}
        />
      }
    />
  )
  return (
    <>
      <div class="website-builder-toolbar-desktop">
        <ActionGroup
          label={tr('website.builder.actions')}
          actions={[
            command('interact', {
              label: tr(interactive ? 'website.builder.editCanvas' : 'website.builder.interact'),
              pressed: !!interactive,
              disabled: busy || !canWrite,
            }),
            entry.catalog ? null : command('preview', { disabled: busy }),
            devices(),
            zoomTools(),
            undo(),
            undo(true),
            save(),
            entry.catalog
              ? null
              : command('schedule', {
                  label: tr('website.entryPublish.schedule'),
                  value: commandValue('builder.openSchedule'),
                  disabled: busy || !ctx.can('website.publish'),
                }),
            entry.catalog ? null : publish(),
            <Menu
              id="builder-more"
              label={tr('website.builder.more')}
              trigger="⋯"
              size="compact"
              align="end"
              items={[
                ...(entry.catalog ? [] : [details]),
                {
                  id: 'commands',
                  label: tr('website.builder.dialog.commands'),
                  href: ctx.href(
                    'builder',
                    { id: entry.id },
                    { ...builderQuery(ctx.route().query), dialog: 'commands' },
                  ),
                },
              ]}
            />,
          ]}
        />
      </div>
      <div class="website-builder-toolbar-mobile" role="group" aria-label={tr('website.builder.actions')}>
        {command('interact', {
          label: tr(interactive ? 'website.builder.editCanvas' : 'website.builder.interact'),
          pressed: !!interactive,
          disabled: busy || !canWrite,
        })}
        {entry.catalog ? null : command('preview', { disabled: busy, variant: 'tertiary' })}
        {save()}
        {entry.catalog ? null : publish(true)}
        {mobileTools}
      </div>
    </>
  )
}
