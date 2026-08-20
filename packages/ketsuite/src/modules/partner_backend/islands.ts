import { each, html, signal } from 'ketjs-view'
import type { IslandDefinition, IslandProps } from 'ketjs-view'
import { createAddressFormView } from './client/address-view.mjs'

const runtime = { each, html, signal }
export const islands: Record<string, IslandDefinition> = {
  'partner.address-form': {
    props: {
      action: 'text',
      address: 'json',
      countries: 'json',
      provinces: 'json',
      provinceId: 'id?',
      divisions: 'json',
      uses: 'json',
      labels: 'json',
      submitLabel: 'text',
      defaultCountry: 'text?',
    },
    client: 'address.mjs',
    export: 'form',
    view: (props: IslandProps) => createAddressFormView(runtime, props),
  },
}
