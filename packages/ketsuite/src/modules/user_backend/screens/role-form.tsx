import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  button,
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
  permissions?: readonly PermissionRow[]
  errors?: readonly string[]
}

export const roleIdentityFields = (_: Translator, values: RoleFormValues): FormField[] => [
  { name: 'name', label: _('user_backend.field.name'), value: values.name, required: true },
  {
    name: 'description',
    label: _('user_backend.field.description'),
    value: values.description,
    type: 'textarea',
    span: 'full',
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
      scope="role-form-page"
      title={title}
      description={_('user_backend.roles.subtitle')}
      actions={
        <FormCluster
          forms={[
            button({
              label: _('user_backend.action.save'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
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
