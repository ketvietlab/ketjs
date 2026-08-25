import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { Framed, RecordForm, Surface } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

export const favoriteScreen = (
  _: Translator,
  frame: Frame,
  returnTo: string,
  locale = '',
  errors?: string[],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('product_backend.favorite.create')}
    frame={frame}
    body={
      <Surface
        body={
          <RecordForm
            action={localized('/admin/product/templates/favorites/new', locale)}
            submit={_('product_backend.favorite.save')}
            submitVariant="primary"
            errors={errors}
            hidden={{ returnTo }}
            fields={[
              { name: 'name', label: _('product_backend.favorite.name'), required: true },
              { name: 'default', label: _('product_backend.favorite.default'), type: 'checkbox' },
            ]}
          />
        }
      />
    }
  />
)
