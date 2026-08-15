/** Copy dictionaries for the MCP manager Settings tab. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: 'MCP 服务',
  loading: '正在读取 MCP 服务…',
  error: '暂时无法读取 MCP 服务。',
  retry: '重试',
  empty: '暂无 MCP 服务。在工作区的 .dsh/dshmm/mcp.json 或 profile 配置中声明。',
  source: '来源',
  sourceWorkspace: '工作区',
  sourceConfig: '配置',
  server: '服务',
  transport: '传输',
  status: '状态',
  action: '操作',
  connecting: '连接中',
  active: '已连接',
  errorStatus: '错误',
  conflict: '冲突',
  removing: '卸载中',
  configured: '已配置',
  remove: '移除',
  view: '查看',
  applyFailed: '操作失败',
  removed: '已移除',
  refresh: '刷新',
} satisfies Record<string, string>

/** MCP manager locale key union. */
export type McpLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en: Record<McpLocaleKey, string> = {
  tab: 'MCP servers',
  loading: 'Loading MCP servers…',
  error: 'Unable to load MCP servers.',
  retry: 'Retry',
  empty: 'No MCP servers. Declare them in a workspace\'s .dsh/dshmm/mcp.json or the profile config.',
  source: 'Source',
  sourceWorkspace: 'Workspace',
  sourceConfig: 'Config',
  server: 'Server',
  transport: 'Transport',
  status: 'Status',
  action: 'Action',
  connecting: 'Connecting',
  active: 'Connected',
  errorStatus: 'Error',
  conflict: 'Conflict',
  removing: 'Removing',
  configured: 'Configured',
  remove: 'Remove',
  view: 'View',
  applyFailed: 'Operation failed',
  removed: 'Removed',
  refresh: 'Refresh',
}
