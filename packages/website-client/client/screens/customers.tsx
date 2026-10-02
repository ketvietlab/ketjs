// The sign-in accounts of a site's customers. An account belongs to a partner of the company; staff
// issue one, close or reopen it and give it a new password. A password the system makes up is shown
// once, in the account it was made for, and never read back.
import {
  DataTable,
  DescriptionList,
  EmptyState,
  FilterBar,
  Grid,
  LinkButton,
  ListPage,
  ModalSheet,
  Notice,
  SearchBar,
  Section,
  Stack,
  Status,
  Tabs,
  TextField,
} from '@ketvietlab/design-system'
import { CommandButton, icon } from '../ui.tsx'
import { EMPTY_VALUE, formatTime } from './format.ts'
import type { StatusView } from './format.ts'
import type { Screen, StudioContext, Translate } from '../types.ts'

const FILTERS = ['all', 'active', 'disabled']

/** `website_studio.customer`: an account without its password or sessions. */
type Customer = {
  id: string
  partnerId: string
  displayName: string
  phone: string | null
  email: string | null
  status: string
  lockedUntil: string | null
  createdAt: string | null
  lastLoginAt: string | null
  signInUrl?: string | null
}
type CustomerList = {
  available: boolean
  selfSignup: boolean
  signInUrl: string | null
  rows: Customer[]
  total: number
}
/** `website_studio.customerCandidates`: partners found by name or phone, and whether they sign in here. */
type Candidate = {
  id: string
  name: string
  phone: string | null
  email: string | null
  account: string | null
}

const validation = (message: string) => Object.assign(new Error(message), { code: 'validation' })

export const customerStatus = (
  tr: Translate,
  customer: Pick<Customer, 'status' | 'lockedUntil'>,
): StatusView =>
  customer.status === 'disabled'
    ? { label: tr('website.customer.state.disabled'), tone: 'neutral' }
    : customer.lockedUntil
      ? { label: tr('website.customer.state.locked'), tone: 'warning' }
      : { label: tr('website.customer.state.active'), tone: 'positive' }

export function createCustomerScreens(ctx: StudioContext) {
  const tr = ctx.tr
  /** The password just made for an account, until the list is opened again. */
  let revealed: { partnerId: string; password: string } | null = null

  const list = {
    readKey: (route) => [route.key, route.query.status ?? 'all', route.query.q ?? ''],
    read: (route, signal) => {
      if (route.key === 'customers') revealed = null
      return ctx.call<CustomerList>(
        'website_studio.customers',
        { siteId: ctx.site().id, status: route.query.status ?? 'all', search: route.query.q ?? '' },
        { signal },
      )
    },
    view: (value, route) => {
      const status = FILTERS.includes(route.query.status) ? route.query.status : 'all'
      const q = route.query.q ?? ''
      return (
        <ListPage
          variant="operational"
          title={tr('website.route.customers')}
          headerActions={
            value.available && ctx.can('website.customer.issue') ? (
              <LinkButton
                label={tr('website.customer.issue')}
                href={ctx.href('customer-new')}
                variant="primary"
                leading={icon('plus')}
              />
            ) : null
          }
          controls={
            <Stack
              items={[
                <Tabs
                  label={tr('website.customer.filter')}
                  items={FILTERS.map((filter) => ({
                    id: filter,
                    label: tr(`website.customer.filter.${filter}`),
                    href: ctx.href('customers', {}, { status: filter === 'all' ? null : filter, q }),
                    active: filter === status,
                  }))}
                />,
                <FilterBar
                  label={tr('website.customer.search')}
                  filters={[
                    <SearchBar
                      id="website-customers-search"
                      action={ctx.href('customers')}
                      value={q}
                      label={tr('website.customer.search')}
                      placeholder={tr('website.customer.searchPlaceholder')}
                      submitLabel={tr('website.search.submit')}
                      hidden={status === 'all' ? undefined : { status }}
                    />,
                  ]}
                />,
              ]}
            />
          }
          footer={tr('website.customer.footer', { shown: value.rows.length, total: value.total })}
          body={
            !value.available ? (
              <EmptyState
                title={tr('website.customer.unavailable')}
                message={tr('website.customer.unavailableHelp')}
              />
            ) : (
              <DataTable
                columns={[
                  {
                    key: 'name',
                    label: tr('website.customer.name'),
                    cell: (row) => row.displayName,
                    priority: 'primary',
                  },
                  {
                    key: 'login',
                    label: tr('website.customer.login'),
                    cell: (row) => row.phone ?? row.email ?? EMPTY_VALUE,
                    priority: 'secondary',
                  },
                  {
                    key: 'state',
                    label: tr('website.customer.state'),
                    cell: (row) => <Status {...customerStatus(tr, row)} />,
                    kind: 'status',
                  },
                  {
                    key: 'lastLogin',
                    label: tr('website.customer.lastLogin'),
                    cell: (row) => formatTime(row.lastLoginAt),
                    kind: 'date',
                  },
                  {
                    key: 'createdAt',
                    label: tr('website.customer.createdAt'),
                    cell: (row) => formatTime(row.createdAt),
                    kind: 'date',
                  },
                ]}
                rows={value.rows}
                id={(row) => row.id}
                rowHref={(row) => ctx.href('customer', { id: row.partnerId })}
                emptyTitle={tr('website.customer.emptyTitle')}
                emptyMessage={tr(q ? 'website.customer.emptySearch' : 'website.customer.emptyMessage')}
              />
            )
          }
        />
      )
    },
  } satisfies Screen<CustomerList>

  const close = () => ctx.href('customers')
  const reveal = (partnerId: string, password: string | null) => {
    revealed = password ? { partnerId, password } : null
  }

  const detail = {
    readKey: (route) => [route.params.id],
    read: (route, signal) =>
      ctx.call<Customer>(
        'website_studio.customer',
        { siteId: ctx.site().id, partnerId: route.params.id },
        { signal },
      ),
    view: (customer) => {
      const canManage = ctx.can('website.customer.manage')
      const busy = ctx.busy()
      const password = revealed?.partnerId === customer.partnerId ? revealed.password : null
      return (
        <ModalSheet
          id="website-customer"
          title={customer.displayName}
          closeHref={close()}
          closeLabel={tr('website.action.close')}
          mode="overlay"
          presentation="dialog"
          size="large"
          height="fixed"
          body={
            <Stack
              items={[
                password ? (
                  <Notice
                    title={tr('website.customer.passwordIssued', { password })}
                    message={tr('website.customer.passwordOnce')}
                    tone="info"
                  />
                ) : null,
                <Section
                  title={tr('website.customer.account')}
                  body={
                    <DescriptionList
                      items={[
                        {
                          id: 'state',
                          label: tr('website.customer.state'),
                          value: <Status {...customerStatus(tr, customer)} />,
                        },
                        {
                          id: 'phone',
                          label: tr('website.customer.phone'),
                          value: customer.phone ?? EMPTY_VALUE,
                        },
                        {
                          id: 'email',
                          label: tr('website.customer.email'),
                          value: customer.email ?? EMPTY_VALUE,
                        },
                        {
                          id: 'signIn',
                          label: tr('website.customer.signInUrl'),
                          value: customer.signInUrl ?? tr('website.customer.noDomain'),
                        },
                        {
                          id: 'lastLogin',
                          label: tr('website.customer.lastLogin'),
                          value: formatTime(customer.lastLoginAt),
                        },
                        {
                          id: 'createdAt',
                          label: tr('website.customer.createdAt'),
                          value: formatTime(customer.createdAt),
                        },
                      ]}
                    />
                  }
                />,
                <Section
                  title={tr('website.customer.reset')}
                  description={tr('website.customer.resetHelp')}
                  actions={
                    <CommandButton
                      label={tr('website.customer.reset')}
                      command="customer.reset"
                      args={{ id: customer.partnerId }}
                      type="submit"
                      form="website-customer-reset"
                      disabled={!canManage || busy}
                    />
                  }
                  body={
                    <form id="website-customer-reset" novalidate>
                      <TextField
                        id="customer-reset-password"
                        name="password"
                        label={tr('website.customer.password')}
                        help={tr('website.customer.passwordHelp')}
                        autocomplete="new-password"
                        disabled={!canManage}
                      />
                    </form>
                  }
                />,
              ]}
            />
          }
          actions={
            <>
              <LinkButton label={tr('website.action.close')} href={close()} />
              {customer.status === 'disabled' ? (
                <CommandButton
                  label={tr('website.customer.enable')}
                  command="customer.enable"
                  args={{ id: customer.partnerId }}
                  variant="primary"
                  disabled={!canManage || busy}
                />
              ) : (
                <CommandButton
                  label={tr('website.customer.disable')}
                  command="customer.disable"
                  args={{ id: customer.partnerId }}
                  variant="destructive"
                  disabled={!canManage || busy}
                />
              )}
            </>
          }
        />
      )
    },
    commands: {
      'customer.disable': async ({ id }) => {
        await ctx.call('website_studio.customerCommand', {
          siteId: ctx.site().id,
          partnerId: id,
          action: 'disable',
        })
        ctx.notify(tr('website.customer.disabled'))
        await ctx.refresh()
      },
      'customer.enable': async ({ id }) => {
        await ctx.call('website_studio.customerCommand', {
          siteId: ctx.site().id,
          partnerId: id,
          action: 'enable',
        })
        ctx.notify(tr('website.customer.enabled'))
        await ctx.refresh()
      },
      'customer.reset': async ({ id }, form) => {
        const password = String(form?.get('password') ?? '')
        if (password && password.length < 6) throw validation(tr('website.customer.passwordShort'))
        const result = await ctx.call<{ password: string | null }>('website_studio.customerCommand', {
          siteId: ctx.site().id,
          partnerId: id,
          action: 'reset',
          password: password || null,
        })
        reveal(id!, result.password)
        ctx.notify(tr('website.customer.resetDone'))
        await ctx.refresh()
      },
    },
  } satisfies Screen<Customer>

  const issue = {
    readKey: (route) => [route.query.find ?? '', route.query.partner ?? ''],
    read: async (route, signal) => {
      const find = String(route.query.find ?? '').trim()
      const rows = find
        ? (
            await ctx.call<{ rows: Candidate[] }>(
              'website_studio.customerCandidates',
              { siteId: ctx.site().id, search: find },
              { signal },
            )
          ).rows
        : []
      return {
        find,
        rows,
        chosen: rows.find((row) => row.id === route.query.partner && !row.account) ?? null,
      }
    },
    view: (value) => {
      const busy = ctx.busy()
      const canIssue = ctx.can('website.customer.issue')
      const chosen = value.chosen
      const search = (
        <SearchBar
          id="website-customer-find"
          action={ctx.href('customer-new')}
          name="find"
          value={value.find}
          label={tr('website.customer.find')}
          placeholder={tr('website.customer.searchPlaceholder')}
          submitLabel={tr('website.search.submit')}
        />
      )
      const candidates =
        value.find.length < 2 ? (
          <p class="website-customer-help">{tr('website.customer.findHelp')}</p>
        ) : (
          <DataTable
            columns={[
              {
                key: 'name',
                label: tr('website.customer.name'),
                cell: (row) => row.name,
                priority: 'primary',
              },
              {
                key: 'contact',
                label: tr('website.customer.login'),
                cell: (row) => row.phone ?? row.email ?? EMPTY_VALUE,
              },
              {
                key: 'choose',
                label: tr('website.customer.state'),
                cell: (row) =>
                  row.account ? (
                    <LinkButton
                      label={tr('website.customer.hasAccount')}
                      href={ctx.href('customer', { id: row.id })}
                      size="compact"
                      variant="tertiary"
                    />
                  ) : (
                    <LinkButton
                      label={tr('website.customer.choose')}
                      href={ctx.href('customer-new', {}, { find: value.find, partner: row.id })}
                      size="compact"
                    />
                  ),
                align: 'end',
              },
            ]}
            rows={value.rows}
            id={(row) => row.id}
            emptyTitle={tr('website.customer.findEmpty')}
            emptyMessage={tr('website.customer.findEmptyHelp')}
          />
        )
      return (
        <ModalSheet
          id="website-customer-new"
          title={tr('website.route.customerNew')}
          description={tr('website.customer.newDescription')}
          closeHref={close()}
          closeLabel={tr('website.action.close')}
          mode="overlay"
          presentation="dialog"
          size="large"
          height="fixed"
          body={
            chosen ? (
              <form id="website-customer-issue" novalidate>
                <input type="hidden" name="partner" value={chosen.id} />
                <Grid
                  columns={2}
                  items={[
                    <TextField
                      id="customer-name"
                      name="displayName"
                      label={tr('website.customer.displayName')}
                      value={chosen.name}
                      required
                      span="full"
                    />,
                    <TextField
                      id="customer-phone"
                      name="phone"
                      type="tel"
                      label={tr('website.customer.phone')}
                      value={chosen.phone ?? ''}
                      help={tr('website.customer.loginHelp')}
                    />,
                    <TextField
                      id="customer-email"
                      name="email"
                      type="email"
                      label={tr('website.customer.email')}
                      value={chosen.email ?? ''}
                    />,
                    <TextField
                      id="customer-password"
                      name="password"
                      label={tr('website.customer.password')}
                      help={tr('website.customer.passwordHelp')}
                      autocomplete="new-password"
                      span="full"
                    />,
                  ]}
                />
              </form>
            ) : (
              <Stack items={[search, candidates]} />
            )
          }
          actions={
            <>
              {chosen ? (
                <LinkButton
                  label={tr('website.customer.change')}
                  href={ctx.href('customer-new', {}, { find: value.find })}
                />
              ) : (
                <LinkButton label={tr('website.action.cancel')} href={close()} />
              )}
              {chosen ? (
                <CommandButton
                  label={tr('website.customer.issue')}
                  command="customer.issue"
                  type="submit"
                  form="website-customer-issue"
                  variant="primary"
                  disabled={!canIssue || busy}
                />
              ) : null}
            </>
          }
        />
      )
    },
    commands: {
      'customer.issue': async (_args, form) => {
        form = form!
        const partnerId = String(form.get('partner') ?? '')
        const values = Object.fromEntries(
          ['displayName', 'phone', 'email', 'password'].map((name) => [
            name,
            String(form.get(name) ?? '').trim(),
          ]),
        )
        if (!values.displayName) throw validation(tr('website.customer.nameRequired'))
        if (!values.phone && !values.email) throw validation(tr('website.customer.loginHelp'))
        if (values.password && values.password.length < 6)
          throw validation(tr('website.customer.passwordShort'))
        const result = await ctx.call<{ password: string | null }>('website_studio.issueCustomer', {
          siteId: ctx.site().id,
          partnerId,
          values,
        })
        reveal(partnerId, result.password)
        ctx.notify(tr('website.customer.issued'))
        ctx.navigate('customer', { id: partnerId })
      },
    },
  } satisfies Screen<{ find: string; rows: Candidate[]; chosen: Candidate | null }>

  return { customers: list, customer: detail, 'customer-new': issue }
}
