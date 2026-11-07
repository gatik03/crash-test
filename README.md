# Crash Test

Runs AI shopping agents through adversarial scenarios against a test merchant wired to PayPal sandbox, audits the real PayPal ledger with deterministic assertions, and reports a Trust Score.

> Status: early scaffolding (M0). See `PRD.md` and `ARCHITECTURE.md` for the full design.

## Requirements

- Node 22+
- pnpm (`corepack enable`)

## Commands

```sh
pnpm install
pnpm dev         # shared (watch) + server + web
pnpm build       # shared → server → web
pnpm start       # production server
pnpm lint        # eslint + prettier check
pnpm typecheck
pnpm test
```

Server health check: `GET http://localhost:3000/healthz`.

## License

MIT, see [LICENSE](LICENSE).
