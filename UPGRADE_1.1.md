# Upgrade existing PokerEx 1.0 to 1.1

This package upgrades the existing PokerEx app and database. It does not create a separate live project or deploy itself.

1. Keep the previous release and take a database backup/snapshot.
2. In the database used by the existing PokerEx production project, run `MIGRATION_PokerEx_1.1.sql`. It adds individual-owner session references and chat tables/indexes. It does not drop existing operational data. The migration is repeatable.
3. Upload the release ZIP's contents to the existing repository, preserving `api` and `lib`. The root contains `index.html`, `package.json`, `vercel.json`, and the new `drafts.js`, `chat.js`, and `chat.css` assets.
4. Keep existing database and notification environment settings. No new external chat service or credential is required.
5. Deploy using the existing project configuration. Confirm the app badge reads **1.1**.
6. Sign in again as Owner. Pre-upgrade owner sessions are rejected because they do not identify the individual owner. Dealers/managers may need to sign in again if credentials were reset.
7. Run the acceptance checks below with designated test accounts before inviting the pilot roster.

## Acceptance checks

- Enter event dates, wait through refreshes, save, reload, and verify both dates.
- Select a dealer under Create Shift, wait, and verify the selection remains.
- Exchange messages in General and a direct conversation. Verify a third account cannot see the private conversation.
- Create a room channel as a manager; verify another room cannot see it.
- Request one open shift from two dealers. Approve one; the competing request must no longer be approvable.
- Cancel a shift with an outstanding swap; it must stay cancelled.
- Try an invalid import and inspect the roster/schedule: no partial rows should have committed.
- Verify normal clocks, room timezone, daily hours, EO order, down-card import and CSV reports.
- Verify real-device notifications and GPS permissions separately. Local tests simulate AI/push delivery.

## Data already affected by older bugs

The code prevents the audited failures on new actions. It does not guess how to repair historical duplicate assignments, detached names, negative time entries or partial imports. Inspect affected records and correct them using a reviewed data repair if necessary.

## Rollback

Retain the database snapshot and previous package. The schema is additive, but rolling the app back also restores the old access-control and form defects. Rollback should be a deliberate operational decision.
