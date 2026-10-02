import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  ContentCard,
  Disclosure,
  Grid,
  Inline,
  KanbanCard,
  KanbanGrid,
  Metric,
  Section,
  Stack,
  Surface,
} from '../layouts/index.tsx'
import { SearchBar } from '../data-operations/list-controls/index.tsx'
import { Button, IconButton, LinkButton } from '../primitives/actions.tsx'
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

/** One form, drawn in a wide surface and in a record-aside-sized column (Két Design System visual contract L7). */
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

/** Bare fields stacked in a panel, with no record form around them (Két Design System visual contract L7). */
const panelFields = (prefix: string): TemplateResult => (
  <Stack
    items={[
      <Field id={`${prefix}-path`} label="Path" name="path" value="/en/careers" />,
      <Field id={`${prefix}-note`} label="Note" name="note" type="textarea" value="" />,
    ]}
  />
)

/** Tags a specimen so the browser check can find it; the tag carries no style. */
const Case = (props: { name: string; body: JSXChild }): TemplateResult => (
  <div data-layering-case={props.name}>{props.body}</div>
)

/**
 * Két Design System visual contract L1–L2 on one page: every container on the canvas and again inside a
 * white region, so the browser check can compare the two by computed style.
 */
export const LayeringPreview = (props: {
  presentation: (typeof layeringPresentations)[number]
}): TemplateResult => (
  <div
    data-kv-design-system
    data-theme="light"
    data-presentation={props.presentation === 'grouped' ? 'grouped' : null}
    style="padding: var(--kv-page-padding-x); background: var(--kv-page-bg)"
  >
    <Stack
      gap="loose"
      items={[
        <Section
          title="Nhịp và phân cấp của Két"
          description="Cùng vai trò, cùng khoảng cách ở mọi màn hình. Màu Két và icon Lucide được giữ nguyên."
          body={
            <Grid
              columns={3}
              items={[
                <Metric
                  label="Hành động liên quan"
                  value="8 px"
                  detail="Khoảng cách giữa các nút cùng nhóm."
                />,
                <Metric
                  label="Bên trong vùng làm việc"
                  value="16 px"
                  detail="Hàng form, nhóm nội dung, inset surface và modal; heading cách nội dung 8 px."
                />,
                <Metric
                  label="Button và input"
                  value="32 / 36 px"
                  detail="Cùng chiều cao: desktop 32 px, mobile 36 px. Button mặc định = Polaris large."
                />,
              ]}
            />
          }
        />,
        <Case
          name="dimensions"
          body={
            <Surface
              title="Kích thước Polaris · màu Két"
              description="Polaris React 13.9.5: chữ 13/20, input 32 px và button large 32 px trên desktop. Dưới 768 px: input 16/24 và cả hai cao 36 px. Density không làm lệch cặp nút–input."
              body={
                <Stack
                  items={(['default', 'compact', 'comfortable'] as const).map((density) => (
                    <div data-kv-design-system data-density={density} data-dimension-density={density}>
                      <Section
                        title={`Density: ${density}`}
                        body={
                          <Stack
                            items={[
                              <Inline
                                items={[
                                  <Field
                                    id={`dimension-${density}`}
                                    name="query"
                                    label="Tìm đơn hàng"
                                    labelHidden
                                    value="Đơn hàng tháng 10"
                                  />,
                                  <Button label="Tìm kiếm" variant="primary" />,
                                  <LinkButton label="Xuất dữ liệu" href="#dimensions" />,
                                  <Button label="Đã khóa" disabled />,
                                  <Button label="Đang lưu" loading />,
                                  <Button label="Prominent" size="prominent" />,
                                  <IconButton label="Thêm" icon="+" />,
                                ]}
                              />,
                              <Inline items={[<Button label="Compact · dùng riêng" size="compact" />]} />,
                              <SearchBar
                                action="#dimensions"
                                id={`dimension-search-${density}`}
                                label="Tìm kiếm"
                                submitLabel="Tìm"
                              />,
                            ]}
                          />
                        }
                      />
                    </div>
                  ))}
                />
              }
            />
          }
        />,
        <Case
          name="kanban-empty-lane"
          body={
            <Grid
              columns={2}
              items={[
                <Section
                  title="Assigned"
                  body={
                    <KanbanGrid
                      rows={[{ id: 'sample', title: 'Drag source' }]}
                      id={(row) => row.id}
                      dropTarget="assigned"
                      dropLabel="Assigned lane"
                      emptyLabel="Drop a card here"
                      card={(row) => <KanbanCard id={row.id} title={row.title} draggable href="#sample" />}
                    />
                  }
                />,
                <Section
                  title="Empty lane"
                  body={
                    <KanbanGrid
                      rows={[]}
                      id={() => ''}
                      dropTarget="empty"
                      dropLabel="Empty lane drop target"
                      emptyLabel="Drop a card here"
                      card={() => <></>}
                    />
                  }
                />,
              ]}
            />
          }
        />,
        <Case name="canvas-surface" body={<Surface title="On the canvas" body={fields('layering-1')} />} />,
        <Case
          name="single-column-form"
          body={
            <div style="max-inline-size: 32rem">
              <Surface
                title="One column, one label track"
                body={
                  <RecordForm
                    action="#layering"
                    submitLabel="Save"
                    fields={[
                      { id: 'rhythm-short', name: 'short', label: 'Customer', value: 'An Việt' },
                      { id: 'rhythm-full', name: 'full', label: 'Address', value: 'Thảo Điền', span: 'full' },
                    ]}
                  />
                }
              />
            </div>
          }
        />,
        <Case
          name="wide-form"
          body={<Surface title="A wide form · 24px column gap" body={noteForm('layering-wide')} />}
        />,
        <Case
          name="narrow-form"
          body={
            <div style="max-inline-size: 20rem">
              <Surface title="A narrow column" body={noteForm('layering-narrow')} />
            </div>
          }
        />,
        <Case
          name="narrow-panel"
          body={
            <div style="max-inline-size: 20rem">
              <Surface title="A side panel" body={panelFields('layering-panel')} />
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
          name="small-modal"
          body={
            <ModalSheet
              id="layering-small-modal"
              mode="embedded"
              presentation="dialog"
              size="small"
              title="Edit label"
              closeLabel="Close"
              body={fields('small-modal')}
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
