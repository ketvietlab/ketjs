---
title: KetJS — Composable TypeScript framework (Preview)
description: Evaluate KetJS, a TypeScript framework for composable modules, checked contracts, reactive islands and durable jobs. Explore the preview docs and examples.
eyebrow: COMPOSE MORE. COUPLE LESS.
headline: The fullstack framework
accent: that fits together.
command: npx -y @ketvietlab/ketjs@latest new my_app
choiceTitle: One contract across your application.
choiceIntro: A router or a UI library solves one part of the stack. KetJS is useful when reusable business modules need their data, permissions, routes and background work to stay aligned.
reasons:
  - title: Catch composition errors before requests arrive
    description: The build composes one manifest and rejects missing dependencies and unpublished extension points. You can inspect what each deployment actually contains.
    href: /docs/workspaces/
    link: Inspect application composition
  - title: Keep rules at the operation boundary
    description: Declare validation, effects and permissions alongside business functions. HTTP routes and agent calls invoke those operations through the framework runtime.
    href: /docs/functions/
    link: Read the function contract
  - title: Start with fewer services to operate
    description: SQLite handles local data and durable jobs. Add the PostgreSQL adapter when you need it; the built-in job queue does not require a separate Redis service.
    href: /docs/jobs/
    link: Understand durable jobs
  - title: Choose just the rendering layer
    description: Use ketjs-view independently for TSX, signals, SSR, static sites or client rendering. Install the server framework only when you need its application contracts.
    href: /docs/view-static-sites/
    link: Build with ketjs-view alone
fitTitle: A good fit for modular business applications.
fitDescription: Evaluate KetJS when building tenant-aware tools, operational workflows, reusable feature modules or agent-accessible business operations. This site itself uses the standalone rendering layer and static generation.
fitLimit: KetJS is still a preview for evaluation and feedback. APIs and data formats can change before 1.0, and production workloads are not recommended yet. If you need a mature ecosystem and long-term compatibility today, weigh that requirement before adopting it.
features:
  - title: Modules with real boundaries
    description: Compose features through published extension points. Catch missing dependencies before serving requests.
    href: /docs/modules/
    visual: modules
  - title: HTML first. Islands when needed.
    description: Render on the server, hydrate only interactive regions, and update the DOM with signals.
    href: /docs/rendering/
    visual: islands
  - title: One manifest. The whole application.
    description: Models, routes, permissions, jobs, and agent capabilities share a checked contract.
    href: /docs/workspaces/
    visual: manifest
  - title: Business logic you can enforce
    description: Explicit effects, validation, and permissions put boundaries around every operation.
    href: /docs/functions/
    visual: effects
  - title: Work that survives a restart
    description: Transactional jobs, worker leases, and retries. SQLite or PostgreSQL. No Redis required.
    href: /docs/jobs/
    visual: jobs
  - title: Ready for agents
    description: Expose declared capabilities with opt-in dry runs and idempotency. Keep domain rules in charge.
    href: /docs/functions/#permissions-and-agents
    visual: agents
---
Build modular TypeScript applications with data, permissions, web UI and jobs that share a checked contract. Start with SQLite, compose reusable features, or use ketjs-view on its own for a static site.
