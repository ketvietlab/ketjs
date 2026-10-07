export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Camera = Point & { scale: number }
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 8
const clamp = (scale: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale))

export function fitDiagram(drawing: Size, viewport: Size): Camera {
  const scale = clamp(
    Math.min(
      1,
      Math.max(1, viewport.width - 32) / drawing.width,
      Math.max(1, viewport.height - 32) / drawing.height,
    ),
  )
  return {
    scale,
    x: (viewport.width - drawing.width * scale) / 2,
    y: (viewport.height - drawing.height * scale) / 2,
  }
}

export function zoomDiagram(camera: Camera, factor: number, anchor: Point): Camera {
  const scale = clamp(camera.scale * factor)
  const ratio = scale / camera.scale
  return { scale, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio }
}

export function panDiagram(camera: Camera, delta: Point): Camera {
  return { ...camera, x: camera.x + delta.x, y: camera.y + delta.y }
}
