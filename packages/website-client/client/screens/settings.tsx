import {
  Checkbox,
  DescriptionList,
  Grid,
  Inline,
  LinkButton,
  Notice,
  RecordPage,
  Select,
  Section,
  Stack,
  Surface,
  TextArea,
  TextField,
} from '@ketvietlab/design-system'
import { CommandButton } from '../ui.tsx'
import { resourceSchemas, resourceValue } from '../resources.ts'
import type { ResourceRecord } from '../resources.ts'
import { domainList } from './domains.tsx'
import type { Domain } from './domains.tsx'
import type { Screen, StudioContext } from '../types.ts'

/** `website_studio.siteReadiness`: the site record and what still keeps it from going live. */
type Readiness = {
  site: ResourceRecord
  publicUrl: string
  bindings: string[]
  blockers: { id: string; title: string; route: string }[]
  /** How the site takes customer sign-in accounts; null for those who do not look after them. */
  customers: { available: boolean; selfSignup: boolean; signInUrl: string | null; total: number } | null
}
/** `website_studio.customerMail`: the company's password-reset mail, null until someone writes it. */
type CustomerMail = {
  template: {
    fromAddress: string
    fromName: string
    replyTo: string
    subject: string
    text: string
    active: boolean
    version: number
  } | null
  keys: string[]
}
type SettingsData = { readiness: Readiness; domains: { rows: Domain[] }; mail: CustomerMail | null }

export function createSettings(ctx: StudioContext) {
  const tr = ctx.tr
  let current: ResourceRecord
  let mailVersion: number | null = null
  const save = async (changes: Record<string, string>) => {
    const values = Object.fromEntries(
      resourceSchemas.sites.fields.map(({ name }) => [name, current[name] ?? '']),
    )
    await ctx.call('website_studio.saveResource', {
      siteId: ctx.site().id,
      kind: 'sites',
      id: current.id,
      expectedRevisionId: current.revisionId,
      values: { ...values, ...changes },
    })
    ctx.notify(tr('website.settings.saved'))
    await ctx.reload()
  }
  return {
    read: async () => {
      const [readiness, domains, mail] = await Promise.all([
        ctx.call<Readiness>('website_studio.siteReadiness', { siteId: ctx.site().id }),
        ctx.call<{ rows: Domain[] }>('website_studio.listResources', {
          siteId: ctx.site().id,
          kind: 'domains',
        }),
        ctx.can('website.customer.mail') ? ctx.call<CustomerMail>('website_studio.customerMail', {}) : null,
      ])
      current = readiness.site
      mailVersion = mail?.template?.version ?? null
      return { readiness, domains, mail }
    },
    view: (value) => {
      const site = ctx.site()
      const canManage = ctx.can('website.site.manage')
      const offer = ctx.boot().offer
      const customers = value.readiness.customers
      const general = (
        <Section
          title={tr('website.settings.general')}
          actions={
            <CommandButton
              label={tr('website.action.save')}
              command="site.save"
              type="submit"
              form="website-site-form"
              variant="primary"
              disabled={!canManage || ctx.busy()}
            />
          }
          body={
            <form id="website-site-form" novalidate>
              <Grid
                columns={2}
                items={[
                  <TextField
                    id="site-name"
                    name="name"
                    label={tr('website.settings.name')}
                    value={value.readiness.site.title}
                    required
                    disabled={!canManage}
                  />,
                  <TextField
                    id="site-code"
                    name="code"
                    label={tr('website.site.code')}
                    value={resourceValue(value.readiness.site.code)}
                    required
                    disabled={!canManage}
                  />,
                  <Select
                    id="site-locale"
                    name="defaultLocale"
                    label={tr('website.settings.defaultLocale')}
                    value={resourceValue(value.readiness.site.defaultLocale)}
                    options={site.locales.map((locale) => ({
                      value: locale,
                      label: tr(`website.locale.${locale}`),
                    }))}
                    disabled={!canManage}
                  />,
                  <TextField
                    id="site-gtm"
                    name="googleTagManagerId"
                    label={tr('website.settings.googleTagManagerId')}
                    value={resourceValue(value.readiness.site.googleTagManagerId)}
                    placeholder="GTM-XXXXXXX"
                    disabled={!canManage}
                  />,
                ]}
              />
            </form>
          }
        />
      )
      const customerMail = ({ template, keys }: CustomerMail) => {
        // A new mail starts from wording that already works; the sender is the company's to give.
        const draft = template ?? {
          fromAddress: '',
          fromName: '',
          replyTo: '',
          subject: tr('website.customerMail.defaultSubject'),
          text: tr('website.customerMail.defaultText'),
          active: true,
        }
        return (
          <Section
            title={tr('website.customerMail.title')}
            actions={
              <CommandButton
                label={tr('website.action.save')}
                command="site.customerMail.save"
                type="submit"
                form="website-customer-mail-form"
                variant="primary"
                disabled={ctx.busy()}
              />
            }
            body={
              <form id="website-customer-mail-form" novalidate>
                <Stack
                  items={[
                    template ? null : (
                      <Notice
                        title={tr('website.customerMail.missing')}
                        message={tr('website.customerMail.missingHelp')}
                        tone="warning"
                      />
                    ),
                    <Grid
                      columns={2}
                      items={[
                        <TextField
                          id="customer-mail-from"
                          name="fromAddress"
                          type="email"
                          label={tr('website.customerMail.fromAddress')}
                          value={draft.fromAddress}
                          required
                        />,
                        <TextField
                          id="customer-mail-from-name"
                          name="fromName"
                          label={tr('website.customerMail.fromName')}
                          value={draft.fromName}
                        />,
                        <TextField
                          id="customer-mail-reply-to"
                          name="replyTo"
                          type="email"
                          label={tr('website.customerMail.replyTo')}
                          value={draft.replyTo}
                        />,
                      ]}
                    />,
                    <TextField
                      id="customer-mail-subject"
                      name="subject"
                      label={tr('website.customerMail.subject')}
                      value={draft.subject}
                      required
                    />,
                    <TextArea
                      id="customer-mail-text"
                      name="text"
                      label={tr('website.customerMail.text')}
                      value={draft.text}
                      rows={8}
                      required
                      help={tr('website.customerMail.keys', {
                        keys: keys.map((key) => `{{${key}}}`).join(', '),
                      })}
                    />,
                    <Checkbox
                      id="customer-mail-active"
                      name="active"
                      value="yes"
                      checked={draft.active}
                      label={tr('website.customerMail.active')}
                      help={tr('website.customerMail.shared')}
                    />,
                  ]}
                />
              </form>
            }
          />
        )
      }
      const connections = (
        <Stack
          items={[
            <Section
              title={tr('website.settings.connections')}
              body={
                <Stack
                  items={[
                    <DescriptionList
                      layout="strip"
                      items={[
                        { id: 'url', label: tr('website.site.publicUrl'), value: value.readiness.publicUrl },
                        {
                          id: 'bindings',
                          label: tr('website.site.bindings'),
                          value:
                            value.readiness.bindings
                              .map(
                                (key) =>
                                  (
                                    ({
                                      retail: tr('website.settings.retail'),
                                      hospitality: tr('website.settings.hospitality'),
                                      crm: tr('website.settings.crm'),
                                    }) as Record<string, string>
                                  )[key] ?? key,
                              )
                              .join(', ') || '—',
                        },
                      ]}
                    />,
                    ...value.readiness.blockers.map((r) => (
                      <Notice
                        title={r.title}
                        message=""
                        tone="warning"
                        actions={<LinkButton label={tr('website.site.resolve')} href={ctx.href(r.route)} />}
                      />
                    )),
                  ]}
                />
              }
            />,
            customers ? (
              <Section
                title={tr('website.settings.customers')}
                actions={
                  customers.available ? (
                    <Inline
                      items={[
                        <LinkButton label={tr('website.customer.viewAll')} href={ctx.href('customers')} />,
                        <CommandButton
                          label={tr('website.action.save')}
                          command="site.customers.save"
                          type="submit"
                          form="website-customers-form"
                          variant="primary"
                          disabled={!ctx.can('website.customer.manage') || ctx.busy()}
                        />,
                      ]}
                    />
                  ) : undefined
                }
                body={
                  customers.available ? (
                    <form id="website-customers-form" novalidate>
                      <Stack
                        items={[
                          <Select
                            id="customers-self-signup"
                            name="selfSignup"
                            label={tr('website.customer.selfSignup')}
                            value={customers.selfSignup ? 'open' : 'closed'}
                            options={['open', 'closed'].map((option) => ({
                              value: option,
                              label: tr(`website.customer.selfSignup.${option}`),
                            }))}
                          />,
                          <DescriptionList
                            layout="strip"
                            items={[
                              {
                                id: 'signIn',
                                label: tr('website.customer.signInUrl'),
                                value: customers.signInUrl ?? tr('website.customer.noDomain'),
                              },
                              {
                                id: 'total',
                                label: tr('website.customer.total'),
                                value: String(customers.total),
                              },
                            ]}
                          />,
                        ]}
                      />
                    </form>
                  ) : (
                    <Notice
                      title={tr('website.customer.unavailable')}
                      message={tr('website.customer.unavailableHelp')}
                      tone="warning"
                    />
                  )
                }
              />
            ) : null,
            value.mail ? customerMail(value.mail) : null,
            ...ctx.slot('siteSettingsSection', value),
          ]}
        />
      )
      return (
        <RecordPage
          width="wide"
          title={tr('website.route.settings')}
          body={
            <Stack
              items={[
                <Surface
                  body={
                    <Stack
                      divided
                      items={[
                        general,
                        <Section
                          title={tr('website.settings.domains')}
                          actions={
                            <LinkButton
                              label={tr('website.domain.add')}
                              href={ctx.href('domains-edit', { id: 'new' })}
                            />
                          }
                          body={domainList(ctx, value.domains)}
                        />,
                        connections,
                      ]}
                    />
                  }
                />,
                offer ? (
                  <Notice
                    title={offer.title}
                    message={offer.message}
                    tone="info"
                    actions={<LinkButton label={offer.label} href={offer.href} />}
                  />
                ) : null,
              ]}
            />
          }
        />
      )
    },
    commands: {
      'site.customers.save': async (_args, form) => {
        await ctx.call('website_studio.saveCustomerSettings', {
          siteId: ctx.site().id,
          selfSignup: form!.get('selfSignup') === 'open',
        })
        ctx.notify(tr('website.customer.settingsSaved'))
        await ctx.refresh()
      },
      'site.customerMail.save': async (_args, form) => {
        form = form!
        await ctx.call('website_studio.saveCustomerMail', {
          expectedVersion: mailVersion,
          values: {
            fromAddress: String(form.get('fromAddress') ?? '').trim(),
            fromName: String(form.get('fromName') ?? '').trim(),
            replyTo: String(form.get('replyTo') ?? '').trim(),
            subject: String(form.get('subject') ?? '').trim(),
            text: String(form.get('text') ?? ''),
            active: form.has('active'),
          },
        })
        ctx.notify(tr('website.customerMail.saved'))
        await ctx.refresh()
      },
      'site.save': async (_args, form) => {
        form = form!
        const googleTagManagerId = String(form.get('googleTagManagerId') ?? '').trim()
        if (googleTagManagerId && !/^GTM-[A-Z0-9]{4,20}$/.test(googleTagManagerId))
          throw Object.assign(new Error(tr('website.settings.invalidGoogleTagManagerId')), {
            code: 'validation',
          })
        const name = String(form.get('name') ?? '').trim()
        if (!name) throw Object.assign(new Error(tr('website.settings.nameRequired')), { code: 'validation' })
        await save({
          title: name,
          code: String(form.get('code') ?? '').trim(),
          defaultLocale: String(form.get('defaultLocale') ?? ''),
          googleTagManagerId,
        })
      },
    },
  } satisfies Screen<SettingsData>
}
