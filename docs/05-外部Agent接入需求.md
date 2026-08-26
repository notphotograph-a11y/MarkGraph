# MarkGraph 外部 Agent 接入需求（MCP）

> 版本：1.0 ｜ 日期：2026-08-23 ｜ 状态：已实现（v0.3.0，2026-08-26 验收通过，见 `04-测试清单.md` T19）｜ 登记于 `01-需求.md` §11（F22 / F23 / N12）
> 一句话：把笔记库的**全部能力**——新建、读取、修改、整理、删除、建立索引、搜索、问答——以 MCP 工具的形式开放给任意外部 AI agent（Claude Code、ZCode、Cursor 等）安全调用。

## 1. 背景与目标

NAS 自托管愿景的自然延伸：**人用浏览器，agent 用 MCP**。典型场景：

- 写代码时让编码 agent 顺手查询 vault 里的项目笔记（`ask_vault` / `search_fulltext`）
- 定期让 agent 整理笔记库：补标签、修断链、归并孤立笔记、归档旧内容
- 让 agent 把对话/研究中的收获直接写成互链笔记落进 vault，而不是散落在聊天记录里
- 开源角度：MCP 接入是自托管笔记产品的天然卖点（README 演示项）

**目标**：任一支持 MCP 的外部 agent，配置一个服务地址 + 一个 API Token，即可完成「读 → 写 → 整理 → 索引 → 问答」全流程；全程可审计、可撤销、不破坏人工编辑。

**非目标**：不做产品内置 agent（Phase 2/3 的富集与问答继续演进）；这里是「把钥匙交给外部 agent」，钥匙本身要安全。

## 2. 接入形态

| 决策 | 选择 | 理由 |
|---|---|---|
| 协议 | MCP（Model Context Protocol），只实现 **Tools** 能力 | 主流 agent 生态事实标准；Resources/Prompts 暂不需要 |
| 传输 | Streamable HTTP | agent 在用户电脑上、MarkGraph 在 NAS 上，天然是远程场景；不选 stdio（要求 agent 与服务同机） |
| 端点 | 内嵌 Fastify 主服务，`/mcp` 路径，与 Web 同端口 | 单进程单端口；Docker 部署不新增暴露面；直接复用 service 层（fs-vault、ai/*）与鉴权 |
| 鉴权 | `Authorization: Bearer <token>`，API Token 与浏览器口令相互独立 | Cookie 会话是浏览器形态，对 agent 不友好；见 §3A |
| 与 REST 的关系 | `/api/*` 保持浏览器私有契约，不承诺稳定、不对 agent 开放；**对外唯一稳定承诺 = MCP 工具 schema** | 避免两套对外契约；前端重构 API 不破坏 agent |
| 索引下沉 | 链接索引（wikilink 解析 → nodes/edges/backlinks/tags）从浏览器端迁到**服务端共用模块**，Web 前端与 MCP 同源取数 | 反链/图谱/标签/全文搜索目前在前端构建，agent 拿不到；两套解析规则必然漂移 |

## 3. 功能需求

### A. 鉴权与 Token（01 需求 F22.2）

| 编号 | 需求 |
|---|---|
| A1 | API Token 两个作用域：`read`（全部查询/问答类工具）、`read-write`（全部工具）；token 为 `mg_` 前缀随机串，仅生成时明文可见一次 |
| A2 | token 配置入口：设置对话框新增「Agent 接入」卡片（生成/吊销/查看作用域）；MVP 阶段允许直接编辑 `vault/.markgraph/settings.json` |
| A3 | 吊销即时生效；未配置 token 时 `/mcp` 一律 401，错误信息说明「未启用 Agent 接入」 |
| A4 | 服务端只存 token 的 SHA-256，校验用常量时间比较；任何日志/接口不回显完整 token |

### B. 笔记 CRUD 工具（映射现有 REST 能力）

| 工具 | 参数要点 | 说明 |
|---|---|---|
| `list_tree` | — | 文件树（复用 `/api/tree` 逻辑，隐藏项已滤除） |
| `read_note` | `path` | 返回 `{ content, mtime }` |
| `read_notes` | `paths?`（缺省=全库） | 批量读，供 agent 建立全库认知 |
| `write_note` | `path, content, expected_mtime?` | 保存；带 `expected_mtime` 时冲突返回 409（乐观并发，防覆盖人工编辑，复用 F9.5 思路） |
| `create_note` | `path, content?` | 新建；重名 409 |
| `create_folder` | `path` | 新建文件夹 |
| `rename_note` | `from, to, update_links=true` | 移动/重命名；`update_links=true` 时同步改写全库指向它的 `[[wikilink]]`（默认开，见 F23.2） |
| `delete_note` | `path, reason?` | **agent 通道一律进回收站**（F23.1），不物理删除；返回回收站条目 id |

### C. 查询工具（依赖索引下沉，F23.1）

| 工具 | 参数要点 | 说明 |
|---|---|---|
| `search_fulltext` | `q` | 全库纯文本搜索（标题命中权重高于正文，F16 的服务端版） |
| `get_backlinks` | `path` | 反向链接 + 引用上下文摘录 |
| `get_outlinks` | `path` | 正向链接（含断链标记） |
| `list_broken_links` | — | 全库断链清单（哪个笔记的哪个链接指向不存在的目标） |
| `list_tags` | `—` | 标签 → 笔记列表（frontmatter 与正文 `#标签` 同源） |
| `get_graph` | `folder?` | 节点/边数据（agent 做结构分析用，不做可视化） |
| `find_orphans` | — | 无入链且无出链的孤立笔记 |
| `health_check` | — | 一次调用返回体检报告：断链、孤立、重名、空笔记、未富集清单——agent 整理的统一入口 |

### D. 整理工具

| 工具 | 参数要点 | 说明 |
|---|---|---|
| `replace_text` | `scope`（路径数组/文件夹/标签）、`from, to, dry_run` | 批量文本替换；`dry_run=true` 返回逐文件 diff 预览，确认后同参数 `dry_run=false` 落盘 |

> 「整理」的定义边界：原子工具（rename_update_links、replace_text、health_check、CRUD）之上，具体整理策略（怎么归档、怎么合并标签）由 **agent 自行编排**，产品不内置固定流程。合并笔记不做原子工具（read + write + delete 组合即可）。

### E. AI 与索引工具（透传 `server/ai/` 既有能力）

| 工具 | 说明 |
|---|---|
| `ai_status` | 配置状态、队列进度 |
| `enrich_note` | 单篇富集（摘要/标签/建议链接） |
| `enrich_all` | **全库建立语义索引**（串行队列 + 进度查询） |
| `get_note_ai` | 单篇 AI 视图：摘要、标签、相关笔记、建议链接 |
| `apply_link_suggestion` | 应用一条建议链接（`[[目标]]` 插入 anchor 行末） |
| `undo_ai_write` | 撤销该笔记最近一次 AI 写入；人工已改过则 409 |
| `semantic_search` | 语义搜索（AI 未配置时明确报未配置，不静默降级——agent 需要知道真相） |
| `ask_vault` | RAG 问答；MCP 工具为请求-响应形态，返回完整答案 + 来源列表（不做流式） |

### F. 附件与恢复运维

| 工具 | 说明 |
|---|---|
| `upload_attachment` | 上传图片（同一白名单与 8MB 上限），返回 `attachments/` 相对路径供正文引用 |
| `list_attachments` | 附件清单（含未被任何笔记引用的孤儿附件——整理素材） |
| `list_trash` / `restore_trash` | 回收站查询与恢复（F23.1） |
| `read_audit_log` | 读取审计日志（N12.2），`read` 作用域即可用 |

## 4. 安全与非功能（01 需求 N12）

| 编号 | 需求 |
|---|---|
| N12.1 | 复用 N2 路径校验（resolve 后必须在 vault 内）；MCP 工具额外禁止读写 `.markgraph/`（回收站与审计日志经专用工具访问） |
| N12.2 | 审计日志 `vault/.markgraph/audit.jsonl`：每次 agent 调用记录时间、工具、参数摘要（内容截断）、结果状态；`read_audit_log` 可查 |
| N12.3 | 回收站保留策略：最多 200 份或 30 天，超限最旧物理清除；`delete_note` 永不物理删除 |
| N12.4 | 写类工具限速：默认 60 次/分钟（settings.json 可配），超限 429——防 agent 循环失控写爆文件系统 |
| N12.5 | 乐观并发：`write_note` / `replace_text` 支持基线校验，冲突 409 并返回当前内容，agent 与浏览器用户、多个 agent 同时操作互不覆盖 |
| N12.6 | 工具 description 与错误信息按「给 agent 读」优化：错误附带自纠信息（如路径不存在时返回相近候选路径），减少 agent 试错循环 |
| N12.7 | MCP 端点与 Web 同端口，Docker 不新增暴露面；公网暴露必须走 HTTPS 反代（README 部署章节说明） |

## 5. 演练场景（验收用例素材）

1. **检索问答**：agent 用 `ask_vault` 回答「我做过的笔记里有哪些关于部署的结论」，答案带可跳转来源
2. **写作落库**：agent 用 `create_note` 新建 3 篇互链笔记 + `upload_attachment` 配图，Web 端即时可见（SSE 联动）
3. **全库索引**：agent 调 `enrich_all` 建立语义索引，期间进度可查，完成后 `semantic_search` 可用
4. **整理闭环**：agent `health_check` 发现 5 个断链与 2 篇孤立笔记 → `create_note` 补断链目标、`replace_text`（先 dry_run 预览）归一标签 → `rename_note`（update_links）重命名一篇 → `read_audit_log` 核对全部操作 → `delete_note` 误删后 `restore_trash` 恢复

## 6. 验收标准

1. 标准 MCP 客户端（Claude Code / ZCode 等）连上 NAS 实例，§3 工具清单全部调用成功
2. §5 四个演练场景逐条跑通
3. 浏览器主流程零回归（Web 端索引切换为服务端同源数据后，图谱/反链/搜索行为不变）
4. 安全项逐条可验证：无 token 401、越权路径拒绝、`.markgraph/` 不可触碰、删除必可恢复、审计可查、限速生效、token 不落日志

## 7. 明确不做

- 多用户、多 agent 权限细分（单 token + 两档作用域足够）
- MCP Resources / Prompts 能力、MCP 事件订阅推送（agent 需要变更感知时轮询 `health_check` / `list_tree`）
- 独立 CLI（agent 走 MCP，人走浏览器；不给 REST 写对外文档）
- Web 端 Agent 管理控制台（设置卡片之外不做）
- 产品内置的固定整理流程（整理策略交给 agent 编排）
