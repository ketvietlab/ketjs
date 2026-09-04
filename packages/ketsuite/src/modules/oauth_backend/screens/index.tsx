import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  CardGrid,
  code,
  ContentCard,
  dataTable,
  DefinitionList,
  emptyState,
  FormPage,
  inline,
  linkButton,
  ListPage,
  Notice,
  RecordActions,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

export type ProviderRow = {
  id: string
  code: string
  name: string
  protocol: string
  issuer: string
  clientId: string
  clientAuthMethod: string
  clientSecretEnv?: string | null
  scopes: string
  redirectUri: string
  allowedAlgorithms: string
  allowLinking: boolean
  autoProvision: boolean
  requireVerifiedEmail: boolean
  defaultCompanyId?: string | null
  defaultRoleId?: string | null
  sequence: number
  active: boolean
}

export type IdentityRow = {
  id: string
  providerId: string
  userId: string
  issuer: string
  subject: string
  email?: string | null
  displayName?: string | null
  preferredUsername?: string | null
  lastLoginAt?: string | null
  provider?: { name?: string; code?: string } | null
  user?: { name?: string; login?: string } | null
}

export type PublicProvider = { id: string; code: string; name: string; sequence: number }

export const providersScreen = (
  _: Translator,
  rows: ProviderRow[],
  frame: Frame,
  locale = '',
  includeArchived = false,
): TemplateResult =>
  shell(
    _,
    _('oauth_backend.providers.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('oauth_backend.providers.title')}
      description={_('oauth_backend.providers.subtitle')}
      actions={inline([
        linkButton({
          label: _('oauth_backend.action.create'),
          href: localized('/admin/oauth/providers/new', locale),
          variant: 'primary',
        }),
        linkButton({
          label: _('oauth_backend.action.identities'),
          href: localized('/admin/oauth/identities', locale),
        }),
        linkButton({
          label: includeArchived
            ? _('oauth_backend.filter.activeOnly')
            : _('oauth_backend.filter.includeArchived'),
          href: localized(
            includeArchived ? '/admin/oauth/providers' : '/admin/oauth/providers?archived=1',
            locale,
          ),
          variant: 'tertiary',
        }),
        frame.extras?.['topbar.end'] ?? '',
      ])}
      status={`${_('oauth_backend.providers.title')}: ${String(rows.length)}`}
      body={
        rows.length === 0
          ? emptyState(_('oauth_backend.providers.empty'), _('oauth_backend.providers.emptyHint'))
          : dataTable(_, {
              rows,
              id: (row) => row.id,
              columns: [
                {
                  key: 'name',
                  label: _('oauth_backend.field.name'),
                  priority: 'primary',
                  cell: (row) =>
                    linkButton({
                      label: row.name,
                      href: localized(`/admin/oauth/providers/${row.id}`, locale),
                      variant: 'tertiary',
                    }),
                },
                { key: 'code', label: _('oauth_backend.field.code'), cell: (row) => code(row.code) },
                { key: 'issuer', label: _('oauth_backend.field.issuer'), cell: (row) => code(row.issuer) },
                {
                  key: 'provision',
                  label: _('oauth_backend.field.autoProvision'),
                  kind: 'status',
                  cell: (row) =>
                    badge(
                      row.autoProvision
                        ? _('oauth_backend.state.enabled')
                        : _('oauth_backend.state.disabled'),
                      row.autoProvision ? 'info' : 'neutral',
                    ),
                },
                {
                  key: 'state',
                  label: _('oauth_backend.field.state'),
                  kind: 'status',
                  cell: (row) =>
                    badge(
                      row.active ? _('oauth_backend.state.active') : _('oauth_backend.state.archived'),
                      row.active ? 'positive' : 'neutral',
                    ),
                },
              ],
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )

type ProviderOptions = {
  companies: FormOption[]
  roles: FormOption[]
  errors?: string[]
}

const providerFields = (_: Translator, row: Partial<ProviderRow>, options: ProviderOptions) => [
  { name: 'name', label: _('oauth_backend.field.name'), value: row.name, required: true },
  { name: 'code', label: _('oauth_backend.field.code'), value: row.code, required: true },
  {
    name: 'protocol',
    label: _('oauth_backend.field.protocol'),
    type: 'select' as const,
    value: row.protocol ?? 'oidc',
    options: [{ value: 'oidc', label: 'OpenID Connect' }],
    required: true,
  },
  {
    name: 'issuer',
    label: _('oauth_backend.field.issuer'),
    value: row.issuer,
    placeholder: 'https://identity.example.com',
    required: true,
    span: 'full' as const,
  },
  { name: 'clientId', label: _('oauth_backend.field.clientId'), value: row.clientId, required: true },
  {
    name: 'clientAuthMethod',
    label: _('oauth_backend.field.clientAuthMethod'),
    type: 'select' as const,
    value: row.clientAuthMethod ?? 'none',
    options: [
      { value: 'none', label: _('oauth_backend.clientAuth.none') },
      { value: 'client_secret_basic', label: 'client_secret_basic' },
      { value: 'client_secret_post', label: 'client_secret_post' },
    ],
    required: true,
  },
  {
    name: 'clientSecretEnv',
    label: _('oauth_backend.field.clientSecretEnv'),
    value: row.clientSecretEnv,
    placeholder: 'KET_OAUTH_CLIENT_SECRET',
    help: _('oauth_backend.field.clientSecretEnvHint'),
  },
  {
    name: 'scopes',
    label: _('oauth_backend.field.scopes'),
    value: row.scopes ?? 'openid profile email',
    required: true,
  },
  {
    name: 'redirectUri',
    label: _('oauth_backend.field.redirectUri'),
    value: row.redirectUri,
    help: _('oauth_backend.field.redirectUriHint'),
    span: 'full' as const,
  },
  {
    name: 'allowedAlgorithms',
    label: _('oauth_backend.field.algorithms'),
    value: row.allowedAlgorithms ?? 'RS256',
    required: true,
  },
  {
    name: 'sequence',
    label: _('oauth_backend.field.sequence'),
    type: 'number' as const,
    value: row.sequence ?? 10,
  },
  {
    name: 'allowLinking',
    label: _('oauth_backend.field.allowLinking'),
    type: 'checkbox' as const,
    value: row.allowLinking ?? true,
  },
  {
    name: 'autoProvision',
    label: _('oauth_backend.field.autoProvision'),
    type: 'checkbox' as const,
    value: row.autoProvision ?? false,
  },
  {
    name: 'requireVerifiedEmail',
    label: _('oauth_backend.field.requireVerifiedEmail'),
    type: 'checkbox' as const,
    value: row.requireVerifiedEmail ?? true,
  },
  {
    name: 'defaultCompanyId',
    label: _('oauth_backend.field.defaultCompany'),
    type: 'select' as const,
    value: row.defaultCompanyId,
    options: [{ value: '', label: _('oauth_backend.option.none') }, ...options.companies],
  },
  {
    name: 'defaultRoleId',
    label: _('oauth_backend.field.defaultRole'),
    type: 'select' as const,
    value: row.defaultRoleId,
    options: [{ value: '', label: _('oauth_backend.option.none') }, ...options.roles],
  },
  {
    name: 'active',
    label: _('oauth_backend.field.active'),
    type: 'checkbox' as const,
    value: row.active ?? true,
  },
]

export const providerFormScreen = (
  _: Translator,
  row: Partial<ProviderRow> & { id?: string },
  options: ProviderOptions,
  frame: Frame,
  locale = '',
): TemplateResult => {
  const existing = Boolean(row.id)
  const title = existing ? String(row.name) : _('oauth_backend.providers.create')
  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="oauth-provider-form"
      title={title}
      description={_('oauth_backend.configuration.hint')}
      status={
        existing
          ? badge(
              row.active ? _('oauth_backend.state.active') : _('oauth_backend.state.archived'),
              row.active ? 'positive' : 'neutral',
            )
          : undefined
      }
      actions={frame.extras?.['topbar.end']}
      body={stack([
        ...(existing
          ? [
              <Section
                title={_('oauth_backend.status.title')}
                body={
                  <Surface
                    body={
                      <RecordActions
                        action={localized(`/admin/oauth/providers/${row.id}/archive`, locale)}
                        actions={[
                          row.active
                            ? {
                                value: 'archive',
                                label: _('oauth_backend.action.archive'),
                                variant: 'destructive' as const,
                              }
                            : {
                                value: 'restore',
                                label: _('oauth_backend.action.restore'),
                                variant: 'secondary' as const,
                              },
                        ]}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
        <Section
          title={_('oauth_backend.configuration.title')}
          description={_('oauth_backend.configuration.hint')}
          body={
            <Surface
              body={
                <RecordForm
                  action={localized(
                    existing ? `/admin/oauth/providers/${row.id}` : '/admin/oauth/providers/new',
                    locale,
                  )}
                  fields={providerFields(_, row, options)}
                  submit={_('oauth_backend.action.save')}
                  submitVariant="primary"
                  errors={options.errors}
                  cancelHref={localized('/admin/oauth/providers', locale)}
                  cancelLabel={_('oauth_backend.action.cancel')}
                />
              }
            />
          }
        />,
        ...(existing
          ? [
              <Section
                title={_('oauth_backend.integration.title')}
                description={_('oauth_backend.integration.hint')}
                body={
                  <DefinitionList
                    title={_('oauth_backend.integration.values')}
                    items={[
                      { key: 'issuer', term: _('oauth_backend.field.issuer'), value: String(row.issuer) },
                      {
                        key: 'redirect',
                        term: _('oauth_backend.field.redirectUri'),
                        value: String(row.redirectUri),
                      },
                      {
                        key: 'secret',
                        term: _('oauth_backend.field.clientSecretEnv'),
                        value: row.clientSecretEnv || _('oauth_backend.clientAuth.none'),
                      },
                    ]}
                  />
                }
                actions={linkButton({
                  label: _('oauth_backend.action.viewIdentities'),
                  href: localized(`/admin/oauth/identities?provider=${row.id}`, locale),
                })}
              />,
            ]
          : []),
      ])}
    />,
    { ...frame, chrome: null, topbar: false },
  )
}

export const identitiesScreen = (
  _: Translator,
  rows: IdentityRow[],
  frame: Frame,
  locale = '',
  errors: string[] = [],
): TemplateResult =>
  shell(
    _,
    _('oauth_backend.identities.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('oauth_backend.identities.title')}
      description={_('oauth_backend.identities.subtitle')}
      actions={inline([
        linkButton({
          label: _('oauth_backend.action.linkIdentity'),
          href: localized('/admin/oauth/identities/new', locale),
          variant: 'primary',
        }),
        linkButton({
          label: _('oauth_backend.action.providers'),
          href: localized('/admin/oauth/providers', locale),
        }),
        frame.extras?.['topbar.end'] ?? '',
      ])}
      status={`${_('oauth_backend.identities.title')}: ${String(rows.length)}`}
      body={stack([
        ...(errors.length
          ? [<Notice tone="danger" title={_('oauth_backend.error.title')} message={errors.join(' ')} />]
          : []),
        rows.length === 0
          ? emptyState(_('oauth_backend.identities.empty'), _('oauth_backend.identities.emptyHint'))
          : dataTable(_, {
              rows,
              id: (row) => row.id,
              columns: [
                {
                  key: 'user',
                  label: _('oauth_backend.field.user'),
                  priority: 'primary',
                  cell: (row) => row.user?.name || row.user?.login || row.userId,
                },
                {
                  key: 'provider',
                  label: _('oauth_backend.field.provider'),
                  cell: (row) => row.provider?.name || row.provider?.code || row.providerId,
                },
                { key: 'subject', label: _('oauth_backend.field.subject'), cell: (row) => code(row.subject) },
                { key: 'email', label: _('oauth_backend.field.email'), cell: (row) => row.email || '—' },
                {
                  key: 'lastLogin',
                  label: _('oauth_backend.field.lastLogin'),
                  cell: (row) => row.lastLoginAt || _('oauth_backend.state.never'),
                },
                {
                  key: 'actions',
                  label: _('oauth_backend.field.actions'),
                  kind: 'status',
                  cell: (row) => (
                    <RecordActions
                      action={localized(`/admin/oauth/identities/${row.id}/unlink`, locale)}
                      actions={[
                        {
                          value: 'unlink',
                          label: _('oauth_backend.action.unlink'),
                          variant: 'destructive',
                        },
                      ]}
                    />
                  ),
                },
              ],
            }),
      ])}
    />,
    { ...frame, chrome: null, topbar: false },
  )

export const identityFormScreen = (
  _: Translator,
  row: Partial<IdentityRow>,
  options: { providers: FormOption[]; users: FormOption[]; errors?: string[] },
  frame: Frame,
  locale = '',
): TemplateResult =>
  shell(
    _,
    _('oauth_backend.identities.link'),
    <FormPage
      variant="operational"
      frame={frame}
      scope="oauth-identity-form"
      title={_('oauth_backend.identities.link')}
      description={_('oauth_backend.identities.linkHint')}
      actions={frame.extras?.['topbar.end']}
      body={
        <Section
          title={_('oauth_backend.identities.verifiedSubject')}
          description={_('oauth_backend.identities.linkHint')}
          body={
            <Surface
              body={
                <RecordForm
                  action={localized('/admin/oauth/identities/new', locale)}
                  fields={[
                    {
                      name: 'providerId',
                      label: _('oauth_backend.field.provider'),
                      type: 'select',
                      value: row.providerId,
                      options: options.providers,
                      required: true,
                    },
                    {
                      name: 'userId',
                      label: _('oauth_backend.field.user'),
                      type: 'select',
                      value: row.userId,
                      options: options.users,
                      required: true,
                    },
                    {
                      name: 'subject',
                      label: _('oauth_backend.field.subject'),
                      value: row.subject,
                      required: true,
                    },
                    { name: 'email', label: _('oauth_backend.field.email'), value: row.email },
                    {
                      name: 'displayName',
                      label: _('oauth_backend.field.displayName'),
                      value: row.displayName,
                    },
                    {
                      name: 'preferredUsername',
                      label: _('oauth_backend.field.preferredUsername'),
                      value: row.preferredUsername,
                    },
                  ]}
                  submit={_('oauth_backend.action.link')}
                  submitVariant="primary"
                  errors={options.errors}
                  cancelHref={localized('/admin/oauth/identities', locale)}
                  cancelLabel={_('oauth_backend.action.cancel')}
                />
              }
            />
          }
        />
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )

export const linkProviderScreen = (
  _: Translator,
  providers: PublicProvider[],
  identities: IdentityRow[],
  frame: Frame,
  locale = '',
): TemplateResult => {
  const linked = new Set(identities.map((identity) => identity.providerId))
  return shell(
    _,
    _('oauth_backend.link.title'),
    <FormPage
      variant="operational"
      frame={frame}
      scope="oauth-link-provider"
      title={_('oauth_backend.link.title')}
      description={_('oauth_backend.link.hint')}
      actions={frame.extras?.['topbar.end']}
      body={
        <Section
          title={_('oauth_backend.link.choose')}
          description={_('oauth_backend.link.hint')}
          body={
            providers.length === 0 ? (
              emptyState(_('oauth_backend.link.empty'), _('oauth_backend.link.emptyHint'))
            ) : (
              <CardGrid
                items={providers}
                id={(provider) => provider.id}
                card={(provider) => (
                  <ContentCard
                    title={provider.name}
                    summary={
                      linked.has(provider.id)
                        ? _('oauth_backend.link.alreadyLinked')
                        : _('oauth_backend.link.ready')
                    }
                    meta={code(provider.code)}
                    actions={linkButton({
                      label: linked.has(provider.id)
                        ? _('oauth_backend.link.linkAnother')
                        : _('oauth_backend.link.action'),
                      href: localized(
                        `/auth/oauth/${provider.code}/start?mode=link&next=/admin/profile`,
                        locale,
                      ),
                      variant: 'primary',
                    })}
                  />
                )}
              />
            )
          }
        />
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
