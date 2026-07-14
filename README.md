# Sully API Playground

Local browser workspace for exercising five Sully API workflows from one UI: live streaming, uploaded transcription, note generation, medical coding, and text-to-JSON.

The Sully API key stays in the local Node server. The browser receives a temporary streaming token and account ID when live transcription starts. Use synthetic or approved test data: submitted content still goes to the configured Sully API.

## Quick start

Requirements:

- Node.js 22 or newer
- pnpm 10.33.2 (pinned in `package.json`)
- Sully API key and account ID
- Chrome or Chromium for microphone streaming

```bash
pnpm install --frozen-lockfile
cp .env.example .env
chmod 600 .env
```

Edit `.env` without sharing or printing its contents:

```dotenv
SULLY_API_URL=https://api-testing.sully.ai
SULLY_API_KEY=your_api_key
SULLY_ACCOUNT_ID=your_account_id
```

Use `https://api.sully.ai` only when you intend to use production. `SULLY_API_URL` must be an exact approved origin—do not append `/v1` or `/v2`.

Start the playground:

```bash
pnpm start
```

`pnpm start` builds both browser and server code, listens on `127.0.0.1:3000`, and opens the new playground. Confirm readiness:

```bash
curl --fail --silent http://127.0.0.1:3000/health
```

Ready output is `{"ok":true,"missing":[],"invalid":[]}`. HTTP 200 alone is not readiness; the same endpoint returns `ok: false` plus credential *names* when setup is incomplete.

Agents can use the repo-local [`sully-api-demo-setup` skill](.agents/skills/sully-api-demo-setup/SKILL.md) for a non-destructive setup and verification pass.

## Workflows

| UI workflow | Local route | Sully route | Behavior | Output and handoff |
| --- | --- | --- | --- | --- |
| Live streaming | `POST /api/streaming-token` + WebSocket | `POST /v1/audio/transcriptions/stream/token` + `/v1/audio/transcriptions/stream` | Realtime microphone audio; temporary token; reconnect and explicit stop lifecycle | Interim/final transcript, optional word details |
| Uploaded transcription | `POST /api/transcriptions`, `GET /api/transcriptions/:id` | `POST /v2/audio/transcriptions`, `GET /v2/audio/transcriptions/:id` | Async upload and bounded polling | Transcript → note generation or coding |
| Note generation | `POST /api/notes`, `GET /api/notes/:id` | `POST /v1/notes`, `GET /v1/notes/:id` | Async note creation and bounded polling | Markdown/JSON note → coding |
| Medical coding | `POST /api/codings`, `GET /api/codings/:id` | `POST /v1/codings`, `GET /v1/codings/:id` | Async analysis and bounded polling | Diagnosis/procedure codes with source spans |
| Text to JSON | `POST /api/text-to-json` | `POST /v1/utils/text-to-json` | Synchronous structured extraction | Validated JSON object |

Each panel keeps request controls beside formatted and raw results. Outputs remain in browser memory only; only non-clinical streaming preferences persist in `localStorage`. Switching away from active streaming asks before stopping it.

Uploaded transcription accepts WAV, MP3, FLAC, OGG, WebM, MP4, M4A, AAC, and Opus files up to 100 MB. The bundled audio sample is synthetic. Uploaded files use a process-owned OS temporary directory. Removal is attempted before each response and again at graceful shutdown; a cleanup failure or process crash can leave a temporary file behind.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SULLY_API_URL` | Yes | — | Exact `https://api-testing.sully.ai` or `https://api.sully.ai` origin; loopback is allowed for local test doubles |
| `SULLY_API_KEY` | Yes | — | Server-side only |
| `SULLY_ACCOUNT_ID` | Yes | — | Server-side; account ID is included with the temporary streaming connection |
| `PORT` | No | `3000` | Integer from 1 through 65535 |
| `SULLY_DEMO_OPEN_BROWSER` | No | `true` | Exactly `true` or `false` |

Process environment variables override `.env`. Before switching accounts or environments, check whether credential variable *names* are already exported in your shell; never print their values.

## Commands

```bash
pnpm start             # build and run the omni browser playground
pnpm typecheck         # strict server and browser TypeScript checks
pnpm build             # build browser and server bundles
pnpm test              # unit then integration tests
pnpm test:e2e          # build and run Playwright browser tests
pnpm start:note        # legacy CLI note example
pnpm start:stream      # legacy CLI streaming example
```

Playwright tests need Chromium once per machine:

```bash
pnpm exec playwright install chromium
```

The two CLI scripts are retained as legacy examples, not the main demo. They can print transcript or note content, use older example flows, and do not offer the browser playground's full workflow coverage or privacy boundaries. Prefer `pnpm start`.

## Architecture and safety boundaries

- Browser: accessible five-tab TypeScript UI with keyboard navigation, live regions, cancellable polling, result copy, and workflow handoffs.
- Local server: loopback-only Express app, fixed static allowlist, same-local-origin checks, CSP, no-store API responses, bounded bodies, strict request validation, and stable safe errors.
- Sully client: fixed upstream route allowlist, exact approved origins, redirects disabled, timeouts/abort propagation, bounded response decoding, and response validation.
- Secrets: the API key never enters the browser; account ID and temporary token are supplied only at streaming runtime. Server logs request method, path, status, and request ID—not request bodies or credentials.
- Data: no application database. Clinical inputs/results remain in page memory and are transmitted upstream; uploaded audio also uses best-effort temporary disk storage.

This is a local development demo, not a production PHI handling system.

## Documentation review and gaps closed

Review against Sully's current API reference found the old repo centered on three legacy examples and mixed npm/Bun instructions, Node 18, four upload formats, placeholder test guidance, and host audio dependencies. Current implementation:

- makes the five requested workflows first-class in one browser UI;
- uses v2 create/get for uploaded transcription and current v1 routes for notes, coding, text-to-JSON, and streaming;
- models documented async status families independently (`pending`/`processing`/`completed`/`failed` versus note `STATUS_*` values);
- matches the documented 100 MB transcription limit and current upload formats;
- keeps durable credentials behind a local token-broker/proxy boundary;
- replaces setup ambiguity with pnpm/Node pins, real tests, `.env` diagnostics, and a repo-local setup skill.

Automated tests use a fake Sully upstream and mocked browser API responses; they do not prove a specific account's credentials, entitlements, billing, or current provider availability. A credentialed manual smoke test remains required for live-provider verification.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Setup required` | Read `/health`; add/fix only the named variables in `.env`, then restart |
| Correct `.env`, wrong account | Unset inherited `SULLY_API_URL`, `SULLY_API_KEY`, or `SULLY_ACCOUNT_ID` variables that override the file |
| Invalid API URL | Use an exact approved origin without path, query, credentials, or fragment |
| Microphone denied | Allow microphone access for `http://127.0.0.1:3000` or `http://localhost:3000` |
| Streaming disconnects | Check connection status; automatic reconnect is bounded, then start a new session |
| Upload rejected | Confirm extension and MIME type agree, file is non-empty, and size is at most 100 MB |
| Async timeout | Retry smaller input; transcription waits up to 15 minutes, notes/coding up to 5 minutes |
| Playwright lacks browser | Run `pnpm exec playwright install chromium` |

## Sully documentation

- [API reference v2](https://docs.sully.ai/api-reference-v2/)
- [Create uploaded transcription](https://docs.sully.ai/api-reference-v2/audio-transcriptions/create)
- [Get uploaded transcription](https://docs.sully.ai/api-reference-v2/audio-transcriptions/get)
- [Streaming](https://docs.sully.ai/api-reference/audio-transcriptions/streaming)
- [Supported transcription languages](https://docs.sully.ai/api-reference/audio-transcriptions/languages)
- [Clinical notes guide](https://docs.sully.ai/documentation/guides/clinical-notes)
- [Create coding](https://docs.sully.ai/api-reference/codings/create)
- [Get coding](https://docs.sully.ai/api-reference/codings/get)
- [Text to JSON](https://docs.sully.ai/api-reference/utils/text-to-json)
