# Contributing

## Development setup

Use Node.js 22 or newer and npm.

```powershell
npm ci
npm test
npm run build
```

Run the local app with `npm run dev -- --host 127.0.0.1`. The current browser app is a local-storage starter; do not describe it as a multi-user production system unless the backend, authentication, authorization, backups, and delivery workflows have been implemented and reviewed.

## Changes

- Keep document totals and date behavior covered by tests in `src/domain.test.mjs`.
- Preserve the distinction between browser-local behavior and server-side integrations.
- Use isolated test fixtures and mocked external services; do not send real messages as part of automated tests.
- Do not commit `.env` files, tokens, private keys, customer exports, backups, screenshots, or generated build output.
- Never put service-role credentials, LINE secrets, or other private keys in `VITE_*` variables or browser code.
- Keep user-facing integration status accurate; a reference adapter or schema is not a connected service.

Before opening a pull request, run `npm test` and `npm run build`, then describe the user-visible change, validation performed, and any setup that remains for the reviewer.
