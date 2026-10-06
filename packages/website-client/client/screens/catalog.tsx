import {
  ActionGroup,
  Checkbox,
  ConfirmDialog,
  CheckboxGroup,
  DataTable,
  DescriptionList,
  FilterBar,
  Grid,
  Inline,
  LinkButton,
  ListPage,
  Menu,
  ModalSheet,
  Notice,
  RecordPage,
  SearchBar,
  Select,
  Stack,
  Status,
  Surface,
  Switch,
  Tabs,
  Text,
  TextArea,
  TextField,
  WorkspacePage,
} from '@ketvietlab/design-system'
import { createCatalogProductPicker } from './catalog-product-picker.tsx'
import { CommandButton, commandValue, icon } from '../ui.tsx'
import { bindCatalogTemplate } from '../catalog-binding.ts'
import type { CatalogProduct, DetailTemplate } from '../catalog-binding.ts'
import { renderLayout, safeImage } from '../renderer.tsx'
import { builderThemeFrame } from './builder-theme-frame.tsx'
import { catalogBuilderId } from './catalog-builder.ts'
import type { Screen, SiteTheme, StudioContext } from '../types.ts'

type Binding = {
  id: string
  productId: string
  product: CatalogProduct
  effectiveProduct?: CatalogProduct
  path: string
  visible: boolean
  revisionId: string
  templateId: string
  seoTitle: string
  seoDescription: string
  sourceEditorHref: string
  templates?: { id: string; title: string }[]
  categoryIds?: string[]
  primaryCategoryId?: string
  categoryChoices?: { id: string; title: string; path?: string[] }[]
}
type CatalogList = {
  rows: Binding[]
  total: number
  page: number
  pages: number
  visible: number
  templates: DetailTemplate[]
  candidates: CatalogProduct[]
}
type TemplateData = {
  template: DetailTemplate
  products: Binding[]
  theme?: SiteTheme
}

export function createCatalogScreens(ctx: StudioContext): Record<string, Screen> {
  const tr = ctx.tr
  const scope = () => ({ siteId: ctx.site().id })
  const writable = () => ctx.can('website.catalog.configure')
  const status = (row: Binding) => (
    <Status
      label={tr(
        row.product.active === false
          ? 'website.catalog.archived'
          : row.visible
            ? 'website.catalog.visible'
            : 'website.catalog.hidden',
      )}
      tone={row.product.active === false ? 'warning' : row.visible ? 'positive' : 'neutral'}
    />
  )
  const categoryPath = (c: { title: string; path?: string[] }) => [...(c.path ?? []), c.title].join(' › ')
  /** The primary category is one of the checked categories; nothing else is offered. */
  const primaryOptions = (choices: NonNullable<Binding['categoryChoices']>, checked: Set<string>) => [
    { value: '', label: tr('website.catalogCategory.noPrimary') },
    ...choices.filter((c) => checked.has(c.id)).map((c) => ({ value: c.id, label: categoryPath(c) })),
  ]
  const syncPrimaryCategory = (event: Event) => {
    const root = event.currentTarget as HTMLElement
    if (!(event.target as HTMLInputElement).matches('input[type="checkbox"]')) return
    const select = root.querySelector<HTMLSelectElement>('select[name="primaryCategoryId"]')!
    const checked = new Set(
      [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((box) => box.value),
    )
    const keep = checked.has(select.value) ? select.value : ''
    select.replaceChildren(
      ...primaryOptions(current?.categoryChoices ?? [], checked).map(
        (option) => new Option(option.label, option.value, false, option.value === keep),
      ),
    )
    select.value = keep
  }
  let sourcePicker: ReturnType<typeof createCatalogProductPicker> | undefined
  let current: Binding | null = null
  const list: Screen<CatalogList> = {
    readKey: (route) => [route.query.q, route.query.status, route.query.page],
    read: (route, signal) =>
      ctx.call(
        'website_catalog.listBindings',
        { ...scope(), search: route.query.q ?? '', status: route.query.status, page: route.query.page },
        { signal },
      ),
    view: (data, route) => (
      <ListPage
        variant="operational"
        title={tr('website.route.catalog')}
        headerActions={
          <ActionGroup
            label={tr('website.catalog.listActions')}
            actions={[
              <LinkButton
                label={tr('website.catalog.editTemplate')}
                href={ctx.href('catalog-template', {
                  id: data.templates[0]?.id ?? '',
                })}
              />,
              writable() ? (
                <LinkButton
                  label={tr('website.catalog.chooseERP')}
                  href={ctx.href('catalog-new')}
                  variant={ctx.can('product.configure') ? 'secondary' : 'primary'}
                />
              ) : null,
              ctx.can('product.configure') && writable() ? (
                <LinkButton
                  label={tr('website.catalog.createProduct')}
                  href={ctx.href('catalog-product-new')}
                  variant="primary"
                />
              ) : null,
            ]}
          />
        }
        controls={
          <Stack
            items={[
              <Tabs
                label={tr('website.catalog.exposure')}
                items={(['all', 'visible', 'hidden'] as const).map((value) => ({
                  id: value,
                  label: tr(`website.catalog.${value}`),
                  href: ctx.href(
                    'catalog',
                    {},
                    { status: value === 'all' ? null : value, q: route.query.q || null },
                  ),
                  active: (route.query.status ?? 'all') === value,
                }))}
              />,
              <FilterBar
                label={tr('website.catalog.filter')}
                filters={[
                  <SearchBar
                    id="catalog-search"
                    action={ctx.href('catalog')}
                    value={route.query.q ?? ''}
                    label={tr('website.catalog.search')}
                    placeholder={tr('website.catalog.searchHint')}
                    submitLabel={tr('website.search.submit')}
                    hidden={
                      route.query.status && route.query.status !== 'all'
                        ? { status: route.query.status }
                        : undefined
                    }
                  />,
                ]}
              />,
            ]}
          />
        }
        body={
          <Stack
            items={[
              <Notice
                tone="info"
                title={tr('website.catalog.sourceTitle')}
                message={tr('website.catalog.sourceHelp')}
              />,
              <DataTable
                responsive="stack"
                rows={data.rows}
                id={(row) => row.id}
                rowHref={(row) => ctx.href('catalog-edit', { id: row.id })}
                emptyTitle={tr('website.catalog.empty')}
                emptyMessage={tr('website.catalog.emptyHelp')}
                columns={[
                  {
                    key: 'name',
                    label: tr('website.catalog.product'),
                    priority: 'primary',
                    cell: (row) => (
                      <div class="website-catalog-name">
                        {row.product.gallery[0] ? (
                          <img src={safeImage(row.product.gallery[0].src)} alt="" />
                        ) : null}
                        <Text children={row.product.name} />
                      </div>
                    ),
                  },
                  {
                    key: 'type',
                    label: tr('website.catalog.type'),
                    cell: (row) => tr(`website.catalog.${row.product.type}`),
                  },
                  {
                    key: 'category',
                    label: tr('website.catalog.category'),
                    cell: (row) => row.product.category,
                  },
                  {
                    key: 'path',
                    label: tr('website.entry.path'),
                    kind: 'identifier',
                    cell: (row) => row.path,
                  },
                  {
                    key: 'template',
                    label: tr('website.catalog.template'),
                    cell: (row) => data.templates.find((t) => t.id === row.templateId)?.title ?? '—',
                  },
                  {
                    key: 'status',
                    label: tr('website.catalog.exposure'),
                    kind: 'status',
                    cell: status,
                  },
                ]}
              />,
            ]}
          />
        }
        footer={
          <Inline
            items={[
              <Text children={tr('website.catalog.count', { count: data.total, visible: data.visible })} />,
              data.page > 1 ? (
                <LinkButton
                  label={tr('website.catalogPicker.previous')}
                  href={ctx.href('catalog', {}, { ...route.query, page: String(data.page - 1) })}
                />
              ) : null,
              <Text children={tr('website.catalogPicker.page', { page: data.page, pages: data.pages })} />,
              data.page < data.pages ? (
                <LinkButton
                  label={tr('website.catalogPicker.next')}
                  href={ctx.href('catalog', {}, { ...route.query, page: String(data.page + 1) })}
                />
              ) : null,
            ]}
          />
        }
      />
    ),
  }
  const edit: Screen<Binding> = {
    read: async (route, signal) => {
      current = await ctx.call<Binding>(
        'website_catalog.getBinding',
        { ...scope(), id: route.params.id },
        { signal },
      )
      return current
    },
    view: (row) => (
      <RecordPage
        title={row.product.name}
        width="wide"
        status={status(row)}
        actions={
          <Inline
            align="end"
            items={[
              <ActionGroup
                label={tr('website.catalog.recordActions')}
                actions={[
                  <LinkButton
                    label={tr('website.catalog.back')}
                    href={ctx.href('catalog')}
                    leading={icon('chevron-left')}
                    iconOnly
                  />,
                  <LinkButton
                    label={tr('website.catalog.previewProduct')}
                    href={ctx.href('catalog-preview', { id: row.id })}
                    leading={icon('search')}
                    iconOnly
                  />,
                  <LinkButton
                    label={tr('website.catalog.overrideContent')}
                    href={ctx.href('builder', {
                      id: catalogBuilderId('product', row.id),
                    })}
                    leading={icon('sliders-horizontal')}
                    iconOnly
                  />,
                  <LinkButton
                    label={tr('website.catalog.editProduct')}
                    href={ctx.href('catalog-product-edit', {
                      id: row.productId,
                    })}
                    leading={icon('pencil')}
                    iconOnly
                  />,
                  <LinkButton
                    label={tr('website.catalog.openERP')}
                    href={row.sourceEditorHref}
                    leading={icon('package')}
                    iconOnly
                  />,
                  <LinkButton
                    label={tr('website.catalog.editTemplate')}
                    href={ctx.href('catalog-template', { id: row.templateId }, { product: row.productId })}
                    leading={icon('layout-grid')}
                    iconOnly
                  />,
                  writable() ? (
                    <Menu
                      id="catalog-more"
                      label={tr('website.catalog.more')}
                      trigger="⋯"
                      align="end"
                      mobileAlign="end"
                      items={[
                        {
                          id: 'remove',
                          label: tr('website.catalog.removeBinding'),
                          href: ctx.href('catalog-remove', { id: row.id }),
                          leading: icon('trash-2'),
                          destructive: true,
                        },
                      ]}
                    />
                  ) : null,
                ]}
              />,
              <CommandButton
                label={tr('website.catalog.saveExposure')}
                command="catalog.save"
                type="submit"
                form="catalog-record"
                variant="primary"
                disabled={!writable() || ctx.busy()}
              />,
            ]}
          />
        }
        body={
          <form id="catalog-record">
            <Stack
              items={[
                <Surface
                  title={tr('website.catalog.sourceTitle')}
                  body={
                    <Stack
                      items={[
                        <DescriptionList
                          items={[
                            {
                              id: 'name',
                              label: tr('website.catalog.product'),
                              value: row.product.name,
                            },
                            {
                              id: 'type',
                              label: tr('website.catalog.type'),
                              value: tr(`website.catalog.${row.product.type}`),
                            },
                            {
                              id: 'category',
                              label: tr('website.catalog.category'),
                              value: row.product.category,
                            },
                          ]}
                        />,
                        <Text children={row.product.description} />,
                        <div class="website-catalog-images">
                          {row.product.gallery.map((image) => (
                            <img src={safeImage(image.src)} alt={image.alt ?? row.product.name} />
                          ))}
                        </div>,
                        <Notice
                          tone="info"
                          title={tr('website.catalog.sourceTitle')}
                          message={tr('website.catalog.sourceReadonly')}
                        />,
                      ]}
                    />
                  }
                />,
                <Surface
                  title={tr('website.catalog.websiteSettings')}
                  body={
                    <Stack
                      items={[
                        <Grid
                          columns={2}
                          mobileColumns={1}
                          items={[
                            <Switch
                              id="catalog-visible"
                              name="visible"
                              label={tr('website.catalog.exposure')}
                              checked={row.visible}
                              value="yes"
                              disabled={!writable()}
                            />,
                            <TextField
                              id="catalog-path"
                              name="path"
                              label={tr('website.entry.path')}
                              value={row.path}
                              disabled={!writable()}
                            />,
                            <Select
                              id="catalog-template"
                              name="templateId"
                              label={tr('website.catalog.template')}
                              value={row.templateId}
                              options={(
                                row.templates ?? [
                                  {
                                    id: row.templateId,
                                    title: tr('website.catalog.serviceTemplate'),
                                  },
                                ]
                              ).map((t) => ({ value: t.id, label: t.title }))}
                              disabled={!writable()}
                            />,
                            <Select
                              id="catalog-action"
                              name="action"
                              label={tr('website.catalog.action')}
                              value="quote"
                              options={[
                                {
                                  value: 'quote',
                                  label: tr('website.catalog.quote'),
                                },
                              ]}
                              disabled={!writable()}
                            />,
                          ]}
                        />,
                      ]}
                    />
                  }
                />,
                <Surface
                  title={tr('website.catalogCategory.categories')}
                  body={
                    <div class="website-catalog-membership" onChange={syncPrimaryCategory}>
                      <Stack
                        items={[
                          <CheckboxGroup
                            id="catalog-categories"
                            name="categoryIds"
                            label={tr('website.catalogCategory.membershipTitle')}
                            help={tr('website.catalogCategory.membershipFieldHelp')}
                            optionsOrientation="vertical"
                            disabled={!writable()}
                            options={(row.categoryChoices ?? []).map((c) => ({
                              value: c.id,
                              label: categoryPath(c),
                              checked: row.categoryIds?.includes(c.id),
                            }))}
                          />,
                          <Grid
                            columns={2}
                            mobileColumns={1}
                            items={[
                              <Select
                                id="catalog-primary-category"
                                name="primaryCategoryId"
                                label={tr('website.catalogCategory.primary')}
                                help={tr('website.catalogCategory.primaryHelp')}
                                value={row.primaryCategoryId ?? ''}
                                options={primaryOptions(
                                  row.categoryChoices ?? [],
                                  new Set(row.categoryIds ?? []),
                                )}
                                disabled={!writable()}
                              />,
                            ]}
                          />,
                        ]}
                      />
                    </div>
                  }
                />,
                <Surface
                  title={tr('website.catalog.seo')}
                  body={
                    <Stack
                      items={[
                        <TextField
                          id="catalog-seo-title"
                          name="seoTitle"
                          label={tr('website.catalog.seoTitle')}
                          value={row.seoTitle}
                          placeholder={row.product.name}
                          help={tr('website.catalog.seoFallback')}
                          disabled={!writable()}
                        />,
                        <TextArea
                          id="catalog-seo-description"
                          name="seoDescription"
                          label={tr('website.catalog.seoDescription')}
                          value={row.seoDescription}
                          placeholder={row.product.description}
                          disabled={!writable()}
                        />,
                      ]}
                    />
                  }
                />,
                <Notice
                  tone="info"
                  title={tr('website.catalog.liveTitle')}
                  message={tr('website.catalog.liveHelp')}
                />,
              ]}
            />
          </form>
        }
      />
    ),
    commands: {
      'catalog.remove': async (_args, form) => {
        if (!current || !writable()) return
        await ctx.call('website_catalog.removeBinding', {
          ...scope(),
          id: current.id,
          expectedRevisionId: current.revisionId,
          confirmed: form?.get('confirmed') === 'yes',
        })
        ctx.notify(tr('website.catalog.removed'), 'positive')
        await ctx.navigate('catalog')
      },
      'catalog.save': async (_args, form) => {
        if (!current || !form || !writable()) return
        await ctx.call('website_catalog.saveBinding', {
          ...scope(),
          id: current.id,
          expectedRevisionId: current.revisionId,
          visible: form.get('visible') === 'yes',
          path: String(form.get('path')),
          templateId: String(form.get('templateId')),
          action: String(form.get('action')),
          categoryIds: form.getAll('categoryIds[]').map(String),
          primaryCategoryId: String(form.get('primaryCategoryId') ?? ''),
          seoTitle: String(form.get('seoTitle') ?? ''),
          seoDescription: String(form.get('seoDescription') ?? ''),
        })
        ctx.notify(tr('website.catalog.saved'), 'positive')
        await ctx.refresh()
      },
    },
  }
  const templateScreen: Screen<null> = {
    read: async (route) => {
      await ctx.navigate('builder', {
        id: catalogBuilderId('template', route.params.id, route.query.product),
      })
      return null
    },
    view: () => <></>,
  }
  return {
    catalog: list,
    'catalog-edit': edit,
    'catalog-remove': {
      read: edit.read,
      view: (row: Binding) => (
        <ConfirmDialog
          id="catalog-remove-dialog"
          title={tr('website.catalog.removeTitle')}
          message={tr('website.catalog.removeHelp')}
          details={
            <form id="catalog-remove">
              <Checkbox
                id="catalog-remove-confirm"
                name="confirmed"
                submitValue="yes"
                checked={false}
                label={tr('website.catalog.removeConfirm')}
              />
            </form>
          }
          closeLabel={tr('website.catalog.cancel')}
          closeHref={ctx.href('catalog-edit', { id: row.id })}
          confirmLabel={tr('website.catalog.removeBinding')}
          confirmName="command"
          confirmValue={commandValue('catalog.remove')}
          confirmForm="catalog-remove"
          confirmDisabled={!writable() || ctx.busy()}
        />
      ),
    },
    'catalog-template': templateScreen,
    'catalog-new': {
      dispose: () => sourcePicker?.dispose(),
      read: (_route, signal) =>
        ctx.call<CatalogList>('website_catalog.listBindings', scope(), {
          signal,
        }),
      view: (data: CatalogList) => {
        sourcePicker?.dispose()
        sourcePicker = createCatalogProductPicker(ctx, {
          productIds: [],
          excludeIds: [],
          collection: false,
          groups: [],
          source: 'unlinked',
          maxSelection: 1,
        })
        return (
          <ModalSheet
            id="catalog-source-choose"
            title={tr('website.catalog.chooseERP')}
            closeLabel={tr('website.catalog.cancel')}
            closeHref={ctx.href('catalog')}
            body={
              <form id="catalog-choose">
                <Stack
                  items={[
                    <Notice
                      title={tr('website.catalog.sourceTitle')}
                      message={tr('website.catalog.chooseHelp')}
                      tone="info"
                    />,
                    sourcePicker.view(),
                  ]}
                />
              </form>
            }
            actions={
              <CommandButton
                label={tr('website.catalog.linkProduct')}
                command="catalog.add"
                type="submit"
                form="catalog-choose"
                variant="primary"
                disabled={!data.candidates.length || ctx.busy()}
              />
            }
          />
        )
      },
      commands: {
        'catalog.add': async (_args, form) => {
          if (!form || !writable()) return
          const row = await ctx.call<Binding>('website_catalog.addProduct', {
            ...scope(),
            productId:
              (JSON.parse(String(form.get('productIdsJSON') || '[]')) as string[])[0] ||
              String(form.get('productId') || ''),
          })
          await ctx.navigate('catalog-edit', { id: row.id })
          ctx.notify(tr('website.catalog.linked'), 'positive')
        },
      },
    },
    'catalog-preview': {
      read: async (route, signal) => {
        const b = await ctx.call<Binding>(
          'website_catalog.getBinding',
          { ...scope(), id: route.params.id },
          { signal },
        )
        const data = await ctx.call<TemplateData>(
          'website_catalog.getTemplate',
          { ...scope(), id: b.templateId },
          { signal },
        )
        return { b, template: data.template }
      },
      view: ({ b, template }) => (
        <WorkspacePage
          title={b.product.name}
          actions={
            <LinkButton label={tr('website.catalog.back')} href={ctx.href('catalog-edit', { id: b.id })} />
          }
          body={
            <Stack
              items={[
                <Notice
                  tone="info"
                  title={tr('website.catalog.preview')}
                  message={tr('website.catalog.previewHelp')}
                />,
                builderThemeFrame(
                  null,
                  ctx.site().name,
                  [],
                  renderLayout(bindCatalogTemplate(template, b.effectiveProduct ?? b.product)),
                ),
              ]}
            />
          }
        />
      ),
    },
  }
}
