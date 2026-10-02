import {
  WorkspacePage,
  ModalSheet,
  Surface,
  Stack,
  Grid,
  Field,
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
import type { FieldOption } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view/jsx-runtime'
import { CommandButton } from '../ui.tsx'
import { ArchiveActions } from '../archive-actions.tsx'
import { formFields } from '../content-schema.ts'
import { resourceValue } from '../resources.ts'
import type { ResourceRecord, ResourceSchema } from '../resources.ts'
import type { StudioContext } from '../types.ts'

/** A form as the editor reads it: its fields, where submissions go, and its published versions. */
type FormRecord = ResourceRecord & {
  destinations?: FieldOption[]
  destination?: string
  consentLabel?: string
  versions?: { revisionId: string; title: string; schema: { fields?: unknown } | null }[]
}

export function formEditorView(
  ctx: StudioContext,
  data: FormRecord,
  schema: ResourceSchema,
  rows: JSXChild,
  refreshDraft: (form: FormData) => Promise<void>,
) {
  const tr = ctx.tr
  const disabled = !ctx.can(schema.capability)
  const control = (name: string) => {
    // The form editor's schema names every control this view places.
    const field = schema.fields.find((field) => field.name === name)!
    const props = {
      id: `form-editor-${name}`,
      name,
      label: tr(field.label),
      required: field.required,
      value: resourceValue(data[name]) ?? field.defaultValue ?? '',
      disabled,
    }
    if (field.kind.startsWith('select:')) {
      const values = field.kind.slice(7).split(',')
      return (
        <Select
          {...props}
          value={resourceValue(data[name]) ?? values[0]}
          options={values.map((value) => ({
            value,
            label: tr(
              name === 'active'
                ? value === 'yes'
                  ? 'website.form.active'
                  : 'website.form.inactive'
                : `website.option.${value}`,
            ),
          }))}
        />
      )
    }
    return field.kind === 'area' ? <TextArea {...props} /> : <TextField {...props} />
  }
  const destination = data.destinations?.length ? (
    <Select
      id="form-editor-destination"
      name="destination"
      label={tr('website.resource.form-editor.destination')}
      value={data.destination ?? ''}
      disabled={disabled}
      options={[{ value: '', label: tr('website.formDesign.destinationNone') }, ...data.destinations]}
    />
  ) : null
  const fields = formFields(data.schema)
  // The preview stands outside the form and is disabled; its names only label the controls.
  const previewBody = (prefix: string) => (
    <div class="website-form-preview">
      <Stack
        items={
          fields.length
            ? [
                ...fields.map((field) => {
                  const props = {
                    id: `preview-${prefix}-${field.id}`,
                    name: `preview-${prefix}-${field.name}`,
                    label: field.label,
                    disabled: true,
                  }
                  if (field.type === 'checkbox') return <Checkbox {...props} />
                  if (field.type === 'textarea') return <TextArea {...props} required={field.required} />
                  return (
                    <Field
                      {...props}
                      required={field.required}
                      type={
                        (['email', 'tel', 'number'] as const).find((type) => type === field.type) ?? 'text'
                      }
                    />
                  )
                }),
                data.consentLabel ? (
                  <Checkbox
                    id={`preview-${prefix}-consent`}
                    name={`preview-${prefix}-consent`}
                    label={data.consentLabel}
                    disabled
                  />
                ) : null,
                <Button label={tr('website.formJourney.send')} disabled variant="primary" />,
              ]
            : [<EmptyState title={tr('website.formDesign.noFields')} message="" />]
        }
      />
    </div>
  )
  const preview = (
    <Surface
      title={tr('website.formDesign.preview')}
      description={tr('website.formDesign.previewHelp')}
      actions={
        <CommandButton
          label={tr('website.formDesign.updatePreview')}
          command="resource.form-editor.reorder"
          type="submit"
          form="resource-form-editor"
          disabled={ctx.busy() || disabled}
        />
      }
      body={previewBody('desktop')}
    />
  )

  return (
    <WorkspacePage
      layout="flow"
      variant="operational"
      title={data.title || tr('website.formDesign.create')}
      actions={
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Delegates clicks from native buttons, which already handle Enter and Space. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from native buttons, which already handle Enter and Space. */}
          <span
            class="website-form-preview-toggle"
            onClick={async (event) => {
              const opener = (event.target as Element).closest('button[name="website-form-preview-open"]')
              if (!opener || ctx.busy()) return
              event.preventDefault()
              const doc = opener.ownerDocument
              if (!disabled)
                await refreshDraft(
                  new FormData(doc.getElementById('resource-form-editor') as HTMLFormElement),
                )
              const dialog = doc.getElementById('website-form-preview-dialog') as HTMLDialogElement | null
              if (!dialog || dialog.open) return
              dialog.showModal()
              dialog.querySelector<HTMLElement>('[data-ui="modal-close"]')?.focus()
            }}
          >
            <Button
              label={tr('website.builder.preview')}
              name="website-form-preview-open"
              disabled={ctx.busy()}
            />
          </span>
          <LinkButton label={tr('website.resource.back')} href={ctx.href('forms')} />
          {data.revisionId ? (
            <LinkButton
              label={tr('website.formDesign.responses')}
              href={ctx.href('submissions', { id: data.id })}
            />
          ) : null}
          <CommandButton
            label={tr(data.revisionId ? 'website.formJourney.newVersion' : 'website.action.save')}
            command="resource.form-editor.save"
            type="submit"
            form="resource-form-editor"
            variant="primary"
            disabled={ctx.busy() || disabled}
          />
          {data.revisionId
            ? ArchiveActions(ctx, {
                id: 'resource-form-editor-archive',
                title: data.title ?? '',
                command: 'resource.form-editor.archive',
                disabled: ctx.busy() || disabled,
                usage: data.usage,
              })
            : null}
        </>
      }
      body={
        <Stack
          items={[
            <div class="website-form-workspace">
              <form id="resource-form-editor" data-reorder="resource.form-editor.reorder" novalidate>
                <Stack
                  items={[
                    <Surface
                      title={tr('website.formDesign.general')}
                      body={<Grid columns={2} items={[control('title'), control('active')]} />}
                    />,
                    <div class="website-form-authoring">
                      <Surface
                        title={tr('website.formDesign.fields')}
                        description={tr('website.formDesign.fieldsHelp')}
                        body={rows}
                      />
                    </div>,
                    <div class="website-form-delivery">
                      <Surface
                        title={tr('website.formDesign.delivery')}
                        description={destination ? tr('website.formDesign.destinationHelp') : undefined}
                        body={
                          <Grid
                            columns={2}
                            items={[
                              destination,
                              ...['recipient', 'spamProtection', 'successMessage', 'consentLabel'].map(
                                control,
                              ),
                            ]
                              .filter(Boolean)
                              .map((item) => <div class="website-form-field">{item}</div>)}
                          />
                        }
                      />
                    </div>,
                  ]}
                />
              </form>
              <aside
                class="website-form-preview-column website-form-preview-desktop"
                aria-label={tr('website.formDesign.preview')}
              >
                {preview}
              </aside>
            </div>,
            // biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from the close button and backdrop; the native dialog closes on Escape.
            <dialog
              id="website-form-preview-dialog"
              class="website-confirm-dialog"
              aria-labelledby="website-form-preview-sheet-title"
              onClose={(event: Event) =>
                (event.currentTarget as Element).ownerDocument
                  .querySelector<HTMLElement>('[name="website-form-preview-open"]')
                  ?.focus()
              }
              onClick={(event) => {
                if ((event.target as Element).closest('[data-ui="modal-close"], [data-ui="modal-backdrop"]'))
                  (event.currentTarget as HTMLDialogElement).close()
              }}
            >
              <ModalSheet
                id="website-form-preview-sheet"
                title={tr('website.formDesign.preview')}
                description={tr('website.formDesign.modalHelp')}
                closeLabel={tr('website.action.close')}
                mode="client"
                dialogSemantics="parent"
                presentation="dialog"
                body={<div class="website-form-preview-column">{previewBody('modal')}</div>}
              />
            </dialog>,
            data.revisionId ? (
              <Surface
                tone="subtle"
                body={
                  <Disclosure
                    summary={tr('website.formJourney.versions')}
                    body={
                      <Stack
                        items={[
                          <Notice
                            title={tr('website.formJourney.newVersion')}
                            message={tr('website.formJourney.versionHelp')}
                            tone="info"
                          />,
                          <DataTable
                            rows={data.versions ?? []}
                            id={(row) => row.revisionId}
                            columns={[
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
                            ]}
                          />,
                        ]}
                      />
                    }
                  />
                }
              />
            ) : null,
          ]}
        />
      }
    />
  )
}
