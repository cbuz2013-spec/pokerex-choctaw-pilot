# PokerEx 1.1 release notes

Built from the local PokerEx 1.0 source after the September 29 audit. The 1.0 source and previous ZIP were preserved. This release has not been deployed.

## Audit disposition

| Finding | 1.1 change |
|---|---|
| Unsaved forms reset | Dirty fields retain values and caret; refresh updates clean fields. Saves clear only submitted drafts. |
| Dealer selection resets | Selection survives refresh; unavailable dealers require a new selection. |
| Saved event dates disappear | Explicit calendar-date serialization; invalid/reversed ranges rejected. |
| Competing pickup approvals | Transaction/state checks; competing requests closed. |
| Cancelled shifts resurrected | Cancellation closes requests; stale approvals rejected. |
| Disabled owners stay logged in | Individual-owner sessions check active status; deactivation/PIN reset revokes sessions. |
| Negative/future clocks | Future timestamps, reversed intervals and overlapping backdated entries rejected. |
| Roster rename loses records | Operational references updated atomically. Chat uses stable identities. |
| Imports partially commit | Full-batch validation and rollback, including late identity conflicts. |
| Failed down clears entry | Draft clears only after success. |
| Impossible shift times | Shared strict validation for manual/imported shifts. |
| Blank geofence means zero | Blank/out-of-range coordinates rejected. |
| Missing number becomes 000 | Validate the original identifier before padding. |
| Dealer-mode manager can mutate settings | Check selected role and account permission. |
| Join approval uses list position | Stable IDs; requests resolve once. |
| Timezone inconsistency | Room timezone drives daily dates/hours; tests cover 23/25-hour DST days. |
| Silent refresh failure | Visible connection status preserves edits. |
| Embedded-browser prompts | In-page confirmations, PIN dialogs and error notices. |

Prior-hours EO ordering continues to use prior historical hours. Event scoping remains a business-rule question; this release does not silently change it. Historical bad data is not automatically rewritten.

## Chat

Room channels and private direct messages, history, per-conversation drafts, retry deduplication, room/participant authorization, active-user checks, send rate limiting and mobile layout. General is automatic; managers can create channels.

Direct messages are private between participants within the app. They are stored in the application database and are not end-to-end encrypted.

## Validation

- **43 automated tests passed**: existing down-card/notification suites plus audit regressions, chat authorization, deduplication, rollback and timezone boundaries.
- Browser verification passed for form preservation, saved-date reload, selected dealer, all feature tabs, channels, drafts, two-person DMs, third-user isolation, failed-down preservation, mobile width and no page script errors.
- Compatibility checks passed for owner/manager/dealer logins, normal schedules/swaps/EO/clocks, roster and temporary PIN flow, protected scheduler, broadcasts, dealer inbox isolation, down-card uploads, totals and CSV exports.

## Limits

Tests use disposable PGlite data. AI and push are simulated. Real PostgreSQL contention, deployed parity, phone push, GPS and handwriting recognition still require acceptance testing. Text chat refreshes every three seconds while open; chat-specific push, attachments and voice/video are not included.
