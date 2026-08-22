# Datadog Smart Menu - Chrome Extension (Manifest V3)

**Datadog Smart Menu** is a modern Chrome extension that automatically filters the Datadog HQ navigation menu based on each user's **real RBAC permissions**, making Datadog easier to adopt for non-expert end users.

---

## 🌟 Key Features

1. **🔐 Permission-Based Filtering (Auto Mode)**:
   - On every Datadog page load, the extension calls the Datadog API (`/api/v2/current_user`) to read the session's real RBAC permissions.
   - Permissions are mapped to sidebar menus via an ordered mapping table covering the [official Datadog permission list](https://docs.datadoghq.com/account_management/rbac/permissions/) (~300 permissions).
   - Unauthorized menus are hidden or collapsed — end users simply see fewer options.

2. **👤 Role-Based Configuration (Admin Only)**:
   - Identified admins (`org_management`, `user_access_manage` or an admin role) can load any **Datadog role's permissions** by name from the Settings page.
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
   - Admins can open the popup → ⚙️ Settings to apply a specific role's permissions.

---

## ⚙️ How Filtering Works

| Mode | Active profile | Source of truth |
|------|----------------|-----------------|
| Auto (default for end users) | `custom` | Real session permissions from `/api/v2/current_user` |
| Role-based (admin) | `custom` | Permissions fetched from a named role via the Roles API |
| Unfiltered | `all` | Nothing is hidden (default until detection succeeds, or on failure) |

- If permission detection fails, nothing is forced: menus stay unfiltered rather than guessing.
- The command palette only lists menus allowed by the active mode.

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
│   └── profiles.js          # Menu definitions, permission→menu mapping table
├── popup/
│   ├── popup.html           # Toolbar popup interface
│   ├── popup.css            # Popup styles & Datadog theme
│   └── popup.js             # Popup interface controller
├── options/
│   ├── options.html         # Admin settings page (role loading)
│   ├── options.css          # Admin panel styles
│   └── options.js           # Settings controller with admin gating
├── scripts/
│   └── build.js             # Build script (copies sources to dist/)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🛠️ Development

```bash
npm run build   # Rebuild dist/ from sources
```

Reload the extension in `chrome://extensions/` after each build.
