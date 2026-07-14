---
name: sully-api-demo-setup
description: Set up, verify, or troubleshoot this Sully API demo repository for a contributor. Use when asked to install dependencies, configure credentials, boot the omni playground, validate readiness, or prepare browser tests.
---

# Set up Sully API demo

Produce a safe, repeatable local setup without overwriting contributor state or exposing credentials.

## Guardrails

- Start at repository root. Inspect `package.json`, `.env.example`, and `.gitignore`; capture `git status --short --branch` before mutation for final comparison.
- Preserve unrelated/untracked files. Never reset, clean, stash, or stage contributor work.
- Never read, print, echo, diff, or log `.env` values. Report credential names only.
- Never overwrite an existing `.env`. If present, restrict it with `chmod 600 .env` without displaying it.
- Process environment overrides `.env`. Detect only whether `SULLY_API_URL`, `SULLY_API_KEY`, or `SULLY_ACCOUNT_ID` names are set; never display values.
- Use pnpm. Do not substitute npm, Bun, or Yarn.
- Boot `pnpm start`, the browser playground. Treat `start:note` and `start:stream` as legacy, privacy-weaker examples.
- Setup verification stops at local health and UI boot. Never infer authorization for a live provider request from a setup, boot, test, or demo deadline.
- Do not install system packages or Playwright browsers without explicit user authorization.

## Procedure

1. Confirm repository and toolchain:

   ```bash
   node --version
   pnpm --version
   git status --short --branch
   ```

   Require Node 22+ and pnpm 10.33.2 from `package.json`. If pnpm is unavailable, explain the pinned version and ask before enabling or installing package-manager tooling.

2. Install exact locked dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

3. Configure without overwriting:

   - If `.env` is absent, run `cp .env.example .env && chmod 600 .env`.
   - If `.env` exists, run only `chmod 600 .env`.
   - Ask contributor to edit missing credentials locally. `SULLY_API_URL` must be exact approved origin (`https://api-testing.sully.ai` for testing or `https://api.sully.ai` intentionally for production), without `/v1` or `/v2`.
   - Use a names-only check for inherited overrides:

     ```bash
     node -e 'for (const name of ["SULLY_API_URL","SULLY_API_KEY","SULLY_ACCOUNT_ID"]) if (Object.hasOwn(process.env,name)) console.log(`${name} is present in process environment and overrides .env`)'
     ```

4. Run non-live verification:

   ```bash
   pnpm typecheck
   pnpm build
   pnpm test
   ```

5. Boot canonical UI with browser auto-open disabled for deterministic verification:

   ```bash
   SULLY_DEMO_OPEN_BROWSER=false pnpm start
   ```

   Keep server running in one terminal. Use the loopback port reported by the `server_listening` event (default `3000`) to request `/health` and `/`; do not inspect `.env` to discover it. Parse health JSON: HTTP 200 with `ok: false` means server booted but API actions remain blocked. `ok: true` means configured. Report only `missing`/`invalid` variable names.

6. Stop server cleanly. Run `git status --short --branch` again and compare it with the captured baseline; investigate any new tracked or untracked path before claiming contributor state was preserved. Summarize tool versions, install/verification results, UI boot result, and health readiness. Distinguish these claims:

   - **Local boot verified:** root page and health endpoint respond.
   - **Configured:** health body has `ok: true`.
   - **Live provider verified:** only after an explicitly authorized credentialed workflow succeeds; setup alone never proves this.

   A later live-provider request requires separate explicit authorization plus confirmation of intended testing/production origin, intended account, approved synthetic/test input, and accepted API usage. Never use clinical or unknown-provenance data to satisfy setup verification.

## Optional browser tests

When user asks for full browser verification, run `pnpm test:e2e`. If Chromium is missing, ask before `pnpm exec playwright install chromium` because it writes outside repository and downloads a browser.

## Safety notes

- Use synthetic/approved test data. UI has no database, but submitted content goes to configured Sully API.
- Uploaded audio briefly uses OS temp storage and is removed after handled requests; crashes can leave a temporary file.
- Existing exported credentials may target a different account or environment than `.env`.
