// Form-specific composition; the shared resource controller owns drafts, revisions and mutations.
import { html } from '@ketvietlab/ketjs-view'
import {
  WorkspacePage,
  ModalSheet,
  Surface,
  Stack,
  Grid,
  TextField,
  TextArea,
  Select,
  Checkbox,
  Button,
  LinkButton,
  Notice,
  Disclosure,
  DataTable,
  EmptyState,
} from '@ketvietlab/design-system'
import { h, CommandButton } from '../ui.mjs'
import { ArchiveActions } from '../archive-actions.mjs'
import { formFields } from '../content-schema.mjs'

export function formEditorView(ctx, data, schema, rows, refreshDraft) {
  const tr = ctx.tr
  const disabled = !ctx.can(schema.capability)
  const control = (name) => {
    const field = schema.fields.find((field) => field.name === name)
    const props = {
      id: `form-editor-${name}`,
      name,
      label: tr(field.label),
      required: field.required,
      value: data[name] ?? field.defaultValue ?? '',
      disabled,
    }
    if (field.kind.startsWith('select:')) {
      const values = field.kind.slice(7).split(',')
      return h(Select, {
        ...props,
        value: data[name] ?? values[0],
        options: values.map((value) => ({
          value,
          label: tr(
            name === 'active'
              ? value === 'yes'
                ? 'website.form.active'
                : 'website.form.inactive'
              : `website.option.${value}`,
          ),
        })),
      })
    }
    return h(field.kind === 'area' ? TextArea : TextField, props)
  }
  const destination = data.destinations?.length
    ? h(Select, {
        id: 'form-editor-destination',
        name: 'destination',
        label: tr('website.resource.form-editor.destination'),
        value: data.destination ?? '',
        disabled,
        options: [{ value: '', label: tr('website.formDesign.destinationNone') }, ...data.destinations],
      })
    : null
  const fields = formFields(data.schema)
  const previewBody = (prefix) =>
    html`<div class="website-form-preview">${h(Stack, {
      items: fields.length
        ? [
            ...fields.map((field) =>
              field.type === 'checkbox'
                ? h(Checkbox, { id: `preview-${prefix}-${field.id}`, label: field.label, disabled: true })
                : h(field.type === 'textarea' ? TextArea : TextField, {
                    id: `preview-${prefix}-${field.id}`,
                    label: field.label,
                    required: field.required,
                    type: ['email', 'tel', 'number'].includes(field.type) ? field.type : 'text',
                    disabled: true,
                  }),
            ),
            data.consentLabel
              ? h(Checkbox, { id: `preview-${prefix}-consent`, label: data.consentLabel, disabled: true })
              : null,
            h(Button, { label: tr('website.formJourney.send'), disabled: true, variant: 'primary' }),
          ]
        : [h(EmptyState, { title: tr('website.formDesign.noFields') })],
    })}</div>`
  const preview = h(Surface, {
    title: tr('website.formDesign.preview'),
    description: tr('website.formDesign.previewHelp'),
    actions: CommandButton({
      label: tr('website.formDesign.updatePreview'),
      command: 'resource.form-editor.reorder',
      type: 'submit',
      form: 'resource-form-editor',
      disabled: ctx.busy() || disabled,
    }),
    body: previewBody('desktop'),
  })

  return h(WorkspacePage, {
    layout: 'flow',
    variant: 'operational',
    title: data.title || tr('website.formDesign.create'),
    actions: html`<span class="website-form-preview-toggle" on:click=${async (event) => {
      const opener = event.target.closest('button[name="website-form-preview-open"]')
      if (!opener || ctx.busy()) return
      event.preventDefault()
      const doc = opener.ownerDocument
      if (!disabled) await refreshDraft(new FormData(doc.getElementById('resource-form-editor')))
      const dialog = doc.getElementById('website-form-preview-dialog')
      if (!dialog || dialog.open) return
      dialog.showModal()
      dialog.querySelector('[data-ui="modal-close"]')?.focus()
    }}>${h(Button, { label: tr('website.builder.preview'), name: 'website-form-preview-open', disabled: ctx.busy() })}</span>${h(LinkButton, { label: tr('website.resource.back'), href: ctx.href('forms') })}
      ${data.revisionId ? h(LinkButton, { label: tr('website.formDesign.responses'), href: ctx.href('submissions', { id: data.id }) }) : null}
      ${CommandButton({
        label: tr(data.revisionId ? 'website.formJourney.newVersion' : 'website.action.save'),
        command: 'resource.form-editor.save',
        type: 'submit',
        form: 'resource-form-editor',
        variant: 'primary',
        disabled: ctx.busy() || disabled,
      })}
      ${
        data.revisionId
          ? ArchiveActions(ctx, {
              id: 'resource-form-editor-archive',
              title: data.title,
              command: 'resource.form-editor.archive',
              disabled: ctx.busy() || disabled,
              usage: data.usage,
            })
          : null
      }`,
    body: h(Stack, {
      items: [
        html`<div class="website-form-workspace"><form id="resource-form-editor" data-reorder="resource.form-editor.reorder" novalidate>${h(
          Stack,
          {
            items: [
              h(Surface, {
                title: tr('website.formDesign.general'),
                body: h(Grid, { columns: 2, items: [control('title'), control('active')] }),
              }),
              html`<div class="website-form-authoring">${h(Surface, {
                title: tr('website.formDesign.fields'),
                description: tr('website.formDesign.fieldsHelp'),
                body: rows,
              })}</div>`,
              html`<div class="website-form-delivery">${h(Surface, {
                title: tr('website.formDesign.delivery'),
                description: destination ? tr('website.formDesign.destinationHelp') : undefined,
                body: h(Grid, {
                  columns: 2,
                  items: [
                    destination,
                    ...['recipient', 'spamProtection', 'successMessage', 'consentLabel'].map(control),
                  ]
                    .filter(Boolean)
                    .map((item) => html`<div class="website-form-field">${item}</div>`),
                }),
              })}</div>`,
            ],
          },
        )}</form><aside class="website-form-preview-column website-form-preview-desktop" aria-label=${tr('website.formDesign.preview')}>${preview}</aside></div>`,
        html`<dialog id="website-form-preview-dialog" class="website-confirm-dialog" aria-labelledby="website-form-preview-sheet-title"
          on:close=${(event) => event.currentTarget.ownerDocument.querySelector('[name="website-form-preview-open"]')?.focus()}
          on:click=${(event) => {
            if (event.target.closest('[data-ui="modal-close"], [data-ui="modal-backdrop"]'))
              event.currentTarget.close()
          }}>${h(ModalSheet, {
            id: 'website-form-preview-sheet',
            title: tr('website.formDesign.preview'),
            description: tr('website.formDesign.modalHelp'),
            closeLabel: tr('website.action.close'),
            mode: 'client',
            dialogSemantics: 'parent',
            presentation: 'dialog',
            body: html`<div class="website-form-preview-column">${previewBody('modal')}</div>`,
          })}</dialog>`,
        data.revisionId
          ? h(Surface, {
              tone: 'subtle',
              body: h(Disclosure, {
                summary: tr('website.formJourney.versions'),
                body: h(Stack, {
                  items: [
                    h(Notice, {
                      title: tr('website.formJourney.newVersion'),
                      message: tr('website.formJourney.versionHelp'),
                      tone: 'info',
                    }),
                    h(DataTable, {
                      rows: data.versions ?? [],
                      id: (row) => row.revisionId,
                      columns: [
                        {
                          key: 'revision',
                          label: tr('website.resource.revision'),
                          cell: (row) => row.revisionId,
                        },
                        { key: 'title', label: tr('website.entry.title'), cell: (row) => row.title },
                        {
                          key: 'fields',
                          label: tr('website.resource.itemCount'),
                          cell: (row) => formFields(row.schema).length,
                        },
                      ],
                    }),
                  ],
                }),
              }),
            })
          : null,
      ],
    }),
  })
}
