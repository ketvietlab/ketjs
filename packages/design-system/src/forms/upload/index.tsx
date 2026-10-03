import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { describedBy, FieldFrame, issueFor } from '../shared.tsx'
import type { FieldIssue } from '../shared.tsx'

export const HOOKS = [
  'file-upload',
  'drop-zone',
  'upload-preview',
  'upload-caption',
  'upload-status',
] as const

export type FileUploadProps = {
  id: string
  name: string
  label: string
  accept?: string
  multiple?: boolean
  required?: boolean
  disabled?: boolean
  help?: string | null
  error?: string | null
  issues?: readonly FieldIssue[]
  status?: JSXChild
  span?: 'half' | 'full'
}

export type DropZoneProps = FileUploadProps & {
  /** null reserves a square image frame before an image is selected. */
  preview?: { src: string; alt: string } | null
  /** The application drag runtime owns this state and upload transport. */
  dragging?: boolean
}

const uploadControl = (props: DropZoneProps, error: string | null, drop: boolean): TemplateResult => (
  <div
    data-ui={drop ? 'drop-zone' : 'file-upload'}
    data-preview={drop && props.preview !== undefined ? 'true' : null}
    data-drag={drop && props.dragging ? 'true' : null}
    data-disabled={props.disabled ? 'true' : null}
  >
    {drop && props.preview && (
      <img data-ui="upload-preview" src={props.preview.src} alt={props.preview.alt} />
    )}
    {drop && (
      <span data-ui="upload-caption" aria-hidden="true">
        {props.label}
      </span>
    )}
    <input
      data-ui="field-control"
      id={props.id}
      type="file"
      name={props.name}
      accept={props.accept}
      multiple={props.multiple === true}
      required={props.required === true}
      disabled={props.disabled === true}
      aria-invalid={error ? 'true' : null}
      aria-describedby={
        [describedBy(props.id, props.help, error), props.status !== undefined ? `${props.id}-status` : null]
          .filter(Boolean)
          .join(' ') || null
      }
    />
    {props.status !== undefined && (
      <div data-ui="upload-status" id={`${props.id}-status`}>
        {props.status}
      </div>
    )}
  </div>
)

const renderUpload = (props: DropZoneProps, drop: boolean): TemplateResult => {
  const error = props.error ?? issueFor(props.issues, props.name)
  return (
    <FieldFrame
      {...props}
      labelHidden={drop}
      kind={drop ? 'drop-zone' : 'file-upload'}
      error={error}
      control={uploadControl(props, error, drop)}
    />
  )
}

export const FileUpload = (props: FileUploadProps): TemplateResult => renderUpload(props, false)
export const DropZone = (props: DropZoneProps): TemplateResult => renderUpload(props, true)
