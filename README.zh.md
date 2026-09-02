# dsh-mcp-mgr

[English](README.md) | 中文

dsh 的工作区级 MCP 管理器：从每个工作区的 `.dsh/dshmm/mcp.json` 读取 MCP server，动态注册工具，并在 Web 设置页提供管理界面。

![MCP 服务列表](Doc/assets/plugin-shot.jpg)

## 选择使用方式

| 使用者 | 入口 | 是否需要源码仓库 |
| --- | --- | --- |
| 普通用户 | npm 包 + `npx @deepseek-ai/dsh` | 不需要 deepseek-harness 或本插件源码 |
| 源码开发者 | deepseek-harness source + 本仓库 source | 见[源码开发者指南](Doc/development.zh.md) |

## 普通用户：使用 npm 包

### 安装并启动

```powershell
npx @deepseek-ai/dsh plugin --profile web add dsh-mcp-mgr@latest
npx @deepseek-ai/dsh web
```

更新时重复执行安装命令即可：

```powershell
npx @deepseek-ai/dsh plugin --profile web add dsh-mcp-mgr@latest
```

卸载：

```powershell
npx @deepseek-ai/dsh plugin --profile web remove dsh-mcp-mgr
```

### 工作区配置

在工作区根目录创建 `.dsh/dshmm/mcp.json`：

```json
{
  "mcpServers": {
    "my-http-server": {
      "type": "http",
      "url": "http://127.0.0.1:8090/mcp"
    },
    "my-stdio-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "<mcp-server-package>"]
    }
  }
}
```

规则：

- 缺省 `type` 按 Streamable HTTP 处理；支持 `${VAR}` 环境变量展开。
- stdio server 未指定 `cwd` 时使用工作区根目录。
- `serverName` 全局唯一，重复名称会显示冲突。
- 设置 `"enabled": false` 可禁用条目但不删除；缺省为启用。

## 行为与限制

- 工作区工具使用 `mcp__<serverName>__<tool>` 命名。
- 设置页的严格模式用于只挂载当前选中工作区的 server。

## 源码开发者

需要同时修改 deepseek-harness 和本插件源码时，参阅[源码开发者指南](Doc/development.zh.md)。两个仓库可以位于任意目录，不要求同级或固定路径。

设计说明见 `Doc/requirements.md`。
