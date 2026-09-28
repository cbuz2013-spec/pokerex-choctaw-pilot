# PokerEx 1.0 — Choctaw Pilot

PokerEx 1.0 is the Poker Executives-branded pilot release. It builds on the complete DealerFlow 6.1 application. The later DealerFlow-branded release is planned as **DealerFlo6.2** and is not part of this package.

## Included

- Original Poker Executives logo, red/black styling, PokerEx name and 1.0 version.
- All existing roles, room/owner management, schedules/imports, EO, swaps, notifications, timekeeping, geofence option, room resources, manual downs, card uploads and reports.
- The term "downs" throughout the interface.
- Manager/owner Messages tab: broadcast to all active dealers or select named dealers, subject/body, recipient confirmation and sent-message history with frozen recipients.
- In-app inbox delivery plus background push for registered devices.
- Durable push queue, transient retries, expired endpoint cleanup, account/room isolation, request idempotency and delivery status. A push service accepting a message is not a read receipt.
- Enable, test and disable notifications on each device; Home Screen guidance for iPhone; web manifest and service worker.
- Validated VAPID configuration, device counts, queue counts and last scheduler run in the manager status panel.
- Protected server-side shift-reminder/retry endpoint. Room time zone defaults to America/Chicago and can be changed in Messages. Reminders no longer depend solely on the dealer keeping the app open, provided the scheduler is connected.

## Installation and deployment

Use Node.js 22+ and `pnpm install --frozen-lockfile` or `npm install`.

Start with **PILOT_SETUP.md** for a separate PokerEx GitHub repository, Neon project and Vercel project. Run **schema.sql** in the new database, then follow the first-owner setup instructions. This installation begins with fresh data and leaves the existing DealerFlow deployment available. **MIGRATION_PokerEx_1.0.sql** is only for upgrading an existing 6.0/6.1 database, not this new-project setup. Browser storage identifiers remain compatible with the previous version and are isolated by the new site's origin.

The release ZIP contains source files, dependencies metadata, migrations and tests. It excludes node_modules and secrets. Deploy the ZIP's extracted contents at the NEW repository root. No online projects, production deployments or database changes were performed while creating this build.

## Push setup

`npm run setup-push -- --subject https://YOUR-SITE.example`

This creates a private `.secrets/pokerex-vercel.env` with matching VAPID keys, subject and CRON_SECRET. Existing keys are preserved on repeat runs. The private setup file must stay out of GitHub and the release ZIP. Import its values into the NEW Vercel project, use your real `mailto:` contact for VAPID_SUBJECT, then deploy. The generated local file's original contact URL can be overridden without changing the key pair.

Shift reminders and unattended retries need a scheduler every minute. The included base vercel.json is compatible with the current Hobby plan: it does NOT pretend that a daily cron can send timely shift reminders. Use an external HTTPS scheduler with an Authorization header, or use the included minute-cron configuration on a Vercel plan that supports it. See PILOT_SETUP.md.

## Tests and limits

`npm test` runs 25 unit/database tests. `npm run verify:serve` starts a local-only verification server with ephemeral data and simulated AI/push. Never use the verification server as your production application. Production handlers do not import it; .vercelignore excludes tests.

Passed database tests cover migrations, down-card validation, duplicate/retry handling, rollback, source isolation, report totals/CSV, manager permissions, message audiences, frozen history, VAPID matching, private endpoint rejection, notification retries, expired devices, account reassignment, room-time-zone reminders and scheduler authentication.

Browser checks passed for manager broadcasts and targeted messages, owner sending, dealer inbox isolation, restored logins, mobile layouts, down-card imports and CSV totals. Existing schedule/swap/EO/time/import/login smoke tests passed through the full API handler.

External image reading and push transport were simulated. Real handwritten-card accuracy, closed-app phone delivery, production database concurrency, provider limits and scheduler cadence still need live pilot checks. Embedded PostgreSQL tests substitute advisory locks; they do not verify real multi-connection lock contention. Queued push delivery is at-least-once; notification tags reduce visible duplicates after retries.

Message history shows the latest 100 sends. Messages accept up to 1,200 characters, subject up to 100, with a byte-size check for push payloads. At most 10 manager messages per room per minute. Each worker invocation processes up to 100 device deliveries; additional work stays queued. Transient failures retry up to five attempts. An interrupted worker lease becomes eligible again after two minutes.

Down-card limits remain: 20 photos/1,000 approved rows per batch, 200 extracted rows per image, optimized images up to 1,800px, and 50,000 records/366 configured dates per report. Review selections remain browser-local until confirmed; source images and review snapshots are retained in PostgreSQL. Dealer imports use the existing roster; dealers cannot delete manager-imported downs.

See **CHOCTAW_PILOT_CHECKLIST.md** for remaining live testing.
