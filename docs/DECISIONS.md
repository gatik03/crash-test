# Decisions

| Date       | Decision                                                                                                | Reason                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 2026-11-07 | Repo owner `gatik03`, license MIT, copyright holder "Gatik (gatik03)".                                  | Answers PRD 13 Q4.                                                                             |
| 2026-11-07 | Node 22 LTS, ESM (`"type": "module"`) everywhere.                                                       | Matches local runtime and Render; Vite and Fastify are ESM-first.                              |
| 2026-11-07 | `packages/shared` is compiled with `tsc` to `dist/`; root `typecheck`, `test` and `dev` build it first. | Apps import it by package name, so a clean clone needs `dist/` before typechecking or testing. |
| 2026-11-07 | TypeScript pinned to 6.0.x, not 7.x.                                                                    | typescript-eslint 8.72 supports `<6.1`. Revisit when it supports 7.                            |
| 2026-11-07 | `allowBuilds: esbuild` in `pnpm-workspace.yaml`.                                                        | pnpm 12 blocks install scripts by default; Vite and tsx need esbuild's binary.                 |
| 2026-11-07 | Server split into `app.ts` (builds the Fastify app) and `index.ts` (listens).                           | Tests call `app.inject()` without opening a port.                                              |
