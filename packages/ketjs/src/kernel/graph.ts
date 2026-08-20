import { KetError } from './errors.ts'
import type { KetModule } from '../types.ts'

export function topoSort(modules: KetModule[]): KetModule[] {
  const byName = new Map<string, KetModule>()
  for (const module of modules) {
    if (byName.has(module.name)) {
      throw new KetError({
        code: 'E_MODULE_NAME_CLASH',
        module: module.name,
        message: `more than one module is named "${module.name}"`,
        hint: 'module names are deployment-wide identities; remove or rename one implementation',
      })
    }
    byName.set(module.name, module)
  }
  for (const m of modules) {
    for (const d of m.depends) {
      if (!byName.has(d)) {
        throw new KetError({
          code: 'E_MISSING_DEPENDENCY',
          module: m.name,
          message: `module "${m.name}" depends on "${d}", which is not installed`,
          hint: `add "${d}" to the app's module list, or remove it from ${m.name}.depends`,
        })
      }
    }
  }

  const state = new Map<string, 0 | 1 | 2>()
  const out: KetModule[] = []
  const stack: string[] = []

  const visit = (name: string): void => {
    const s = state.get(name) ?? 0
    if (s === 2) return
    if (s === 1) {
      const cycle = [...stack.slice(stack.indexOf(name)), name].join(' -> ')
      throw new KetError({
        code: 'E_DEPENDENCY_CYCLE',
        message: `dependency cycle: ${cycle}`,
        hint: 'break the cycle by moving the shared piece into a third module both can depend on',
      })
    }
    state.set(name, 1)
    stack.push(name)
    const mod = byName.get(name) as KetModule
    // sorted for determinism: the same input always produces the same manifest
    for (const d of [...mod.depends].sort()) visit(d)
    stack.pop()
    state.set(name, 2)
    out.push(mod)
  }

  for (const m of [...modules].sort((a, b) => a.name.localeCompare(b.name))) visit(m.name)
  return out
}
