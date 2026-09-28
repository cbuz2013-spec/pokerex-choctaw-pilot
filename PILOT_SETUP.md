# PokerEx 1.0 — separate project deployment

This is a fresh PokerEx installation. Keep the existing DealerFlow GitHub repository, Neon project, Vercel project and URL available for DealerFlow. Use the proposed name `pokerex-choctaw-pilot` for all three new resources. Nothing online has been created by these instructions.

## 1. New GitHub repository

1. Extract `PokerEx-1.0-Choctaw-Pilot.zip` into a new folder.
2. Open https://github.com/new under your `cbuz2013-spec` account.
3. Repository name: `pokerex-choctaw-pilot`. Choose Private and initialize with a README so the upload controls are available. Create the repository.
4. Choose Add file → Upload files. Upload the CONTENTS of the extracted ZIP, including its folders. Replace the starter README with the supplied README. Commit to main.
5. Confirm `index.html`, `package.json`, `vercel.json`, `api/` and `lib/` appear directly at the repository root, not inside another folder. Include `.gitignore` and `.vercelignore`; enable Hidden items in File Explorer if needed.

Upload from the extracted ZIP, which excludes private files and node_modules. Do not upload the development folder's `.secrets` or any `.env` file.

## 2. New Neon database

1. Open https://console.neon.tech and choose New project/Create project.
2. Name it `pokerex-choctaw-pilot`. Use a region close to the Vercel functions (AWS US East/N. Virginia is suitable when functions use Washington, D.C.). Keep a supported default Postgres version and the default database name, usually `neondb`.
3. In this NEW project, open SQL Editor. Select its default branch and database.
4. Open the supplied `schema.sql`, copy the entire file, replace the editor's sample text and click Run. Clearing editor text only clears the draft query. Do not run a DROP/reset command. This full schema includes PokerEx 1.0; the upgrade-only migration is not needed for this fresh installation.
5. Click Connect. Select the same branch/database, enable Connection pooling and copy the PostgreSQL connection string. Copy only the value starting `postgresql://` or `postgres://`, without `psql`, quotes or `DATABASE_URL=`. Keep its SSL parameters. This will be the NEW Vercel project's DATABASE_URL.

This starts with fresh data. DealerFlow's roster, schedules and history are not copied automatically. No Neon Auth or Data API setup is required by this application.

## 3. New Vercel project and environment variables

1. Open https://vercel.com/rage-factory1 and choose Add New/Create New → Project.
2. Import `cbuz2013-spec/pokerex-choctaw-pilot`. If it is missing, use the GitHub integration's Configure access control to grant Vercel access to the new repository, then refresh.
3. Project name: `pokerex-choctaw-pilot` (or an available variation). Framework: Other. Root directory: repository root. Build Command: empty (enable its override and clear it if needed). Output Directory: `.`. Install Command: leave automatic. Use Node.js 22 or later.
4. Add the following Environment Variables for Production before clicking Deploy:

| Name | Value |
| --- | --- |
| DATABASE_URL | Connection string from the NEW PokerEx Neon project |
| OPENAI_API_KEY | Your saved valid OpenAI API key; a separate PokerEx key can be used for independent rotation |
| VAPID_PUBLIC_KEY | Matching value from the local private push settings file |
| VAPID_PRIVATE_KEY | Matching value from the local private push settings file |
| VAPID_SUBJECT | `mailto:` followed by your real contact email address |
| CRON_SECRET | Value from the local private push settings file |

The existing private push settings file is in the original workspace at:
`C:\Users\cbuz2\OneDrive\Desktop\DealerFlow\pokerex-v1.0-choctaw-pilot\.secrets\pokerex-vercel.env`

It contains these four values:

- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY
- VAPID_SUBJECT
- CRON_SECRET

Open that file privately in a text editor and copy each needed value into Vercel. If importing the whole file, override VAPID_SUBJECT with your contact email as above, since its original subject points to the previous pilot site. These keys were generated for PokerEx and have not been deployed by this build. If installing elsewhere without this private file, run `npm install` then `npm run setup-push -- --subject mailto:YOUR-EMAIL` to generate new settings. Keep the pair stable after phones register. The setup helper refuses to overwrite an existing file.

Do not upload private values to GitHub or send them in chat/screenshots. Keep any working OPENAI_DOWN_CARD_MODEL / OPENAI_SCHEDULE_MODEL override if needed. Vercel environment changes take effect on a new deployment. For later Preview tests, use an isolated test database.

5. Click Deploy and wait for Ready. Use Visit, then record the project's permanent production domain from Domains. Vercel may add a suffix if the proposed name is unavailable. Use this new URL for PokerEx testers.

## 4. First sign-in on a fresh database

The app initially has no room records. "Room not found" before this step is expected.

1. Open the new site and select Owner.
2. Organization code: `DEMO`. Initial owner PIN: `5555`. Click Owner Sign In once to create the starter organization and room `4271`.
3. In Owner management, add your own owner name with a private PIN. Refresh the owner dashboard if the starter Owner row is not yet visible, then disable the starter Owner account. Sign out and verify your new owner PIN works with organization code DEMO.
4. Use Create room / event for the real Choctaw pilot room, a room code of your choice (for example `4272`), and your real first manager with a private PIN. Archive the starter room `4271` so its displayed demo dealer/manager credentials cannot be used. Give testers the actual pilot room code.
5. Open the real room, configure event dates/resources/EO rules, import the roster and schedule, and verify America/Chicago in Messages. The actual pilot data starts here.

The starter credentials are built into the existing application. Complete this setup before sharing the URL or adding real operational data. The initial organization code remains DEMO; changing it is a separate configuration change.

## 5. Connect the notification scheduler

Use exactly one of these options:

### Current Vercel Hobby plan

Connect an HTTPS scheduler that can call your production endpoint every minute with a custom Authorization header:

- Method: GET
- URL: `https://YOUR-PRODUCTION-DOMAIN/api/notifications-cron`
- Header name: `Authorization`
- Header value: `Bearer YOUR_CRON_SECRET`
- Frequency: every minute

The secret is the CRON_SECRET from the private setup file. Keep it in the scheduler's secret/header settings, never in the URL. Only give this value to the scheduler you choose. The endpoint returns 401 without a valid secret, and 200 with completion statistics when authorized. Vercel's deployment protection, if enabled for the chosen URL, must also permit the scheduler's authenticated request; do not turn off protection merely to troubleshoot.

### Vercel plan with minute-level cron support

Replace vercel.json with the contents of deployment/vercel-with-minute-cron.json and redeploy to Production. Keep CRON_SECRET set. Vercel attaches its Authorization header automatically. The base package deliberately does not enable this schedule on Hobby.

In Messages → Notification setup, verify that Last completed stays recent. A configured secret alone does not mean a scheduler is running. With no scheduler, active app requests can still create reminders and drain pending delivery, but reminders/retries while everyone is offline are not guaranteed.

Vercel Hobby cron currently runs at most daily, so it cannot provide timely 15-minute shift reminders. Reference: https://vercel.com/docs/cron-jobs/usage-and-pricing

## 6. Phone setup and live push test

Log in to each dealer's own account on their own phone. On iPhone, use Safari → Share → Add to Home Screen; open PokerEx from that icon. On a supported Android browser, open the site or install it. In Time, tap Enable Notifications and allow permission. Then tap Test Notification. Log out on shared devices so the subscription is removed.

Next, close/background the app and send a targeted manager message. Verify only that dealer receives it. Test a broadcast, EO alert, posted/accepted swap, manager approval-needed alert, shift reminder and clock-out summary. A successful API request or a Sent counter is not enough to prove the phone displayed it.

Apple's guidance: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

## 7. Troubleshooting

- Push needs setup: check the matching public/private VAPID keys and subject, then redeploy.
- No device registered: enable notifications on the actual phone, not just on the manager computer.
- Permission denied: change notification permission in device/browser settings, then enable again.
- Scheduler not recent: inspect the scheduler response and Vercel function logs. Check the secret, frequency and room time zone.
- Failed push jobs: expired subscriptions are disabled; re-enable on the phone. Other permanent errors require corrected configuration and a new test notification. Transient errors retry through the scheduler.
- Missing down-card AI: verify OPENAI_API_KEY, API billing and the configured model. Review actual handwritten cards before using counts operationally.

Deployment references: https://vercel.com/docs/git and https://vercel.com/docs/builds/configure-a-build
Neon references: https://neon.com/docs/manage/projects and https://neon.com/docs/get-started/query-with-neon-sql-editor
