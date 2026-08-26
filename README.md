# MarkGraph

跑在你自己 NAS 上的多端双链笔记——一个服务，电脑 / 手机 / 平板随时随地访问同一个库。

MarkGraph 是自托管的网页版 Markdown 双链笔记（客户端-服务器架构：服务端管数据与索引，浏览器只是界面）。笔记是服务器上一个文件夹里的纯 `.md` 文件——你的数据、你的机器、无云端、无账号、无格式锁定，任何文本编辑器都能直接打开同一目录。

## 功能一览

- **写作流**：文件树、CodeMirror 编辑器（wikilink 高亮 / 补全 / 断链一键创建、实时预览、自动保存）、阅读模式；粘贴或拖入图片写入 `attachments/`，正文插入标准 `![]()`
- **双链**：`[[wikilink]]`、反向链接（带上下文摘录）、大纲、力导向图谱（断链虚线节点、悬停高亮邻居）
- **文件夹页**：点击文件夹打开聚合页——子笔记的摘要 / 标签 / 被引数一目了然；纯虚拟视图，不产生额外文件
- **搜索**：命令面板 = 文件名 fuzzy + 全库全文搜索（不依赖 AI）+ 语义搜索（配置 AI 后）
- **AI 自动富集**（可选）：保存笔记即自动生成标签与摘要（写入 frontmatter）、自动插入双链（每次写入可撤销）、相关笔记推荐
- **库内问答**（可选）：对整个 vault 提问，流式回答、只依据库内笔记，引用与来源可跳转到具体段落
- **外部 Agent 接入（MCP）**：把笔记库的全部能力（增删改查 / 整理 / 索引 / 问答）以 30 个 MCP 工具开放给 Claude Code、ZCode、Cursor 等 AI agent——人用浏览器，agent 用 MCP；全程审计、删除进回收站、读写双作用域 token
- **设置中心**：⌘/Ctrl+, 卡片式设置，AI 网关在应用内配置并热生效——支持 newAPI 等 OpenAI 兼容网关，也支持 Ollama 本地模型（免密钥，数据不出内网）
- **五套主题**：玻璃 / 纸感 / 经典深色 / 纯黑 / 卡片——每套主题连图谱的画法都不同（柔光圆点 / 墨线勾勒 / 实心圆 / 极简细线 / 圆角方块）

## 产品目标

面向**个人 NAS 自托管、随时随地多端访问**的笔记应用：一个服务跑在用户的 NAS 或自有服务器上，任何设备的浏览器访问同一个笔记库。当前阶段专注把 Web 端功能做完整，随后按序推进：

1. **Web 功能完善**（写作流、双链、AI 富集、问答、设置、文件夹页、全文搜索、正文插图）
2. **移动 Web 适配**（窄屏阅读优先壳：底栏库 / 搜索 / 上下文 / 更多）
3. **部署安全与分发**：单用户口令 + Docker 镜像（群晖 / 威联通 / 绿联）
4. **多端客户端**（原生 / 壳应用）——REST + SSE API 已为其就绪

> 术语说明：MarkGraph **不是** local-first——浏览器是无状态客户端，数据存于服务端文件系统。真实的承诺是**数据主权**（纯 `.md`、无云、无账号、无锁定）+ **自托管**。

## 快速开始

需要 Node.js 20+。

```bash
npm install
npm run dev          # Vite :5173  +  Fastify :7710
```

浏览器打开 http://127.0.0.1:5173 。空库会提示导入一份约 25 篇互链的中文示例笔记。

生产构建：

```bash
npm run build
npm start            # 默认 http://127.0.0.1:7710
```

环境变量（复制 `.env.example` 为 `.env`；AI 四项也可在应用「设置」里配置且优先于 .env）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址。本机开发保持默认；非回环必须设口令 |
| `PORT` | `7710` | 端口 |
| `VAULT_DIR` | `~/MarkGraph-vault` | 笔记库文件夹，位于仓库外，不进 git |
| `AUTH_PASSWORD` | 空 | 单用户访问口令。回环可不设；局域网 / Docker 必设 |
| `AUTH_SECRET` | 空 | Cookie 签名（≥32 字符）。不设则每次启动随机 |
| `AI_BASE_URL` | 空 | OpenAI 兼容接口地址（newAPI 网关的 `/v1`，或 Ollama 的 `http://127.0.0.1:11434/v1`） |
| `AI_API_KEY` | 空 | 网关密钥，只存在服务端（设置界面只回显掩码）；本地网关可留空 |
| `AI_CHAT_MODEL` | 空 | 生成标签/摘要/建议链接的模型 |
| `AI_EMBED_MODEL` | 空 | 向量模型（相关笔记与语义搜索用） |

## AI 自动富集

在「设置」（⌘,）里配置好网关后，**保存笔记即自动完成**：

- **标签与摘要**写入笔记 frontmatter（`tags` / `summary`），正文不动，阅读模式不显示
- **相关笔记**：右栏「智能」面板按语义相似度展示
- **自动连接**：AI 挑选强相关笔记，把 `[[链接]]` 插到对应原句所在行末（默认全自动，可切「仅建议 / 关闭」）
- **语义搜索**：命令面板输入自然语言，语义相近的笔记排最前
- **库内问答**：「问答」标签页对整个 vault 提问，答案流式生成、只依据库内笔记，引用与来源可跳转
- 每次 AI 写入都有备份（`vault/.markgraph/backups/`），面板可一键**撤销**；正文未变不重复调用

反向链接与反链摘录不需要 AI——它们从 `[[wikilink]]` 索引实时派生。AI 只负责「生成」，不负责「维护」。

## 设置

**⌘/Ctrl + ,** 打开设置（工具栏齿轮、命令面板「打开设置」同路径），卡片分区：

- **AI 接入**：网关地址、API Key（只存服务端，界面只显示掩码）、两个模型名，支持「测试连接」先测后存，保存即热生效，无需重启
- **AI 行为**：自动标签 / 自动摘要 / 自动连接（全自动·仅建议·关）、单次自动插链上限
- **Agent 接入（MCP）**：生成 / 吊销 API Token（只读 / 读写两档），明文只显示一次
- **外观**：五套主题一键切换

`HOST` / `PORT` / `VAULT_DIR` 属部署配置，在 `.env` 中设置。

## 外部 Agent 接入（MCP）

NAS 场景的自然延伸：**人用浏览器，agent 用 MCP**。在「设置 → Agent 接入」生成一个 Token，任何支持 MCP 的编码 agent（Claude Code / ZCode / Cursor 等）即可安全操作你的笔记库——查询、写作、整理、建索引、问答。

- 端点：与 Web 同源 `/mcp`（Streamable HTTP，不新增端口）；鉴权 `Authorization: Bearer mg_...`
- 30 个原子工具：`list_tree` / `read_note` / `write_note`（乐观并发）/ `create_note` / `rename_note`（自动改写全库 wikilink）/ `delete_note`（一律进回收站，可 `restore_trash`）/ `search_fulltext` / `get_backlinks` / `list_broken_links` / `find_orphans` / `health_check` / `replace_text`（先 dry_run 预览再落盘）/ `enrich_all` / `semantic_search` / `ask_vault` / `upload_attachment` / `read_audit_log` 等
- 整理策略由 agent 编排原子工具完成，产品不内置固定流程——`health_check` 一次返回断链 / 孤立 / 重名 / 空笔记 / 未富集清单，是整理工作的统一入口
- 安全：token 只存 SHA-256（常量时间比较）、吊销即时生效；写操作限速（默认 60 次/分钟，`.markgraph/agents.json` 可调）；全部调用进审计日志；`.markgraph/` 内部目录不可直接触碰

agent 侧配置示例（MCP Streamable HTTP）：

```json
{
  "mcpServers": {
    "markgraph": {
      "type": "streamableHttp",
      "url": "http://<NAS-IP>:7710/mcp",
      "headers": { "Authorization": "Bearer mg_你的token" }
    }
  }
}
```

## Docker / NAS

```bash
export AUTH_PASSWORD='换成你的口令'
export AUTH_SECRET="$(openssl rand -hex 32)"
docker compose up -d --build
```

浏览器打开 `http://<NAS-IP>:7710`，先输入口令。笔记库在 Docker 卷 `markgraph-vault`（容器内 `/data/vault`）。群晖 / 威联通 / 绿联：用 Container Manager 导入本目录的 `docker-compose.yml`，映射 7710，需要 HTTPS 时走 NAS 反代。绑定挂载到网络盘、外部改文件界面不刷新时，加上环境变量 `CHOKIDAR_USEPOLLING=1`。

## 安全

回环地址（`127.0.0.1`）可以不设口令，方便本机开发。绑定非回环地址或跑在 Docker 里时，**必须**设置 `AUTH_PASSWORD`，否则进程拒绝启动。口令换到 Cookie 会话，覆盖全部 API（含实时事件流）。即便如此，也不要把未套 TLS 的端口直接暴露到公网——用 Tailscale 或 NAS 反代。

## 快捷键

| 按键 | 作用 |
|---|---|
| `Cmd/Ctrl+P` | 命令面板（文件 / 全文 / 语义搜索，命令执行） |
| `Cmd/Ctrl+E` | 编辑 ⇄ 阅读 |
| `Cmd/Ctrl+,` | 设置 |
| `Esc` | 关闭命令面板 / 对话框 |

## 主题

五套可切换主题，默认「玻璃」。选择会记在 `localStorage`，也支持 `?theme=` URL 参数直达。

| 内部 id | 显示名 |
|---|---|
| `apple` | 玻璃 |
| `paper` | 纸感 |
| `obsidian` | 经典深色 |
| `x` | 纯黑 |
| `meta` | 卡片 |

独立预览页：[style-samples/index.html](style-samples/index.html)（浏览器直接打开）。

## 许可

[MIT](LICENSE)
