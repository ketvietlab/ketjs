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
}
type SettingsData = { readiness: Readiness; domains: { rows: Domain[] } }

export function createSettings(ctx: StudioContext) {
  const tr = ctx.tr
  let current: ResourceRecord
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
      const [readiness, domains] = await Promise.all([
        ctx.call<Readiness>('website_studio.siteReadiness', { siteId: ctx.site().id }),
        ctx.call<{ rows: Domain[] }>('website_studio.listResources', {
          siteId: ctx.site().id,
          kind: 'domains',
        }),
      ])
      current = readiness.site
      return { readiness, domains }
    },
    view: (value) => {
      const site = ctx.site()
      const canManage = ctx.can('website.site.manage')
      const offer = ctx.boot().offer
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
                    id="site-timezone"
                    name="timezone"
                    label={tr('website.site.timezone')}
                    value={resourceValue(value.readiness.site.timezone)}
                    required
                    disabled={!canManage}
                  />,
                ]}
              />
            </form>
          }
        />
      )
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
            <Section
              title={tr('website.settings.visitorAccess')}
              actions={
                <CommandButton
                  label={tr('website.action.save')}
                  command="site.connections.save"
                  type="submit"
                  form="website-connections-form"
                  variant="primary"
                  disabled={!canManage || ctx.busy()}
                />
              }
              body={
                <form id="website-connections-form" novalidate>
                  <Grid
                    columns={2}
                    items={['realm', 'retentionDays', 'consentVersion', 'authReady'].map((name) => {
                      const props = {
                        id: `connection-${name}`,
                        name,
                        label: tr(`website.site.${name}`),
                        value: resourceValue(value.readiness.site[name]),
                        required: true,
                        disabled: !canManage,
                      }
                      return name === 'authReady' ? (
                        <Select
                          {...props}
                          options={['yes', 'no'].map((value) => ({
                            value,
                            label: tr(`website.option.${value}`),
                          }))}
                        />
                      ) : (
                        <TextField {...props} />
                      )
                    })}
                  />
                </form>
              }
            />,
            ...ctx.slot('siteSettingsSection', value),
          ]}
        />
      )
      return (
        <WorkspacePage
          title={tr('website.route.settings')}
          layout="flow"
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
      'site.connections.save': async (_args, form) =>
        save(
          Object.fromEntries(
            ['realm', 'retentionDays', 'consentVersion', 'authReady'].map((name) => [
              name,
              String(form!.get(name) ?? '').trim(),
            ]),
          ),
        ),
      'site.save': async (_args, form) => {
        form = form!
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
  } satisfies Screen<SettingsData>
}
