import { menuTree } from '../content-schema.mjs'
import { html } from '@ketvietlab/ketjs-view'
import {
  Surface,
  Stack,
  Grid,
  TextField,
  Select,
  DatePicker,
  Checkbox,
  LinkButton,
  DataTable,
  DescriptionList,
  Notice,
  EmptyState,
} from '@ketvietlab/design-system'
import { h, CommandButton, fragments } from '../ui.mjs'
import { safeImage } from '../renderer.mjs'
import { newId, formatTime } from './format.mjs'
export const visitorMoney = (value) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value)
export function publicFrame(
  ctx,
  title,
  body,
  {
    stay = false,
    actions = null,
    lead = null,
    brand = null,
    menus = null,
    theme = null,
    resolveLink = null,
    titleVisible = true,
  } = {},
) {
  const t = (key) => ctx.tr(`website.visitor.${key}`)
  const nav = stay
    ? [
        ['stays', 'stayNav'],
        ['own-bookings', 'bookings'],
        ['visitor-account', 'account'],
      ]
    : [
        ['shop', 'shop'],
        ['public-blog', 'blog'],
        ['stays', 'stays'],
        ['own-orders', 'orders'],
        ['own-bookings', 'bookings'],
        ['visitor-account', 'account'],
        ['shop-cart', 'cart'],
      ]
  const menu = (position) => {
    const tree = menuTree(menus?.filter((m) => m.position === position).flatMap((m) => m.items ?? []) ?? [])
    const children = (items, level = 0) =>
      fragments(
        items.map(
          (item) =>
            html`<span class="website-public-menu-item" data-menu-level=${String(level)}><a href=${resolveLink ? resolveLink(item.href) : safeHref(item.href)}>${item.label}</a>${children(item.children, level + 1)}</span>`,
        ),
      )
    return children(tree)
  }
  return html`<div class="website-visitor" data-website-theme=${theme ? 'default' : null} data-theme-preset=${theme?.preset ?? 'default'} data-accent=${theme?.accent} data-font=${theme?.font} data-spacing=${theme?.spacing} data-buttons=${theme?.buttons} data-visitor-theme=${stay ? 'retreat' : 'moc'}><header class="website-visitor-header"><a class="website-visitor-brand" href=${ctx.href(brand ? 'public' : stay ? 'stays' : 'shop')}>${brand ?? t(stay ? 'stayBrand' : 'brand')}</a><nav aria-label=${t('continue')}>${menus ? menu('header') : fragments(nav.map(([key, label]) => html`<a href=${ctx.href(key)}>${t(label)}</a>`))}</nav></header><main class="website-visitor-main">${titleVisible ? html`<header class="website-visitor-title"><div><h1>${title}</h1>${lead ? html`<p>${lead}</p>` : null}</div>${actions}</header>` : null}${body}</main><footer class="website-visitor-footer"><p>${theme?.footer ?? t('footer')}</p>${menus ? menu('footer') : null}<small>${theme?.preset === 'cosmetics' ? ctx.tr('website.cosmetics.simulation') : t('simulation')}</small></footer></div>`
}
export function createVisitorCommerceScreens(ctx) {
  const t = (key, args) => ctx.tr(`website.visitor.${key}`, args),
    money = visitorMoney
  const call = (name, input = {}, signal) => ctx.call(name, { siteId: ctx.site().id, ...input }, { signal })
  const link = (label, key, params = {}, query = {}) =>
    h(LinkButton, { label: t(label), href: ctx.href(key, params, query) })
  const empty = () => h(EmptyState, { title: t('empty'), description: t('emptyHelp') })
  const info = (items) =>
    h(DescriptionList, {
      columns: 2,
      items: items.map(([key, value]) => ({ id: key, label: t(key), value })),
    })
  const field = (key, value = '', component = TextField, extra = {}) =>
    h(component, { id: `visitor-${key}`, name: key, label: t(key), value, ...extra })
  const submit = (label, command, form) =>
    CommandButton({
      label: t(label),
      command,
      type: 'submit',
      form,
      variant: 'primary',
      disabled: ctx.busy(),
    })
  const contact = (form, command, label, address = false) =>
    html`<form id=${form} novalidate>${h(Stack, { items: [h(Stack, { items: [field('name'), field('email'), field('phone'), ...(address ? [field('address')] : [])] }), h(Checkbox, { id: `${form}-consent`, name: 'consent', label: t('consent') }), submit(label, command, form)] })}</form>`
  const contactValues = (form) => ({
    name: String(form.get('name') ?? ''),
    phone: String(form.get('phone') ?? ''),
    email: String(form.get('email') ?? ''),
    address: String(form.get('address') ?? ''),
    consent: form.has('consent'),
  })
  const pager = (data, key) =>
    html`<div class="website-visitor-pager"><span>${t('count', { count: data.total, page: data.page })}</span>${data.page > 1 ? link('previous', key, {}, { ...ctx.route().query, page: String(data.page - 1) }) : null}${data.page * data.limit < data.total ? link('next', key, {}, { ...ctx.route().query, page: String(data.page + 1) }) : null}</div>`
  const lineTable = (lines) =>
    h(DataTable, {
      rows: lines,
      id: (r) => r.id,
      columns: [
        { key: 'title', label: t('product'), cell: (r) => r.title, priority: 'primary' },
        { key: 'uom', label: t('unit'), cell: (r) => r.uom },
        { key: 'quantity', label: t('quantity'), cell: (r) => r.quantity },
        { key: 'price', label: t('price'), cell: (r) => money(r.price) },
        { key: 'total', label: t('total'), cell: (r) => money(r.price * r.quantity) },
      ],
    })
  const readList = (name) => (route, signal) => call(name, route.query, signal)
  let product,
    cart,
    quote,
    booking,
    orderId = newId('order'),
    bookingId = newId('booking')
  return {
    shop: {
      read: readList('website_studio.shopProducts'),
      view: (data) =>
        publicFrame(
          ctx,
          t('shop'),
          data.rows.length
            ? h(Grid, {
                columns: 3,
                items: data.rows.map((p) =>
                  h(Surface, {
                    title: p.title,
                    body: html`<a href=${ctx.href('shop-product', { id: p.id })}><img class="website-visitor-photo" src=${safeImage(p.image)} alt=${p.title} /></a><p>${p.description}</p><strong>${money(p.variants[0].price)}</strong>${link('details', 'shop-product', { id: p.id })}`,
                  }),
                ),
              })
            : empty(),
          { lead: t('shopLead') },
        ),
    },
    'shop-product': {
      read: async (route, signal) =>
        (product = await call('website_studio.shopProduct', { id: route.params.id }, signal)),
      view: (p) =>
        publicFrame(
          ctx,
          p.title,
          h(Grid, {
            columns: 2,
            items: [
              html`<img class="website-visitor-photo website-visitor-photo-large" src=${safeImage(p.image)} alt=${p.title} />`,
              h(Surface, {
                title: p.category,
                body: html`<p>${p.description}</p><p class="website-visitor-price">${money(p.variants[0].price)}${p.variants.length > 1 ? html` – ${money(Math.max(...p.variants.map((v) => v.price)))}` : null}</p>${info([['unit', p.uom]])}<form id="visitor-product" novalidate>${h(Stack, { items: [field('variant', p.variants[0]?.id, Select, { options: p.variants.map((v) => ({ value: v.id, label: `${v.title} · ${money(v.price)} · ${t('available', { count: v.available, unit: p.uom })}` })) }), field('quantity', '1'), submit('add', 'visitor.cart.add', 'visitor-product')] })}</form><p>${t('priceHelp')}</p>${p.specs ? h(DescriptionList, { items: p.specs.map(([label, value], i) => ({ id: String(i), label, value })) }) : null}`,
              }),
            ],
          }),
          { actions: link('back', 'shop') },
        ),
      commands: {
        'visitor.cart.add': async (_, form) => {
          await call('website_studio.shopCartUpdate', {
            variantId: String(form.get('variant')),
            quantity: Number(form.get('quantity')),
          })
          await ctx.navigate('shop-cart')
        },
      },
    },
    'shop-cart': {
      read: async (_route, signal) => (cart = await call('website_studio.shopCart', {}, signal)),
      view: (data) =>
        publicFrame(
          ctx,
          t('cart'),
          data.lines.length
            ? h(Stack, {
                items: [
                  lineTable(data.lines),
                  fragments(
                    data.lines.map((l) =>
                      CommandButton({
                        label: `${t('remove')} · ${l.title}`,
                        command: 'visitor.cart.remove',
                        args: { id: l.id },
                      }),
                    ),
                  ),
                  info([['total', money(data.total)]]),
                  link('checkout', 'shop-checkout'),
                ],
              })
            : empty(),
          { actions: link('continue', 'shop') },
        ),
      commands: {
        'visitor.cart.remove': async ({ id }) => {
          await call('website_studio.shopCartUpdate', { variantId: id, quantity: 0 })
          await ctx.refresh()
        },
      },
    },
    'shop-checkout': {
      read: async (_route, signal) => (cart = await call('website_studio.shopCart', {}, signal)),
      view: (data) =>
        publicFrame(
          ctx,
          t('checkout'),
          data.lines.length
            ? h(Grid, {
                columns: 2,
                items: [
                  h(Surface, {
                    title: t('contact'),
                    body: html`${h(Notice, { title: t('policyLabel'), message: t('policy'), tone: 'info' })}${contact('visitor-checkout', 'visitor.checkout', 'confirmOrder', true)}`,
                  }),
                  h(Surface, {
                    title: t('cart'),
                    body: html`${lineTable(data.lines)}${info([
                      ['total', money(data.total)],
                      ['reference', orderId],
                    ])}<p>${t('unknown')}</p>`,
                  }),
                ],
              })
            : empty(),
        ),
      commands: {
        'visitor.checkout': async (_, form) => {
          const result = await call('website_studio.shopCheckout', {
            ...contactValues(form),
            id: orderId,
            expectedRevision: cart.revision,
            expectedTotal: cart.total,
          })
          orderId = newId('order')
          await ctx.navigate('shop-receipt', { id: result.id })
        },
      },
    },
    'shop-receipt': {
      read: (route, signal) => call('website_studio.shopReceipt', { id: route.params.id }, signal),
      view: (data) =>
        publicFrame(
          ctx,
          t('receipt'),
          h(Stack, {
            items: [
              h(Notice, {
                title: t(data.state),
                message: data.order ? t('unpaid') : t('unknown'),
                tone: data.order ? 'positive' : 'warning',
              }),
              info([
                ['reference', data.reference],
                ['payment', t('unpaid')],
              ]),
              data.order
                ? link('details', 'own-order', { id: data.order.id })
                : CommandButton({ label: t('checkReceipt'), command: 'visitor.receipt.check' }),
              link('orders', 'own-orders'),
            ],
          }),
        ),
      commands: { 'visitor.receipt.check': () => ctx.refresh() },
    },
    'own-orders': {
      read: readList('website_studio.ownOrders'),
      view: (data) =>
        publicFrame(
          ctx,
          t('orders'),
          h(Stack, {
            items: [
              data.rows.length
                ? h(DataTable, {
                    rows: data.rows,
                    id: (r) => r.id,
                    rowHref: (r) => ctx.href('own-order', { id: r.id }),
                    columns: [
                      { key: 'id', label: t('reference'), cell: (r) => r.id, priority: 'primary' },
                      { key: 'date', label: t('date'), cell: (r) => formatTime(r.date) },
                      { key: 'total', label: t('total'), cell: (r) => money(r.total) },
                      { key: 'state', label: t('state'), cell: (r) => t(r.state) },
                    ],
                  })
                : empty(),
              pager(data, 'own-orders'),
            ],
          }),
        ),
    },
    'own-order': {
      read: (route, signal) => call('website_studio.ownOrder', { id: route.params.id }, signal),
      view: (data) =>
        publicFrame(
          ctx,
          data.id,
          h(Stack, {
            items: [
              h(Notice, { title: t(data.state), message: t('unpaid'), tone: 'info' }),
              h(Surface, { title: t('cart'), body: lineTable(data.lines) }),
              h(Surface, {
                title: t('details'),
                body: info([
                  ['total', money(data.total)],
                  ['date', formatTime(data.date)],
                  ['fulfillment', t(data.fulfillment)],
                  ['payment', t('unpaid')],
                  ['address', data.address],
                  ['phone', data.phone],
                ]),
              }),
              link('contact', 'visitor-form', { id: 'form-booking' }),
            ],
          }),
          { actions: link('orders', 'own-orders') },
        ),
    },
    stays: {
      read: readList('website_studio.stayProperties'),
      view: (data) =>
        publicFrame(
          ctx,
          t('stays'),
          data.rows.length
            ? h(Stack, {
                items: data.rows.map((p) =>
                  h(Surface, {
                    title: p.title,
                    body: html`<a href=${ctx.href('stay-property', { id: p.id })}><img class="website-visitor-photo website-visitor-photo-large" src=${safeImage(p.image)} alt=${p.title} /></a><p>${p.location} · ${p.amenities.join(' · ')}</p><p>${p.description}</p>${link('discover', 'stay-property', { id: p.id })}`,
                  }),
                ),
              })
            : empty(),
          { stay: true, lead: t('stayLead') },
        ),
    },
    'stay-property': {
      read: (route, signal) => call('website_studio.stayProperty', { id: route.params.id }, signal),
      view: (p) =>
        publicFrame(
          ctx,
          p.title,
          h(Stack, {
            items: [
              html`<img class="website-visitor-photo website-visitor-photo-wide" src=${safeImage(p.image)} alt=${p.title} /><p>${p.location} · ${p.amenities.join(' · ')}</p>`,
              h(Grid, {
                columns: 2,
                items: p.rooms.map((r) =>
                  h(Surface, {
                    title: r.title,
                    body: html`<p>${t('capacity', { count: r.capacity })}</p><strong>${money(r.price)}</strong>`,
                  }),
                ),
              }),
              h(Surface, {
                title: t('quote'),
                body: html`<form id="stay-quote" novalidate><input type="hidden" name="propertyId" value=${p.id}/>${h(Grid, { columns: 3, items: [field('arrival', '2026-12-10', DatePicker), field('departure', '2026-12-12', DatePicker), field('roomType', p.rooms[0].id, Select, { options: p.rooms.map((r) => ({ value: r.id, label: r.title })) }), field('rooms', '1'), field('guests', '2')] })}<p>${t('quoteHelp')}</p>${submit('quote', 'visitor.stay.quote', 'stay-quote')}</form>`,
              }),
            ],
          }),
          { stay: true, actions: link('stays', 'stays') },
        ),
      commands: {
        'visitor.stay.quote': async (_, form) => {
          const result = await call('website_studio.stayQuote', {
            propertyId: String(form.get('propertyId')),
            roomId: String(form.get('roomType')),
            arrival: String(form.get('arrival')),
            departure: String(form.get('departure')),
            rooms: Number(form.get('rooms')),
            guests: Number(form.get('guests')),
          })
          await ctx.navigate('stay-checkout', {}, { quote: result.id })
        },
      },
    },
    'stay-checkout': {
      read: async (route, signal) =>
        (quote = await call('website_studio.stayQuoteContext', { id: route.query.quote }, signal)),
      view: (q) =>
        publicFrame(
          ctx,
          t('booking'),
          q.missing
            ? h(Stack, {
                items: [
                  h(Notice, { title: t('quoteMissing'), message: t('quoteHelp'), tone: 'info' }),
                  link('quote', 'stay-property', { id: 'an-nhien' }),
                ],
              })
            : h(Grid, {
                columns: 2,
                items: [
                  h(Surface, {
                    title: q.propertyTitle,
                    body: html`${info([
                      ['roomType', q.roomTitle],
                      ['arrival', q.arrival],
                      ['departure', q.departure],
                      ['rooms', q.rooms],
                      ['guests', q.guests],
                      ['nights', q.nights],
                      ['timezone', q.timezone],
                      ['expires', formatTime(q.expiresAt)],
                      ['total', money(q.total)],
                    ])}<p>${q.policy}</p><p>${t('fresh')}</p>`,
                  }),
                  h(Surface, {
                    title: t('confirmBooking'),
                    body: html`${contact('stay-book', 'visitor.stay.book', 'confirmBooking')}<p>${t('reference')}: ${bookingId}</p><p>${t('unknown')}</p>`,
                  }),
                ],
              }),
          { stay: true },
        ),
      commands: {
        'visitor.stay.book': async (_, form) => {
          const result = await call('website_studio.stayBook', {
            ...contactValues(form),
            id: bookingId,
            quoteId: quote.id,
          })
          bookingId = newId('booking')
          await ctx.navigate('own-booking', { id: result.id })
        },
      },
    },
    'own-bookings': {
      read: readList('website_studio.ownBookings'),
      view: (data) =>
        publicFrame(
          ctx,
          t('bookings'),
          h(Stack, {
            items: [
              data.rows.length
                ? h(DataTable, {
                    rows: data.rows,
                    id: (r) => r.id,
                    rowHref: (r) => ctx.href('own-booking', { id: r.id }),
                    columns: [
                      {
                        key: 'id',
                        label: t('reference'),
                        cell: (r) => html`${r.propertyTitle}<br/>${r.id}`,
                        priority: 'primary',
                      },
                      { key: 'dates', label: t('arrival'), cell: (r) => `${r.arrival} → ${r.departure}` },
                      { key: 'rooms', label: t('rooms'), cell: (r) => t('roomsCount', r) },
                      { key: 'total', label: t('total'), cell: (r) => money(r.total) },
                      { key: 'state', label: t('state'), cell: (r) => t(r.state) },
                    ],
                  })
                : empty(),
              pager(data, 'own-bookings'),
            ],
          }),
          { stay: true },
        ),
    },
    'own-booking': {
      read: async (route, signal) =>
        (booking = await call('website_studio.ownBooking', { id: route.params.id }, signal)),
      view: (b) =>
        publicFrame(
          ctx,
          b.id,
          h(Stack, {
            items: [
              h(Notice, {
                title: t(b.state),
                message: t('unpaid'),
                tone: b.state === 'cancelled' ? 'warning' : 'positive',
              }),
              h(Grid, {
                columns: 2,
                items: [
                  h(Surface, {
                    title: b.propertyTitle,
                    body: info([
                      ['roomType', b.roomTitle],
                      ['arrival', b.arrival],
                      ['departure', b.departure],
                      ['rooms', b.rooms],
                      ['guests', b.guests],
                      ['total', money(b.total)],
                      ['timezone', b.timezone],
                      ['units', b.units.join(', ')],
                    ]),
                  }),
                  h(Surface, {
                    title: t('policyLabel'),
                    body: html`<p>${b.policy}</p>${b.canCancel ? html`<form id="stay-cancel">${h(Checkbox, { id: 'stay-cancel-confirm', name: 'confirmed', label: t('cancelConsent') })}${submit('cancel', 'visitor.stay.cancel', 'stay-cancel')}</form>` : html`<p>${t('cancelUnavailable')}</p>`}${link('contact', 'visitor-form', { id: 'form-booking' })}`,
                  }),
                ],
              }),
            ],
          }),
          { stay: true, actions: link('bookings', 'own-bookings') },
        ),
      commands: {
        'visitor.stay.cancel': async (_, form) => {
          await call('website_studio.stayCancel', {
            id: booking.id,
            expectedRevision: booking.revision,
            confirmed: form.has('confirmed'),
          })
          await ctx.refresh()
        },
      },
    },
    'public-blog': {
      read: readList('website_studio.publicBlog'),
      view: (data) =>
        publicFrame(
          ctx,
          t('blog'),
          h(Stack, {
            items: [
              html`<form id="blog-filter">${h(Grid, { columns: 2, items: [field('search', ctx.route().query.q ?? ''), field('category', ctx.route().query.category ?? '', Select, { options: [{ value: '', label: t('all') }, ...data.categories.map((c) => ({ value: c, label: c }))] })] })}${submit('search', 'visitor.blog.search', 'blog-filter')}</form>`,
              data.rows.length
                ? h(Grid, {
                    columns: 2,
                    items: data.rows.map((r) =>
                      h(Surface, {
                        title: r.title,
                        body: html`<p>${r.category} · ${formatTime(r.publishedAt)} · ${r.author}</p><p>${r.excerpt}</p>${link('read', 'public', {}, { path: r.path })}`,
                      }),
                    ),
                  })
                : empty(),
              pager(data, 'public-blog'),
            ],
          }),
          { lead: t('blogLead') },
        ),
      commands: {
        'visitor.blog.search': async (_, form) =>
          ctx.navigate(
            'public-blog',
            {},
            { q: String(form.get('search') ?? ''), category: String(form.get('category') ?? '') },
          ),
      },
    },
  }
}
