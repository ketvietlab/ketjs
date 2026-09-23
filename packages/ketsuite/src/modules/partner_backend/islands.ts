import { defineIsland, each, html, signal } from '@ketvietlab/ketjs-view'
import { createAddressFormView } from './client/address-view.mjs'

const runtime = { each, html, signal }
type AddressFormProps = {
  action: string
  address: unknown
  countries: unknown
  provinces: unknown
  provinceId?: string
  divisions: unknown
  uses: unknown
  labels: unknown
  submitLabel: string
  defaultCountry?: string
}

export const islands = {
  'partner.address-form': defineIsland<AddressFormProps>()({
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
    view: (props) => createAddressFormView(runtime, props),
  }),
}
