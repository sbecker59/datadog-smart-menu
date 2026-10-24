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
```

Preview the filtered navbar on a saved Datadog page (*Save page as…* in Chrome), with a managed role or an explicit permission list:

```bash
npm run preview -- --html datadog.html --role "Datadog Read Only Role" --verbose
npm run preview -- --html datadog.html --perms logs_read_data,dashboards_read
```

Reload the extension in `chrome://extensions/` after each build.
