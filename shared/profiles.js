/**
 * Datadog Smart Menu - Profiles & Menu Definitions
 */

export const DATADOG_MENUS = [
  {
    id: 'dashboards',
    name: 'Dashboards',
    icon: '📊',
    selector: '[data-dd-action-name="dashboards"], a[href*="/dashboard"], [href*="/dash"]',
    keywords: ['dashboard', 'charts', 'widgets', 'overview'],
    category: 'Core'
  },
  {
    id: 'infrastructure',
    name: 'Infrastructure',
    icon: '🖥️',
    selector: '[data-dd-action-name="infrastructure"], a[href*="/infrastructure"], a[href*="/host"]',
    keywords: ['hosts', 'containers', 'serverless', 'k8s', 'kubernetes', 'processes'],
    category: 'Core'
  },
  {
    id: 'monitors',
    name: 'Monitors & Alerts',
    icon: '🔔',
    selector: '[data-dd-action-name="monitors"], a[href*="/monitors"], a[href*="/watchdog"]',
    keywords: ['alerting', 'watchdog', 'downtimes', 'slo', 'service level'],
    category: 'Core'
  },
  {
    id: 'apm',
    name: 'APM & Tracing',
    icon: '⚡',
    selector: '[data-dd-action-name="apm"], a[href*="/apm"], a[href*="/services"]',
    keywords: ['services', 'traces', 'service catalog', 'profiling', 'error tracking', 'database'],
    category: 'Telemetry'
  },
  {
    id: 'logs',
    name: 'Logs',
    icon: '📝',
    selector: '[data-dd-action-name="logs"], a[href*="/logs"]',
    keywords: ['log search', 'patterns', 'analytics', 'pipelines', 'generate metrics'],
    category: 'Telemetry'
  },
  {
    id: 'metrics',
    name: 'Metrics',
    icon: '📈',
    selector: '[data-dd-action-name="metrics"], a[href*="/metric"]',
    keywords: ['explorer', 'summary', 'custom metrics'],
    category: 'Telemetry'
  },
  {
    id: 'ux_monitoring',
    name: 'Digital Experience (UX / RUM)',
    icon: '👥',
    selector: '[data-dd-action-name="ux_monitoring"], a[href*="/rum"], a[href*="/synthetics"]',
    keywords: ['rum', 'real user', 'synthetics', 'session replay', 'mobile', 'product analytics'],
    category: 'Experience'
  },
  {
    id: 'security',
    name: 'Security & Compliance',
    icon: '🛡️',
    selector: '[data-dd-action-name="security"], a[href*="/security"], a[href*="/appsec"]',
    keywords: ['cloud security', 'appsec', 'audit trail', 'csm', 'vulnerabilities', 'threats'],
    category: 'Security'
  },
  {
    id: 'network',
    name: 'Network',
    icon: '🌐',
    selector: '[data-dd-action-name="network"], a[href*="/network"]',
    keywords: ['npm', 'network performance', 'dns', 'devices'],
    category: 'Telemetry'
  },
  {
    id: 'incidents',
    name: 'Service Mgmt & Incidents',
    icon: '🚨',
    selector: '[data-dd-action-name="incidents"], a[href*="/incidents"], a[href*="/on-call"]',
    keywords: ['incidents', 'on-call', 'change tracking', 'workflows', 'service catalog'],
    category: 'Operations'
  },
  {
    id: 'notebooks',
    name: 'Notebooks',
    icon: '📓',
    selector: '[data-dd-action-name="notebooks"], a[href*="/notebook"]',
    keywords: ['notes', 'postmortem', 'runbook', 'investigation'],
    category: 'Operations'
  },
  {
    id: 'cost_management',
    name: 'Cloud Cost Mgmt (FinOps)',
    icon: '💰',
    selector: '[data-dd-action-name="cost_management"], a[href*="/cost"], a[href*="/billing"]',
    keywords: ['finops', 'billing', 'cloud cost', 'usage', 'budget'],
    category: 'Business'
  },
  {
    id: 'integrations',
    name: 'Integrations',
    icon: '🔌',
    selector: '[data-dd-action-name="integrations"], a[href*="/account/settings"]',
    keywords: ['api', 'plugins', 'aws', 'datadog agent'],
    category: 'Admin'
  },
  {
    id: 'organization_settings',
    name: 'Organization Settings',
    icon: '⚙️',
    selector: '[data-dd-action-name="organization_settings"], a[href*="/organization-settings"]',
    keywords: ['users', 'roles', 'permissions', 'teams', 'api keys'],
    category: 'Admin'
  }
];

export const ROLE_PROFILES = {
  dev: {
    id: 'dev',
    name: 'Developer (Dev)',
    icon: '💻',
    description: 'Focused on APM, Tracing, application logs, metrics, and incident resolution.',
    allowedMenus: ['dashboards', 'apm', 'logs', 'metrics', 'notebooks', 'incidents']
  },
  sre: {
    id: 'sre',
    name: 'SRE / DevOps',
    icon: '🛠️',
    description: 'Full observability access: Infrastructure, Monitors, APM, Logs, Metrics & Network.',
    allowedMenus: ['dashboards', 'infrastructure', 'monitors', 'apm', 'logs', 'metrics', 'network', 'incidents', 'notebooks']
  },
  security: {
    id: 'security',
    name: 'Security & Compliance',
    icon: '🛡️',
    description: 'Dedicated to threat monitoring, container security, audit trail, and compliance.',
    allowedMenus: ['dashboards', 'security', 'logs', 'incidents', 'notebooks', 'organization_settings']
  },
  product: {
    id: 'product',
    name: 'Product Manager / UX',
    icon: '🎨',
    description: 'Focused on User Experience, Real User Monitoring (RUM), Synthetics & Dashboards.',
    allowedMenus: ['dashboards', 'ux_monitoring', 'monitors', 'notebooks']
  },
  finops: {
    id: 'finops',
    name: 'FinOps / Executive',
    icon: '💼',
    description: 'Cloud cost overview, key metrics, usage attribution, and billing management.',
    allowedMenus: ['dashboards', 'cost_management', 'notebooks']
  },
  all: {
    id: 'all',
    name: 'All Menus (Admin)',
    icon: '🔓',
    description: 'Full unfiltered access to all Datadog sections and organization settings.',
    allowedMenus: DATADOG_MENUS.map(m => m.id)
  },
  custom: {
    id: 'custom',
    name: 'Custom Profile',
    icon: '⚙️',
    description: 'Manually select allowed Datadog menu sections tailored to your organization.',
    allowedMenus: ['dashboards', 'apm', 'logs', 'monitors']
  }
};

export const DEFAULT_SETTINGS = {
  enabled: true,
  activeProfile: 'dev',
  customMenus: ['dashboards', 'apm', 'logs', 'monitors', 'infrastructure'],
  autoDetectRights: true,
  enableCommandPalette: true,
  collapseHiddenItems: true,
  highlightActiveProfile: true
};
