import { publicFrame } from './visitor-commerce.tsx'
import {
  ListPage,
  WorkspacePage,
  Surface,
  Stack,
  Grid,
  DataTable,
  DatePicker,
  Field,
  Checkbox,
  LinkButton,
  Notice,
  DescriptionList,
} from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view/jsx-runtime'
import { CommandButton } from '../ui.tsx'
import { newId } from './format.ts'
import type { Screen, StudioContext } from '../types.ts'

type AdapterSummary = { id: string; title: string; description: string }
/** A field the adapter asks the visitor for; a date gets a date picker. */
type AdapterField = {
  name: string
  label: string
  type?: 'text' | 'email' | 'tel' | 'number' | 'date'
  required?: boolean
}
type AdapterItem = { id: string; title: string; price: number; quantity: number; available: number }
/** `website_studio.adapterContext`: what one ERP adapter offers and what the visitor chose. */
type AdapterContext = AdapterSummary & {
  available?: boolean
  receipt?: { id: string } | null
  external?: boolean
  items: AdapterItem[]
  total: number
  fields: AdapterField[]
}

export function createAdapterList(ctx: StudioContext) {
  return {
    read: (_route, signal) =>
      ctx.call<{ rows: AdapterSummary[] }>(
        'website_studio.adapterList',
        { siteId: ctx.site().id },
        { signal },
      ),
    view: (data) => (
      <ListPage
        variant="operational"
        title={ctx.tr('website.route.adapters')}
        footer={ctx.tr('website.list.results', { count: data.rows.length })}
        body={
          <DataTable
            rows={data.rows}
            id={(row) => row.id}
            rowHref={(row) =>
              row.id === 'retail'
                ? ctx.href('shop')
                : row.id === 'hospitality'
                  ? ctx.href('visitor-table')
                  : row.id === 'crm'
                    ? ctx.href('visitor-contact')
                    : ctx.href('adapter', { id: row.id })
            }
            columns={[
              {
                key: 'title',
                label: ctx.tr('website.entry.title'),
                cell: (row) => row.title,
                priority: 'primary',
              },
              { key: 'description', label: ctx.tr('website.adapter.scope'), cell: (row) => row.description },
            ]}
          />
        }
      />
    ),
  } satisfies Screen<{ rows: AdapterSummary[] }>
}
export function createAdapter(ctx: StudioContext, adapter: string | null = null) {
  const command = (action: string) => `adapter.${adapter ?? 'studio'}.${action}`
  const frame = (data: AdapterContext, body: JSXChild) =>
    adapter ? (
      publicFrame(ctx, data.title, body)
    ) : (
      <WorkspacePage
        title={data.title}
        actions={<LinkButton label={ctx.tr('website.resource.back')} href={ctx.href('adapters')} />}
        body={body}
      />
    )
  let current: AdapterContext
  let requestId = newId('request')
  const money = (value: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value)
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) =>
      (current = await ctx.call<AdapterContext>(
        'website_studio.adapterContext',
        { siteId: ctx.site().id, adapter: adapter ?? route.params.id },
        { signal },
      )),
    view: (data) =>
      frame(
        data,
        <Stack
          items={[
            <Notice title={ctx.tr('website.adapter.scope')} message={data.description} tone="info" />,
            data.available === false ? (
              <Notice
                title={ctx.tr('website.adapter.unavailable')}
                message={ctx.tr('website.adapter.unavailableHelp')}
                tone="warning"
              />
            ) : null,
            data.receipt ? (
              <Notice
                title={ctx.tr('website.adapter.received')}
                message={ctx.tr('website.adapter.receipt', { id: data.receipt.id })}
                tone="positive"
              />
            ) : null,
            data.external ? (
              <Notice
                title={ctx.tr('website.adapter.deferred')}
                message={ctx.tr('website.adapter.deferredHelp')}
                tone="info"
              />
            ) : (
              <Surface
                title={ctx.tr(
                  data.id === 'hospitality'
                    ? 'website.adapter.chooseSlot'
                    : data.id === 'crm'
                      ? 'website.adapter.choosePurpose'
                      : 'website.adapter.choose',
                )}
                body={
                  <DataTable
                    rows={data.items}
                    id={(row) => row.id}
                    emptyTitle={ctx.tr('website.adapter.empty')}
                    emptyMessage={ctx.tr('website.adapter.emptyHelp')}
                    columns={[
                      {
                        key: 'title',
                        label: ctx.tr('website.entry.title'),
                        cell: (row) => row.title,
                        priority: 'primary',
                      },
                      {
                        key: 'price',
                        label: ctx.tr('website.adapter.price'),
                        cell: (row) => money(row.price),
                      },
                      {
                        key: 'quantity',
                        label: ctx.tr('website.adapter.quantity'),
                        cell: (row) => (
                          <>
                            <CommandButton
                              label={ctx.tr('website.adapter.less')}
                              command={command('cart')}
                              args={{ item: row.id, quantity: String(row.quantity - 1) }}
                              disabled={!row.quantity || ctx.busy()}
                            />{' '}
                            {row.quantity}{' '}
                            <CommandButton
                              label={ctx.tr('website.adapter.more')}
                              command={command('cart')}
                              args={{ item: row.id, quantity: String(row.quantity + 1) }}
                              disabled={row.quantity >= row.available || ctx.busy()}
                            />
                          </>
                        ),
                      },
                    ]}
                  />
                }
              />
            ),
            !data.external ? (
              <Surface
                title={ctx.tr('website.adapter.contact')}
                body={
                  <>
                    {data.id === 'retail' ? (
                      <DescriptionList
                        layout="strip"
                        items={[
                          { id: 'total', label: ctx.tr('website.adapter.total'), value: money(data.total) },
                        ]}
                      />
                    ) : null}
                    <form id="adapter-request" novalidate>
                      <Grid
                        columns={2}
                        items={[
                          ...data.fields.map((field) => {
                            const props = {
                              id: `adapter-${field.name}`,
                              name: field.name,
                              label: field.label,
                              required: field.required !== false,
                            }
                            return field.type === 'date' ? (
                              <DatePicker {...props} />
                            ) : (
                              <Field {...props} type={field.type ?? 'text'} />
                            )
                          }),
                          <Checkbox
                            id="adapter-consent"
                            name="consent"
                            value="yes"
                            label={ctx.tr('website.formJourney.consent')}
                          />,
                        ]}
                      />
                      <CommandButton
                        label={ctx.tr('website.formJourney.send')}
                        command={command('submit')}
                        type="submit"
                        form="adapter-request"
                        variant="primary"
                        disabled={ctx.busy() || !data.items.some((row) => row.quantity)}
                      />
                    </form>
                  </>
                }
              />
            ) : null,
          ]}
        />,
      ),
    commands: {
      [command('cart')]: async ({ item, quantity }) => {
        await ctx.call('website_studio.adapterCart', {
          siteId: ctx.site().id,
          adapter: current.id,
          itemId: item,
          quantity: Number(quantity),
        })
        await ctx.refresh()
      },
      [command('submit')]: async (_args, form) => {
        await ctx.call(
          'website_studio.adapterSubmit',
          {
            siteId: ctx.site().id,
            adapter: current.id,
            id: requestId,
            consent: form!.has('consent'),
            fields: Object.fromEntries(
              current.fields.map((field) => [field.name, String(form!.get(field.name) ?? '')]),
            ),
          },
          { key: requestId },
        )
        requestId = newId('request')
        await ctx.refresh()
      },
    },
  } satisfies Screen<AdapterContext>
}
