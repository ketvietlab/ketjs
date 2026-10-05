import {
  Checkbox,
  DataTable,
  Grid,
  Inline,
  Notice,
  Select,
  Stack,
  Status,
  Surface,
  TextField,
} from '@ketvietlab/design-system'
import { CommandButton } from '../ui.tsx'
import type { ResourceRecord } from '../resources.ts'
import type { Commands, StudioContext } from '../types.ts'

/** A setting as the theme's manifest declares it; `label` and `labels` are the theme's own words. */
type ThemeSetting =
  | { type: 'enum'; values: string[]; default?: string; label?: string; labels?: Record<string, string> }
  | { type: 'text'; maxLength: number; default?: string; label?: string }
  | { type: 'bool'; default?: boolean; label?: string }
/** One of the company's themes at its newest version the site may switch to. */
export type CompanyTheme = {
  id: string
  key: string
  title: string
  version: string
  settings: Record<string, ThemeSetting>
}
/** What the site's draft style holds once a company theme is chosen. */
type Selected = {
  key: string
  versionId: string
  version: string
  settings: Record<string, string | boolean>
}

const selectedOf = (record: ResourceRecord): Selected | null => {
  const theme = record.theme as Selected | undefined
  return theme && typeof theme.versionId === 'string' ? theme : null
}
const themesOf = (record: ResourceRecord): CompanyTheme[] | null =>
  Array.isArray(record.companyThemes) ? (record.companyThemes as CompanyTheme[]) : null
const settingName = (name: string) => `theme-setting-${name}`

/**
 * The company's own themes on the site's style page. A theme replaces the bundled preset's look; the
 * choice is a draft, as every style change is, and reaches visitors with the next publish.
 */
export function companyThemeSection(ctx: StudioContext, record: ResourceRecord) {
  const tr = ctx.tr
  const themes = themesOf(record)
  if (!themes || !ctx.can('website.theme.select')) return null
  const selected = selectedOf(record)
  const offered = selected ? themes.find((theme) => theme.key === selected.key) : undefined
  // Settings follow the version in use; an older version keeps its values until it is updated.
  const schema = offered?.id === selected?.versionId ? offered?.settings : undefined
  const settings = Object.entries(schema ?? {})
  const disabled = ctx.busy()
  return (
    <Surface
      title={tr('website.companyTheme.title')}
      actions={
        selected ? (
          <Inline
            items={[
              <CommandButton
                label={tr('website.companyTheme.clear')}
                command="companyTheme.clear"
                disabled={disabled}
              />,
              settings.length ? (
                <CommandButton
                  label={tr('website.companyTheme.saveSettings')}
                  command="companyTheme.settings"
                  type="submit"
                  form="company-theme-settings"
                  variant="primary"
                  disabled={disabled}
                />
              ) : null,
            ]}
          />
        ) : undefined
      }
      body={
        <Stack
          items={[
            <Notice
              title={
                selected
                  ? tr('website.companyTheme.using', {
                      title: offered?.title ?? selected.key,
                      version: selected.version,
                    })
                  : tr('website.companyTheme.none')
              }
              message={tr('website.companyTheme.draftHelp')}
              tone="info"
            />,
            <DataTable
              rows={themes}
              id={(theme) => theme.id}
              columns={[
                {
                  key: 'title',
                  label: tr('website.companyTheme.name'),
                  cell: (theme: CompanyTheme) => theme.title,
                  priority: 'primary' as const,
                },
                {
                  key: 'version',
                  label: tr('website.companyTheme.version'),
                  cell: (theme: CompanyTheme) => theme.version,
                },
                {
                  key: 'state',
                  label: tr('website.companyTheme.state'),
                  cell: (theme: CompanyTheme) =>
                    theme.id === selected?.versionId ? (
                      <Status label={tr('website.companyTheme.inUse')} tone="positive" />
                    ) : theme.key === selected?.key ? (
                      <Status
                        label={tr('website.companyTheme.update', { version: selected.version })}
                        tone="warning"
                      />
                    ) : null,
                },
                {
                  key: 'action',
                  label: tr('website.companyTheme.action'),
                  cell: (theme: CompanyTheme) =>
                    theme.id === selected?.versionId ? null : (
                      <CommandButton
                        label={tr(
                          theme.key === selected?.key
                            ? 'website.companyTheme.updateTo'
                            : 'website.companyTheme.use',
                          { version: theme.version },
                        )}
                        command="companyTheme.select"
                        args={{ id: theme.id }}
                        disabled={disabled}
                      />
                    ),
                },
              ]}
              emptyTitle={tr('website.companyTheme.empty')}
              emptyMessage={tr('website.companyTheme.emptyHelp')}
            />,
            selected && settings.length ? (
              <form id="company-theme-settings" novalidate>
                <Grid
                  columns={2}
                  items={settings.map(([name, spec]) => {
                    const props = {
                      id: settingName(name),
                      name: settingName(name),
                      label: spec.label ?? name,
                      disabled,
                    }
                    const value = selected.settings[name] ?? spec.default
                    if (spec.type === 'bool') return <Checkbox {...props} checked={value === true} />
                    if (spec.type === 'enum')
                      return (
                        <Select
                          {...props}
                          value={String(value ?? spec.values[0])}
                          options={spec.values.map((option) => ({
                            value: option,
                            label: spec.labels?.[option] ?? option,
                          }))}
                        />
                      )
                    return <TextField {...props} value={String(value ?? '')} maxLength={spec.maxLength} />
                  })}
                />
              </form>
            ) : null,
          ]}
        />
      }
    />
  )
}

/** The settings a form holds for a schema: a checkbox is present only when ticked. */
const settingsFrom = (form: FormData, schema: Record<string, ThemeSetting>) =>
  Object.fromEntries(
    Object.entries(schema).map(([name, spec]) => [
      name,
      spec.type === 'bool' ? form.has(settingName(name)) : String(form.get(settingName(name)) ?? ''),
    ]),
  )

/** Commands of the section; `current` is the themes resource the page last read. */
export function companyThemeCommands(ctx: StudioContext, current: () => ResourceRecord): Commands {
  const select = async (versionId: string | null, settings?: Record<string, string | boolean>) => {
    const record = current()
    await ctx.call('website_studio.selectCompanyTheme', {
      siteId: ctx.site().id,
      id: record.id,
      expectedRevisionId: record.revisionId,
      versionId,
      ...(settings ? { settings } : {}),
    })
    ctx.notify(ctx.tr('website.companyTheme.saved'))
    await ctx.refresh()
  }
  return {
    'companyTheme.select': async (args) => {
      const record = current()
      const theme = themesOf(record)?.find((t) => t.id === args.id)
      if (!theme) return
      // A newer version of the theme in use keeps the values it still declares.
      const selected = selectedOf(record)
      const kept =
        selected?.key === theme.key
          ? Object.fromEntries(
              Object.entries(selected.settings).filter(([name]) => Object.hasOwn(theme.settings, name)),
            )
          : undefined
      await select(theme.id, kept)
    },
    'companyTheme.settings': async (_args, form) => {
      const record = current()
      const selected = selectedOf(record)
      const theme = themesOf(record)?.find((t) => t.id === selected?.versionId)
      if (!selected || !theme || !form) return
      await select(theme.id, settingsFrom(form, theme.settings))
    },
    'companyTheme.clear': async () => {
      await select(null)
    },
  }
}
