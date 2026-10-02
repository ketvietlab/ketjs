# Embedded LiveDoc images

`createLiveDocView` exposes `prepareImageInsertion()` for local documents. Call before opening an
upload picker; invoke the returned callback with `{src, alt}` after the attachment upload completes.
The callback inserts a native image block and a following paragraph at the captured block anchor.
It returns false for readonly/non-local/disposed controllers and non-canonical attachment URLs.
The host owns permission checks, upload progress, MIME/size validation, storage scanning and saving.
Images round-trip through `getValue().blocks`, Yjs snapshot, local loading and `documentHtml`.
Only `/files/{id}` URLs render; alt text is escaped. No arbitrary HTML or data URLs are accepted.

Website Studio integration lives in the separate ketviet `feat/website` worktree. Its renderer can
bundle this source with the explicit `KET_WEBSITE_LIVEDOC_SOURCE` development override. This branch
has not been committed or released; do not claim the capability is present in the pinned package.

Toolbar integration: supply `onImageRequest(insert, trigger)` to mount the native image icon beside
Table. The core captures the insertion anchor before opening the host dialog. `imageDisabled` disables
the action until an owner has been saved. The host restores focus to `trigger` on cancel/close.

Local image blocks are selectable. Width (20–100 percent) and alignment persist in the native block
model, and readonly rendering respects them. Pointer resizing previews width without transactions on
every movement; pointerup commits once and pointercancel restores the starting width. The accessible
range input is the keyboard alternative. Removal deletes a block, not an attachment. The host's
revision-aware attachment lifecycle remains responsible for eventual object cleanup.

Embedded writable editors normalize each completed transaction to retain an empty final paragraph.
Loading an image-only saved draft also restores that typing target. Normalization waits for IME
composition to finish, does not accumulate placeholders when already empty, and does not mutate
readonly or collaborative remote documents.
