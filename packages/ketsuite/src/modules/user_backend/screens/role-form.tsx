import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  DefinitionList,
  FormCluster,
  FormPage,
  linkButton,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import type { PermissionRow, RoleRow } from './types.ts'

export type RoleFormValues = Partial<RoleRow> & { id?: string }

export type RoleFormScreenOptions = {
  mode: 'create' | 'detail'
  action: string
  cancelHref: string
  permissionsAction?: string
  cloneAction?: string
  cloneId?: string
  authorizationRevision?: number
  permissions?: readonly PermissionRow[]
  errors?: readonly string[]
}

export const roleIdentityFields = (_: Translator, values: RoleFormValues): FormField[] => [
  {
    name: 'name',
    label: _('user_backend.field.name'),
    value: values.name,
    required: true,
    disabled: values.mode === 'managed',
  },
  {
    name: 'description',
    label: _('user_backend.field.description'),
    value: values.description,
    type: 'textarea',
    span: 'full',
    disabled: values.mode === 'managed',
  },
]

export const roleScreen = (
  _: Translator,
  values: RoleFormValues,
  options: RoleFormScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const create = options.mode === 'create'
  const title = create ? _('user_backend.roles.create') : String(values.name ?? values.id ?? '')
  const formId = 'role-record-form'
  const permissionsAction = options.permissionsAction
  const groups = new Map<string, PermissionRow[]>()
  for (const permission of options.permissions ?? [])
    groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission])

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="role-form-page"
      title={title}
      description={_('user_backend.roles.subtitle')}
      status={
        create
          ? undefined
          : values.mode === 'managed'
            ? badge(
                `${_('user_backend.role.managed')} · v${String(values.templateVersion ?? '—')}`,
                'positive',
                'managed',
              )
            : badge(_('user_backend.role.custom'), 'neutral', 'custom')
      }
      actions={
        <FormCluster
          forms={[
            ...(values.mode === 'managed'
              ? []
              : [
                  button({
                    label: _('user_backend.action.save'),
                    type: 'submit',
                    form: formId,
                    variant: 'primary',
                  }),
                ]),
            linkButton({
              label: _('user_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={stack([
        <Section
          title={_('user_backend.roles.identity')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="role-record"
                  action={options.action}
                  hidden={{ action: 'save', ...(values.id ? { id: values.id } : {}) }}
                  fields={roleIdentityFields(_, values)}
                  errors={options.errors}
                  submit={_('user_backend.action.save')}
                  submitVariant="primary"
                  submitPlacement="external"
                />
              }
            />
          }
        />,
        ...(!create && values.grantSources?.length
          ? [
              <Section
                title={_('user_backend.roles.provenance')}
                description={_('user_backend.roles.provenanceHint')}
                body={
                  <Surface
                    body={
                      <DefinitionList
                        title={_('user_backend.roles.provenance')}
                        items={values.grantSources.map((source, index) => ({
                          key: `${source.fnKey}:${source.sourceKind}:${source.sourceKey}:${String(index)}`,
                          term: source.fnKey,
                          value: `${source.sourceKind} · ${source.sourceKey}${
                            source.sourceVersion == null ? '' : ` · v${String(source.sourceVersion)}`
                          }`,
                        }))}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
        ...(!create && values.mode === 'managed' && options.cloneAction && options.cloneId
          ? [
              <Section
                title={_('user_backend.roles.clone')}
                description={_('user_backend.roles.cloneHint')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={options.cloneAction}
                        hidden={{
                          action: 'clone',
                          id: options.cloneId,
                          expectedAuthorizationRevision: String(options.authorizationRevision ?? 0),
                          idempotencyKey: options.cloneId,
                        }}
                        submit={_('user_backend.action.cloneRole')}
                        submitVariant="secondary"
                        fields={[
                          {
                            name: 'name',
                            label: _('user_backend.field.name'),
                            required: true,
                            value: `${String(values.name ?? values.id ?? '')} · ${_('user_backend.role.custom')}`,
                          },
                          {
                            name: 'reason',
                            label: _('user_backend.field.reason'),
                            type: 'textarea' as const,
                            required: true,
                            span: 'full' as const,
                          },
                        ]}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
        ...(!create && permissionsAction
          ? [...groups.entries()].map(([moduleName, items]) => (
              <Section
                title={items[0]?.moduleLabel ?? moduleName}
                description={_('user_backend.roles.permissionHint')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={permissionsAction}
                        submit={_('user_backend.action.savePermissions')}
                        submitVariant="secondary"
                        hidden={{ action: 'save', module: moduleName }}
                        fields={items.map((permission) => ({
                          name: `permission.${permission.key}`,
                          label: permission.label,
                          type: 'checkbox' as const,
                          value: permission.checked,
                        }))}
                      />
                    }
                  />
                }
              />
            ))
          : []),
      ])}
    />,
    { ...frame, topbar: false },
  )
}
