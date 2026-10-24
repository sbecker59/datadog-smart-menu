/**
 * Datadog Smart Menu - single source of truth for menus and permissions.
 *
 * Plain script (no ES module syntax) so it can be loaded both as a content
 * script and imported by the background/popup modules. It publishes its API
 * on globalThis.DD_SMART_MENU.
 *
 * - `paths`: URL prefixes of the Datadog navigation links that belong to the
 *   menu (taken from the real Datadog navbar). The longest matching prefix wins,
 *   so "/logs/archive-search" belongs to Log Archives, not Logs.
 * - `permissions`: RBAC permission names that grant access. A trailing "*"
 *   is a prefix match ("logs_*" matches "logs_read_data" but not
 *   "audit_logs_read"). `null` means the page has no dedicated permission and
 *   is never hidden.
 *
 * Permission names: https://docs.datadoghq.com/account_management/rbac/permissions/
 */
(function (root) {
  const DATADOG_MENUS = [
    // Dashboards
    { id: 'dashboards', name: 'Dashboards', icon: '📊', category: 'Dashboards',
      paths: ['/dashboard', '/ai'],
      permissions: ['dashboards_*', 'generate_dashboard_reports', 'embeddable_graphs_share', 'product_dashboards_write'],
      keywords: ['dashboard', 'overview', 'chart', 'widget'] },
    { id: 'notebooks', name: 'Notebooks', icon: '📓', category: 'Dashboards',
      paths: ['/notebook'], permissions: ['notebooks_*'],
      keywords: ['notebook', 'postmortem', 'runbook'] },
    { id: 'sheets', name: 'Sheets', icon: '📋', category: 'Dashboards',
      paths: ['/sheets'], permissions: ['sheets_*'],
      keywords: ['sheets', 'spreadsheet'] },
    { id: 'ddsql_editor', name: 'DDSQL Editor', icon: '🗃️', category: 'Dashboards',
      paths: ['/ddsql'], permissions: ['ddsql_editor_read'],
      keywords: ['ddsql', 'sql'] },

    // Monitoring
    { id: 'monitors', name: 'Monitors', icon: '🔔', category: 'Monitoring',
      paths: ['/monitors', '/check/summary', '/watchdog'],
      permissions: ['monitors_*', 'monitor_config_policy_write', 'watchdog_*', 'external_provider_status_*'],
      keywords: ['monitor', 'alert', 'downtime', 'watchdog', 'check summary'] },
    { id: 'slos', name: 'SLOs', icon: '🎯', category: 'Monitoring',
      paths: ['/slo'], permissions: ['slos_*'],
      keywords: ['slo', 'service level'] },
    { id: 'events', name: 'Event Management', icon: '📣', category: 'Monitoring',
      paths: ['/event'], permissions: ['events_*', 'event_correlation_config_*', 'event_config_write'],
      keywords: ['event', 'triage inbox', 'correlation'] },

    // Developer Portal
    { id: 'software_catalog', name: 'Software Catalog', icon: '🧩', category: 'Developer Portal',
      paths: ['/software', '/idp'], permissions: ['apm_service_catalog_*', 'apm_api_catalog_*'],
      keywords: ['software', 'catalog', 'scorecards', 'developer portal', 'self-service actions'] },

    // Incident Response
    { id: 'on_call', name: 'On-Call', icon: '📞', category: 'Incident Response',
      paths: ['/on-call', '/personal-settings/profile?tab=on-call-notifications'], permissions: ['on_call_*'],
      keywords: ['on-call', 'on call', 'pages', 'schedule'] },
    { id: 'incidents', name: 'Incident Management', icon: '🚨', category: 'Incident Response',
      paths: ['/incidents'], permissions: ['incident_*', 'incidents_private_global_access'],
      keywords: ['incident', 'postmortem'] },
    { id: 'status_pages', name: 'Status Pages', icon: '📟', category: 'Incident Response',
      paths: ['/status-pages'], permissions: ['status_pages_*'],
      keywords: ['status page'] },
    { id: 'case_management', name: 'Work Management', icon: '🗂️', category: 'Incident Response',
      paths: ['/work', '/cases'], permissions: ['cases_*'],
      keywords: ['case', 'work management'] },

    // Automation
    { id: 'automation', name: 'Workflows & Apps', icon: '🤖', category: 'Automation',
      paths: ['/actions', '/workflow', '/app-builder'],
      permissions: ['workflows_*', 'apps_run', 'apps_write', 'apps_datastore_*', 'connections_*', 'connection_groups_*',
        'on_prem_runner_*', 'actions_interface_run', 'execution_groups_*'],
      keywords: ['automation', 'workflow', 'app builder', 'action catalog'] },
    { id: 'agent_builder', name: 'Bits Agent Builder', icon: '🛠️', category: 'Automation',
      paths: ['/actions/agents'], permissions: ['agent_builder_*'],
      keywords: ['agent builder'] },
    { id: 'forms', name: 'Forms', icon: '📝', category: 'Automation',
      paths: ['/forms'], permissions: ['apps_form_*'],
      keywords: ['forms'] },

    // Infrastructure
    { id: 'infrastructure', name: 'Infrastructure', icon: '🖥️', category: 'Infrastructure',
      paths: ['/infrastructure', '/containers', '/kubernetes', '/orchestration', '/container-images', '/process',
        '/serverless', '/functions', '/storage-management', '/end-user-devices', '/gpu-monitoring',
        '/software?selectedComponent=infrastructure'],
      permissions: ['hosts_read', 'infrastructure_resource_policies_*', 'guardrails_*', 'containers_generate_image_metrics',
        'orchestration_*', 'processes_generate_metrics', 'process_tags_*', 'serverless_aws_instrumentation_*',
        'terraform_state_file_configurations_*'],
      keywords: ['host', 'container', 'kubernetes', 'serverless', 'process', 'gpu'] },
    { id: 'cloud_maps', name: 'Cloudcraft', icon: '🗺️', category: 'Infrastructure',
      paths: ['/cloud-maps'], permissions: ['cloudcraft_read'],
      keywords: ['cloudcraft', 'cloud map'] },
    { id: 'network', name: 'Network', icon: '🌐', category: 'Infrastructure',
      paths: ['/network', '/network-path', '/devices'],
      permissions: ['network_connections_read', 'network_health_insights_read', 'ndm_*', 'network_path_*'],
      keywords: ['network', 'devices', 'netflow', 'network path'] },

    // Cloud Cost
    { id: 'cost_management', name: 'Cloud Cost', icon: '💰', category: 'Cloud Cost',
      paths: ['/cost'],
      permissions: ['cloud_cost_management_*', 'ccm_*', 'generate_ccm_report_schedules', 'manage_ccm_report_schedules'],
      keywords: ['finops', 'cost', 'budget'] },

    // APM
    { id: 'apm', name: 'APM', icon: '⚡', category: 'APM',
      paths: ['/apm', '/profiling', '/debugging', '/dynamic-instrumentation', '/databases', '/data-streams', '/smp',
        '/software?selectedComponent=endpoint', '/software?lens=Performance'],
      permissions: ['apm_*', 'continuous_profiler_*', 'debugger_*', 'live_debugger_*', 'dbm_*', 'data_streams_*'],
      keywords: ['apm', 'trace', 'service', 'profiling', 'database', 'data streams'] },

    // Digital Experience
    { id: 'rum', name: 'Real User Monitoring', icon: '👥', category: 'Digital Experience',
      paths: ['/rum'], permissions: ['rum_*'],
      keywords: ['rum', 'real user', 'session replay'] },
    { id: 'synthetics', name: 'Synthetic Monitoring', icon: '🧭', category: 'Digital Experience',
      paths: ['/synthetics'], permissions: ['synthetics_*', 'dem_journey_*'],
      keywords: ['synthetics', 'browser test', 'api test'] },
    { id: 'product_analytics', name: 'Product Analytics', icon: '📈', category: 'Digital Experience',
      paths: ['/product-analytics'], permissions: ['product_analytics_*', 'audience_management_*', 'rum_*'],
      keywords: ['product analytics', 'funnel', 'retention'] },

    // Software Delivery
    { id: 'ci_visibility', name: 'CI Visibility & Delivery', icon: '🧪', category: 'Software Delivery',
      paths: ['/ci'],
      permissions: ['ci_*', 'cd_visibility_read', 'test_optimization_*', 'quality_gate_rules_*', 'quality_gates_evaluations_read',
        'dora_*', 'code_coverage_read', 'deployment_gates_*'],
      keywords: ['ci', 'pipeline', 'test optimization', 'dora', 'pr gates'] },
    { id: 'feature_flags', name: 'Feature Flags', icon: '🚩', category: 'Software Delivery',
      paths: ['/feature-flags'], permissions: ['feature_flag_*'],
      keywords: ['feature flag'] },
    { id: 'code_security', name: 'Code Security', icon: '🔐', category: 'Software Delivery',
      paths: ['/security/code-security', '/security/configuration/code-security'],
      permissions: ['code_analysis_read', 'static_analysis_settings_*', 'appsec_vm_*', 'security_testing_*'],
      keywords: ['code security', 'static analysis', 'vulnerabilities'] },

    // Security
    { id: 'security', name: 'Security', icon: '🛡️', category: 'Security',
      paths: ['/security'],
      permissions: ['security_monitoring_*', 'security_pipelines_*', 'security_comments_*', 'appsec_*', 'siem_*',
        'security_testing_*'],
      keywords: ['security', 'siem', 'appsec', 'cloud security', 'workload protection'] },
    { id: 'bits_security_analyst', name: 'Bits Security Analyst', icon: '🕵️', category: 'Security',
      paths: ['/security/bits-ai-security-analyst'], permissions: ['bits_security_analyst_*'],
      keywords: ['bits security analyst'] },
    { id: 'ai_guard', name: 'AI Guard', icon: '🧱', category: 'Security',
      paths: ['/security/ai-guard'], permissions: ['ai_guard_*'],
      keywords: ['ai guard'] },
    { id: 'data_scanner', name: 'Sensitive Data Scanner', icon: '🔍', category: 'Security',
      paths: ['/sensitive-data-scanner'], permissions: ['data_scanner_*'],
      keywords: ['sensitive data scanner', 'data scanner'] },

    // Data Observability: no dedicated read permission in Datadog RBAC.
    { id: 'data_observability', name: 'Data Observability', icon: '🗄️', category: 'Data Observability',
      paths: ['/data-obs'], permissions: null,
      keywords: ['data observability', 'quality monitoring', 'jobs monitoring', 'lineage'] },

    // AI Observability
    { id: 'llm_observability', name: 'LLM Observability', icon: '🧠', category: 'AI Observability',
      paths: ['/llm'], permissions: ['llm_observability_*'],
      keywords: ['llm', 'ai observability', 'agent observability'] },
    { id: 'agent_console', name: 'Agent Console', icon: '🎛️', category: 'AI Observability',
      paths: ['/llm/ai-agents-console'], permissions: ['agent_console_*'],
      keywords: ['agent console'] },

    // Errors / Metrics / Logs
    { id: 'error_tracking', name: 'Error Tracking', icon: '🐛', category: 'Telemetry',
      paths: ['/error-tracking'], permissions: ['error_tracking_*'],
      keywords: ['error tracking', 'errors'] },
    { id: 'metrics', name: 'Metrics', icon: '📈', category: 'Telemetry',
      paths: ['/metric'], permissions: ['metrics_read', 'metric_tags_write', 'metrics_metadata_write', 'timeseries_query'],
      keywords: ['metric', 'explorer', 'summary', 'volume'] },
    { id: 'logs', name: 'Logs', icon: '📝', category: 'Telemetry',
      paths: ['/logs', '/byoc-logs'], permissions: ['logs_*', 'flex_logs_config_write'],
      keywords: ['log', 'live tail', 'pipelines', 'indexes'] },
    { id: 'logs_archives', name: 'Log Archives & Forwarding', icon: '🗄️', category: 'Telemetry',
      paths: ['/logs/archive-search', '/logs/forwarding', '/logs/historical-views'],
      permissions: ['logs_read_archives', 'logs_write_archives', 'logs_write_archive_search', 'logs_write_forwarding_rules',
        'logs_write_historical_view'],
      keywords: ['archive', 'forwarding', 'rehydration'] },
    { id: 'observability_pipelines', name: 'Observability Pipelines', icon: '🛠️', category: 'Telemetry',
      paths: ['/observability-pipelines'], permissions: ['observability_pipelines_*'],
      keywords: ['observability pipelines'] },

    // Bits AI
    { id: 'bits_ai', name: 'Bits Chat', icon: '✨', category: 'Bits AI',
      paths: ['/ask'], permissions: ['assistant_access'],
      keywords: ['bits', 'bits chat', 'assistant'] },
    { id: 'bits_ai_investigations', name: 'Bits Investigation', icon: '🔎', category: 'Bits AI',
      paths: ['/bits-ai'], permissions: ['bits_investigations_*', 'bits_settings_org_write'],
      keywords: ['bits investigation', 'investigations'] },
    { id: 'bits_ai_code', name: 'Bits Code', icon: '💻', category: 'Bits AI',
      paths: ['/code'], permissions: ['bits_dev_write'],
      keywords: ['bits code'] },

    // Integrations
    { id: 'integrations', name: 'Integrations', icon: '🔌', category: 'Integrations',
      paths: ['/integrations'],
      permissions: ['integrations_read', 'manage_integrations', 'aws_configuration*', 'azure_configuration*',
        'gcp_configuration*', 'oci_configuration*'],
      keywords: ['integrations', 'aws', 'gcp', 'azure'] },
    { id: 'marketplace', name: 'Marketplace & IDE Plugins', icon: '🛒', category: 'Integrations',
      paths: ['/marketplace', '/ide-integrations'], permissions: null,
      keywords: ['marketplace', 'ide', 'plugins'] },
    { id: 'source_code', name: 'Source Code Integration', icon: '🧬', category: 'Integrations',
      paths: ['/source-code'], permissions: ['repo_info_read', 'repo_settings_write'],
      keywords: ['source code', 'repository'] },
    { id: 'fleet', name: 'Fleet Automation', icon: '🚚', category: 'Integrations',
      paths: ['/fleet'],
      permissions: ['agent_flare_collection', 'agent_upgrade_write', 'fleet_policies_write', 'hosts_read', 'remote_configuration_read'],
      keywords: ['fleet', 'agent', 'install agent'] },

    // Settings
    { id: 'personal_settings', name: 'Personal Settings', icon: '👤', category: 'Settings',
      paths: ['/personal-settings'], permissions: null,
      keywords: ['profile', 'preferences'] },
    { id: 'organization_settings', name: 'Organization Settings', icon: '⚙️', category: 'Settings',
      paths: ['/organization-settings'], permissions: null,
      keywords: ['organization', 'teams'] },
    { id: 'user_management', name: 'Users & Roles', icon: '🧑‍🤝‍🧑', category: 'Settings',
      paths: ['/organization-settings/users', '/organization-settings/roles'],
      permissions: ['user_access_*', 'org_management'],
      keywords: ['users', 'roles', 'permissions'] },
    { id: 'service_accounts', name: 'Service Accounts', icon: '🤖', category: 'Settings',
      paths: ['/organization-settings/service-accounts'], permissions: ['service_account_write'],
      keywords: ['service account'] },
    { id: 'api_keys', name: 'API & Application Keys', icon: '🔑', category: 'Settings',
      paths: ['/organization-settings/api-keys', '/organization-settings/access-tokens', '/organization-settings/application-keys'],
      permissions: ['api_keys_*', 'org_app_keys_*'],
      keywords: ['api key', 'application key', 'access token'] },
    { id: 'plan_usage', name: 'Plan & Usage', icon: '💳', category: 'Settings',
      paths: ['/billing'], permissions: ['billing_*', 'usage_*'],
      keywords: ['billing', 'usage', 'plan'] },
    { id: 'audit_trail', name: 'Audit Trail', icon: '📜', category: 'Settings',
      paths: ['/audit-trail'], permissions: ['audit_logs_*'],
      keywords: ['audit trail', 'audit'] }
  ];

  const ALL_MENU_IDS = DATADOG_MENUS.map(m => m.id);

  function permissionMatches(pattern, permission) {
    return pattern.endsWith('*')
      ? permission.startsWith(pattern.slice(0, -1))
      : permission === pattern;
  }

  /**
   * Map technical permission names to the menu IDs the user can access.
   */
  function mapPermissionsToMenus(permNames) {
    const perms = (permNames || []).map(p => String(p).toLowerCase());
    return DATADOG_MENUS
      .filter(menu => menu.permissions === null ||
        menu.permissions.some(pattern => perms.some(p => permissionMatches(pattern, p))))
      .map(menu => menu.id);
  }

  // [path, menu] pairs, longest path first, so the most specific path wins.
  const PATH_INDEX = DATADOG_MENUS
    .flatMap(menu => menu.paths.map(path => [path.toLowerCase(), menu]))
    .sort((a, b) => b[0].length - a[0].length);

  function pathMatches(url, path) {
    if (!url.startsWith(path)) return false;
    const next = url.charAt(path.length);
    return next === '' || next === '/' || next === '?' || next === '#' || (path.includes('?') && next === '&');
  }

  /**
   * Return the menu a Datadog link belongs to, or null for unknown and
   * external links. Accepts relative ("/logs") or absolute URLs.
   */
  function findMenuForHref(href, origin) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, origin || 'https://app.datadoghq.com');
    } catch (e) {
      return null;
    }
    if (origin && url.origin !== new URL(origin).origin) return null;
    if (!origin && !href.startsWith('/')) return null;
    const target = (url.pathname + url.search).toLowerCase();
    const entry = PATH_INDEX.find(([path]) => pathMatches(target, path));
    return entry ? entry[1] : null;
  }

  root.DD_SMART_MENU = { DATADOG_MENUS, ALL_MENU_IDS, mapPermissionsToMenus, findMenuForHref, permissionMatches };
})(typeof globalThis !== 'undefined' ? globalThis : self);
