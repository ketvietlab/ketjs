import { KetError, defineFn, defineModule } from '@ketvietlab/ketjs'

// The one piece of server state this demo app owns: a customer list shared
// between demo.tsx's own rendering (seeding orders, the closed relation-select's
// initial options) and the two functions below — so the relation-select island
// embedded in /demo2 searches and creates against a real function call, the same
// `/_ket/fn/*` contract a production relation field uses, rather than a client-only
// illusion of one.
export type Customer = { id: string; name: string }

export const customers: Customer[] = [
  { id: 'mua-ha-riverside', name: 'Mùa Hạ Riverside' },
  { id: 'cong-ty-anh-duong', name: 'Công ty Ánh Dương' },
  { id: 'the-local-coffee', name: 'The Local Coffee' },
  { id: 'an-nhien-retreat', name: 'An Nhiên Retreat' },
  { id: 'khach-san-song-xanh', name: 'Khách sạn Sông Xanh' },
  { id: 'bep-nha', name: 'Bếp Nhà' },
  { id: 'nang-garden', name: 'Nắng Garden' },
  { id: 'huong-viet', name: 'Hương Việt' },
  { id: 'la-xanh-bistro', name: 'Lá Xanh Bistro' },
  { id: 'cong-huong-studio', name: 'Cộng Hưởng Studio' },
  { id: 'moc-coffee', name: 'Mộc Coffee' },
  { id: 'binh-minh-hotel', name: 'Bình Minh Hotel' },
]

export const customerName = (id: string): string => customers.find((c) => c.id === id)?.name ?? id

export const demoBackendModule = defineModule({
  name: 'demo',
  category: 'Nội bộ',
  functions: {
    // relation-select sends `search`/`limit` on every keystroke — the same shape
    // its manager.listFunction contract expects everywhere else in the app.
    listCustomers: defineFn({
      input: { search: 'text?', limit: 'int?' },
      output: { id: 'id', name: 'text' },
      handler: (_ctx, args) => {
        const term = String(args.search ?? '')
          .trim()
          .toLocaleLowerCase('vi')
        const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 80
        return customers
          .filter((customer) => !term || customer.name.toLocaleLowerCase('vi').includes(term))
          .slice(0, limit)
      },
    }),
    // The id relation-select posts is a client-generated uuid, decoupled from the
    // display name — the same convention every real relation manager in ketsuite
    // uses (see product.saveCategory). A demo customer is never edited once
    // created, so this only ever inserts.
    createCustomer: defineFn({
      input: { id: 'id', name: 'text' },
      output: { ok: 'bool', id: 'id' },
      idempotent: true,
      handler: (_ctx, args) => {
        const name = String(args.name ?? '').trim()
        if (!name)
          throw new KetError({
            code: 'E_CUSTOMER_NAME_REQUIRED',
            message: 'Tên khách hàng không được để trống',
          })
        const id = String(args.id)
        if (!customers.some((customer) => customer.id === id)) customers.push({ id, name })
        return { ok: true, id }
      },
    }),
  },
})
