import { builderThemeFrame } from './builder-theme-frame.tsx'
import { AttachmentImage } from '../image-upload.tsx'
import { BuilderRecords } from './builder-records.tsx'
import { blockPicker } from './builder-library.tsx'
import { templateLayout } from './template-layout.ts'
import { postFields, readPostFields } from './post-fields.tsx'
import {
  Surface,
  Stack,
  TextField,
  TextArea,
  Select,
  Checkbox,
  Notice,
  LinkButton,
  Field,
} from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view/jsx-runtime'
import { CommandButton } from '../ui.tsx'
import { walkLayout, safeImage } from '../renderer.tsx'
import type {
  CommandArgs,
  Commands,
  Placement,
  ResponsiveSettings,
  SiteTheme,
  StudioContext,
  TaxonomyTerm,
  Viewport,
} from '../types.ts'
import type {
  BuilderEditor,
  EntryHistory,
  PageTemplate,
  RevisionChange,
  SectionCatalogue,
  SharedMenu,
  SharedTheme,
} from './builder-types.ts'
import { themePresets } from '../theme/presets.ts'

/** A page or post in the site's list, for the page switcher and the shared-scope notice. */
type EntryRow = { id: string; title: string }
const THEME_KEYS = ['preset', 'accent', 'font', 'spacing', 'buttons', 'account'] as const

export function createBuilderWorkspace(ctx: StudioContext, editor: BuilderEditor) {
  const t = (key: string) => ctx.tr(`website.workspace.${key}`)
  let sharedMenus: SharedMenu[] = []
  let changes: RevisionChange[] = []
  let terms: TaxonomyTerm[] = []
  let theme: SiteTheme | null = null
  let themePreview: SiteTheme | null = null
  let entries: EntryRow[] = [],
    history: EntryHistory | null = null,
    selectedTemplate: PageTemplate | null | undefined = null,
    search = '',
    compareId: string | null = null
  let presentationNode: string | null = null,
    presentationPoint: Viewport = 'desktop'
  /** A logo still uploading has no address yet; saving now would quietly drop it. */
  const logoSettled = (form: FormData) => {
    if (
      form.has('logo') &&
      Number(globalThis.document?.getElementById('workspace-theme')?.dataset.uploading ?? 0)
    )
      throw Object.assign(new Error(ctx.tr('website.taxonomy.imageUploading')), { code: 'validation' })
  }
  const command = (label: string, name: string, args: CommandArgs = {}, form?: string) => (
    <CommandButton
      label={label}
      command={name}
      args={args}
      form={form}
      type={form ? 'submit' : 'button'}
      disabled={
        ctx.busy() || !ctx.can(name === 'workspace.theme' ? 'website.site.manage' : 'website.content.write')
      }
    />
  )
  const link = (
    label: string,
    key: string,
    params: Record<string, string> = {},
    query: Record<string, unknown> = {},
  ) => <LinkButton label={label} href={ctx.href(key, params, query)} />
  const imageNode = () => {
    const nodes: Placement[] = []
    walkLayout(editor.draft().layout, (p) => nodes.push(p))
    return nodes.find((p) => p.id === ctx.route().query.node) ?? nodes[0]
  }
  const frameFields = () => {
    const node = imageNode()
    if (!node) return <Notice title={t('selectBlock')} message={t('mediaHelp')} tone="info" />
    const s = node.settings ?? {}
    const focus = (event: Event) => {
      if (!ctx.can('website.content.write') || ctx.busy()) return
      const { clientX, clientY, currentTarget } = event as MouseEvent
      const rect = (currentTarget as Element).getBoundingClientRect()
      editor.change((layout) =>
        walkLayout(layout, (p) => {
          if (p.id === node.id)
            Object.assign(p.settings!, {
              focalX: Math.round(((clientX - rect.left) / rect.width) * 100),
              focalY: Math.round(((clientY - rect.top) / rect.height) * 100),
            })
        }),
      )
    }
    return (
      <form id="workspace-image-frame">
        <Stack
          items={[
            <Notice title={t('imageFrame')} message={t('imageFrameHelp')} tone="info" />,
            // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the focal X and Y fields set the same point by keyboard.
            // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut; the focal X and Y fields set the same point by keyboard.
            <div class="website-focal-preview" onClick={focus}>
              <img src={safeImage(s.image)} alt={s.alt ?? ''} />
              <span style={`left:${s.focalX ?? 50}%;top:${s.focalY ?? 50}%`} aria-hidden="true">
                +
              </span>
            </div>,
            <TextField
              disabled={!ctx.can('website.content.write')}
              id="image-alt"
              name="alt"
              label={ctx.tr('website.resource.media.alt')}
              value={s.alt ?? ''}
              required
            />,
            ...(['focalX', 'focalY'] as const).map((key) => (
              <Field
                disabled={!ctx.can('website.content.write')}
                id={`image-${key}`}
                name={key}
                label={ctx.tr(`website.media.${key}`)}
                value={String(s[key] ?? 50)}
                type="number"
              />
            )),
            <Select
              disabled={!ctx.can('website.content.write')}
              id="image-ratio"
              name="ratio"
              label={t('cropRatio')}
              value={s.imageRatio ?? 'original'}
              options={['original', '4:3', '1:1', '16:9'].map((value) => ({
                value,
                label: value === 'original' ? t('original') : value,
              }))}
            />,
            <Select
              disabled={!ctx.can('website.content.write')}
              id="image-fit"
              name="fit"
              label={ctx.tr('website.media.fit')}
              value={s.imageFit ?? 'cover'}
              options={['cover', 'contain'].map((value) => ({
                value,
                label: ctx.tr(`website.option.${value}`),
              }))}
            />,
            command(t('applyImageFrame'), 'workspace.image.frame', {}, 'workspace-image-frame'),
          ]}
        />
      </form>
    )
  }
  const newLayout = () => templateLayout(selectedTemplate!)
  return {
    read: async () => {
      const d = editor.draft()
      const [pages, posts, revisions] = await Promise.all([
        ctx.call<{ rows: EntryRow[] }>('website.listEntries', { siteId: ctx.site().id, type: 'page' }),
        ctx.call<{ rows: EntryRow[] }>('website.listEntries', { siteId: ctx.site().id, type: 'post' }),
        ctx.call<EntryHistory>('website_studio.entryHistory', { siteId: ctx.site().id, id: d.entry.id }),
      ])
      entries = [...pages.rows, ...posts.rows]
      if (d.entry.type === 'post' && ctx.can('website.content.write'))
        terms = (
          await ctx.call<{ rows: TaxonomyTerm[] }>('website_studio.listResources', {
            siteId: ctx.site().id,
            kind: 'taxonomy',
          })
        ).rows
      history = revisions
      changes = ctx.can('website.content.write')
        ? ((
            await ctx.call<{ changes?: RevisionChange[] }>('website.diffRevisions', {
              entryId: d.entry.id,
              fromRevisionId: compareId ?? revisions.revisions.at(-1)?.revisionId,
              toRevisionId: revisions.entry.revisionId,
            })
          ).changes ?? [])
        : []
      sharedMenus = revisions.resources?.filter((r): r is SharedMenu => r.kind === 'menus') ?? []
      theme = revisions.resources?.find((r): r is SharedTheme => r.kind === 'themes') ?? null
      if (ctx.can('website.site.manage'))
        theme =
          (
            await ctx.call<{ rows: SiteTheme[] }>('website_studio.listResources', {
              siteId: ctx.site().id,
              kind: 'themes',
            })
          ).rows[0] ?? null
    },
    frame: (body: JSXChild) =>
      builderThemeFrame(
        themePreview ?? theme,
        ctx.site().name,
        sharedMenus.find((m) => m.position === 'header')?.items ?? [],
        body,
      ),
    live: () => history?.liveRevisionId,
    template: (id: string) => {
      selectedTemplate = editor.templates().find((r) => r.id === id)
      editor.touch()
    },
    previewTemplate: () => (selectedTemplate ? { title: selectedTemplate.title, layout: newLayout() } : null),
    pages: () => entries,
    view: (panel: string, sections: SectionCatalogue, { embedded = false }: { embedded?: boolean } = {}) => {
      const draft = editor.draft()
      let body: JSXChild
      if (panel === 'page-settings')
        body = (
          <form id="workspace-page-settings">
            <Stack
              items={[
                ...(['title', 'path'] as const).map((key) => (
                  <TextField
                    id={`workspace-page-${key}`}
                    name={key}
                    label={ctx.tr(`website.entry.${key}`)}
                    value={draft.entry[key]}
                    required
                  />
                )),
                draft.entry.type === 'post' ? postFields(ctx, draft.entry, terms, 1) : null,
                ...(['title', 'description', 'canonical', 'image'] as const).map((key) => {
                  const Input = key === 'description' ? TextArea : TextField
                  return (
                    <Input
                      id={`workspace-seo-${key}`}
                      name={`seo-${key}`}
                      label={ctx.tr(`website.resource.seo.${key}`)}
                      value={draft.entry.seo?.[key] ?? ''}
                    />
                  )
                }),
                <Select
                  id="workspace-seo-indexing"
                  name="seo-indexing"
                  label={ctx.tr('website.resource.seo.indexing')}
                  value={draft.entry.seo?.indexing ?? 'index'}
                  options={['index', 'noindex'].map((value) => ({
                    value,
                    label: ctx.tr(`website.option.${value}`),
                  }))}
                />,
                <Notice
                  title={t('socialPreview')}
                  message={`${draft.entry.seo?.title || draft.entry.title} · ${draft.entry.seo?.description ?? ''}`}
                  tone="info"
                />,
                command(t('savePageSettings'), 'workspace.pageSettings', {}, 'workspace-page-settings'),
              ]}
            />
          </form>
        )
      if (panel === 'shared')
        body = (
          <Stack
            items={[
              <Notice
                title={t('siteScope')}
                message={`${entries.map((e) => e.title).join(' · ')}`}
                tone="warning"
              />,
              ...sharedMenus.map((menu) => (
                <Surface
                  title={menu.title}
                  body={
                    <LinkButton
                      label={ctx.tr('website.resource.edit')}
                      href={ctx.href('menus-edit', { id: menu.id })}
                    />
                  }
                />
              )),
              theme ? (
                <Surface
                  title={t('footer')}
                  body={
                    <form id="workspace-footer">
                      <TextArea
                        id="workspace-footer-text"
                        name="footer"
                        label={ctx.tr('website.resource.themes.footer')}
                        value={theme.footer}
                        disabled={!ctx.can('website.site.manage')}
                      />
                      <Checkbox id="workspace-footer-confirm" name="confirmed" label={t('sharedConfirm')} />
                      <CommandButton
                        label={t('saveShared')}
                        command="workspace.footer"
                        type="submit"
                        form="workspace-footer"
                        disabled={!ctx.can('website.site.manage') || ctx.busy()}
                      />
                    </form>
                  }
                />
              ) : null,
            ]}
          />
        )
      if (panel === 'styles')
        body = theme ? (
          <form id="workspace-theme">
            <Stack
              items={[
                <Notice
                  title={t('siteScope')}
                  message={`${entries.length} ${t('affectedPages')}`}
                  tone="warning"
                />,
                ...THEME_KEYS.map((key) => (
                  <Select
                    id={`theme-${key}`}
                    name={key}
                    label={ctx.tr(`website.resource.themes.${key}`)}
                    value={
                      (themePreview ?? theme)![key] ??
                      (
                        {
                          preset: 'default',
                          spacing: 'comfortable',
                          buttons: 'rounded',
                          account: 'hidden',
                        } as Record<string, string>
                      )[key] ??
                      ''
                    }
                    options={{
                      preset: [...themePresets],
                      accent: ['green', 'indigo', 'orange'],
                      font: ['sans', 'serif'],
                      spacing: ['compact', 'comfortable', 'spacious'],
                      buttons: ['rounded', 'square'],
                      account: ['hidden', 'shown'],
                    }[key].map((value) => ({ value, label: ctx.tr(`website.option.${value}`) }))}
                  />
                )),
                <fieldset class="website-theme-logo">
                  <legend>{t('logo')}</legend>
                  <p>{t('logoHelp')}</p>
                  {AttachmentImage(ctx, {
                    id: ctx.site().id,
                    field: 'logo',
                    value: (themePreview ?? theme)!.logo ?? '',
                    alt: ctx.site().name,
                    resModel: 'website.Site',
                    disabled: !ctx.can('website.site.manage'),
                    describe: false,
                  })}
                </fieldset>,
                command(t('previewTheme'), 'workspace.theme.preview', {}, 'workspace-theme'),
                command(t('resetThemePreview'), 'workspace.theme.reset'),
                <Checkbox id="theme-confirm" name="confirmed" label={t('themeConfirm')} />,
                command(t('saveTheme'), 'workspace.theme', {}, 'workspace-theme'),
                <Notice title={t('previewLocation')} message={t('previewLocationHelp')} tone="info" />,
              ]}
            />
          </form>
        ) : (
          <Notice title={t('styles')} message={t('themePermission')} tone="info" />
        )
      if (['responsive', 'visibility', 'layout'].includes(panel)) {
        const nodes: Placement[] = []
        walkLayout(draft.layout, (p) => nodes.push(p))
        const selected = nodes.find((p) => p.id === (ctx.route().query.node ?? presentationNode)) ?? nodes[0]
        const s = selected?.settings ?? {}
        const overrides: ResponsiveSettings = s.responsive?.[presentationPoint] ?? {}
        const select = (key: string, values: string[], value: string) => (
          <Select
            id={`workspace-${key}`}
            name={key}
            label={t(key)}
            value={value}
            options={values.map((value) => ({ value, label: t(value) }))}
            disabled={!ctx.can('website.content.write')}
          />
        )
        body = selected ? (
          <form id="workspace-presentation">
            <Stack
              items={[
                <input type="hidden" name="node" value={selected.id} />,
                <Notice
                  title={t(panel)}
                  message={t(panel === 'visibility' ? 'visibilityHelp' : 'responsiveHelp')}
                  tone="info"
                />,
                ...(panel === 'visibility'
                  ? [
                      select('locale', ['all', ...ctx.site().locales], s.locale ?? 'all'),
                      select('profile', ['all', 'guest', 'registered'], s.profile ?? 'all'),
                    ]
                  : [
                      select('breakpoint', ['desktop', 'tablet', 'mobile'], presentationPoint),
                      command(
                        t('loadPresentation'),
                        'workspace.presentation.select',
                        {},
                        'workspace-presentation',
                      ),
                      select(
                        'spacing',
                        ['inherit', 'compact', 'comfortable', 'spacious'],
                        overrides.spacing ?? 'inherit',
                      ),
                      select('align', ['inherit', 'start', 'center', 'end'], overrides.align ?? 'inherit'),
                      ...(['minWidth', 'maxWidth'] as const).map((key) => (
                        <Field
                          id={`workspace-${key}`}
                          name={key}
                          label={t(key)}
                          type="number"
                          value={String(overrides[key] ?? '')}
                        />
                      )),
                    ]),
                ...(panel === 'layout'
                  ? [
                      select('layoutMode', ['grid', 'stack'], s.layoutMode ?? 'grid'),
                      select('gap', ['compact', 'comfortable', 'spacious'], s.gap ?? 'comfortable'),
                    ]
                  : []),
                command(
                  t('applyPresentation'),
                  'workspace.presentation',
                  { panel },
                  'workspace-presentation',
                ),
                command(
                  t('resetPresentation'),
                  'workspace.presentation.reset',
                  { panel },
                  'workspace-presentation',
                ),
              ]}
            />
            <Notice
              title={t('inheritance')}
              message={t(
                presentationPoint === 'desktop'
                  ? 'baseBreakpoint'
                  : Object.keys(overrides).length
                    ? 'overriddenBreakpoint'
                    : 'inheritedBreakpoint',
              )}
              tone="info"
            />
          </form>
        ) : (
          <Notice title={t('block')} message={t('selectBlock')} tone="info" />
        )
      }
      if (panel === 'library')
        body = blockPicker({
          sections,
          layout: draft.layout,
          selectedNode: ctx.route().query.node ?? draft.layout[0]?.id ?? null,
          search,
          onSearch: (value: string) => {
            search = value
            editor.touch()
          },
          tr: ctx.tr,
          disabled: ctx.busy() || !ctx.can('website.content.write'),
        })
      if (panel === 'templates')
        body = (
          <Stack
            items={[
              <p class="website-template-picker-help">{t('templateSelectHelp')}</p>,
              ...editor.templates().map((r) => command(r.title, 'builder.template', { id: r.id })),
              selectedTemplate ? (
                <Notice title={t('replaceTitle')} message={t('replaceHelp')} tone="warning" />
              ) : null,
              selectedTemplate ? (
                <p class="website-template-picker-help">{t('templatePreviewHelp')}</p>
              ) : null,
              selectedTemplate ? (
                <form id="template-confirm">
                  <Checkbox id="template-replace" name="confirmed" label={t('replaceConfirm')} />
                  {command(t('replace'), 'workspace.template.apply', {}, 'template-confirm')}
                </form>
              ) : null,
            ]}
          />
        )
      if (panel === 'history') {
        const before = history?.revisions.find((r) => r.revisionId === compareId) ?? history?.revisions.at(-1)
        body = (
          <Stack
            items={[
              draft.dirty ? (
                <Notice title={t('savedHistory')} message={t('saveBeforeCompare')} tone="info" />
              ) : null,
              <form id="revision-compare">
                <Select
                  id="revision-before"
                  name="revision"
                  label={t('compare')}
                  value={before?.revisionId}
                  options={(history?.revisions ?? []).map((r) => ({
                    value: r.revisionId,
                    label: `${r.revisionId} · ${r.updatedBy}`,
                  }))}
                />
                {command(t('compare'), 'workspace.compare', {}, 'revision-compare')}
              </form>,
              BuilderRecords({
                rows: changes,
                emptyTitle: t('noDiff'),
                columns: [
                  { key: 'id', label: t('block'), cell: (r) => r.id },
                  { key: 'change', label: t('change'), cell: (r) => ctx.tr(`website.change.${r.change}`) },
                  {
                    key: 'fields',
                    label: ctx.tr('website.content.changedField'),
                    cell: (r) => r.fields?.join(', ') ?? r.path,
                  },
                ],
              }),
              before ? command(t('restore'), 'workspace.restore', { revision: before.revisionId }) : null,
              link(t('historyAll'), 'entry-details', { id: draft.entry.id }),
            ]}
          />
        )
      }
      if (panel === 'media') {
        const selected = imageNode()
        body = selected ? (
          <Stack
            items={[
              <form id="builder-image-upload" novalidate>
                {AttachmentImage(ctx, {
                  id: draft.entry.id,
                  field: 'image',
                  value: selected.settings?.image ?? '',
                  alt: selected.settings?.alt ?? '',
                  resModel: 'website.Entry',
                  disabled: !ctx.can('website.content.write'),
                })}
                {command(t('choose'), 'workspace.image.upload', {}, 'builder-image-upload')}
              </form>,
              selected.settings?.image ? frameFields() : null,
            ]}
          />
        ) : (
          <Notice title={t('selectBlock')} message={t('mediaHelp')} tone="info" />
        )
      }
      return embedded ? (
        body
      ) : (
        <div class="website-builder-panel">
          <Surface title={t(panel)} body={body} />
        </div>
      )
    },
    commands: {
      'workspace.pageSettings': async (_, form) => {
        form = form!
        if (editor.draft().dirty) await editor.save()
        await ctx.call('website_studio.savePageSettings', {
          siteId: ctx.site().id,
          id: editor.draft().entry.id,
          expectedRevisionId: editor.draft().base,
          title: String(form.get('title')),
          path: String(form.get('path')),
          ...(editor.draft().entry.type === 'post' ? { post: readPostFields(form) } : {}),
          seo: Object.fromEntries(
            ['title', 'description', 'canonical', 'image', 'indexing'].map((key) => [
              key,
              String(form.get(`seo-${key}`) ?? ''),
            ]),
          ),
        })
        await ctx.refresh()
      },
      'workspace.footer': async (_, form) => {
        form = form!
        if (!ctx.can('website.site.manage') || !theme || !form.has('confirmed'))
          throw Object.assign(new Error(t('sharedConfirm')), { code: 'validation' })
        theme = await ctx.call<SiteTheme>('website_studio.saveResource', {
          siteId: ctx.site().id,
          kind: 'themes',
          id: theme.id,
          expectedRevisionId: theme.revisionId,
          values: { ...theme, footer: String(form.get('footer') ?? '') },
        })
        await ctx.refresh()
      },
      'workspace.theme.preview': (_, form) => {
        logoSettled(form!)
        themePreview = {
          ...theme,
          ...Object.fromEntries(THEME_KEYS.map((k) => [k, String(form!.get(k))])),
          logo: String(form!.get('logo') ?? ''),
        }
        editor.touch()
      },
      'workspace.theme.reset': () => {
        themePreview = null
        editor.touch()
      },
      'workspace.theme': async (_, form) => {
        form = form!
        if (!ctx.can('website.site.manage') || !theme || !form.has('confirmed'))
          throw Object.assign(new Error(t('themeConfirm')), { code: 'validation' })
        logoSettled(form)
        theme = await ctx.call<SiteTheme>('website_studio.saveResource', {
          siteId: ctx.site().id,
          kind: 'themes',
          id: theme.id,
          expectedRevisionId: theme.revisionId,
          values: {
            ...theme,
            preset: String(form.get('preset') ?? 'default'),
            accent: String(form.get('accent')),
            font: String(form.get('font')),
            spacing: String(form.get('spacing')),
            buttons: String(form.get('buttons')),
            account: String(form.get('account') ?? 'hidden'),
            logo: String(form.get('logo') ?? ''),
          },
        })
        themePreview = null
        await ctx.refresh()
      },
      'workspace.presentation.select': (_, form) => {
        presentationNode = String(form!.get('node'))
        presentationPoint = String(form!.get('breakpoint')) as Viewport
        editor.touch()
      },
      'workspace.presentation': ({ panel }, form) => {
        form = form!
        const dimensions: Pick<ResponsiveSettings, 'minWidth' | 'maxWidth'> = {}
        for (const key of ['minWidth', 'maxWidth'] as const) {
          const raw = String(form.get(key) ?? '').trim()
          if (!raw) continue
          const value = Number(raw)
          if (!Number.isInteger(value) || value < 0 || value > 4096)
            throw Object.assign(new Error(t('invalidDimensions')), { code: 'validation' })
          dimensions[key] = value
        }
        if ((dimensions.minWidth ?? 0) > (dimensions.maxWidth ?? 4096))
          throw Object.assign(new Error(t('invalidDimensions')), { code: 'validation' })
        editor.change((layout) =>
          walkLayout(layout, (p) => {
            if (p.id !== form.get('node')) return
            const s = (p.settings ??= {})
            if (panel === 'visibility') {
              s.locale = String(form.get('locale'))
              s.profile = String(form.get('profile'))
              return
            }
            const breakpoint = String(form.get('breakpoint'))
            if (!['desktop', 'tablet', 'mobile'].includes(breakpoint)) return
            const next: ResponsiveSettings = { ...dimensions }
            for (const key of ['spacing', 'align'] as const)
              if (form.get(key) && form.get(key) !== 'inherit') next[key] = String(form.get(key))
            ;(s.responsive ??= {})[breakpoint as Viewport] = next
            if (panel === 'layout') {
              s.layoutMode = String(form.get('layoutMode'))
              s.gap = String(form.get('gap'))
            }
          }),
        )
      },
      'workspace.presentation.reset': ({ panel }, form) =>
        editor.change((layout) =>
          walkLayout(layout, (p) => {
            if (p.id !== form!.get('node')) return
            const s = (p.settings ??= {})
            if (panel === 'visibility') {
              delete s.locale
              delete s.profile
            } else if (s.responsive) delete s.responsive[String(form!.get('breakpoint')) as Viewport]
          }),
        ),
      'workspace.compare': async (_, form) => {
        compareId = String(form!.get('revision'))
        await ctx.refresh()
      },
      'workspace.template.apply': async (_, form) => {
        if (!selectedTemplate || !form!.has('confirmed'))
          throw Object.assign(new Error(t('replaceConfirm')), { code: 'validation' })
        if (editor.draft().dirty) await editor.save()
        const next = newLayout()
        editor.change((layout) => layout.splice(0, layout.length, ...next))
        selectedTemplate = null
        editor.touch()
      },
      'workspace.restore': async ({ revision }) => {
        if (editor.draft().dirty) await editor.save()
        await ctx.call('website_studio.restoreEntry', {
          siteId: ctx.site().id,
          id: editor.draft().entry.id,
          revisionId: revision,
          expectedRevisionId: editor.draft().base,
        })
        await ctx.refresh()
      },
      'workspace.image.frame': (_, form) => {
        form = form!
        const values = {
          alt: String(form.get('alt') ?? '').trim(),
          focalX: Number(form.get('focalX')),
          focalY: Number(form.get('focalY')),
          imageRatio: String(form.get('ratio')),
          imageFit: String(form.get('fit')),
        }
        if (
          !values.alt ||
          !['original', '4:3', '1:1', '16:9'].includes(values.imageRatio) ||
          !['cover', 'contain'].includes(values.imageFit) ||
          (['focalX', 'focalY'] as const).some(
            (key) => !Number.isFinite(values[key]) || values[key] < 0 || values[key] > 100,
          )
        )
          throw Object.assign(new Error(t('invalidImageFrame')), { code: 'validation' })
        const selected = imageNode()?.id
        if (!selected) throw Object.assign(new Error(t('selectBlock')), { code: 'validation' })
        editor.change((layout) =>
          walkLayout(layout, (p) => {
            if (p.id === selected) Object.assign((p.settings ??= {}), values)
          }),
        )
      },
      'workspace.image.upload': async (_, form) => {
        form = form!
        if (Number(globalThis.document?.getElementById('builder-image-upload')?.dataset.uploading ?? 0))
          throw Object.assign(new Error(ctx.tr('website.taxonomy.imageUploading')), { code: 'validation' })
        const url = String(form.get('image') ?? ''),
          alt = String(form.get('imageAlt') ?? '')
        if (url && !alt.trim()) throw Object.assign(new Error(t('missingAlt')), { code: 'validation' })
        // The upload is this page's own; saving the revision is what claims it, and refuses one
        // that is not this page's, has not finished or has expired.
        const selected = imageNode()?.id
        if (!selected) throw Object.assign(new Error(t('selectBlock')), { code: 'validation' })
        editor.change((layout) =>
          walkLayout(layout, (p) => {
            if (p.id === selected) Object.assign((p.settings ??= {}), { image: url, alt })
          }),
        )
        await ctx.navigate(
          'builder',
          { id: editor.draft().entry.id },
          { ...ctx.route().query, dialog: undefined },
        )
      },
    } satisfies Commands,
  }
}
