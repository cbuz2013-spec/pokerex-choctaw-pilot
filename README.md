# PokerEx 1.1.1 — Choctaw Pilot

Poker Executives branding, room channels, private direct messages, and the fixes from the PokerEx 1.0 audit.

## Included

- Event dates save and reload correctly. Background refresh preserves unsaved settings, event details, and selected dealers.
- Room chat: General, manager-created channels, private conversations between two active room participants, message history, safe retry, and per-conversation drafts. Channel access is confined to the room; direct-message access is confined to the participants, including when a manager is signed in.
- Transactional scheduling: competing pickups cannot overwrite approved assignments; cancelled shifts cannot return through stale approvals.
- Atomic roster/schedule imports with strict dates, times, dealer identifiers and identity-conflict checks. Renames update legacy name-based operational records in the same transaction.
- Owner-specific sessions, access revocation, and consistent selected-role checks.
- Validated clocks and geofences, room-timezone daily hours, stable join-request IDs, visible refresh failures, and in-page confirmations.
- Existing EO, scheduling, swaps, timekeeping, down-card import/report, roster imports, broadcasts and operational notifications.

## QA repair release

See **UPGRADE_1.1.1.md** for the QA fixes, owner PIN rotation requirement, AI billing dependency, scheduler requirements and remaining physical-device checks.

## Upgrade

Use **UPGRADE_1.1.md** for the existing PokerEx installation. Run **MIGRATION_PokerEx_1.1.sql** against the same database, then deploy the package contents. Existing owners must sign in again because old owner sessions did not identify the individual owner.

Use `schema.sql` only for a fresh database. Existing credentials and notification environment variables stay in the hosting environment; no secrets are included in this package.

## Verification

`npm test` runs 56 automated checks. `npm run verify:serve` starts a disposable local database and test server; AI and push are simulated. See **RELEASE_NOTES_1.1.md** for results and remaining device checks.

Chat supports text channels and direct messages. Attachments, voice/video, reactions, read receipts and chat-specific background push are outside this version. Existing operational and manager-broadcast notifications remain available.
