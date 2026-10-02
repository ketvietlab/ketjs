import { AttachmentImage } from '../image-upload.mjs'
import { BuilderRecords } from './builder-records.mjs'
import { blockPicker } from './builder-library.mjs'
import { templateLayout } from './template-layout.mjs'
import { postFields, readPostFields } from './post-fields.mjs'
import { html } from '@ketvietlab/ketjs-view'
import {
  Surface,
  Stack,
  TextField,
  TextArea,
  Select,
  Checkbox,
  Notice,
  LinkButton,
} from '@ketvietlab/design-system'
import { h, CommandButton } from '../ui.mjs'
import { walkLayout, safeImage } from '../renderer.mjs'
export function createBuilderWorkspace(ctx, editor) {
  const t = (key) => ctx.tr(`website.workspace.${key}`)
  let sharedMenus = []
  let changes = []
  let terms = []
  let theme = null
  let themePreview = null
  let entries = [],
    history = null,
    selectedTemplate = null,
    search = '',
    compareId = null
  let presentationNode = null,
    presentationPoint = 'desktop'
  const command = (label, name, args = {}, form) =>
    CommandButton({
      label,
      command: name,
      args,
      form,
      type: form ? 'submit' : 'button',
      disabled:
        ctx.busy() || !ctx.can(name === 'workspace.theme' ? 'website.site.manage' : 'website.content.write'),
    })
  const link = (label, key, params = {}, query = {}) =>
    h(LinkButton, { label, href: ctx.href(key, params, query) })
  const imageNode = () => {
    const nodes = []
    walkLayout(editor.draft().layout, (p) => nodes.push(p))
    return nodes.find((p) => p.id === ctx.route().query.node) ?? nodes[0]
  }
  const frameFields = () => {
    const node = imageNode()
    if (!node) return h(Notice, { title: t('selectBlock'), message: t('mediaHelp'), tone: 'info' })
    const s = node.settings ?? {}
    const focus = (event) => {
      if (!ctx.can('website.content.write') || ctx.busy()) return
      const rect = event.currentTarget.getBoundingClientRect()
      editor.change((layout) =>
        walkLayout(layout, (p) => {
          if (p.id === node.id)
            Object.assign(p.settings, {
              focalX: Math.round(((event.clientX - rect.left) / rect.width) * 100),
              focalY: Math.round(((event.clientY - rect.top) / rect.height) * 100),
            })
        }),
      )
    }
    return html`<form id="workspace-image-frame">${h(Stack, {
      items: [
        h(Notice, { title: t('imageFrame'), message: t('imageFrameHelp'), tone: 'info' }),
        html`<div class="website-focal-preview" on:click=${focus}><img src=${safeImage(s.image)} alt=${s.alt ?? ''} /><span style=${`left:${s.focalX ?? 50}%;top:${s.focalY ?? 50}%`} aria-hidden="true">+</span></div>`,
        h(TextField, {
          disabled: !ctx.can('website.content.write'),
          id: 'image-alt',
          name: 'alt',
          label: ctx.tr('website.resource.media.alt'),
          value: s.alt ?? '',
          required: true,
        }),
        ...['focalX', 'focalY'].map((key) =>
          h(TextField, {
            disabled: !ctx.can('website.content.write'),
            id: `image-${key}`,
            name: key,
            label: ctx.tr(`website.media.${key}`),
            value: String(s[key] ?? 50),
            type: 'number',
          }),
        ),
        h(Select, {
          disabled: !ctx.can('website.content.write'),
          id: 'image-ratio',
          name: 'ratio',
          label: t('cropRatio'),
          value: s.imageRatio ?? 'original',
          options: ['original', '4:3', '1:1', '16:9'].map((value) => ({
            value,
            label: value === 'original' ? t('original') : value,
          })),
        }),
        h(Select, {
          disabled: !ctx.can('website.content.write'),
          id: 'image-fit',
          name: 'fit',
          label: ctx.tr('website.media.fit'),
          value: s.imageFit ?? 'cover',
          options: ['cover', 'contain'].map((value) => ({ value, label: ctx.tr(`website.option.${value}`) })),
        }),
        command(t('applyImageFrame'), 'workspace.image.frame', {}, 'workspace-image-frame'),
      ],
    })}</form>`
  }
  const newLayout = () => templateLayout(selectedTemplate)
  return {
    read: async () => {
      const d = editor.draft()
      const [pages, posts, revisions] = await Promise.all([
        ctx.call('website.listEntries', { siteId: ctx.site().id, type: 'page' }),
        ctx.call('website.listEntries', { siteId: ctx.site().id, type: 'post' }),
        ctx.call('website_studio.entryHistory', { siteId: ctx.site().id, id: d.entry.id }),
      ])
      entries = [...pages.rows, ...posts.rows]
      if (d.entry.type === 'post' && ctx.can('website.content.write'))
        terms = (await ctx.call('website_studio.listResources', { siteId: ctx.site().id, kind: 'taxonomy' }))
          .rows
      history = revisions
      changes = ctx.can('website.content.write')
        ? ((
            await ctx.call('website.diffRevisions', {
              entryId: d.entry.id,
              fromRevisionId: compareId ?? revisions.revisions.at(-1)?.revisionId,
              toRevisionId: revisions.entry.revisionId,
            })
          ).changes ?? [])
        : []
      sharedMenus = revisions.resources?.filter((r) => r.kind === 'menus') ?? []
      theme = revisions.resources?.find((r) => r.kind === 'themes') ?? null
      if (ctx.can('website.site.manage'))
        theme =
          (await ctx.call('website_studio.listResources', { siteId: ctx.site().id, kind: 'themes' }))
            .rows[0] ?? null
    },
    frame: (body) =>
      html`<div class="wt-site" data-website-theme="default" data-theme-preset=${(themePreview ?? theme)?.preset ?? 'default'} data-accent=${(themePreview ?? theme)?.accent ?? 'green'} data-font=${(themePreview ?? theme)?.font ?? 'sans'} data-spacing=${(themePreview ?? theme)?.spacing ?? 'comfortable'} data-buttons=${(themePreview ?? theme)?.buttons ?? 'rounded'}><header class="wt-theme-header"><strong>${ctx.site().name}</strong><nav>${(
        sharedMenus.find((m) => m.position === 'header')?.items ?? []
      )
        .map((item) => html`<span>${item.label}</span>`)
        .reduce(
          (a, b) => html`${a}${b}`,
          html``,
        )}</nav></header>${body}<footer class="wt-theme-footer">${theme?.footer ?? ctx.site().name}</footer></div>`,
    live: () => history?.liveRevisionId,
    template: (id) => {
      selectedTemplate = editor.templates().find((r) => r.id === id)
      editor.touch()
    },
    previewTemplate: () => (selectedTemplate ? { title: selectedTemplate.title, layout: newLayout() } : null),
    pages: () => entries,
    view: (panel, sections, { embedded = false } = {}) => {
      const draft = editor.draft()
      let body
      if (panel === 'page-settings')
        body = html`<form id="workspace-page-settings">${h(Stack, {
          items: [
            ...['title', 'path'].map((key) =>
              h(TextField, {
                id: `workspace-page-${key}`,
                name: key,
                label: ctx.tr(`website.entry.${key}`),
                value: draft.entry[key],
                required: true,
              }),
            ),
            draft.entry.type === 'post' ? postFields(ctx, draft.entry, terms, 1) : null,
            ...['title', 'description', 'canonical', 'image'].map((key) =>
              h(key === 'description' ? TextArea : TextField, {
                id: `workspace-seo-${key}`,
                name: `seo-${key}`,
                label: ctx.tr(`website.resource.seo.${key}`),
                value: draft.entry.seo?.[key] ?? '',
              }),
            ),
            h(Select, {
              id: 'workspace-seo-indexing',
              name: 'seo-indexing',
              label: ctx.tr('website.resource.seo.indexing'),
              value: draft.entry.seo?.indexing ?? 'index',
              options: ['index', 'noindex'].map((value) => ({
                value,
                label: ctx.tr(`website.option.${value}`),
              })),
            }),
            h(Notice, {
              title: t('socialPreview'),
              message: `${draft.entry.seo?.title || draft.entry.title} · ${draft.entry.seo?.description ?? ''}`,
              tone: 'info',
            }),
            command(t('savePageSettings'), 'workspace.pageSettings', {}, 'workspace-page-settings'),
          ],
        })}</form>`
      if (panel === 'shared')
        body = h(Stack, {
          items: [
            h(Notice, {
              title: t('siteScope'),
              message: `${entries.map((e) => e.title).join(' · ')}`,
              tone: 'warning',
            }),
            ...sharedMenus.map((menu) =>
              h(Surface, {
                title: menu.title,
                body: h(LinkButton, {
                  label: ctx.tr('website.resource.edit'),
                  href: ctx.href('menus-edit', { id: menu.id }),
                }),
              }),
            ),
            theme
              ? h(Surface, {
                  title: t('footer'),
                  body: html`<form id="workspace-footer">${h(TextArea, { id: 'workspace-footer-text', name: 'footer', label: ctx.tr('website.resource.themes.footer'), value: theme.footer, disabled: !ctx.can('website.site.manage') })}${h(Checkbox, { id: 'workspace-footer-confirm', name: 'confirmed', label: t('sharedConfirm') })}${CommandButton({ label: t('saveShared'), command: 'workspace.footer', type: 'submit', form: 'workspace-footer', disabled: !ctx.can('website.site.manage') || ctx.busy() })}</form>`,
                })
              : null,
          ],
        })
      if (panel === 'styles')
        body = theme
          ? html`<form id="workspace-theme">${h(Stack, {
              items: [
                h(Notice, {
                  title: t('siteScope'),
                  message: `${entries.length} ${t('affectedPages')}`,
                  tone: 'warning',
                }),
                ...['preset', 'accent', 'font', 'spacing', 'buttons'].map((key) =>
                  h(Select, {
                    id: `theme-${key}`,
                    name: key,
                    label: ctx.tr(`website.resource.themes.${key}`),
                    value:
                      (themePreview ?? theme)[key] ??
                      { preset: 'default', spacing: 'comfortable', buttons: 'rounded' }[key] ??
                      '',
                    options: {
                      preset: ['default', 'cosmetics'],
                      accent: ['green', 'indigo', 'orange'],
                      font: ['sans', 'serif'],
                      spacing: ['compact', 'comfortable', 'spacious'],
                      buttons: ['rounded', 'square'],
                    }[key].map((value) => ({ value, label: ctx.tr(`website.option.${value}`) })),
                  }),
                ),
                command(t('previewTheme'), 'workspace.theme.preview', {}, 'workspace-theme'),
                command(t('resetThemePreview'), 'workspace.theme.reset'),
                h(Checkbox, { id: 'theme-confirm', name: 'confirmed', label: t('themeConfirm') }),
                command(t('saveTheme'), 'workspace.theme', {}, 'workspace-theme'),
                h(Notice, { title: t('previewLocation'), message: t('previewLocationHelp'), tone: 'info' }),
              ],
            })}</form>`
          : h(Notice, { title: t('styles'), message: t('themePermission'), tone: 'info' })
      if (['responsive', 'visibility', 'layout'].includes(panel)) {
        const nodes = []
        walkLayout(draft.layout, (p) => nodes.push(p))
        const selected = nodes.find((p) => p.id === (ctx.route().query.node ?? presentationNode)) ?? nodes[0]
        const s = selected?.settings ?? {}
        const overrides = s.responsive?.[presentationPoint] ?? {}
        const select = (key, values, value) =>
          h(Select, {
            id: `workspace-${key}`,
            name: key,
            label: t(key),
            value,
            options: values.map((value) => ({ value, label: t(value) })),
            disabled: !ctx.can('website.content.write'),
          })
        body = selected
          ? html`<form id="workspace-presentation">${h(Stack, {
              items: [
                html`<input type="hidden" name="node" value=${selected.id} />`,
                h(Notice, {
                  title: t(panel),
                  message: t(panel === 'visibility' ? 'visibilityHelp' : 'responsiveHelp'),
                  tone: 'info',
                }),
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
                      ...['minWidth', 'maxWidth'].map((key) =>
                        h(TextField, {
                          id: `workspace-${key}`,
                          name: key,
                          label: t(key),
                          type: 'number',
                          value: String(overrides[key] ?? ''),
                        }),
                      ),
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
              ],
            })}${h(Notice, { title: t('inheritance'), message: t(presentationPoint === 'desktop' ? 'baseBreakpoint' : Object.keys(overrides).length ? 'overriddenBreakpoint' : 'inheritedBreakpoint'), tone: 'info' })}</form>`
          : h(Notice, { title: t('block'), message: t('selectBlock'), tone: 'info' })
      }
      if (panel === 'library')
        body = blockPicker({
          sections,
          layout: draft.layout,
          selectedNode: ctx.route().query.node ?? draft.layout[0]?.id ?? null,
          search,
          onSearch: (value) => {
            search = value
            editor.touch()
          },
          tr: ctx.tr,
          disabled: ctx.busy() || !ctx.can('website.content.write'),
        })
      if (panel === 'templates')
        body = h(Stack, {
          items: [
            html`<p class="website-template-picker-help">${t('templateSelectHelp')}</p>`,
            ...editor.templates().map((r) => command(r.title, 'builder.template', { id: r.id })),
            selectedTemplate
              ? h(Notice, { title: t('replaceTitle'), message: t('replaceHelp'), tone: 'warning' })
              : null,
            selectedTemplate
              ? html`<p class="website-template-picker-help">${t('templatePreviewHelp')}</p>`
              : null,
            selectedTemplate
              ? html`<form id="template-confirm">${h(Checkbox, { id: 'template-replace', name: 'confirmed', label: t('replaceConfirm') })}${command(t('replace'), 'workspace.template.apply', {}, 'template-confirm')}</form>`
              : null,
          ],
        })
      if (panel === 'history') {
        const before = history?.revisions.find((r) => r.revisionId === compareId) ?? history?.revisions.at(-1)
        body = h(Stack, {
          items: [
            draft.dirty
              ? h(Notice, { title: t('savedHistory'), message: t('saveBeforeCompare'), tone: 'info' })
              : null,
            html`<form id="revision-compare">${h(Select, { id: 'revision-before', name: 'revision', label: t('compare'), value: before?.revisionId, options: (history?.revisions ?? []).map((r) => ({ value: r.revisionId, label: `${r.revisionId} · ${r.updatedBy}` })) })}${command(t('compare'), 'workspace.compare', {}, 'revision-compare')}</form>`,
            h(BuilderRecords, {
              rows: changes,
              id: (r) => `${r.id}:${r.change}`,
              emptyTitle: t('noDiff'),
              columns: [
                { key: 'id', label: t('block'), cell: (r) => r.id, priority: 'primary' },
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
          ],
        })
      }
      if (panel === 'media') {
        const selected = imageNode()
        body = selected
          ? h(Stack, {
              items: [
                html`<form id="builder-image-upload" novalidate>${AttachmentImage(ctx, { id: draft.entry.id, field: 'image', value: selected.settings?.image ?? '', alt: selected.settings?.alt ?? '', resModel: 'website.Entry', disabled: !ctx.can('website.content.write') })}${command(t('choose'), 'workspace.image.upload', {}, 'builder-image-upload')}</form>`,
                selected.settings?.image ? frameFields() : null,
              ],
            })
          : h(Notice, { title: t('selectBlock'), message: t('mediaHelp'), tone: 'info' })
      }
      return embedded
        ? body
        : html`<div class="website-builder-panel">${h(Surface, { title: t(panel), body })}</div>`
    },
    commands: {
      'workspace.pageSettings': async (_, form) => {
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
        if (!ctx.can('website.site.manage') || !theme || !form.has('confirmed'))
          throw Object.assign(new Error(t('sharedConfirm')), { code: 'validation' })
        theme = await ctx.call('website_studio.saveResource', {
          siteId: ctx.site().id,
          kind: 'themes',
          id: theme.id,
          expectedRevisionId: theme.revisionId,
          values: { ...theme, footer: String(form.get('footer') ?? '') },
        })
        await ctx.refresh()
      },
      'workspace.theme.preview': (_, form) => {
        themePreview = {
          ...theme,
          ...Object.fromEntries(
            ['preset', 'accent', 'font', 'spacing', 'buttons'].map((k) => [k, String(form.get(k))]),
          ),
        }
        editor.touch()
      },
      'workspace.theme.reset': () => {
        themePreview = null
        editor.touch()
      },
      'workspace.theme': async (_, form) => {
        if (!ctx.can('website.site.manage') || !theme || !form.has('confirmed'))
          throw Object.assign(new Error(t('themeConfirm')), { code: 'validation' })
        theme = await ctx.call('website_studio.saveResource', {
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
          },
        })
        themePreview = null
        await ctx.refresh()
      },
      'workspace.presentation.select': (_, form) => {
        presentationNode = String(form.get('node'))
        presentationPoint = String(form.get('breakpoint'))
        editor.touch()
      },
      'workspace.presentation': ({ panel }, form) => {
        const dimensions = {}
        for (const key of ['minWidth', 'maxWidth']) {
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
            const next = { ...dimensions }
            for (const key of ['spacing', 'align'])
              if (form.get(key) && form.get(key) !== 'inherit') next[key] = String(form.get(key))
            ;(s.responsive ??= {})[breakpoint] = next
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
            if (p.id !== form.get('node')) return
            const s = (p.settings ??= {})
            if (panel === 'visibility') {
              delete s.locale
              delete s.profile
            } else if (s.responsive) delete s.responsive[String(form.get('breakpoint'))]
          }),
        ),
      'workspace.compare': async (_, form) => {
        compareId = String(form.get('revision'))
        await ctx.refresh()
      },
      'workspace.template.apply': async (_, form) => {
        if (!selectedTemplate || !form.has('confirmed'))
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
          ['focalX', 'focalY'].some(
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
        if (Number(globalThis.document?.getElementById('builder-image-upload')?.dataset.uploading ?? 0))
          throw Object.assign(new Error(ctx.tr('website.taxonomy.imageUploading')), { code: 'validation' })
        const url = String(form.get('image') ?? ''),
          alt = String(form.get('imageAlt') ?? '')
        if (url && !alt.trim()) throw Object.assign(new Error(t('missingAlt')), { code: 'validation' })
        const rows = (
          await ctx.call('website_studio.listResources', {
            siteId: ctx.site().id,
            kind: 'media',
            search: '',
            publicOnly: true,
          })
        ).rows
        if (url && !rows.some((r) => r.url === url && r.visibility === 'public' && r.scan === 'clean'))
          throw Object.assign(new Error(t('mediaUnavailable')), { code: 'validation' })
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
    },
  }
}
