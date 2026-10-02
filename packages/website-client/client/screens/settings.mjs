// Site configuration only; ERP owns identity and access administration.
import { html } from '@ketvietlab/ketjs-view'
import {
  DescriptionList,
  Grid,
  LinkButton,
  Notice,
  Select,
  Section,
  Stack,
  Surface,
  TextField,
  WorkspacePage,
} from '@ketvietlab/design-system'
import { h, CommandButton } from '../ui.mjs'
import { resourceSchemas } from '../resources.mjs'
import { domainList } from './domains.mjs'

export function createSettings(ctx) {
  const tr = ctx.tr
  let current
  const save = async (changes) => {
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
      const [readiness, domains] = await Promise.all([
        ctx.call('website_studio.siteReadiness', { siteId: ctx.site().id }),
        ctx.call('website_studio.listResources', { siteId: ctx.site().id, kind: 'domains' }),
      ])
      current = readiness.site
      return { readiness, domains }
    },
    view: (value) => {
      const site = ctx.site()
      const canManage = ctx.can('website.site.manage')
      const offer = ctx.boot().offer
      const general = h(Section, {
        title: tr('website.settings.general'),
        actions: CommandButton({
          label: tr('website.action.save'),
          command: 'site.save',
          type: 'submit',
          form: 'website-site-form',
          variant: 'primary',
          disabled: !canManage || ctx.busy(),
        }),
        body: html`<form id="website-site-form" novalidate>${h(Grid, {
          columns: 2,
          items: [
            h(TextField, {
              id: 'site-name',
              name: 'name',
              label: tr('website.settings.name'),
              value: value.readiness.site.title,
              required: true,
              disabled: !canManage,
            }),
            h(TextField, {
              id: 'site-code',
              name: 'code',
              label: tr('website.site.code'),
              value: value.readiness.site.code,
              required: true,
              disabled: !canManage,
            }),
            h(Select, {
              id: 'site-locale',
              name: 'defaultLocale',
              label: tr('website.settings.defaultLocale'),
              value: value.readiness.site.defaultLocale,
              options: site.locales.map((locale) => ({
                value: locale,
                label: tr(`website.locale.${locale}`),
              })),
              disabled: !canManage,
            }),
            h(TextField, {
              id: 'site-timezone',
              name: 'timezone',
              label: tr('website.site.timezone'),
              value: value.readiness.site.timezone,
              required: true,
              disabled: !canManage,
            }),
          ],
        })}</form>`,
      })
      const connections = h(Stack, {
        items: [
          h(Section, {
            title: tr('website.settings.connections'),
            body: h(Stack, {
              items: [
                h(DescriptionList, {
                  layout: 'strip',
                  items: [
                    { id: 'url', label: tr('website.site.publicUrl'), value: value.readiness.publicUrl },
                    {
                      id: 'bindings',
                      label: tr('website.site.bindings'),
                      value:
                        value.readiness.bindings
                          .map(
                            (key) =>
                              ({
                                retail: tr('website.settings.retail'),
                                hospitality: tr('website.settings.hospitality'),
                                crm: tr('website.settings.crm'),
                              })[key] ?? key,
                          )
                          .join(', ') || '—',
                    },
                  ],
                }),
                ...value.readiness.blockers.map((r) =>
                  h(Notice, {
                    title: r.title,
                    tone: 'warning',
                    actions: h(LinkButton, { label: tr('website.site.resolve'), href: ctx.href(r.route) }),
                  }),
                ),
              ],
            }),
          }),
          h(Section, {
            title: tr('website.settings.visitorAccess'),
            actions: CommandButton({
              label: tr('website.action.save'),
              command: 'site.connections.save',
              type: 'submit',
              form: 'website-connections-form',
              variant: 'primary',
              disabled: !canManage || ctx.busy(),
            }),
            body: html`<form id="website-connections-form" novalidate>${h(Grid, {
              columns: 2,
              items: ['realm', 'retentionDays', 'consentVersion', 'authReady'].map((name) =>
                h(name === 'authReady' ? Select : TextField, {
                  id: `connection-${name}`,
                  name,
                  label: tr(`website.site.${name}`),
                  value: value.readiness.site[name],
                  required: true,
                  disabled: !canManage,
                  ...(name === 'authReady'
                    ? {
                        options: ['yes', 'no'].map((value) => ({
                          value,
                          label: tr(`website.option.${value}`),
                        })),
                      }
                    : {}),
                }),
              ),
            })}</form>`,
          }),
          ...ctx.slot('siteSettingsSection', value),
        ],
      })
      return h(WorkspacePage, {
        title: tr('website.route.settings'),
        layout: 'flow',
        body: h(Stack, {
          items: [
            h(Surface, {
              body: h(Stack, {
                divided: true,
                items: [
                  general,
                  h(Section, {
                    title: tr('website.settings.domains'),
                    actions: h(LinkButton, {
                      label: tr('website.domain.add'),
                      href: ctx.href('domains-edit', { id: 'new' }),
                    }),
                    body: domainList(ctx, value.domains),
                  }),
                  connections,
                ],
              }),
            }),
            offer
              ? h(Notice, {
                  title: offer.title,
                  message: offer.message,
                  tone: 'info',
                  actions: h(LinkButton, { label: offer.label, href: offer.href }),
                })
              : null,
          ],
        }),
      })
    },
    commands: {
      'site.connections.save': async (_args, form) =>
        save(
          Object.fromEntries(
            ['realm', 'retentionDays', 'consentVersion', 'authReady'].map((name) => [
              name,
              String(form.get(name) ?? '').trim(),
            ]),
          ),
        ),
      'site.save': async (_args, form) => {
        const name = String(form.get('name') ?? '').trim()
        if (!name) throw Object.assign(new Error(tr('website.settings.nameRequired')), { code: 'validation' })
        await save({
          title: name,
          code: String(form.get('code') ?? '').trim(),
          timezone: String(form.get('timezone') ?? '').trim(),
          defaultLocale: String(form.get('defaultLocale') ?? ''),
        })
      },
    },
  }
}
