// @ts-nocheck Shared dependency-free browser/SSR relational selector.
const array = (value) => (Array.isArray(value) ? value : [])
const string = (value) => (value == null ? '' : String(value))

const callApi = async (name, input, requestSignal) => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: requestSignal,
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false) {
    const domainError = array(payload.errors)[0]
    throw new Error(
      string(domainError?.message || domainError?.code || payload.message || `HTTP ${response.status}`),
    )
  }
  return payload.value
}

export function createRelationSelectView(runtime, props) {
  const { each, html, signal } = runtime
  const config = props.config ?? {}
  const labels = config.labels ?? {}
  const manager = config.manager ?? null
  // One representation for both modes: an array of chosen ids. Single-select is
  // the array of length 0 or 1, so nothing downstream has to branch on the mode
  // except the places where the two genuinely differ — the trigger and the chips.
  const multiple = config.multiple === true
  const chosen = signal(
    multiple ? array(config.values).map(string).filter(Boolean) : [string(config.value)].filter(Boolean),
  )
  const selected = () => chosen()[0] ?? ''
  const isChosen = (value) => chosen().includes(string(value))
  const options = signal(array(config.options))
  const open = signal(false)
  const dialog = signal(false)
  const query = signal('')
  const rows = signal([])
  const loading = signal(false)
  const error = signal('')
  const editor = signal(null)
  const pendingRemove = signal('')
  let activeRequest = null
  let searchTimer = null
  let disposed = false

  const rowId = (row) => string(row?.[manager?.idField || 'id'])
  const rowLabel = (row) => string(row?.[manager?.labelField || 'name']) || labels.noRecords
  const rowDescription = (row) => string(row?.[manager?.descriptionField || 'ref'])
  const selectedLabel = () =>
    options().find((entry) => string(entry.value) === selected())?.label || labels.choose

  const filteredOptions = () => {
    const needle = query().trim().toLocaleLowerCase()
    const held = needle
      ? options().filter((entry) =>
          `${string(entry.label)} ${string(entry.description)}`.toLocaleLowerCase().includes(needle),
        )
      : options()
    return held.slice(0, 7)
  }

  const choose = (value, label, description = '') => {
    const id = string(value)
    if (!options().some((entry) => string(entry.value) === id))
      options.set([...options(), { value: id, label: string(label), description: string(description) }])
    if (multiple) {
      // Picking is a toggle, and the dialog stays open: choosing several records
      // one after another is the whole point of a multi-valued field.
      chosen.set(isChosen(id) ? chosen().filter((held) => held !== id) : [...chosen(), id])
      return
    }
    chosen.set(id ? [id] : [])
    open.set(false)
    dialog.set(false)
    query.set('')
    editor.set(null)
    pendingRemove.set('')
  }

  const unchoose = (value) => chosen.set(chosen().filter((held) => held !== string(value)))

  const labelOf = (value) =>
    options().find((entry) => string(entry.value) === string(value))?.label || string(value)

  const loadRows = async () => {
    if (!manager?.listFunction) return
    activeRequest?.abort()
    const request = new AbortController()
    activeRequest = request
    loading.set(true)
    error.set('')
    try {
      const input = { ...(manager.listInput ?? {}) }
      input[manager.searchParam || 'search'] = query().trim()
      input[manager.limitParam || 'limit'] = manager.limit || 80
      const value = await callApi(manager.listFunction, input, request.signal)
      const excluded = new Set(array(manager.excludeIds).map(string))
      rows.set(array(value).filter((row) => !excluded.has(rowId(row))))
    } catch (caught) {
      if (disposed || caught?.name === 'AbortError') return
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      if (activeRequest === request) loading.set(false)
    }
  }

  const openDialog = async () => {
    open.set(false)
    dialog.set(true)
    editor.set(null)
    pendingRemove.set('')
    await loadRows()
  }

  const closeDialog = () => {
    dialog.set(false)
    editor.set(null)
    pendingRemove.set('')
    error.set('')
  }

  const searchManager = (event) => {
    query.set(event.currentTarget.value)
    clearTimeout(searchTimer)
    searchTimer = setTimeout(loadRows, 180)
  }

  const save = async (event) => {
    event.preventDefault()
    if (!manager?.saveFunction) return
    const editing = editor()
    const id = editing?.id || crypto.randomUUID()
    const payload = { ...(manager.saveDefaults ?? {}), id }
    for (const [name, value] of new FormData(event.currentTarget).entries()) payload[name] = string(value)
    loading.set(true)
    error.set('')
    try {
      await callApi(manager.saveFunction, payload)
      const label = string(payload[manager.labelField || 'name'])
      if (!editing?.id) {
        choose(id, label)
        // `choose` closes the dialog for a single value; a multi-valued field
        // stays open to keep picking, so the editor has to be dismissed here.
        if (multiple) {
          editor.set(null)
          await loadRows()
        }
        return
      }
      options.set(
        options().map((entry) =>
          string(entry.value) === id ? { ...entry, label: label || entry.label } : entry,
        ),
      )
      editor.set(null)
      await loadRows()
    } catch (caught) {
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      loading.set(false)
    }
  }

  const remove = async (row) => {
    const id = rowId(row)
    if (pendingRemove() !== id) {
      pendingRemove.set(id)
      return
    }
    if (!manager?.removeFunction) return
    loading.set(true)
    error.set('')
    try {
      await callApi(manager.removeFunction, { ...(manager.removeDefaults ?? {}), id })
      unchoose(id)
      options.set(options().filter((entry) => string(entry.value) !== id))
      pendingRemove.set('')
      await loadRows()
    } catch (caught) {
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      loading.set(false)
    }
  }

  const editorField = (field) => {
    const held = editor()?.row ?? manager?.saveDefaults ?? {}
    const value = string(held?.[field.name])
    return html`
      <label data-ui="form-field" data-span="full">
        <span data-ui="form-label">${field.label}${field.required ? html`<span data-ui="form-required" aria-hidden="true"> *</span>` : ''}</span>
        ${
          field.type === 'select'
            ? html`<select data-ui="form-control" name=${field.name} required=${field.required === true}>
                ${each(
                  array(field.options),
                  (entry) => entry.value,
                  (entry) =>
                    html`<option value=${entry.value} selected=${string(entry.value) === value}>${entry.label}</option>`,
                )}
              </select>`
            : html`<input data-ui="form-control" type=${field.type || 'text'} name=${field.name} value=${value} autocomplete="off" required=${field.required === true}>`
        }
      </label>
    `
  }

  const editorForm = () => html`
    <form data-ui="relation-editor" on:submit=${save}>
      <div data-ui="form-grid">
        ${each(array(manager?.fields), (field) => field.name, editorField)}
      </div>
      <div data-ui="form-actions">
        <div data-ui="action-group">
          <button data-ui="action" data-variant="primary" type="submit" disabled=${loading()}>${labels.save}</button>
          <button data-ui="action" data-variant="tertiary" type="button" on:click=${() => editor.set(null)}>${labels.cancel}</button>
        </div>
      </div>
    </form>
  `

  const managerRow = (row) => {
    const id = rowId(row)
    const description = rowDescription(row)
    return html`
      <li data-ui="relation-dialog-row" data-selected=${String(isChosen(id))}>
        <button data-ui="relation-dialog-main" type="button" aria-pressed=${multiple ? String(isChosen(id)) : null} on:click=${() => choose(id, rowLabel(row), description)}>
          <strong>${rowLabel(row)}</strong>
          ${description ? html`<small data-ui="relation-dialog-meta">${description}</small>` : ''}
        </button>
        <div data-ui="relation-dialog-actions">
          <button data-ui="action" data-size="compact" data-variant=${isChosen(id) ? 'primary' : 'secondary'} type="button" on:click=${() => choose(id, rowLabel(row), description)}>${isChosen(id) ? labels.chosen : labels.select}</button>
          ${
            manager?.saveFunction
              ? html`<button data-ui="action" data-size="compact" data-variant="tertiary" type="button" on:click=${() => editor.set({ id, row })}>${labels.edit}</button>`
              : ''
          }
          ${
            manager?.removeFunction
              ? html`<button data-ui="action" data-size="compact" data-variant="destructive" type="button" on:click=${() => remove(row)}>${pendingRemove() === id ? labels.confirmRemove : labels.remove}</button>`
              : ''
          }
        </div>
      </li>
    `
  }

  const dialogView = () => html`
    <div data-ui="modal-layer" data-presentation="dialog">
      <button data-ui="modal-backdrop" type="button" aria-label=${labels.close} on:click=${closeDialog}><span>${labels.close}</span></button>
      <section data-ui="modal-sheet" data-size="large" role="dialog" aria-modal="true" aria-labelledby=${`${props.id}-relation-title`}>
        <header data-ui="modal-head">
          <h2 data-ui="modal-title" id=${`${props.id}-relation-title`}>${labels.dialogTitle}</h2>
          <button data-ui="modal-close" type="button" aria-label=${labels.close} title=${labels.close} on:click=${closeDialog}>×</button>
        </header>
        <div data-ui="modal-body">
          <div data-ui="relation-dialog-toolbar">
            <input data-ui="form-control" type="search" value=${query()} autocomplete="off" placeholder=${labels.search} aria-label=${labels.search} on:input=${searchManager}>
            ${manager?.saveFunction ? html`<button data-ui="action" data-variant="primary" type="button" on:click=${() => editor.set({ id: '', row: manager.saveDefaults ?? {} })}>${labels.create}</button>` : ''}
          </div>
          ${error() ? html`<aside data-ui="notice" data-tone="danger" role="alert"><div data-ui="notice-copy"><p data-ui="notice-title">${labels.loadError}</p><p data-ui="notice-message">${error()}</p></div><button data-ui="action" data-variant="secondary" type="button" on:click=${loadRows}>${labels.retry}</button></aside>` : ''}
          ${editor() ? editorForm() : ''}
          ${loading() ? html`<p data-ui="relation-empty" role="status">${labels.loading}</p>` : ''}
          ${
            !loading() && !editor()
              ? rows().length
                ? html`<ul data-ui="relation-dialog-list">${each(rows(), rowId, managerRow)}</ul>`
                : html`<p data-ui="relation-empty">${labels.noRecords}</p>`
              : ''
          }
        </div>
      </section>
    </div>
  `

  const handleKeydown = (event) => {
    if (event.key !== 'Escape') return
    open.set(false)
    closeDialog()
  }

  const handleInvalid = (event) => {
    event.preventDefault()
    open.set(true)
    event.currentTarget.nextElementSibling?.focus()
  }

  return {
    view: () => html`
      <div data-ui="relation-select" on:keydown=${handleKeydown}>
        <select
          data-ui="relation-native"
          name=${config.name}
          required=${config.required === true}
          disabled=${config.disabled === true}
          tabindex="-1"
          aria-hidden="true"
          on:invalid=${handleInvalid}
        >
          <option value="" selected=${!chosen().length}></option>
          ${
            multiple
              ? // One option carrying the joined ids, so `required` still refuses an
                // empty field and the value survives `readForm` intact.
                chosen().length
                ? html`<option value=${chosen().join(',')} selected>${chosen().map(labelOf).join(', ')}</option>`
                : ''
              : each(
                  options().filter((entry) => string(entry.value)),
                  (entry) => entry.value,
                  (entry) =>
                    html`<option value=${entry.value} selected=${string(entry.value) === selected()}>${entry.label}</option>`,
                )
          }
        </select>
        <button
          data-ui="relation-trigger"
          data-empty=${String(!chosen().length)}
          type="button"
          aria-haspopup="listbox"
          aria-label=${config.ariaLabel}
          aria-expanded=${String(open())}
          aria-controls=${`${props.id}-relation-menu`}
          aria-required=${config.required === true ? 'true' : null}
          disabled=${config.disabled === true}
          on:click=${() => open.set(!open())}
        >
          <span data-ui="relation-value">${multiple ? labels.choose : selectedLabel()}</span>
          <span aria-hidden="true">⌄</span>
        </button>
        ${
          multiple && chosen().length
            ? html`<ul data-ui="relation-chips" aria-label=${labels.chosen}>
                ${each(
                  chosen(),
                  (value) => value,
                  (value) =>
                    html`<li data-ui="relation-chip"><span>${labelOf(value)}</span><button data-ui="relation-chip-clear" type="button" aria-label=${`${labels.clear}: ${labelOf(value)}`} title=${labels.clear} disabled=${config.disabled === true} on:click=${() => unchoose(value)}>×</button></li>`,
                )}
              </ul>`
            : ''
        }
        ${
          open()
            ? html`<div data-ui="relation-menu" id=${`${props.id}-relation-menu`}>
                <input data-ui="relation-search" type="search" value=${query()} autocomplete="off" placeholder=${labels.search} aria-label=${labels.search} on:input=${(event) => query.set(event.currentTarget.value)}>
                <div data-ui="relation-options" role="listbox">
                  ${
                    filteredOptions().length
                      ? each(
                          filteredOptions(),
                          (entry) => entry.value,
                          (entry) =>
                            html`<button data-ui="relation-option" type="button" role="option" data-selected=${String(isChosen(entry.value))} aria-selected=${String(isChosen(entry.value))} on:click=${() => choose(entry.value, entry.label, entry.description)}><span>${entry.label}</span>${entry.description ? html`<small>${entry.description}</small>` : ''}</button>`,
                        )
                      : html`<p data-ui="relation-empty">${labels.noRecords}</p>`
                  }
                </div>
                <footer data-ui="relation-footer">
                  <button data-ui="action" data-variant="tertiary" type="button" on:click=${openDialog}>${labels.more}</button>
                </footer>
              </div>`
            : ''
        }
        ${dialog() ? dialogView() : ''}
      </div>
    `,
    dispose: () => {
      disposed = true
      clearTimeout(searchTimer)
      activeRequest?.abort()
    },
  }
}
