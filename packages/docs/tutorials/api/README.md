# KetJS backend learning lab

A completed reference application for the [KetJS learning path](https://ketjs.dev/learn/).
Targets **KetJS 0.3.0 preview**, Node 24+, and native SQLite. APIs may change before 1.0.

## Start

```bash
# Run from: learn_api
npm ci
npm run learn -- doctor
npm run learn -- list
npm run learn -- lesson server-project
npm run learn -- serve
```

The local API binds to `127.0.0.1:3711`. Its development identity accepts `X-Ket-Company`
for learning; this is not a production authentication setup.

```bash
# Run from: learn_api
curl -H 'X-Ket-Company: lab' http://127.0.0.1:3711/api/todos
curl -i http://127.0.0.1:3711/api/todos \
  -H 'X-Ket-Company: lab' -H 'Content-Type: application/json' \
  --data '{"title":"Learn KetJS"}'
```

The response supplies the ID. PATCH `/api/todos/{id}` with `{"done":true}` to complete it.
The `learn_api.scheduleCompletion` function is available for queue exercises through the
framework's local development/test transport. Run its worker in a second terminal:

```bash
# Run from: learn_api
npm run learn -- worker
```

The HTTP and worker roles use `.ket/learn.db`. Stop a process with Ctrl+C.

## Checkpoints

```bash
# Run from: learn_api
npm run learn -- check api
npm run learn -- check isolation
npm run learn -- check jobs
npm run learn -- status
```

Each check compiles this project, starts an isolated test deployment and runs one explicit test
file. It does not need the development server and does not modify `.ket/learn.db`. Results are
stored in `.learn/progress.json`; status marks them stale when relevant source or lockfile changes.
No result is recorded when a command fails. These checks cover their named behavior, not every
lesson or a production certification.

`lesson <slug>` reads bundled Markdown. Later lessons include manual extension exercises for
sessions, grants, themes, storage, reports and PostgreSQL. Those integrations are not silently
included or simulated in this small baseline.

## Source map

- `ket.workspace.ts`: application composition, queue and HTTP facade.
- `modules/learn_api.ts`: scoped Todo model, functions and idempotent completion job.
- `body.ts`: bounded JSON parsing for the facade.
- `test/`: real HTTP, company isolation and worker checkpoints.
- `tools/learn.mjs`: local learning companion; delegates execution to KetJS tools.
- `lessons/` and `course.json`: course text and ordered curriculum.

The three tests use disposable SQLite databases. PostgreSQL exercises need a separately
configured disposable PostgreSQL deployment and their own verification.
