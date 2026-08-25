// @ts-nocheck Shared dependency-free browser/SSR address form view.
const callApi = async (name, input, signal) => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false)
    throw new Error(String(payload.message ?? `HTTP ${response.status}`))
  return payload.value
}

const array = (value) => (Array.isArray(value) ? value : [])
const string = (value) => (value == null ? '' : String(value))

export function createAddressFormView(runtime, props) {
  const { each, html, signal } = runtime
  const labels = props.labels ?? {}
  const address = props.address ?? {}
  const countries = array(props.countries)
  const countryCode = signal(string(address.countryCode || props.defaultCountry || 'VN'))
  const provinces = signal(array(props.provinces))
  const provinceId = signal(string(props.provinceId))
  const divisions = signal(array(props.divisions))
  const divisionId = signal(string(address.divisionId))
  const loading = signal(false)
  const error = signal('')
  let activeRequest = null
  let disposed = false

  const children = async (parentId) => {
    activeRequest?.abort()
    activeRequest = new AbortController()
    return callApi(
      'address.listDivisionChildren',
      {
        countryCode: countryCode(),
        parentId: parentId || null,
        limit: 1000,
      },
      activeRequest.signal,
    )
  }

  const chooseCountry = async (event) => {
    countryCode.set(event.currentTarget.value)
    provinceId.set('')
    divisionId.set('')
    provinces.set([])
    divisions.set([])
    error.set('')
    loading.set(true)
    try {
      provinces.set(await children(null))
    } catch (caught) {
      if (disposed || caught?.name === 'AbortError') return
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      loading.set(false)
    }
  }

  const chooseProvince = async (event) => {
    const selected = event.currentTarget.value
    provinceId.set(selected)
    divisionId.set('')
    divisions.set([])
    error.set('')
    if (!selected) return
    loading.set(true)
    try {
      divisions.set(await children(selected))
    } catch (caught) {
      if (disposed || caught?.name === 'AbortError') return
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      loading.set(false)
    }
  }

  const field = (label, control, required = false, span = 'half') => html`
    <label data-ui="form-field" data-span=${span}>
      <span data-ui="form-label">${label}${required ? html`<span data-ui="form-required" aria-hidden="true"> *</span>` : ''}</span>
      ${control}
    </label>
  `

  return {
    view: () => html`
    <form
      data-ui="record-form"
      data-layout="default"
      data-has-fields="true"
      data-address-form
      method="post"
      action=${props.action}
    >
      <div data-ui="form-grid">
        ${field(
          labels.use,
          html`<select data-ui="form-control" name="use">
            ${each(
              array(props.uses),
              (entry) => entry.value,
              (entry) =>
                html`<option value=${entry.value} selected=${entry.value === address.use}>${entry.label}</option>`,
            )}
          </select>`,
        )}
        ${field(
          labels.country,
          html`<select data-ui="form-control" name="countryId" required on:change=${chooseCountry}>
            ${each(
              countries,
              (entry) => entry.value,
              (entry) =>
                html`<option value=${entry.value} selected=${entry.value === countryCode()}>${entry.label}</option>`,
            )}
          </select>`,
          true,
        )}
        ${field(
          labels.street,
          html`<input data-ui="form-control" name="street1" value=${string(address.street1)} autocomplete="off" required>`,
          true,
          'full',
        )}
        ${field(
          labels.street2,
          html`<input data-ui="form-control" name="street2" value=${string(address.street2)} autocomplete="off">`,
          false,
          'full',
        )}
        ${field(
          labels.province,
          html`<select data-ui="form-control" name="provinceId" required on:change=${chooseProvince} disabled=${loading()}>
            <option value="">${labels.chooseProvince}</option>
            ${each(
              provinces(),
              (entry) => entry.id,
              (entry) =>
                html`<option value=${entry.id} selected=${entry.id === provinceId()}>${entry.officialName}</option>`,
            )}
          </select>`,
          true,
        )}
        ${field(
          labels.division,
          html`<select data-ui="form-control" name="divisionId" required disabled=${loading() || !provinceId()} on:change=${(event) => divisionId.set(event.currentTarget.value)}>
            <option value="">${loading() ? labels.loading : labels.chooseDivision}</option>
            ${each(
              divisions(),
              (entry) => entry.id,
              (entry) =>
                html`<option value=${entry.id} selected=${entry.id === divisionId()}>${entry.officialName}</option>`,
            )}
          </select>`,
          true,
        )}
        ${field(
          labels.locality,
          html`<input data-ui="form-control" name="locality" value=${string(address.locality)} autocomplete="off" placeholder=${labels.localityHint}>`,
        )}
        ${field(
          labels.postalCode,
          html`<input data-ui="form-control" name="postalCode" value=${string(address.postalCode)} autocomplete="off" inputmode="numeric">`,
        )}
        <label data-ui="form-field" data-kind="checkbox">
          <input data-ui="form-control" type="checkbox" name="isDefault" value="1" autocomplete="off" checked=${address.isDefault === true}>
          <span data-ui="form-label">${labels.default}</span>
        </label>
      </div>
      ${error() ? html`<p data-ui="address-error" role="alert">${labels.loadError}: ${error()}</p>` : ''}
      ${
        !loading() && provinces().length === 0
          ? html`<p data-ui="address-error" role="status">${labels.catalogMissing}</p>`
          : ''
      }
      <p data-ui="address-preview" aria-live="polite">${address.oneLine || labels.previewHint}</p>
      <div data-ui="form-actions">
        <button data-ui="action" data-variant="secondary" type="submit" disabled=${loading() || provinces().length === 0}>${props.submitLabel}</button>
      </div>
    </form>
  `,
    dispose: () => {
      disposed = true
      activeRequest?.abort()
    },
  }
}
