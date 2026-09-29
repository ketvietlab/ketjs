import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { ContentCard, Disclosure, Grid, Metric, Section, Stack, Surface } from '../layouts/index.tsx'
import { Field } from '../primitives/field.tsx'
import { Notice } from '../primitives/feedback.tsx'
import { DataTable } from '../patterns/data-table.tsx'
import { ModalSheet } from '../patterns/modal-sheet.tsx'
import { RecordForm } from '../patterns/record-form.tsx'
import { DescriptionList } from '../record/display/index.tsx'

export const layeringPresentations = ['default', 'grouped'] as const

const rows = [
  { id: 'serum', name: 'Serum 30ml', range: '35–55 days' },
  { id: 'cream', name: 'Cream 50g', range: '45–75 days' },
]

const table = (title?: string): TemplateResult => (
  <DataTable
    title={title}
    rows={rows}
    id={(row) => row.id}
    columns={[
      { key: 'name', label: 'Product', cell: (row) => row.name },
      { key: 'range', label: 'Reference range', cell: (row) => row.range },
    ]}
  />
)

const fields = (prefix: string): TemplateResult => (
  <Grid
    columns={2}
    items={[
      <Field id={`${prefix}-name`} label="Name" name="name" value="Barrier repair" />,
      <Field id={`${prefix}-start`} label="Start date" name="start" type="date" value="2026-09-01" />,
    ]}
  />
)

/** One form, drawn in a wide surface and in a record-aside-sized column (LAYOUT.md L7). */
const noteForm = (prefix: string): TemplateResult => (
  <RecordForm
    action="#layering"
    submitLabel="Save"
    fields={[
      { id: `${prefix}-subject`, name: 'subject', label: 'Subject', value: 'Follow-up call', span: 'full' },
      { id: `${prefix}-note`, name: 'note', label: 'Note', type: 'textarea', value: '', span: 'full' },
    ]}
  />
)

/** Tags a specimen so the browser check can find it; the tag carries no style. */
const Case = (props: { name: string; body: JSXChild }): TemplateResult => (
  <div data-layering-case={props.name}>{props.body}</div>
)

/**
 * LAYOUT.md L1–L2 on one page: every container on the canvas and again inside a
 * white region, so the browser check can compare the two by computed style.
 */
export const LayeringPreview = (props: {
  presentation: (typeof layeringPresentations)[number]
}): TemplateResult => (
  <div
    data-kv-design-system
    data-theme="light"
    data-presentation={props.presentation === 'grouped' ? 'grouped' : null}
    style="padding: 12px; background: var(--kv-page-bg)"
  >
    <Stack
      items={[
        <Case name="canvas-surface" body={<Surface title="On the canvas" body={fields('layering-1')} />} />,
        <Case name="wide-form" body={<Surface title="A wide form" body={noteForm('layering-wide')} />} />,
        <Case
          name="narrow-form"
          body={
            <div style="max-inline-size: 20rem">
              <Surface title="A narrow column" body={noteForm('layering-narrow')} />
            </div>
          }
        />,
        <Case name="canvas-table" body={table('Titled table on the canvas')} />,
        <Case name="canvas-metric" body={<Metric label="Open" value={12} />} />,
        <Case
          name="surface-in-surface"
          body={
            <Surface
              title="Outer surface"
              body={
                <Surface
                  title="Nested surface"
                  description="Renders as a section."
                  body={fields('layering-2')}
                />
              }
            />
          }
        />,
        <Case
          name="modal"
          body={
            <ModalSheet
              id="layering-modal"
              mode="embedded"
              title="Routine"
              closeLabel="Close"
              size="large"
              body={
                <Stack
                  items={[
                    <Notice title="Reference only" message="Ranges never create a schedule." tone="info" />,
                    <Case name="modal-table" body={table('Products from the order')} />,
                    <Case name="modal-untitled-table" body={table()} />,
                    <Case
                      name="modal-surface"
                      body={<Surface title="Routine" body={fields('layering-3')} />}
                    />,
                    <Case
                      name="modal-well"
                      body={<Surface tone="subtle" body={<p>Customer said the serum stings.</p>} />}
                    />,
                    <Case
                      name="modal-section"
                      body={<Section title="Next care" body={fields('layering-4')} />}
                    />,
                    <Case
                      name="modal-divided"
                      body={
                        <Stack
                          divided
                          items={[
                            <Section title="Outcome" body={<p>Reached the customer.</p>} />,
                            <Section title="Product feedback" body={<p>Serum suits her skin.</p>} />,
                          ]}
                        />
                      }
                    />,
                    <Case
                      name="modal-disclosure"
                      body={<Disclosure summary="More detail" body={fields('layering-5')} />}
                    />,
                    <Case name="modal-metric" body={<Metric label="Uses a day" value={2} />} />,
                    <Case
                      name="modal-card"
                      body={<ContentCard title="Serum 30ml" summary="An object keeps its boundary." />}
                    />,
                    <Case
                      name="modal-strip"
                      body={
                        <DescriptionList
                          layout="strip"
                          items={[
                            { id: 'due', label: 'Due', value: '03/09 09:00' },
                            { id: 'sla', label: 'SLA', value: 'Overdue' },
                            { id: 'owner', label: 'Owner', value: 'Ngoc Anh' },
                          ]}
                        />
                      }
                    />,
                  ]}
                />
              }
            />
          }
        />,
      ]}
    />
  </div>
)
