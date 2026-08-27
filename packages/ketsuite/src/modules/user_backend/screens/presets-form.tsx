import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormPage, Notice, RecordForm, Section, shell, stack, Surface } from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'

export type PresetsFormValues = { module?: string; level?: string }

export type PresetsScreenOptions = {
  modules: readonly FormOption[]
  action: string
  values?: PresetsFormValues
  errors?: readonly string[]
  result?: string
}

export const presetsScreen = (_: Translator, frame: Frame, options: PresetsScreenOptions): TemplateResult => {
  const formId = 'permission-preset-form'
  return shell(
    _,
    _('user_backend.presets.title'),
    <FormPage
      scope="permission-preset-page"
      title={_('user_backend.presets.title')}
      description={_('user_backend.presets.hint')}
      actions={button({
        label: _('user_backend.action.applyPreset'),
        type: 'submit',
        form: formId,
        variant: 'primary',
      })}
      body={stack([
        ...(options.result
          ? [<Notice tone="positive" title={_('user_backend.presets.done')} message={options.result} />]
          : []),
        <Section
          title={_('user_backend.presets.apply')}
          description={_('user_backend.presets.hint')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="permission-preset"
                  action={options.action}
                  hidden={{ action: 'save' }}
                  submit={_('user_backend.action.applyPreset')}
                  submitVariant="primary"
                  submitPlacement="external"
                  errors={options.errors}
                  fields={[
                    {
                      name: 'module',
                      label: _('user_backend.presets.module'),
                      type: 'select',
                      value: options.values?.module,
                      options: options.modules,
                      required: true,
                    },
                    {
                      name: 'level',
                      label: _('user_backend.presets.level'),
                      type: 'select',
                      value: options.values?.level,
                      options: [
                        { value: 'user', label: _('user_backend.presets.user') },
                        { value: 'manager', label: _('user_backend.presets.manager') },
                      ],
                      required: true,
                    },
                  ]}
                />
              }
            />
          }
        />,
      ])}
    />,
    { ...frame, topbar: false },
  )
}
