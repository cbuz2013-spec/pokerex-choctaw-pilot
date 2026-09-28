# Choctaw pilot checklist — PokerEx 1.0

This release is built for the test. Complete these live checks before relying on it for room operations.

## Deployment and recovery

- [ ] Create separate PokerEx GitHub, Neon and Vercel projects; record the new production URL and leave DealerFlow available.
- [ ] Run schema.sql in the NEW empty Neon database; complete the initial owner setup, private PINs and real pilot room from PILOT_SETUP.md.
- [ ] Back up/branch the PokerEx database before loading real pilot data and record its working Vercel deployment for recovery.
- [ ] Verify PokerEx 1.0 branding, real owner access and manager access on the deployed site.
- [ ] Import push settings and confirm the scheduler completes every minute.
- [ ] Keep an owner/admin recovery contact and know how to roll back the app.
- [ ] Test existing CSV exports for schedules/hours/downs where available; keep a separate schedule export/source file. Agree a manual correction/reconciliation procedure for records that have no manager edit screen.
- [ ] Confirm only intended accounts know owner/manager PINs. Do not use the demo credentials for live pilot accounts.

## Real event configuration

- [ ] Set event title, event dates, room name, tables, breaks, brushes and setup positions.
- [ ] Confirm America/Chicago time zone for Choctaw shift reminders.
- [ ] Load roughly 75 real dealers with correct unique three-digit numbers and names.
- [ ] Set up the intended owner and 8–10 managers; test temporary PIN change and reset/recovery.
- [ ] Import the real schedule, verify changes, dates/start times and no duplicate assignments.
- [ ] Confirm EO priority policy with management. The inherited rule groups by scheduled start and uses completed hours before today's date; confirm whether earlier same-day shifts should also count before pilot use.

## Notifications — use real phones with the app closed

- [ ] iPhone Home Screen installation, permission, enable/disable and test notification.
- [ ] Android installation/browser notification permission where available.
- [ ] Dealer EO alert.
- [ ] Shift posted → all dealers notified.
- [ ] Shift accepted → requester notified; manager approval-needed alert.
- [ ] Shift starts in roughly 15 minutes, using the room time zone and scheduler.
- [ ] Clock-out summary.
- [ ] Manager broadcast → intended active roster receives it.
- [ ] Manager targeted message → selected dealers receive it; others do not.
- [ ] Check sent history, sender, recipients and timestamps.
- [ ] Log out or change account on a shared phone; verify the previous account's messages do not appear afterward.
- [ ] Repeat after device/browser restart, weak connectivity and temporary loss of signal.

## Down cards and reporting

- [ ] Test actual handwritten event/table/date headers and every signed dealer row.
- [ ] Test handwritten numbers, names/times, crooked photos and poor lighting.
- [ ] Correct uncertain rows, add a missed row and leave unwanted rows unapproved.
- [ ] Import once, then upload the same card again; totals must not double.
- [ ] Check overlap with an existing manual down.
- [ ] Compare dealer/date totals and event totals with an independently counted sample.
- [ ] Open the source-card audit and CSV in the spreadsheet tool used by the room.
- [ ] Confirm leading-zero dealer numbers and zero-count event dates survive export.

## Core workflows

- [ ] Dealer clock-in/out and daily hours, including shifts crossing midnight.
- [ ] Manager clock-in/out and backdated correction procedure.
- [ ] Optional geofence on actual property devices.
- [ ] EO order, removal/cancellation, manager action and dealer notification.
- [ ] Two dealers post/accept a swap, manager approves and schedule updates correctly.
- [ ] Owner room/manager management and dealer privacy.
- [ ] Phone navigation: EO, Schedule, Swaps, Time, Downs, Room, Reports, Down Cards, Down Report and manager Messages as appropriate to role. Bottom navigation scrolls horizontally.

## Simulated shift

- [ ] Run a 2–3 hour practice event with 8–12 test users.
- [ ] Clock in, join/send EO, post/accept a swap, broadcast a message, upload cards, review totals and clock out.
- [ ] Record failures and expected recovery actions. Confirm staff can continue manually if connectivity fails.
- [ ] Have the pilot owner approve the results before the full Choctaw test.

## Later release

After the PokerEx 1.0 Choctaw pilot, build the separate DealerFlow-branded **DealerFlo6.2** release from this tested base. That branding release has not been created or deployed here.
