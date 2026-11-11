# Repository guidance

## Purpose and structure

Grievance Insights is a single-organization pilot for browsing and analyzing Telugu citizen grievances and department responses. The implemented application is a React/TypeScript/Vite frontend with deterministic local processing. `src/` contains UI, domain, service, utility, and test code; `server/api.ts` supplies development/preview-only HTTP endpoints; `docs/` records architecture, decisions, and implementation status. Planned AWS services and AI integration are not implemented unless the status document says otherwise.

## Development environment

- Work in WSL under `~/src/grievance-insights`.
- Use Node.js 22 (minimum supported versions are Node 20.19 or 22.12) and install from the lockfile with `npm ci`.
- Standard checks: `npm run lint`, `npm test`, and `npm run build`.
- Run locally with `npm run dev`; preview a production build with `npm run preview`.

## Engineering conventions

- Preserve existing complaint browsing, import/export, search, deterministic summary, assistant, translation, and accessibility behavior.
- Keep complaint and response text distinct and source-grounded. A response is not proof of resolution; do not invent missing values, translations, status, or AI output.
- Treat grievance data and credentials as sensitive. Do not log record bodies, commit secrets, place long-lived credentials in browser code, or add AWS keys to GitHub Actions.
- Validate inputs at trust boundaries and keep APIs same-origin and authenticated when production endpoints are introduced.
- Prefer focused changes and existing dependencies. Avoid unnecessary refactoring, repeated investigation, unrelated edits, and generated build output in Git.

## Git and documentation

- Branch from `main` using a focused branch; do not commit directly to `main` or merge your own PR automatically.
- Use descriptive commits, run all checks before pushing, and keep PRs limited to one coherent task.
- Preserve unrelated worktree changes.
- Update `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_STATUS.md`, and `docs/DECISIONS.md` when architecture or implementation status materially changes. Clearly distinguish implemented behavior from proposals.
- The AI and HimParivar repositories are read-only references; never modify them as part of this project.
