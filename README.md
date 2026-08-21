# Datadog Smart Menu - Chrome Extension (Manifest V3)

**Datadog Smart Menu** is a modern Chrome extension that adapts and automatically filters the Datadog HQ navigation menu based on each user's role and required permissions.

---

## 🌟 Key Features

1. **🎭 Predefined Role Profiles**:
   - **💻 Developer (Dev)**: APM, Traces, Application Logs, Errors, Notebooks, Incidents.
   - **🛠️ SRE / DevOps**: Infrastructure, Metrics, Monitors & Alerts, Logs, Kubernetes, Network.
   - **🛡️ Security & Compliance**: Cloud Security, AppSec, Audit Trail, Threats & Vulnerabilities.
   - **🎨 Product Manager / UX**: Real User Monitoring (RUM), Synthetics, Dashboards, Product Analytics.
   - **💼 FinOps / Executive**: Cloud Cost Management, Billing, Budget overview.
   - **⚙️ Custom Profile**: Checkbox matrix to manually configure each menu.

2. **🤖 Hybrid Rights Detection**:
   - Dynamically inspects the Datadog interface and the active user session.
   - Automatically hides or collapses unauthorized sections.

3. **🔍 Quick Command Palette (`Ctrl + M` / `Cmd + M`)**:
   - Opens an instant search modal to jump directly to any authorized menu without cluttering the sidebar.

4. **⚡ Grayed-out or Full Hide Mode**:
   - Option to hide 100% of unnecessary menus or collapse them into a grayed-out folder.

5. **💾 Configuration Import / Export (JSON)**:
   - Easily share configured menu profiles with your whole team.

---

## 🚀 Installation Guide for Chrome / Brave / Edge

1. **Download / Clone the folder**:
   The project is located at: `/home/sbecker/datadog_smart_menu`

2. **Open the extensions page**:
   In your Chrome or Chromium browser, go to:
   `chrome://extensions/` (or `edge://extensions/`)

3. **Enable Developer Mode**:
   Toggle the **"Developer mode"** switch at the top right.

4. **Load the extension**:
   - Click the **"Load unpacked"** button.
   - Select the folder `/home/sbecker/datadog_smart_menu`.

5. **Use the extension**:
   - Pin the 🐶 icon to the Chrome toolbar.
   - Click the icon to choose your role profile (e.g. Developer, SRE, SecOps) or create a custom configuration.
   - Open [app.datadoghq.com](https://app.datadoghq.com) to see the filtered navigation live!

---

## 📂 Project Structure

```text
datadog_smart_menu/
├── manifest.json            # Chrome Manifest V3 configuration
├── README.md                # User documentation
├── background/
│   └── background.js        # Background service worker (state & badge management)
├── content/
│   ├── content.js           # DOM injection script in Datadog + Palette (Ctrl+M)
│   └── content.css          # Filtering and modal styles
├── shared/
│   └── profiles.js          # Datadog menu definitions and role profiles
├── popup/
│   ├── popup.html           # Toolbar popup interface
│   ├── popup.css            # Glassmorphism styles & Datadog theme
│   └── popup.js             # Popup interface controller
├── options/
│   ├── options.html         # Advanced settings and rights matrix page
│   ├── options.css          # Admin panel styles
│   └── options.js           # Settings & import/export controller
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
