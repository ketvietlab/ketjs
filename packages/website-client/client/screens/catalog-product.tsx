import {
  ActionGroup,
  Checkbox,
  ConfirmDialog,
  DescriptionList,
  Inline,
  Link,
  LinkButton,
  Menu,
  Notice,
  RecordPage,
  Select,
  Stack,
  Status,
  Surface,
  TextArea,
  TextField,
} from '@ketvietlab/design-system'
import { CommandButton, commandValue, icon } from '../ui.tsx'
import { newId } from './format.ts'
import type { CatalogProduct } from '../catalog-binding.ts'
import type { Screen, StudioContext } from '../types.ts'

export type SourceProduct = CatalogProduct & {
  active: boolean
  categoryId?: string
  categoryChoices?: { id: string; name: string }[]
  revisionId?: string
  affectedSites?: { id: string; name: string; bindingId: string; visible: boolean }[]
}

/** Both application entry points use the same fields; the product domain owns every mutation. */
export function ProductSourceFields({
  product,
  disabled,
  tr,
  prefix = 'source',
}: {
  product: SourceProduct
  disabled: boolean
  tr: StudioContext['tr']
  prefix?: string
}) {
  return (
    <Stack
      items={[
        <TextField
          id={`${prefix}-name`}
          name="name"
          label={tr('website.catalog.name')}
          value={product.name}
          disabled={disabled}
          required
        />,
        <Select
          id={`${prefix}-type`}
          name="type"
          label={tr('website.catalog.type')}
          value={product.type}
          disabled={disabled || !!product.revisionId}
          options={[
            { value: 'service', label: tr('website.catalog.service') },
            { value: 'goods', label: tr('website.catalog.goods') },
          ]}
        />,
        <Select
          id={`${prefix}-category`}
          name="categoryId"
          label={tr('website.catalog.category')}
          value={product.categoryId ?? ''}
          disabled={disabled}
          options={[
            { value: '', label: '—' },
            ...(product.categoryChoices ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />,
        <TextArea
          id={`${prefix}-description`}
          name="description"
          label={tr('website.catalog.description')}
          value={product.description}
          disabled={disabled}
        />,
      ]}
    />
  )
}

export function createCatalogProductScreens(ctx: StudioContext): Record<string, Screen> {
  const tr = ctx.tr
  const make = (isNew: boolean): Screen<SourceProduct> => {
    const prefix = isNew ? 'product.createSource' : 'product.editSource'
    let current: SourceProduct | null = null
    let pendingId: string | null = null
    const writable = () => ctx.can('product.configure') && (!isNew || ctx.can('website.catalog.configure'))
    return {
      read: async (route, signal) => {
        current = isNew
          ? {
              id: (pendingId ??= newId('product')),
              categoryChoices: await ctx.call<{ id: string; name: string }[]>(
                'product.listCategories',
                {},
                { signal },
              ),
              name: '',
              type: 'service',
              category: '',
              description: '',
              gallery: [],
              summaryDoc: '[]',
              descriptionDoc: '[]',
              active: true,
            }
          : await ctx.call<SourceProduct>('product.getTemplate', { id: route.params.id }, { signal })
        return current
      },
      view: (product) => {
        const own = product.affectedSites?.find((s) => s.id === ctx.site().id)
        return (
          <RecordPage
            title={isNew ? tr('website.catalog.createProduct') : product.name}
            width="wide"
            status={
              isNew ? null : (
                <Status
                  label={tr(product.active ? 'website.catalog.lifecycleActive' : 'website.catalog.archived')}
                  tone={product.active ? 'positive' : 'warning'}
                />
              )
            }
            actions={
              <Inline
                align="end"
                items={[
                  <ActionGroup
                    label={tr('website.catalog.productActions')}
                    actions={[
                      <LinkButton
                        label={tr(own ? 'website.catalog.backToBinding' : 'website.catalog.back')}
                        href={own ? ctx.href('catalog-edit', { id: own.bindingId }) : ctx.href('catalog')}
                        leading={icon('chevron-left')}
                        iconOnly
                      />,
                      !isNew && writable() ? (
                        <Menu
                          id="catalog-product-more"
                          label={tr('website.catalog.more')}
                          trigger="⋯"
                          align="end"
                          mobileAlign="end"
                          items={[
                            {
                              id: 'lifecycle',
                              label: tr(
                                product.active
                                  ? 'website.catalog.archiveProduct'
                                  : 'website.catalog.restoreProduct',
                              ),
                              href: ctx.href('catalog-product-archive', { id: product.id }),
                              leading: icon(product.active ? 'trash-2' : 'refresh-cw'),
                              destructive: product.active,
                            },
                          ]}
                        />
                      ) : null,
                    ]}
                  />,
                  <CommandButton
                    label={tr(isNew ? 'website.catalog.createAndLink' : 'website.catalog.erpSave')}
                    command={`${prefix}.save`}
                    form="product-source"
                    type="submit"
                    variant="primary"
                    disabled={!writable() || ctx.busy()}
                  />,
                ]}
              />
            }
            body={
              <Stack
                items={[
                  <Notice
                    tone="info"
                    title={tr('website.catalog.oneSource')}
                    message={tr('website.catalog.sharedEditHelp')}
                  />,
                  <Surface
                    title={tr('website.catalog.productContent')}
                    body={
                      <form id="product-source">
                        <ProductSourceFields product={product} disabled={!writable()} tr={tr} />
                      </form>
                    }
                  />,
                ]}
              />
            }
            aside={
              isNew ? (
                <Notice
                  title={tr('website.catalog.hiddenOnCreate')}
                  message={tr('website.catalog.chooseHelp')}
                  tone="info"
                />
              ) : (
                <Surface
                  title={tr('website.catalog.affectedSites')}
                  body={
                    product.affectedSites?.length ? (
                      <DescriptionList
                        items={product.affectedSites.map((s) => ({
                          id: s.id,
                          label:
                            s.id === ctx.site().id
                              ? tr('website.catalog.currentSite', { name: s.name })
                              : s.name,
                          value:
                            s.id === ctx.site().id ? (
                              <Link
                                label={tr(s.visible ? 'website.catalog.visible' : 'website.catalog.hidden')}
                                href={ctx.href('catalog-edit', { id: s.bindingId })}
                              />
                            ) : (
                              tr(s.visible ? 'website.catalog.visible' : 'website.catalog.hidden')
                            ),
                        }))}
                      />
                    ) : (
                      tr('website.catalog.noLinkedSites')
                    )
                  }
                />
              )
            }
          />
        )
      },
      commands: {
        [`${prefix}.save`]: async (_args, form) => {
          if (!current || !form || !writable()) return
          const saved = await ctx.call<{ id: string }>(
            'product.saveTemplate',
            {
              id: current.id,
              ...(isNew ? { siteId: ctx.site().id } : {}),
              expectedRevisionId: current.revisionId,
              name: String(form.get('name')),
              type: String(form.get('type') ?? current.type),
              categoryId: String(form.get('categoryId') ?? '') || null,
              description: String(form.get('description')),
            },
            { key: isNew ? current.id : undefined },
          )
          if (isNew) {
            const linked = await ctx.call<{ id: string }>(
              'website_catalog.addProduct',
              { siteId: ctx.site().id, productId: saved.id },
              { key: saved.id },
            )
            pendingId = null
            await ctx.navigate('catalog-edit', { id: linked.id })
          } else await ctx.refresh()
          ctx.notify(tr('website.catalog.erpSaved'), 'positive')
        },
        [`${prefix}.archive`]: async (args, form) => {
          if (!current || !writable()) return
          await ctx.call('product.archiveTemplate', {
            id: current.id,
            active: args.active === 'yes',
            expectedRevisionId: current.revisionId,
            confirmed: form?.get('confirmed') === 'yes',
          })
          ctx.notify(tr('website.catalog.lifecycleSaved'), 'positive')
          await ctx.navigate('catalog-product-edit', { id: current.id })
        },
      },
    }
  }
  const edit = make(false)
  const archive: Screen<SourceProduct> = {
    read: edit.read,
    view: (product) => (
      <ConfirmDialog
        id="catalog-product-archive-dialog"
        title={tr(product.active ? 'website.catalog.archiveProduct' : 'website.catalog.restoreProduct')}
        message={tr(product.active ? 'website.catalog.archiveHelp' : 'website.catalog.restoreHelp')}
        details={
          <form id="product-lifecycle">
            <Checkbox
              id="product-confirm"
              name="confirmed"
              submitValue="yes"
              checked={false}
              label={tr('website.catalog.lifecycleConfirm')}
            />
          </form>
        }
        closeLabel={tr('website.catalog.cancel')}
        closeHref={ctx.href('catalog-product-edit', { id: product.id })}
        confirmLabel={tr(
          product.active ? 'website.catalog.archiveProduct' : 'website.catalog.restoreProduct',
        )}
        confirmName="command"
        confirmValue={commandValue('product.editSource.archive', { active: product.active ? 'no' : 'yes' })}
        confirmForm="product-lifecycle"
        confirmVariant={product.active ? 'destructive' : 'primary'}
        confirmDisabled={!ctx.can('product.configure') || ctx.busy()}
      />
    ),
  }
  return {
    'catalog-product-new': make(true),
    'catalog-product-edit': edit,
    'catalog-product-archive': archive,
  }
}
