import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { describedBy, FieldFrame, issueFor } from '../shared.tsx'
import type { FieldIssue } from '../shared.tsx'

export const HOOKS = [
  'file-upload',
  'drop-zone',
  'upload-status',
  'image-drop-zone',
  'image-drop-preview',
  'image-drop-actions',
  'image-drop-picker',
  'image-drop-help',
  'image-drop-error',
] as const

export type DropZoneProps = FileUploadProps

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

const uploadControl = (props: FileUploadProps, error: string | null, drop: boolean): TemplateResult => (
  <div data-ui={drop ? 'drop-zone' : 'file-upload'}>
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
      aria-describedby={describedBy(props.id, props.help, error)}
    />
    {props.status !== undefined && <div data-ui="upload-status">{props.status}</div>}
  </div>
)

const renderUpload = (props: FileUploadProps, drop: boolean): TemplateResult => {
  const error = props.error ?? issueFor(props.issues, props.name)
  return (
    <FieldFrame
      {...props}
      kind={drop ? 'drop-zone' : 'file-upload'}
      error={error}
      control={uploadControl(props, error, drop)}
    />
  )
}

export const FileUpload = (props: FileUploadProps): TemplateResult => renderUpload(props, false)
export const DropZone = (props: DropZoneProps): TemplateResult => renderUpload(props, true)

/** Image-only upload surface. The record adapter owns commands and file events;
 * this component owns the thumbnail, hidden native picker and inline actions. */
export const ImageDropZone = (props: {
  label: string
  viewer?: JSXChild | null
  picker?: JSXChild
  actions?: JSXChild
  help?: string | null
  error?: string | null
  busy?: boolean
  dragging?: boolean
}): TemplateResult => (
  <div
    data-ui="image-drop-zone"
    role="group"
    aria-label={props.label}
    aria-busy={props.busy === true}
    data-drag={props.dragging ? 'true' : null}
  >
    <div data-ui="image-drop-preview">{props.viewer ?? <span>{props.label}</span>}</div>
    {(props.picker || props.actions) && (
      <div data-ui="image-drop-actions">
        {props.picker}
        {props.actions}
      </div>
    )}
    {props.help && <small data-ui="image-drop-help">{props.help}</small>}
    {props.error && (
      <small data-ui="image-drop-error" role="alert">
        {props.error}
      </small>
    )}
  </div>
)
