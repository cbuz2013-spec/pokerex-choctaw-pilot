# PokerEx 1.0 room buttons fix — 2026-09-28

The embedded browser reported `prompt() is not supported` for Add / Reset Manager and Delete on the deployed owner dashboard. These actions now use dialogs rendered inside the page. The related Owner Reset PIN, owner activation/deactivation, and room Archive/Restore confirmations use the same dialog component.

The forms mask and confirm PINs, require the exact room code before deletion, show server errors inside the dialog, prevent duplicate submission while saving, and allow cancellation before submission. Success feedback appears in the owner dashboard. No backend or database schema changes are required.

## Install on the manually managed deployment

Extract `PokerEx-1.0-Room-Buttons-Fix.zip`. Upload its three files (`index.html`, `pokerex.js`, `pokerex.css`) to the root of `cbuz2013-spec/pokerex-choctaw-pilot`, replacing the current versions. Commit to main. Wait for the linked Vercel deployment to reach Ready, then reload the PokerEx site. Existing rooms, roster, credentials and environment variables are preserved.

The full PokerEx release ZIP has also been refreshed. No live deployment was performed while preparing this fix.

## Verification

Verified using the Codex embedded browser against a local server with ephemeral PostgreSQL fixture data:

- Manager form opens, rejects mismatched PINs, and saves a new manager who can sign in.
- Resetting that manager's PIN allows the new PIN and rejects the previous one.
- Delete rejects an incorrect room code; Cancel retains the room.
- Exact-code deletion removes only the local fixture room and updates the dashboard.
- Archive and Restore update the fixture room and dashboard.
- Trying to disable the last owner shows the server's error inside the dialog and re-enables the buttons.
- Owner PIN reset saves and the new PIN signs in.
- No JavaScript console errors in the local test; both changed scripts parse.

No live rooms were deleted, archived or changed during verification. Other unrelated browser prompts elsewhere in the legacy application are outside this fix.
