import { menuTree } from '../content-schema.ts'
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
import type { FieldOption } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view/jsx-runtime'
import { CommandButton, fragments } from '../ui.tsx'
import { safeHref, safeImage } from '../renderer.tsx'
import { newId, formatTime } from './format.ts'
import type { MenuNode } from '../content-schema.ts'
import type { MenuItem, Screen, SiteTheme, StudioContext, WebsiteLocation } from '../types.ts'

/** One page of a visitor list: its rows, and where the page sits in the total. */
export type VisitorPage<Row> = { rows: Row[]; total: number; page: number; limit: number }
type Variant = { id: string; title: string; price: number; available: number }
type Product = {
  id: string
  title: string
  image: string
  description: string
  category: string
  uom: string
  variants: Variant[]
  specs?: [string, string][]
}
type CartLine = { id: string; title: string; uom: string; quantity: number; price: number }
type Cart = { lines: CartLine[]; total: number; revision: string | number }
type Receipt = { state: string; reference: string; order: { id: string } | null }
type OrderRow = { id: string; date: string; total: number; state: string }
type Order = OrderRow & { lines: CartLine[]; fulfillment: string; address: string; phone: string }
type Room = { id: string; title: string; capacity: number; price: number }
type StayProperty = {
  id: string
  title: string
  image: string
  location: string
  amenities: string[]
  description: string
  rooms: Room[]
}
type StayQuote = {
  id: string
  missing?: boolean
  propertyTitle: string
  roomTitle: string
  arrival: string
  departure: string
  rooms: number
  guests: number
  nights: number
  timezone: string
  expiresAt: string
  total: number
  policy: string
}
type BookingRow = {
  id: string
  propertyTitle: string
  arrival: string
  departure: string
  rooms: number
  total: number
  state: string
}
type Booking = BookingRow & {
  roomTitle: string
  guests: number
  timezone: string
  units: string[]
  policy: string
  canCancel: boolean
  revision: string | number
}
type BlogRow = {
  title: string
  category: string
  publishedAt: string
  author: string
  excerpt: string
  path: string
}

/** The site's menus as a visitor page draws them: the header's and the footer's. */
export type PublicMenu = { position?: string; items?: MenuItem[] }
export type PublicFrameOptions = {
  stay?: boolean
  actions?: JSXChild
  lead?: string | null
  brand?: JSXChild
  menus?: PublicMenu[] | null
  theme?: SiteTheme | null
  resolveLink?: ((href: string) => string) | null
  titleVisible?: boolean
}

export const visitorMoney = (value: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value)
export function publicFrame(
  ctx: StudioContext,
  title: string,
  body: JSXChild,
  {
    stay = false,
    actions = null,
    lead = null,
    brand = null,
    menus = null,
    theme = null,
    resolveLink = null,
    titleVisible = true,
  }: PublicFrameOptions = {},
) {
  const t = (key: string) => ctx.tr(`website.visitor.${key}`)
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
  const menu = (position: string) => {
    const tree = menuTree(menus?.filter((m) => m.position === position).flatMap((m) => m.items ?? []) ?? [])
    const children = (items: MenuNode[], level = 0): JSXChild =>
      fragments(
        items.map((item) => (
          <span class="website-public-menu-item" data-menu-level={String(level)}>
            <a href={resolveLink ? resolveLink(item.href) : safeHref(item.href)}>{item.label}</a>
            {children(item.children, level + 1)}
          </span>
        )),
      )
    return children(tree)
  }
  return (
    <div
      class="website-visitor"
      data-website-theme={theme ? 'default' : null}
      data-theme-preset={theme?.preset ?? 'default'}
      data-accent={theme?.accent}
      data-font={theme?.font}
      data-spacing={theme?.spacing}
      data-buttons={theme?.buttons}
      data-visitor-theme={stay ? 'retreat' : 'moc'}
    >
      <header class="website-visitor-header">
        <a class="website-visitor-brand" href={ctx.href(brand ? 'public' : stay ? 'stays' : 'shop')}>
          {brand ?? t(stay ? 'stayBrand' : 'brand')}
        </a>
        <nav aria-label={t('continue')}>
          {menus
            ? menu('header')
            : fragments(nav.map(([key, label]) => <a href={ctx.href(key)}>{t(label)}</a>))}
        </nav>
      </header>
      <main class="website-visitor-main">
        {titleVisible ? (
          <header class="website-visitor-title">
            <div>
              <h1>{title}</h1>
              {lead ? <p>{lead}</p> : null}
            </div>
            {actions}
          </header>
        ) : null}
        {body}
      </main>
      <footer class="website-visitor-footer">
        <p>{theme?.footer ?? t('footer')}</p>
        {menus ? menu('footer') : null}
        <small>
          {theme?.preset === 'cosmetics' ? ctx.tr('website.cosmetics.simulation') : t('simulation')}
        </small>
      </footer>
    </div>
  )
}
export function createVisitorCommerceScreens(ctx: StudioContext) {
  const t = (key: string, args?: Record<string, string | number>) => ctx.tr(`website.visitor.${key}`, args),
    money = visitorMoney
  const call = <T,>(name: string, input: object = {}, signal?: AbortSignal) =>
    ctx.call<T>(name, { siteId: ctx.site().id, ...input }, { signal })
  const link = (
    label: string,
    key: string,
    params: Record<string, string> = {},
    query: Record<string, unknown> = {},
  ) => <LinkButton label={t(label)} href={ctx.href(key, params, query)} />
  const empty = () => <EmptyState title={t('empty')} message={t('emptyHelp')} />
  const info = (items: [string, string | number][]) => (
    <DescriptionList columns={2} items={items.map(([key, value]) => ({ id: key, label: t(key), value }))} />
  )
  const fieldProps = (key: string, value = '') => ({ id: `visitor-${key}`, name: key, label: t(key), value })
  const field = (key: string, value?: string) => <TextField {...fieldProps(key, value)} />
  const choice = (key: string, value: string | undefined, options: FieldOption[]) => (
    <Select {...fieldProps(key, value)} options={options} />
  )
  const date = (key: string, value: string) => <DatePicker {...fieldProps(key, value)} />
  const submit = (label: string, command: string, form: string) => (
    <CommandButton
      label={t(label)}
      command={command}
      type="submit"
      form={form}
      variant="primary"
      disabled={ctx.busy()}
    />
  )
  const contact = (form: string, command: string, label: string, address = false) => (
    <form id={form} novalidate>
      <Stack
        items={[
          <Stack
            items={[field('name'), field('email'), field('phone'), ...(address ? [field('address')] : [])]}
          />,
          <Checkbox id={`${form}-consent`} name="consent" label={t('consent')} />,
          submit(label, command, form),
        ]}
      />
    </form>
  )
  const contactValues = (form: FormData) => ({
    name: String(form.get('name') ?? ''),
    phone: String(form.get('phone') ?? ''),
    email: String(form.get('email') ?? ''),
    address: String(form.get('address') ?? ''),
    consent: form.has('consent'),
  })
  const pager = (data: VisitorPage<unknown>, key: string) => (
    <div class="website-visitor-pager">
      <span>{t('count', { count: data.total, page: data.page })}</span>
      {data.page > 1
        ? link('previous', key, {}, { ...ctx.route().query, page: String(data.page - 1) })
        : null}
      {data.page * data.limit < data.total
        ? link('next', key, {}, { ...ctx.route().query, page: String(data.page + 1) })
        : null}
    </div>
  )
  const lineTable = (lines: CartLine[]) => (
    <DataTable
      rows={lines}
      id={(r) => r.id}
      columns={[
        { key: 'title', label: t('product'), cell: (r) => r.title, priority: 'primary' },
        { key: 'uom', label: t('unit'), cell: (r) => r.uom },
        { key: 'quantity', label: t('quantity'), cell: (r) => r.quantity },
        { key: 'price', label: t('price'), cell: (r) => money(r.price) },
        { key: 'total', label: t('total'), cell: (r) => money(r.price * r.quantity) },
      ]}
    />
  )
  const readList =
    <T,>(name: string) =>
    (route: WebsiteLocation, signal: AbortSignal) =>
      call<T>(name, route.query, signal)
  let product: Product | undefined,
    cart: Cart | undefined,
    quote: StayQuote | undefined,
    booking: Booking | undefined,
    orderId = newId('order'),
    bookingId = newId('booking')
  return {
    shop: {
      read: readList<VisitorPage<Product>>('website_studio.shopProducts'),
      view: (data) =>
        publicFrame(
          ctx,
          t('shop'),
          data.rows.length ? (
            <Grid
              columns={3}
              items={data.rows.map((p) => (
                <Surface
                  title={p.title}
                  body={
                    <>
                      <a href={ctx.href('shop-product', { id: p.id })}>
                        <img class="website-visitor-photo" src={safeImage(p.image)} alt={p.title} />
                      </a>
                      <p>{p.description}</p>
                      <strong>{money(p.variants[0].price)}</strong>
                      {link('details', 'shop-product', { id: p.id })}
                    </>
                  }
                />
              ))}
            />
          ) : (
            empty()
          ),
          { lead: t('shopLead') },
        ),
    } satisfies Screen<VisitorPage<Product>>,
    'shop-product': {
      read: async (route, signal) =>
        (product = await call<Product>('website_studio.shopProduct', { id: route.params.id }, signal)),
      view: (p) =>
        publicFrame(
          ctx,
          p.title,
          <Grid
            columns={2}
            items={[
              <img
                class="website-visitor-photo website-visitor-photo-large"
                src={safeImage(p.image)}
                alt={p.title}
              />,
              <Surface
                title={p.category}
                body={
                  <>
                    <p>{p.description}</p>
                    <p class="website-visitor-price">
                      {money(p.variants[0].price)}
                      {p.variants.length > 1 ? (
                        <> – {money(Math.max(...p.variants.map((v) => v.price)))}</>
                      ) : null}
                    </p>
                    {info([['unit', p.uom]])}
                    <form id="visitor-product" novalidate>
                      <Stack
                        items={[
                          choice(
                            'variant',
                            p.variants[0]?.id,
                            p.variants.map((v) => ({
                              value: v.id,
                              label: `${v.title} · ${money(v.price)} · ${t('available', { count: v.available, unit: p.uom })}`,
                            })),
                          ),
                          field('quantity', '1'),
                          submit('add', 'visitor.cart.add', 'visitor-product'),
                        ]}
                      />
                    </form>
                    <p>{t('priceHelp')}</p>
                    {p.specs ? (
                      <DescriptionList
                        items={p.specs.map(([label, value], i) => ({ id: String(i), label, value }))}
                      />
                    ) : null}
                  </>
                }
              />,
            ]}
          />,
          { actions: link('back', 'shop') },
        ),
      commands: {
        'visitor.cart.add': async (_, form) => {
          form = form!
          await call('website_studio.shopCartUpdate', {
            variantId: String(form.get('variant')),
            quantity: Number(form.get('quantity')),
          })
          await ctx.navigate('shop-cart')
        },
      },
    } satisfies Screen<Product>,
    'shop-cart': {
      read: async (_route, signal) => (cart = await call<Cart>('website_studio.shopCart', {}, signal)),
      view: (data) =>
        publicFrame(
          ctx,
          t('cart'),
          data.lines.length ? (
            <Stack
              items={[
                lineTable(data.lines),
                fragments(
                  data.lines.map((l) => (
                    <CommandButton
                      label={`${t('remove')} · ${l.title}`}
                      command="visitor.cart.remove"
                      args={{ id: l.id }}
                    />
                  )),
                ),
                info([['total', money(data.total)]]),
                link('checkout', 'shop-checkout'),
              ]}
            />
          ) : (
            empty()
          ),
          { actions: link('continue', 'shop') },
        ),
      commands: {
        'visitor.cart.remove': async ({ id }) => {
          await call('website_studio.shopCartUpdate', { variantId: id, quantity: 0 })
          await ctx.refresh()
        },
      },
    } satisfies Screen<Cart>,
    'shop-checkout': {
      read: async (_route, signal) => (cart = await call<Cart>('website_studio.shopCart', {}, signal)),
      view: (data) =>
        publicFrame(
          ctx,
          t('checkout'),
          data.lines.length ? (
            <Grid
              columns={2}
              items={[
                <Surface
                  title={t('contact')}
                  body={
                    <>
                      <Notice title={t('policyLabel')} message={t('policy')} tone="info" />
                      {contact('visitor-checkout', 'visitor.checkout', 'confirmOrder', true)}
                    </>
                  }
                />,
                <Surface
                  title={t('cart')}
                  body={
                    <>
                      {lineTable(data.lines)}
                      {info([
                        ['total', money(data.total)],
                        ['reference', orderId],
                      ])}
                      <p>{t('unknown')}</p>
                    </>
                  }
                />,
              ]}
            />
          ) : (
            empty()
          ),
        ),
      commands: {
        'visitor.checkout': async (_, form) => {
          const result = await call<{ id: string }>('website_studio.shopCheckout', {
            ...contactValues(form!),
            id: orderId,
            expectedRevision: cart!.revision,
            expectedTotal: cart!.total,
          })
          orderId = newId('order')
          await ctx.navigate('shop-receipt', { id: result.id })
        },
      },
    } satisfies Screen<Cart>,
    'shop-receipt': {
      read: (route, signal) => call<Receipt>('website_studio.shopReceipt', { id: route.params.id }, signal),
      view: (data) =>
        publicFrame(
          ctx,
          t('receipt'),
          <Stack
            items={[
              <Notice
                title={t(data.state)}
                message={data.order ? t('unpaid') : t('unknown')}
                tone={data.order ? 'positive' : 'warning'}
              />,
              info([
                ['reference', data.reference],
                ['payment', t('unpaid')],
              ]),
              data.order ? (
                link('details', 'own-order', { id: data.order.id })
              ) : (
                <CommandButton label={t('checkReceipt')} command="visitor.receipt.check" />
              ),
              link('orders', 'own-orders'),
            ]}
          />,
        ),
      commands: { 'visitor.receipt.check': () => ctx.refresh() },
    } satisfies Screen<Receipt>,
    'own-orders': {
      read: readList<VisitorPage<OrderRow>>('website_studio.ownOrders'),
      view: (data) =>
        publicFrame(
          ctx,
          t('orders'),
          <Stack
            items={[
              data.rows.length ? (
                <DataTable
                  rows={data.rows}
                  id={(r) => r.id}
                  rowHref={(r) => ctx.href('own-order', { id: r.id })}
                  columns={[
                    { key: 'id', label: t('reference'), cell: (r) => r.id, priority: 'primary' },
                    { key: 'date', label: t('date'), cell: (r) => formatTime(r.date) },
                    { key: 'total', label: t('total'), cell: (r) => money(r.total) },
                    { key: 'state', label: t('state'), cell: (r) => t(r.state) },
                  ]}
                />
              ) : (
                empty()
              ),
              pager(data, 'own-orders'),
            ]}
          />,
        ),
    } satisfies Screen<VisitorPage<OrderRow>>,
    'own-order': {
      read: (route, signal) => call<Order>('website_studio.ownOrder', { id: route.params.id }, signal),
      view: (data) =>
        publicFrame(
          ctx,
          data.id,
          <Stack
            items={[
              <Notice title={t(data.state)} message={t('unpaid')} tone="info" />,
              <Surface title={t('cart')} body={lineTable(data.lines)} />,
              <Surface
                title={t('details')}
                body={info([
                  ['total', money(data.total)],
                  ['date', formatTime(data.date)],
                  ['fulfillment', t(data.fulfillment)],
                  ['payment', t('unpaid')],
                  ['address', data.address],
                  ['phone', data.phone],
                ])}
              />,
              link('contact', 'visitor-form', { id: 'form-booking' }),
            ]}
          />,
          { actions: link('orders', 'own-orders') },
        ),
    } satisfies Screen<Order>,
    stays: {
      read: readList<VisitorPage<StayProperty>>('website_studio.stayProperties'),
      view: (data) =>
        publicFrame(
          ctx,
          t('stays'),
          data.rows.length ? (
            <Stack
              items={data.rows.map((p) => (
                <Surface
                  title={p.title}
                  body={
                    <>
                      <a href={ctx.href('stay-property', { id: p.id })}>
                        <img
                          class="website-visitor-photo website-visitor-photo-large"
                          src={safeImage(p.image)}
                          alt={p.title}
                        />
                      </a>
                      <p>
                        {p.location} · {p.amenities.join(' · ')}
                      </p>
                      <p>{p.description}</p>
                      {link('discover', 'stay-property', { id: p.id })}
                    </>
                  }
                />
              ))}
            />
          ) : (
            empty()
          ),
          { stay: true, lead: t('stayLead') },
        ),
    } satisfies Screen<VisitorPage<StayProperty>>,
    'stay-property': {
      read: (route, signal) =>
        call<StayProperty>('website_studio.stayProperty', { id: route.params.id }, signal),
      view: (p) =>
        publicFrame(
          ctx,
          p.title,
          <Stack
            items={[
              <>
                <img
                  class="website-visitor-photo website-visitor-photo-wide"
                  src={safeImage(p.image)}
                  alt={p.title}
                />
                <p>
                  {p.location} · {p.amenities.join(' · ')}
                </p>
              </>,
              <Grid
                columns={2}
                items={p.rooms.map((r) => (
                  <Surface
                    title={r.title}
                    body={
                      <>
                        <p>{t('capacity', { count: r.capacity })}</p>
                        <strong>{money(r.price)}</strong>
                      </>
                    }
                  />
                ))}
              />,
              <Surface
                title={t('quote')}
                body={
                  <form id="stay-quote" novalidate>
                    <input type="hidden" name="propertyId" value={p.id} />
                    <Grid
                      columns={3}
                      items={[
                        date('arrival', '2026-12-10'),
                        date('departure', '2026-12-12'),
                        choice(
                          'roomType',
                          p.rooms[0].id,
                          p.rooms.map((r) => ({ value: r.id, label: r.title })),
                        ),
                        field('rooms', '1'),
                        field('guests', '2'),
                      ]}
                    />
                    <p>{t('quoteHelp')}</p>
                    {submit('quote', 'visitor.stay.quote', 'stay-quote')}
                  </form>
                }
              />,
            ]}
          />,
          { stay: true, actions: link('stays', 'stays') },
        ),
      commands: {
        'visitor.stay.quote': async (_, form) => {
          form = form!
          const result = await call<{ id: string }>('website_studio.stayQuote', {
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
    } satisfies Screen<StayProperty>,
    'stay-checkout': {
      read: async (route, signal) =>
        (quote = await call<StayQuote>('website_studio.stayQuoteContext', { id: route.query.quote }, signal)),
      view: (q) =>
        publicFrame(
          ctx,
          t('booking'),
          q.missing ? (
            <Stack
              items={[
                <Notice title={t('quoteMissing')} message={t('quoteHelp')} tone="info" />,
                link('quote', 'stay-property', { id: 'an-nhien' }),
              ]}
            />
          ) : (
            <Grid
              columns={2}
              items={[
                <Surface
                  title={q.propertyTitle}
                  body={
                    <>
                      {info([
                        ['roomType', q.roomTitle],
                        ['arrival', q.arrival],
                        ['departure', q.departure],
                        ['rooms', q.rooms],
                        ['guests', q.guests],
                        ['nights', q.nights],
                        ['timezone', q.timezone],
                        ['expires', formatTime(q.expiresAt)],
                        ['total', money(q.total)],
                      ])}
                      <p>{q.policy}</p>
                      <p>{t('fresh')}</p>
                    </>
                  }
                />,
                <Surface
                  title={t('confirmBooking')}
                  body={
                    <>
                      {contact('stay-book', 'visitor.stay.book', 'confirmBooking')}
                      <p>
                        {t('reference')}: {bookingId}
                      </p>
                      <p>{t('unknown')}</p>
                    </>
                  }
                />,
              ]}
            />
          ),
          { stay: true },
        ),
      commands: {
        'visitor.stay.book': async (_, form) => {
          const result = await call<{ id: string }>('website_studio.stayBook', {
            ...contactValues(form!),
            id: bookingId,
            quoteId: quote!.id,
          })
          bookingId = newId('booking')
          await ctx.navigate('own-booking', { id: result.id })
        },
      },
    } satisfies Screen<StayQuote>,
    'own-bookings': {
      read: readList<VisitorPage<BookingRow>>('website_studio.ownBookings'),
      view: (data) =>
        publicFrame(
          ctx,
          t('bookings'),
          <Stack
            items={[
              data.rows.length ? (
                <DataTable
                  rows={data.rows}
                  id={(r) => r.id}
                  rowHref={(r) => ctx.href('own-booking', { id: r.id })}
                  columns={[
                    {
                      key: 'id',
                      label: t('reference'),
                      cell: (r) => (
                        <>
                          {r.propertyTitle}
                          <br />
                          {r.id}
                        </>
                      ),
                      priority: 'primary',
                    },
                    { key: 'dates', label: t('arrival'), cell: (r) => `${r.arrival} → ${r.departure}` },
                    { key: 'rooms', label: t('rooms'), cell: (r) => t('roomsCount', r) },
                    { key: 'total', label: t('total'), cell: (r) => money(r.total) },
                    { key: 'state', label: t('state'), cell: (r) => t(r.state) },
                  ]}
                />
              ) : (
                empty()
              ),
              pager(data, 'own-bookings'),
            ]}
          />,
          { stay: true },
        ),
    } satisfies Screen<VisitorPage<BookingRow>>,
    'own-booking': {
      read: async (route, signal) =>
        (booking = await call<Booking>('website_studio.ownBooking', { id: route.params.id }, signal)),
      view: (b) =>
        publicFrame(
          ctx,
          b.id,
          <Stack
            items={[
              <Notice
                title={t(b.state)}
                message={t('unpaid')}
                tone={b.state === 'cancelled' ? 'warning' : 'positive'}
              />,
              <Grid
                columns={2}
                items={[
                  <Surface
                    title={b.propertyTitle}
                    body={info([
                      ['roomType', b.roomTitle],
                      ['arrival', b.arrival],
                      ['departure', b.departure],
                      ['rooms', b.rooms],
                      ['guests', b.guests],
                      ['total', money(b.total)],
                      ['timezone', b.timezone],
                      ['units', b.units.join(', ')],
                    ])}
                  />,
                  <Surface
                    title={t('policyLabel')}
                    body={
                      <>
                        <p>{b.policy}</p>
                        {b.canCancel ? (
                          <form id="stay-cancel">
                            <Checkbox id="stay-cancel-confirm" name="confirmed" label={t('cancelConsent')} />
                            {submit('cancel', 'visitor.stay.cancel', 'stay-cancel')}
                          </form>
                        ) : (
                          <p>{t('cancelUnavailable')}</p>
                        )}
                        {link('contact', 'visitor-form', { id: 'form-booking' })}
                      </>
                    }
                  />,
                ]}
              />,
            ]}
          />,
          { stay: true, actions: link('bookings', 'own-bookings') },
        ),
      commands: {
        'visitor.stay.cancel': async (_, form) => {
          await call('website_studio.stayCancel', {
            id: booking!.id,
            expectedRevision: booking!.revision,
            confirmed: form!.has('confirmed'),
          })
          await ctx.refresh()
        },
      },
    } satisfies Screen<Booking>,
    'public-blog': {
      read: readList<VisitorPage<BlogRow> & { categories: string[] }>('website_studio.publicBlog'),
      view: (data) =>
        publicFrame(
          ctx,
          t('blog'),
          <Stack
            items={[
              <form id="blog-filter">
                <Grid
                  columns={2}
                  items={[
                    field('search', ctx.route().query.q ?? ''),
                    choice('category', ctx.route().query.category ?? '', [
                      { value: '', label: t('all') },
                      ...data.categories.map((c) => ({ value: c, label: c })),
                    ]),
                  ]}
                />
                {submit('search', 'visitor.blog.search', 'blog-filter')}
              </form>,
              data.rows.length ? (
                <Grid
                  columns={2}
                  items={data.rows.map((r) => (
                    <Surface
                      title={r.title}
                      body={
                        <>
                          <p>
                            {r.category} · {formatTime(r.publishedAt)} · {r.author}
                          </p>
                          <p>{r.excerpt}</p>
                          {link('read', 'public', {}, { path: r.path })}
                        </>
                      }
                    />
                  ))}
                />
              ) : (
                empty()
              ),
              pager(data, 'public-blog'),
            ]}
          />,
          { lead: t('blogLead') },
        ),
      commands: {
        'visitor.blog.search': async (_, form) =>
          ctx.navigate(
            'public-blog',
            {},
            { q: String(form!.get('search') ?? ''), category: String(form!.get('category') ?? '') },
          ),
      },
    } satisfies Screen<VisitorPage<BlogRow> & { categories: string[] }>,
  }
}
