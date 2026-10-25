# Datadog Smart Menu - Chrome Extension (Manifest V3)

**Datadog Smart Menu** is a modern Chrome extension that automatically filters the Datadog HQ navigation menu based on each user's **real RBAC permissions**, making Datadog easier to adopt for non-expert end users.

---

## 🌟 Key Features

1. **🔐 Permission-Based Filtering (Auto Mode)**:
   - On every Datadog page load, the extension calls the Datadog API (`/api/v2/current_user`) to read the session's real RBAC permissions.
   - Permissions are mapped to sidebar menus via an ordered mapping table covering the [official Datadog permission list](https://docs.datadoghq.com/account_management/rbac/permissions/) (~300 permissions).
   - Unauthorized menus are hidden or collapsed — end users simply see fewer options.

2. **👤 Role-Based Configuration (Admin Only)**:
   - Identified admins (`org_management`, `user_access_manage` or an admin role) get an **Admin configuration** section in the popup where they can load any **Datadog role's permissions** by name.
   - The extension fetches `/api/v2/roles/{id}/permissions` and builds the filtered menu from it.
   - Non-admin users never see configuration options.

3. **🔍 Quick Command Palette (`Ctrl + M` / `Cmd + M`)**:
   - Opens an instant search modal to jump directly to any authorized menu without cluttering the sidebar.

4. **⚡ Grayed-out or Full Hide Mode**:
   - Option to hide 100% of unnecessary menus or collapse them into a grayed-out folder.

---

## 🚀 Installation Guide for Chrome / Brave / Edge

1. **Download / Clone the repository**.

2. **Open the extensions page**:
   In your Chrome or Chromium browser, go to:
   `chrome://extensions/` (or `edge://extensions/`)

3. **Enable Developer Mode**:
   Toggle the **"Developer mode"** switch at the top right.

4. **Load the extension**:
   - Click the **"Load unpacked"** button.
   - Select the project folder (or `dist/` after running `npm run build`).

5. **Use the extension**:
   - Pin the 🐶 icon to the Chrome toolbar.
   - Open [app.datadoghq.com](https://app.datadoghq.com): filtering is applied automatically based on your permissions.
   - Admins can open the popup → *Admin configuration* to apply a specific role's permissions.

---

## ⚙️ How Filtering Works

| Mode | Active profile | Source of truth |
|------|----------------|-----------------|
| Auto (default for end users) | `custom` | Real session permissions from `/api/v2/current_user` |
| Role-based (admin) | `custom` | Permissions fetched from a named role via the Roles API |
| Unfiltered | `all` | Nothing is hidden (default until detection succeeds, or on failure) |

- If permission detection fails, nothing is forced: menus stay unfiltered rather than guessing.
- The command palette only lists menus allowed by the active mode.

### Menu ↔ permission mapping

All definitions live in [`shared/menu-definitions.js`](shared/menu-definitions.js):

- Each navbar link is matched by its **URL** (longest path prefix wins: `/logs/archive-search` → *Log Archives*, `/logs` → *Logs*). Link text is never used.
- A menu is allowed when the user has **at least one** of its permissions. Names are exact; a trailing `*` is a prefix (`logs_*` matches `logs_read_data`, not `audit_logs_read`).
- Menus with `permissions: null` (Data Observability, Personal/Organization Settings, Marketplace) have no dedicated RBAC permission and are never hidden.
- When every link of a navbar section or top-level entry is hidden, the section or entry is hidden too.

Datadog's own navbar already hides a few entries itself (for example *Monitoring* without `monitors_read`, *SLOs* without `slos_read`, *Dashboards* without `dashboards_read`, *Notebooks* without `notebooks_read`, *APM Traces* without `apm_read`). Most other entries are only gated by feature flags, which is what this extension complements.

---

## 📂 Project Structure

```text
datadog-smart-menu/
├── manifest.json            # Chrome Manifest V3 configuration
├── README.md                # User documentation
├── background/
│   └── background.js        # Service worker: state, badge, Roles API fetching
├── content/
│   ├── content.js           # DOM injection in Datadog + permission detection + Palette (Ctrl+M)
│   └── content.css          # Filtering and modal styles
├── shared/
│   ├── menu-definitions.js  # Menus, navbar URLs and permission mapping (single source of truth)
│   └── profiles.js          # ES module re-export + default settings
├── popup/
│   ├── popup.html           # Toolbar popup (status, toggles, admin configuration)
│   ├── popup.css            # Popup styles & Datadog theme
│   └── popup.js             # Popup controller with admin gating & role loading
├── scripts/
│   ├── build.js             # Build script (copies sources to dist/)
│   └── preview-menu.js      # Playwright preview of the filtered navbar for a role
├── test/
│   ├── menu-definitions.test.js
│   └── fixtures/            # Datadog navbar links + official permissions/managed roles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🛠️ Development

```bash
npm run build   # Rebuild dist/ from sources
npm test        # Check menu/permission mapping against the real navbar links and official permissions
npm run test:e2e  # Build, then run the real extension in headless Chromium against a navbar fixture (needs `npx playwright install chromium`)
```

Preview the filtered navbar on a saved Datadog page (*Save page as…* in Chrome), with a managed role or an explicit permission list:

```bash
npm run preview -- --html datadog.html --role "Datadog Read Only Role" --verbose
npm run preview -- --html datadog.html --perms logs_read_data,dashboards_read
```

Reload the extension in `chrome://extensions/` after each build.

Both test suites run in GitHub Actions on every pull request (`.github/workflows/ci.yml`).

### Navbar sync from a Datadog test account

The tests use `test/fixtures/datadog-nav-links.json`, a copy of the Datadog navbar. The **Datadog navbar sync** workflow (`.github/workflows/navbar-sync.yml`, Mondays and on demand) logs in to a test account with Playwright, captures the navbar as rendered and opens a pull request when it changed. Unknown links make `npm test` fail on that pull request.

Use a dedicated test account with the **Datadog Admin Role**: Datadog hides some entries itself when permissions are missing, and the capture only sees what the account sees (including the org's feature flags). No personal data is written: the user menu is renamed and the capture is refused if an e-mail address remains.

Authentication, by preference:

1. **Saved session** (works with SSO, 2FA and reCAPTCHA). Log in once by hand, then store the session as the `DD_STORAGE_STATE_B64` secret. Refresh it when the workflow reports that the session expired.

   ```bash
   npm run capture:navbar -- --login --save-state .auth/datadog.json
   base64 -w0 .auth/datadog.json
   ```

2. **Login form**: secrets `DD_TEST_USERNAME`, `DD_TEST_PASSWORD` and optionally `DD_TEST_TOTP_SECRET` (base32 authenticator secret). Datadog may answer with a reCAPTCHA from CI runners, in which case use a saved session.

Set the `DD_SITE` repository variable when the account is not on the EU site. It takes the usual Datadog site name (`datadoghq.com`, `us3.datadoghq.com`, …) or an app URL. Locally:

```bash
npm run capture:navbar -- --state .auth/datadog.json    # live capture with a saved session
npm run capture:navbar -- --from-html datadog.html      # from a page saved with "Save page as..."
```

### RBAC audit: which permissions each page really needs

`npm test` checks that the extension applies its menu ↔ permission table, not that the table matches Datadog. The audit measures the real requirements on a **dedicated test organization** and writes `audit/route-permissions.json`; `test/rbac-matrix.test.js` then compares the extension with it on minimal counterexamples and 5,000 random custom roles, and fails on any link shown to a user who would get a 403, or hidden from a user who can open it.

How the audit works: it creates a temporary role, gives it to a test user (their other roles are removed for the run and restored at the end, also on Ctrl+C or with `--restore`), starts from an empty role and opens every navbar page as the test user. Datadog's 403 responses do not name the missing permission, so for each denied page the audit grants all candidate permissions (the menu's permissions and their documentation group), finds the necessary ones by halving (remove half of the candidates; if the page breaks, split that half again), counter-checks each of them, and looks for "one of these" permissions that complete them. A page still denied with every candidate is retried with every permission of the organization, which reveals permissions outside the extension's table. With `--verify-mapping`, it also tries each permission a menu accepts alone on that menu's pages.

Datadog applies a role change to API calls tens of seconds after showing it in the session, so the audit waits `--settle` seconds (default 30, 60 for the first change) after each change. Expect about 25 minutes for `--only /logs` and several hours for the whole navbar: run it area by area with `--only`. Progress is saved after each step: if a run stops (network change, Ctrl+C), rerun the same command with `--resume` to keep the pages already solved. Network errors and Datadog rate limits are retried automatically.

Requirements, all in the test organization:

- a **non-admin** test user, and its browser session: `npm run capture:navbar -- --login --save-state .auth/audit-user.json` (log in as that user);
- admin `DD_API_KEY` / `DD_APP_KEY` allowed to manage roles, and `DD_SITE` if not `datadoghq.eu`.

```bash
npm run audit:rbac -- --user-id <test user uuid>                       # dry run: read-only checks and plan
npm run audit:rbac -- --user-id <uuid> --apply --allowed-org <public_id> --verify-mapping
npm test                                                               # now also runs the random-role comparison
```

The script refuses to change anything without `--apply` and an `--allowed-org` equal to the organization's public ID, when the saved session belongs to another user, or when the test user is an admin. **Never run it on a production organization.** A page counts as denied when one of its API calls answers 403 or it shows a "no permission" message; pages denied without naming a permission are reported as `unknown`.

Without Datadog's *Minimal Access Roles* feature, some restricted permissions cannot be removed from any role. The audit keeps them as a baseline (`baselinePermissions` in the matrix), and the comparison adds them to every random role, as every user of that organization holds them.
