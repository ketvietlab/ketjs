import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { PartnerInitials, RecordForm, RecordWorkspace, shell, Surface } from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

export const newPartnerScreen = (
  _: Translator,
  parents: FormOption[],
  frame: Frame,
  errors?: string[],
  locale = '',
  parentControl?: JSXChild,
): TemplateResult =>
  shell(
    _,
    _('partner_backend.create.title'),
    <RecordWorkspace
      kicker={_('partner_backend.menu.app')}
      title={_('partner_backend.create.title')}
      subtitle={_('partner_backend.create.subtitle')}
      imageFallback={<PartnerInitials name={_('partner_backend.create.title')} />}
      body={
        <Surface
          body={
            <RecordForm
              action={localized('/admin/partner/partners/new', locale)}
              submit={_('partner_backend.action.create')}
              submitVariant="primary"
              cancelHref={localized('/admin/partner/partners', locale)}
              cancelLabel={_('partner_backend.action.cancel')}
              errors={errors}
              fields={[
                { name: 'name', label: _('partner_backend.field.name'), required: true },
                {
                  name: 'kind',
                  label: _('partner_backend.field.kind'),
                  type: 'select',
                  value: 'company',
                  options: ['company', 'person'].map((value) => ({
                    value,
                    label: _(`partner.kind.${value}`),
                  })),
                },
                {
                  name: 'parentId',
                  label: _('partner_backend.field.parent'),
                  type: 'select',
                  control: parentControl,
                  options: [{ value: '', label: '—' }, ...parents],
                },
                { name: 'ref', label: _('partner_backend.field.ref') },
                { name: 'vat', label: _('partner_backend.field.vat') },
                { name: 'email', label: _('partner_backend.field.email') },
                { name: 'phone', label: _('partner_backend.field.phone') },
              ]}
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
