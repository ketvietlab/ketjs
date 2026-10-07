import assert from 'node:assert/strict'
import test from 'node:test'
import { fitDiagram, zoomDiagram, panDiagram, MIN_ZOOM, MAX_ZOOM } from '../site/diagram-camera.ts'

test('fit centers a tall or wide diagram inside the available canvas', () => {
  for (const drawing of [
    { width: 1600, height: 400 },
    { width: 200, height: 1400 },
  ]) {
    const viewport = { width: 360, height: 600 }
    const camera = fitDiagram(drawing, viewport)
    assert.ok(camera.x >= 16 && camera.y >= 16)
    assert.ok(camera.x + drawing.width * camera.scale <= viewport.width - 16)
    assert.ok(camera.y + drawing.height * camera.scale <= viewport.height - 16)
  }
})
test('zoom keeps the drawing point under the pointer stationary and clamps scale', () => {
  const camera = { x: 30, y: -40, scale: 0.5 },
    anchor = { x: 200, y: 100 }
  for (const factor of [2, 1000, 0.00001]) {
    const next = zoomDiagram(camera, factor, anchor)
    assert.ok(next.scale >= MIN_ZOOM && next.scale <= MAX_ZOOM)
    assert.equal((anchor.x - next.x) / next.scale, (anchor.x - camera.x) / camera.scale)
    assert.equal((anchor.y - next.y) / next.scale, (anchor.y - camera.y) / camera.scale)
  }
})
test('pan translates the camera without changing zoom or mutating the original', () => {
  const camera = { x: 30, y: -40, scale: 2 }
  assert.deepEqual(panDiagram(camera, { x: -70, y: 90 }), { x: -40, y: 50, scale: 2 })
  assert.deepEqual(camera, { x: 30, y: -40, scale: 2 })
})
