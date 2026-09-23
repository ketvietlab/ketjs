import { each, type JSXChild, type TemplateResult } from '@ketvietlab/ketjs-view'
import { Button } from '../../primitives/actions/index.tsx'
import { reorderClick, reorderDragStart, reorderDragOver, reorderDrop } from './runtime.ts'

export const HOOKS = [
  'reorder-list',
  'reorder-list-value',
  'reorder-list-rows',
  'reorder-list-row',
  'reorder-list-content',
  'reorder-list-controls',
] as const
export type ReorderListProps = {
  id: string
  name: string
  label: string
  items: readonly { id: string; content: JSXChild }[]
  disabled?: boolean
  labels: { add: string; remove: string; up: string; down: string; drag: string; empty: string }
}
/** Editable content stays caller-owned; this control emits its ordered ids through a native change event. */
export const ReorderList = (props: ReorderListProps): TemplateResult => (
  // biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from native buttons, which already handle Enter and Space.
  <div
    id={props.id}
    role="group"
    aria-label={props.label}
    data-ui="reorder-list"
    onClick={reorderClick}
    onDragStart={reorderDragStart}
    onDragOver={reorderDragOver}
    onDrop={reorderDrop}
  >
    <input
      data-ui="reorder-list-value"
      type="hidden"
      name={props.name}
      value={JSON.stringify(props.items.map((item) => item.id))}
      disabled={props.disabled}
      autocomplete="off"
    />
    <ol data-ui="reorder-list-rows" aria-label={props.label}>
      {each(
        props.items,
        (item) => item.id,
        (item, index) => (
          <li data-ui="reorder-list-row" data-reorder-id={item.id}>
            <div data-ui="reorder-list-content">{item.content}</div>
            <div data-ui="reorder-list-controls">
              <span data-reorder-handle draggable={!props.disabled}>
                <Button
                  label={props.labels.drag}
                  size="compact"
                  variant="tertiary"
                  disabled={props.disabled}
                />
              </span>
              <span data-reorder-action="up">
                <Button
                  label={props.labels.up}
                  size="compact"
                  variant="tertiary"
                  disabled={props.disabled || index === 0}
                />
              </span>
              <span data-reorder-action="down">
                <Button
                  label={props.labels.down}
                  size="compact"
                  variant="tertiary"
                  disabled={props.disabled || index === props.items.length - 1}
                />
              </span>
              <span data-reorder-action="remove">
                <Button
                  label={props.labels.remove}
                  size="compact"
                  variant="tertiary"
                  disabled={props.disabled}
                />
              </span>
            </div>
          </li>
        ),
      )}
    </ol>
    {!props.items.length && <p>{props.labels.empty}</p>}
    <span data-reorder-action="add">
      <Button label={props.labels.add} size="compact" disabled={props.disabled} />
    </span>
  </div>
)
