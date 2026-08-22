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
    id: 'error_tracking',
    name: 'Error Tracking',
    icon: '🐛',
    selector: '[data-dd-action-name="error_tracking"], a[href*="/error-tracking"]',
    keywords: ['error tracking'],
    category: 'Telemetry'
  },
  {
    id: 'observability_pipelines',
    name: 'Observability Pipelines',
    icon: '🛠️',
    selector: '[data-dd-action-name="observability_pipelines"], a[href*="/observability-pipelines"], a[href*="/op-pipelines"]',
    keywords: ['observability pipelines'],
    category: 'Telemetry'
  },
  {
    id: 'logs_archives',
    name: 'Log Archives',
    icon: '🗄️',
    selector: '[data-dd-action-name="logs_archives"], a[href*="/logs/archives"], a[href*="/archives"]',
    keywords: ['archive'],
    category: 'Telemetry'
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
    id: 'automation',
    name: 'Automation',
    icon: '🤖',
    selector: '[data-dd-action-name="automation"], a[href*="/workflow-automation"], a[href*="/automations"]',
    keywords: ['automation', 'app builder', 'workflow automation'],
    category: 'Operations'
  },
  {
    id: 'bits_ai',
    name: 'Bits AI',
    icon: '✨',
    selector: '[data-dd-action-name="bits_ai"], a[href*="/bits"], [data-testid*="bits"]',
    keywords: ['bits assistant', 'bits ai', 'bits chat'],
    category: 'Operations'
  },
  {
    id: 'ci_visibility',
    name: 'CI Visibility',
    icon: '🧪',
    selector: '[data-dd-action-name="ci_visibility"], a[href*="/ci"], a[href*="/ci-visibility"]',
    keywords: ['ci visibility', 'test optimization'],
    category: 'Operations'
  },
  {
    id: 'llm_observability',
    name: 'LLM Observability',
    icon: '🧠',
    selector: '[data-dd-action-name="llm_observability"], a[href*="/llm-observability"], a[href*="/llmobs"]',
    keywords: ['llm observability'],
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
    keywords: ['integrations', 'api', 'plugins', 'aws configurations', 'gcp', 'azure', 'datadog agent'],
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

export const DEFAULT_SETTINGS = {
  enabled: true,
  activeProfile: 'all',
  customMenus: ['dashboards', 'apm', 'logs', 'monitors', 'infrastructure'],
  autoDetectRights: true,
  enableCommandPalette: true,
  collapseHiddenItems: true
};

/**
 * Ordered permission-to-menu mapping, most specific rules first.
 * Source: https://docs.datadoghq.com/account_management/rbac/permissions/
 */
export const PERMISSION_MENU_MAP = [
  ['logs_archives', ['logs_read_archives', 'logs_write_archives', 'logs_write_archive_search']],
  ['observability_pipelines', ['observability_pipeline']],
  ['error_tracking', ['error_tracking']],
  ['llm_observability', ['llm_observability']],
  ['ci_visibility', ['ci_visibility', 'test_optimization', 'ci_provider', 'ci_ingestion', 'cd_visibility', 'code_analysis', 'code_coverage', 'dora_', 'quality_gates', 'static_analysis']],
  ['bits_ai', ['assistant_access', 'bits_investigations', 'bits_dev_']],
  ['security', ['bits_security', 'security_', 'appsec_', 'ai_guard', 'data_scanner', 'audit_logs_']],
  ['automation', ['workflows_', 'workflow_automation', 'apps_', 'agent_builder', 'actions_interface', 'connections_', 'execution_groups', 'on_prem_runner', 'app_builder', 'mcp_']],
  ['incidents', ['incident_', 'cases_', 'on_call_', 'status_pages']],
  ['ux_monitoring', ['rum_', 'synthetics_', 'product_analytics', 'audience_management', 'dem_journey', 'feature_flag']],
  ['cost_management', ['cloud_cost_management', 'ccm_', 'billing_', 'usage_']],
  ['integrations', ['integrations', 'aws_configuration', 'azure_configuration', 'gcp_configuration', 'oci_configuration', 'api_keys', 'client_tokens', 'org_app_keys', 'user_app_keys', 'repo_info', 'repo_settings']],
  ['organization_settings', ['org_management', 'org_group', 'org_connections', 'user_access', 'service_account', 'teams_manage', 'governance_console', 'workload_identity', 'coterm']],
  ['infrastructure', ['infrastructure_', 'guardrails', 'agent_upgrade', 'agent_flare', 'fleet_policies', 'orchestration_', 'terraform_state', 'process_tags', 'processes_generate', 'containers_generate', 'disaster_recovery', 'serverless_']],
  ['apm', ['apm_', 'continuous_profiler', 'debugger_', 'live_debugger', 'dbm_', 'data_streams_']],
  ['monitors', ['monitors_', 'monitor_config', 'slos_', 'watchdog']],
  ['network', ['network_connections', 'network_health', 'ndm_']],
  ['logs', ['logs_', 'telemetry_rules', 'events_write', 'event_correlation', 'generate_log_reports', 'manage_log_reports', 'saved_views', 'facets_']],
  ['metrics', ['metric_tags', 'metrics_metadata', 'host_tags', 'reference_tables', 'ddsql_editor']],
  ['notebooks', ['notebooks']],
  ['dashboards', ['dashboards_', 'embeddable_graphs', 'product_dashboards']]
];

/**
 * Map list of technical permission names to accessible Datadog menu IDs
 */
export function mapPermissionsToMenus(permNames) {
  const menus = new Set();
  menus.add('dashboards'); // Dashboards basic access

  permNames.forEach(p => {
    for (const [menuId, tokens] of PERMISSION_MENU_MAP) {
      if (tokens.some(token => p.includes(token))) {
        menus.add(menuId);
        break;
      }
    }
  });

  return Array.from(menus);
}
