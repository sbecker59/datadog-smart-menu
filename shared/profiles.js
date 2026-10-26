/**
 * Datadog Smart Menu - Profiles & Menu Definitions (ES module entry point)
 *
 * Menu and permission definitions live in menu-definitions.js, which is also
 * loaded as a plain content script. This module re-exports them.
 */
import './menu-definitions.js';

export const {
  DATADOG_MENUS,
  ALL_MENU_IDS,
  mapPermissionsToMenus,
  findMenuForHref
} = globalThis.DD_SMART_MENU;

export const DEFAULT_SETTINGS = {
  enabled: true,
  activeProfile: 'all',
  customMenus: ['dashboards', 'apm', 'logs', 'monitors', 'infrastructure'],
  autoDetectRights: true,
  enableCommandPalette: true,
  collapseHiddenItems: true
};
