// @ts-nocheck Shared dependency-free browser/SSR product image upload control.
export function createProductMediaUploadView(runtime, props) {
  const { html } = runtime

  const upload = (event) => {
    if (!event.currentTarget.files?.length) return
    event.currentTarget.form?.requestSubmit()
  }

  return () => html`
    <form data-ui="media-upload" method="post" action=${props.action} enctype="multipart/form-data">
      <label data-ui="media-file-label">
        <span>${props.label}</span>
        <input
          data-ui="media-file-input"
          type="file"
          name="file"
          accept="image/*"
          required
          aria-label=${props.label}
          on:change=${upload}
        >
      </label>
    </form>
  `
}
