import { publicFrame } from './visitor-commerce.mjs'
import { html } from '@ketvietlab/ketjs-view'
import {
  ListPage,
  WorkspacePage,
  Surface,
  Stack,
  Grid,
  DataTable,
  TextField,
  DatePicker,
  Checkbox,
  LinkButton,
  Notice,
  DescriptionList,
} from '@ketvietlab/design-system'
import { h, CommandButton } from '../ui.mjs'
import { newId } from './format.mjs'
export function createAdapterList(ctx) {
  return {
    read: (_route, signal) => ctx.call('website_studio.adapterList', { siteId: ctx.site().id }, { signal }),
    view: (data) =>
      h(ListPage, {
        variant: 'operational',
        title: ctx.tr('website.route.adapters'),
        footer: ctx.tr('website.list.results', { count: data.rows.length }),
        body: h(DataTable, {
          rows: data.rows,
          id: (row) => row.id,
          rowHref: (row) =>
            row.id === 'retail'
              ? ctx.href('shop')
              : row.id === 'hospitality'
                ? ctx.href('visitor-table')
                : row.id === 'crm'
                  ? ctx.href('visitor-contact')
                  : ctx.href('adapter', { id: row.id }),
          columns: [
            {
              key: 'title',
              label: ctx.tr('website.entry.title'),
              cell: (row) => row.title,
              priority: 'primary',
            },
            { key: 'description', label: ctx.tr('website.adapter.scope'), cell: (row) => row.description },
          ],
        }),
      }),
  }
}
export function createAdapter(ctx, adapter = null) {
  const command = (action) => `adapter.${adapter ?? 'studio'}.${action}`
  const frame = (data, body) =>
    adapter
      ? publicFrame(ctx, data.title, body)
      : h(WorkspacePage, {
          title: data.title,
          actions: h(LinkButton, { label: ctx.tr('website.resource.back'), href: ctx.href('adapters') }),
          body,
        })
  let current
  let requestId = newId('request')
  const money = (value) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value)
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) =>
      (current = await ctx.call(
        'website_studio.adapterContext',
        { siteId: ctx.site().id, adapter: adapter ?? route.params.id },
        { signal },
      )),
    view: (data) =>
      frame(
        data,
        h(Stack, {
          items: [
            h(Notice, { title: ctx.tr('website.adapter.scope'), message: data.description, tone: 'info' }),
            data.available === false
              ? h(Notice, {
                  title: ctx.tr('website.adapter.unavailable'),
                  message: ctx.tr('website.adapter.unavailableHelp'),
                  tone: 'warning',
                })
              : null,
            data.receipt
              ? h(Notice, {
                  title: ctx.tr('website.adapter.received'),
                  message: ctx.tr('website.adapter.receipt', { id: data.receipt.id }),
                  tone: 'positive',
                })
              : null,
            data.external
              ? h(Notice, {
                  title: ctx.tr('website.adapter.deferred'),
                  message: ctx.tr('website.adapter.deferredHelp'),
                  tone: 'info',
                })
              : h(Surface, {
                  title: ctx.tr(
                    data.id === 'hospitality'
                      ? 'website.adapter.chooseSlot'
                      : data.id === 'crm'
                        ? 'website.adapter.choosePurpose'
                        : 'website.adapter.choose',
                  ),
                  body: h(DataTable, {
                    rows: data.items,
                    id: (row) => row.id,
                    columns: [
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
                        cell: (row) =>
                          html`${CommandButton({ label: ctx.tr('website.adapter.less'), command: command('cart'), args: { item: row.id, quantity: String(row.quantity - 1) }, disabled: !row.quantity || ctx.busy() })} ${row.quantity} ${CommandButton({ label: ctx.tr('website.adapter.more'), command: command('cart'), args: { item: row.id, quantity: String(row.quantity + 1) }, disabled: row.quantity >= row.available || ctx.busy() })}`,
                      },
                    ],
                  }),
                }),
            !data.external
              ? h(Surface, {
                  title: ctx.tr('website.adapter.contact'),
                  body: html`${data.id === 'retail' ? h(DescriptionList, { layout: 'strip', items: [{ id: 'total', label: ctx.tr('website.adapter.total'), value: money(data.total) }] }) : null}<form id="adapter-request" novalidate>${h(Grid, { columns: 2, items: [...data.fields.map((field) => h(field.type === 'date' ? DatePicker : TextField, { id: `adapter-${field.name}`, name: field.name, label: field.label, type: field.type ?? 'text', required: field.required !== false })), h(Checkbox, { id: 'adapter-consent', name: 'consent', value: 'yes', label: ctx.tr('website.formJourney.consent') })] })}${CommandButton({ label: ctx.tr('website.formJourney.send'), command: command('submit'), type: 'submit', form: 'adapter-request', variant: 'primary', disabled: ctx.busy() || !data.items.some((row) => row.quantity) })}</form>`,
                })
              : null,
          ],
        }),
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
            consent: form.has('consent'),
            fields: Object.fromEntries(
              current.fields.map((field) => [field.name, String(form.get(field.name) ?? '')]),
            ),
          },
          { key: requestId },
        )
        requestId = newId('request')
        await ctx.refresh()
      },
    },
  }
}
