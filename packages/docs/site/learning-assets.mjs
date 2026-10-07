import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'

// Explicit roots prevent dependencies, build output, credentials and lab databases entering downloads.
export function prepareLearningDownloads(pages) {
  const lessons = pages
    .filter((page) => page.kind === 'learn' && page.slug !== 'index')
    .sort((a, b) => a.order - b.order)
  mkdirSync('tutorials/api/lessons', { recursive: true })
  for (const lesson of lessons) {
    writeFileSync(`tutorials/api/lessons/${lesson.slug}.md`, readFileSync(`content/learn/${lesson.slug}.md`))
  }
  writeFileSync(
    'tutorials/api/course.json',
    JSON.stringify(
      lessons.map((lesson) => ({
        slug: lesson.slug,
        title: lesson.title,
        stage: lesson.metadata.stage,
        duration: lesson.metadata.duration,
        lab: lesson.metadata.lab,
        order: lesson.order,
        url: `https://ketjs.dev${lesson.route}`,
      })),
      null,
      2,
    ) + '\n',
  )
  mkdirSync('public/learn/downloads', { recursive: true })
  const projects = [
    {
      source: 'tutorials/view',
      name: 'learn-view',
      roots: [
        'README.md',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'ket-view.config.ts',
        'src',
        'public',
        '.gitignore',
      ],
    },
    {
      source: 'tutorials/api',
      name: 'learn-api',
      roots: [
        'README.md',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'ket.workspace.ts',
        'body.ts',
        'biome.json',
        'modules',
        'test',
        'tools',
        'lessons',
        'course.json',
        '.gitignore',
      ],
    },
  ]
  for (const project of projects) {
    const files = {}
    const add = (relative) => {
      for (const entry of readdirSync(join(project.source, relative), { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Learning downloads must not contain symlinks')
        const child = join(relative, entry.name)
        if (entry.isDirectory()) add(child)
        else files[`${project.name}/${child}`] = readFileSync(join(project.source, child))
      }
    }
    for (const root of project.roots) {
      if (['src', 'public', 'modules', 'test', 'tools', 'lessons'].includes(root)) add(root)
      else files[`${project.name}/${root}`] = readFileSync(join(project.source, root))
    }
    if (project.name === 'learn-api') {
      // The downloaded project is standalone; the repository fixture is nested.
      const config = JSON.parse(files['learn-api/biome.json'].toString())
      files['learn-api/biome.json'] = new TextEncoder().encode(
        JSON.stringify({ ...config, root: true }, null, 2) + '\n',
      )
    }
    writeFileSync(
      `public/learn/downloads/${project.name}.zip`,
      zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') }),
    )
  }
}
