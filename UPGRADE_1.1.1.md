# PokerEx 1.1.1 QA repair release

Prepared September 29, 2026 from release commit `728725c71ff72cbc47628ab5ebaa2535a1528ac5`. These are source fixes; production deployment and device acceptance are separate steps.

## Changes

- Require event name, room name and ordered real calendar dates before saving. Preserve the existing dirty-form protection during background refresh; support change events on reviewed date/time fields.
- Reject duplicate or overlapping assigned shifts, including overnight overlap, imports, pickups, swap acceptance and manager approval. Multiple open staffing slots remain allowed.
- Require explicit next-day selection for overnight manual downs; persist that distinction. Reject malformed, equal and reversed same-day times.
- Validate CSV headers, names, dealer numbers, quoting and column counts before preview/import. Disable repeat submissions while saves are pending.
- Allow dealers to withdraw their own unresolved requests and managers to close open swaps. Withdrawal retains the shift assignment and creates an audit entry. The legacy request status is `denied`; the audit distinguishes withdrawal.
- Preserve failed down-card images for retry and explain AI credit, configuration and rate-limit failures without exposing provider details. Schedule extraction defaults to the image-capable `gpt-4.1-mini`, matching down-card extraction; environment overrides remain supported.
- Register the notification worker as a minute cron. Retain authenticated, idempotent notification processing.
- Remove public demo credentials from the login page. Disable automatic demo provisioning in production and reject the publicly exposed owner PIN and its existing sessions. Prevent disabling the final active owner.
- Delay report-download object URL cleanup so the browser can start the download.

## Deployment prerequisites — do these before promoting

1. In the existing owner dashboard, the account holder must replace the exposed owner PIN with a private PIN and verify a fresh owner login. This release deliberately rejects the published demo PIN, including old sessions. Deploying first would lock that owner out. No credential is included here or changed by the repair work.
2. Restore credits/billing for the configured AI provider and confirm the deployed key can access the selected model. Code cannot restore exhausted account credits. Official model reference: https://developers.openai.com/api/docs/models/gpt-4.1-mini .
3. Confirm the Vercel project supports minute cron execution and that `CRON_SECRET` and VAPID configuration are present. Hobby only supports daily cron, which is unsuitable for shift reminders; do not silently replace minute reminders with daily runs. Use an eligible plan or an already approved authenticated external scheduler. No plan upgrade or purchase is authorized by this package. Reference: https://vercel.com/docs/cron-jobs/usage-and-pricing .
4. Use the existing database and take a normal database snapshot before rollout. Do not run `schema.sql` against production. The idempotent startup migration adds `down_entries.ends_next_day BOOLEAN NOT NULL DEFAULT false`. It does not rewrite historical invalid or duplicate QA entries.
5. Deploy to an isolated preview with an isolated database first. Keep `POKEREX_ENABLE_DEMO` unset/false outside disposable tests. Promote only after owner login, saved dates and one real photo extraction pass. Ensure the first scheduled worker invocation is recorded.

## Verification and limits

The automated suites use disposable PostgreSQL-compatible PGlite databases with simulated provider and push responses. Run `npm ci`, then `npm test`; tests run sequentially to reduce memory pressure. Do not run the verification server concurrently on a memory-constrained computer.

The local browser verified manager login, event save, full refresh, persisted October 26–30 dates, and rejection of malformed CSV. No browser console errors were observed. Test credentials and mock AI in `tests/serve-fixture.mjs` are local-only and excluded from deployment.

Physical iPhone/Safari calendar interactions, real OS push delivery, live funded AI extraction and a production scheduler invocation still require acceptance testing. The original iPhone picker failure was not reproduced directly, so it is not claimed as conclusively fixed on that device. Existing production test records remain documented in the QA report; no historical punches, downs or shifts were deleted.

## Rollback

Retain the prior deployment and database snapshot. The new boolean column is additive, so an application rollback does not require dropping it. Keep the newly private owner PIN; never restore the public credential. A rollback also removes the new validation and withdrawal controls.
