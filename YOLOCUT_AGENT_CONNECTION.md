# YoloCut 安装包与 Agent 接入

## 产品与兼容边界

- 安装包、应用名、窗口标题、可执行文件和新 MCP 客户端名称：`YoloCut` / `yolocut`。
- 新状态工具：`yolocut_status`。
- 迁移兼容：旧 `chatcut` / `openchatcut` MCP 客户端名、对应状态工具、
  旧数据目录和旧请求头仍能被兼容层识别。
- 新旧状态工具返回同一份数据；旧 Agent 配置不必立即迁移。

## Agent 如何连接

1. 启动 YoloCut，打开目标工程。
2. 在顶部或项目页打开 **Agent 连接中心 (MCP)**。
3. 复制页面显示的实际 URL 和 Bearer Token；桌面端口被占用时，
   不要继续写死 5199。
4. 选择 Codex / Claude Code / Gemini CLI / Cursor 的配置片段并复制。
5. 点击 **运行连接自检**；页面会真实执行 MCP
   `initialize → initialized → tools/list → DELETE`。

默认端点：

```text
http://localhost:5199/api/external-mcp/mcp
```

Codex（Windows PowerShell）：

```powershell
$env:YOLOCUT_MCP_TOKEN = '<连接中心显示的令牌>'
codex mcp add yolocut `
  --url 'http://localhost:5199/api/external-mcp/mcp' `
  --bearer-token-env-var YOLOCUT_MCP_TOKEN
```

Claude Code：

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer <token>" \
  yolocut http://localhost:5199/api/external-mcp/mcp
```

Gemini CLI（包括由 ZCode Antigravity 调用的 Gemini Agent）：

```bash
gemini mcp add --transport http yolocut \
  http://localhost:5199/api/external-mcp/mcp \
  --header "Authorization: Bearer <token>"
```

Cursor：

```json
{
  "mcpServers": {
    "yolocut": {
      "type": "http",
      "url": "http://localhost:5199/api/external-mcp/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Agent 完整剪辑流程

```text
yolocut_status
  → get_connection_manifest
  → list_projects
  → target_project
  → load_skill / ToolSearch
  → begin_edit_session
  → 读取与剪辑工具（全部携带 editSessionId）
  → review_edit_session
  → get_edit_session
```

只有同时满足下列条件才能报告完成：

- `readiness.fullEditing=ready`；
- `capabilityCoverage.complete=true`；
- 最终会话 `status=applied`。

`server-direct` 只是没有在线编辑器时的受限数据工具层，不是完整剪辑面。

## Windows 安装包

```powershell
npm run desktop:dist:win
```

默认产物：

```text
release/YoloCut-v<version>-x64.exe
```

本地私有构建不会继承 YoloCut 的自动更新源。要为正式 YoloCut
仓库生成更新元数据，打包时显式设置：

```powershell
$env:YOLOCUT_RELEASE_REPOSITORY = 'owner/YoloCut'
npm run desktop:dist:win
```

没有签名证书时，Windows 安装包会是未签名文件；发布时应同时提供
SHA-256，不应宣称已通过 Authenticode 签名。
