# Setup Assistant Multi-Domain Deployer Design

## Goal
设计并实现一个**本地运行的内部 Web 部署工具**，用于将当前 `cloudflare_temp_email` 仓库以“安装向导 / Setup Assistant”的方式部署到 Cloudflare。

该工具的目标不是做通用 PaaS，也不是长期运维后台，而是把以下动作尽量收敛到一次可理解、可恢复、低认知负担的安装流程中：
- 导入并保存 Cloudflare API Token
- 读取当前账号下可用 root domains
- 一次性选择多个主域名并启用 `*.root-domain` 泛解析模式
- 自动创建并初始化 Worker / Pages / D1
- 自动配置多域名的 Email Routing
- 自动初始化当前仓库所需的 wildcard 配置
- 在最终页面明确提示仍需人工完成的邮箱验证与测试动作

## Scope
本设计覆盖：
- 本地 Web 安装向导的产品结构与页面流程
- 单 Cloudflare 账号、多 root domain 的安装模型
- 多域名 Email Routing 自动化边界
- 本地状态持久化与任务恢复
- 基于 Cloudflare API + Wrangler 的混合编排架构
- 旧 MX 冲突检测与用户确认删除流程
- 与当前 `cloudflare_temp_email` 仓库结构对接的部署策略

本设计不覆盖：
- 通用多项目部署平台
- 多账号同时部署
- 任意本地源码目录切换
- 自动完成 destination email verification
- 程序内自动发送测试邮件
- Resend / SMTP / Telegram / OAuth / 外部 S3 等扩展能力的一键配置
- 自动回滚所有已创建资源
- 面向普通用户的 SaaS 化控制台

## Context and Constraints

### Current Repository State
截至 **2026-04-03**，当前仓库已具备：
- Cloudflare Worker + Pages + D1 的基本项目结构
- 多 root domain wildcard 模式
- 后端 Cloudflare wildcard settings API
- 前端 wildcard settings 管理界面
- wildcard-created address 仅收信、90 天有效期的基础实现
- 对地址过期、收件、发件限制的基础守卫逻辑

这意味着本次工作不是重写 temp mail 核心逻辑，而是补一个**部署编排层**，把当前仓库从“手工部署多个 Cloudflare 组件”升级为“安装向导式部署体验”。

### User Constraints Confirmed During Brainstorming
本次设计已与用户确认以下约束：
- 工具是**内部人员使用**，不是公开给普通用户的安装器
- 运行形态是**浏览器访问的本地 Web 界面**
- Token 可以**本地落盘明文保存**，由管理人员自行管理
- UI 风格应更接近：
  - macOS 出厂配置流程
  - 软件首次安装引导 / Setup Assistant
  - 而不是传统后台 dashboard 或 Windows MSI 安装器
- MVP 需要遵循 **KISS**，优先追求高成功率
- 部署只针对**当前仓库内置源码**，不支持任意源码目录
- 只支持**单个 Cloudflare 账号**，即一次安装中所有选中的 root domains 必须属于同一个 account
- 一次安装流程要支持**多个 `*.root-domain`**
- 多个 root domain **共用一个 destination address**
- Email Routing 尽量自动完成
- 如果检测到目标 root domain 的旧 MX，必须：
  - 告警
  - 展示将删除的记录
  - 由用户明确选择是否删除
- destination address verification 可以由人工完成
- 最终的测试邮件发送也由人工完成

### External Platform Constraints
基于 Cloudflare 官方文档，截至 **2026-04-03**，以下结论对本设计是硬约束：

1. **Cloudflare Email Routing 可以通过 API 开启和配置**
   - Email Routing DNS / enable
   - destination addresses
   - catch-all / rules

2. **destination address 必须验证后才能真正可用**
   - 这是 Cloudflare 平台侧要求
   - 不能假装工具可以稳定跳过该步骤
   - 因此“真正开始收件”的最终状态必须保留一个人工验证环节

3. **旧 MX 会影响 Email Routing 启用**
   - 如果目标 root domain 之前已有其他邮件服务的 MX，必须被检测出来
   - 是否删除这些 MX 必须成为显式的风险确认点

### Reference Inputs
本次设计参考了两类材料：

#### A. 仓库内现有实现
- `worker/wrangler.toml.template`
- `pages/wrangler.toml`
- `docs/superpowers/specs/2026-04-02-cloudflare-wildcard-multi-domain-design.md`
- `worker/src/cloudflare_wildcard.ts`
- `worker/src/admin_api/cloudflare_wildcard_settings.ts`
- 前端 wildcard 管理 UI

这些材料说明：
- 当前仓库已经完成 wildcard 模式的主业务逻辑
- 现在缺少的是“自动部署与初始化体验”

#### B. 外部参考仓库
- `bbbbbbbin/one-click-deploy-tempmail`

这个参考项目证明了以下方向是成立的：
- 可以围绕当前上游仓库做“一键部署包装层”
- 自动生成配置、创建 D1/KV、部署 Worker/Pages 是现实可行的

但它也暴露出两个问题：
- 它偏脚本，不是低认知负担的安装向导
- Email Routing 仍保留了较多人工步骤

因此本设计不会复制其 PowerShell 脚本形态，而是吸收其“围绕现有仓库做包装层”的思路，转而实现为本地 Web Setup Assistant。

## Product Definition

### What This Tool Is
它是一个**本地运行的部署向导**，负责把当前仓库部署成一个**单实例、多 root domain、共享 destination address** 的 Cloudflare temp mail 服务。

### What This Tool Is Not
它不是：
- 通用 Cloudflare 资源管理器
- 长期运维 dashboard
- 可切换任意项目模板的部署平台
- 替代 Cloudflare 控制台的一体化面板

### MVP Success Criteria
本次 MVP 的“成功”定义为：
- 能在单个 Cloudflare 账号下完成：
  - D1 创建与 schema 初始化
  - Worker 部署
  - Pages 部署
  - frontend / API 自定义域名绑定
- 多账号可见时，允许在可访问账号中选择**一个**作为本次安装目标
  - 多个 root domain 的 Email Routing 基础配置
  - current repo 的 wildcard domain pool 初始化
- 安装向导可以明确告诉用户：
  - 哪些域名已经配置完成
  - 哪些步骤因为旧 MX 或人工验证而阻塞
  - 还剩哪些人工动作

本次 MVP **不要求**在“用户未验证 destination address”的情况下假装系统已 fully ready。

## Options Considered

### Option A: Giant Shell Script With Thin Web Wrapper
用一个大的 shell / PowerShell 脚本来完成所有逻辑，Web UI 只是表单输入和日志展示。

**Pros**
- 初始开发速度快
- 可以复用参考仓库的一键脚本思路

**Cons**
- 难以细粒度呈现每一步状态
- 难以把“旧 MX 冲突”“多域名检查结果”“人工阻塞点”做成良好交互
- 后续维护会迅速退化成不可控的大脚本

### Option B: Hybrid Orchestrator (**Recommended**)
使用：
- Web 向导作为前端交互层
- 本地 orchestrator 作为任务编排层
- Cloudflare API 做资源发现与 Email Routing 配置
- Wrangler CLI 做 D1 / Worker / Pages 实际部署

**Pros**
- 最符合 KISS 与 MVP 成功率目标
- 可以精细表达风险与状态
- 可直接复用当前仓库的 deploy 方式
- 不需要从零实现完整 Cloudflare 资源上传协议

**Cons**
- 需要同时维护 API adapter 和 CLI adapter
- 状态同步需要清晰设计

### Option C: Full Cloudflare API Platform
尽量不使用 Wrangler，全部直接用 Cloudflare API 完成 build/deploy/configure。

**Pros**
- 形式上更统一
- 理论上每一步完全可控

**Cons**
- 明显超出 MVP
- Worker / Pages 构建与部署链路复杂度过高
- 与当前仓库已有 deploy 实践不一致

## Selected Approach
采用 **Option B: Hybrid Orchestrator**。

### Why
因为本项目最重要的不是“部署底层全自研”，而是：
- 高成功率
- 可理解
- 安装感
- 对当前仓库低侵入

把职责拆成：
- **Cloudflare API**：负责“看”和“配”
- **Wrangler**：负责“建”和“发”
是当前最稳的方案。

## Product Architecture

### 1. Core Installation Model
首版安装模型固定为：
- 一个 Cloudflare 账号
- 一个部署实例
- 一个 Worker
- 一个 Pages
- 一个 D1
- 多个 root domains
- 一个共享 destination address
- 一个共享 wildcard pool
- 一个 `primary control domain`，用于 frontend / API 对外域名

示例：
- root domains: `a.com`, `b.net`, `c.org`
- primary control domain: `a.com`
- wildcard rules:
  - `*.a.com`
  - `*.b.net`
  - `*.c.org`
- frontend domain: `mail.a.com`
- api domain: `email-api.a.com`
- destination address: `ops@example.net`

这里的关键不是“为每个 root domain 单独部署一套服务”，而是“部署一个统一系统实例，接收多个 root domain 的邮件”。


如果 token 可以访问多个 accounts，UI 应先按 account 分组展示 zones；一旦用户选择了 account，后续 root domain 选择器只显示该 account 下的 domains。

### 2. Wizard-First UX
产品打开后默认进入 Setup Assistant，而不是 dashboard。

这是一个 deliberate choice：
- 当前用户进入工具的主要意图是“把系统部署起来”
- 如果先展示 dashboard，会迫使用户自己推断下一步
- Setup Assistant 更适合表达：
  - 先决条件
  - 风险确认
  - 当前进度
  - 人工收尾事项

### 3. UI Flow
推荐 8 步结构：

1. **Welcome**
2. **Cloudflare Token**
3. **Account & Root Domains**
4. **Deploy Targets**
5. **Domain Checks**
6. **Confirm Changes**
7. **Deploy**
8. **Manual Finish Checklist**

#### 3.1 Welcome
目标：建立预期
- 说明自动化覆盖范围
- 说明仍需人工完成的动作
- 简要展示 8 步流程

#### 3.2 Cloudflare Token
目标：确认可用凭据
- 输入并保存 token
- 展示所需权限说明
- 校验 token 与权限缺口

#### 3.3 Account & Root Domains
目标：选择单账号下的多个 root domains
- 选择 account
- 多选 root domains
- 从已选 root domains 中指定一个 **primary control domain**，用于承载 frontend/api hostname
- 填写共享 destination address
- 生成 wildcard preview
- 允许修改 project slug 与 frontend/api subdomain

#### 3.4 Deploy Targets
目标：在实际变更前预览部署结果
- Worker 名称
- Pages 名称
- D1 名称
- frontend / API 域名预览
- wildcard rules 预览

#### 3.5 Domain Checks
目标：对每个 root domain 做预检查
- Email Routing 状态
- 现有 MX
- DNS 是否满足
- 现有 catch-all / routing 冲突
- destination address 状态

#### 3.6 Confirm Changes
目标：汇总“将创建 / 将修改 / 将删除”的内容
- Resources
- Domains
- Email Routing
- Destructive Changes

#### 3.7 Deploy
目标：可视化执行进度
- 全局进度条
- 当前步骤
- 已完成步骤
- 单域名执行结果
- 可展开日志

#### 3.8 Manual Finish Checklist
目标：明确人工收尾动作
- 去邮箱验证 destination address
- 发送真实测试邮件
- 到前端验证收件
- 给出常见失败排查提示

### 4. Visual Style Direction
UI 风格应接近：
- macOS 出厂配置流程
- 软件首次安装向导
- 大留白、低噪音、一步一主题

明确不做：
- Dense admin dashboard
- 过量数据表格首页
- 默认日志墙

### 5. Multi-Domain Execution Model
多域名相关逻辑采用：
- 全局步骤串行
- 域名相关步骤按域名逐个执行
- 单域名结果独立记录

这样做有三个好处：
1. UI 可明确表达每个域名状态
2. 某个域名失败不必让全局状态变得不可理解
3. 后续可做“只重试失败域名”

## System Architecture

### 1. Main Components

#### 1.1 Frontend App
负责：
- Wizard 页面
- 表单输入
- 风险确认
- 进度可视化
- 最终结果展示

#### 1.2 Local Orchestrator Service
负责：
- 参数校验
- 任务编排
- 调用 Cloudflare API adapter
- 调用 Wrangler adapter
- 持久化状态与日志
- 处理中断与恢复

#### 1.3 Cloudflare API Adapter
负责：
- 校验 token
- 列出 account / zones
- 检查权限
- 检查域名 Email Routing 状态
- 检查 MX / DNS 冲突
- 创建 destination address
- 配置 catch-all / rules
- 启用 Email Routing

#### 1.4 Wrangler Adapter
负责：
- 创建 D1
- 初始化 schema
- 部署 Worker
- 部署 Pages
- 绑定 custom domain

#### 1.5 Local Store
负责：
- token 落盘
- config 落盘
- deploy state
- logs
- install artifacts

### 2. Why Hybrid Instead of Pure API
原因不是技术做不到，而是：
- 当前仓库已经天然依赖 Wrangler 生态
- 纯 API 化会把 MVP 复杂度推高
- 纯脚本又无法表达良好状态机

因此最合理的边界是：
- **Cloudflare API** 负责：发现、检查、配置
- **Wrangler** 负责：构建、部署、初始化

## Data Model

### 1. Local Files
建议持久化以下文件：
- `data/token.json`
- `data/installer-config.json`
- `data/deploy-state.json`
- `data/logs/<task-id>.log`
- `data/artifacts/<task-id>/...`

### 2. Token Model
保存：
- token 原文
- 最近校验时间
- 最近一次权限检查结果
- 可访问账号摘要

本项目接受 token 明文落盘，因为它是内部本地工具，调试便利优先。

### 2.1 Required Permission Summary
UI 至少要向用户明确展示并在校验结果中映射以下权限摘要：
- Zone Read
- Workers Scripts Write
- Pages Write
- D1 Write
- Email Routing Rules Write
- Email Routing Addresses Write
- 为 Email Routing DNS 状态检查/修复所需的 Zone Settings Read/Write（如果当前实现路径需要）

如果某个权限校验无法通过 token capability 直接静态判断，installer 也必须通过一次最小 API 探测将其归类为“缺失权限或不可用能力”，而不是在深层部署阶段才模糊失败。

### 3. Installer Config Model
最小模型建议包含：
- `accountId`
- `accountName`
- `rootDomains[]`
- `wildcardRules[]`
- `destinationAddress`
- `projectSlug`
- `frontendSubdomain`
- `apiSubdomain`
- `frontendDomain`
- `apiDomain`

注意：
- `wildcardRules` 是派生值，不是用户原始输入
- `frontendDomain` / `apiDomain` 首版只挂到一个由用户明确选定的 `primary control domain` 上，而不是隐式使用“第一个域名”

### 4. Domain Check Result Model
每个 root domain 都要有独立检查结果：
- `emailRoutingEnabled`
- `mxRecords[]`
- `hasMxConflict`
- `dnsReady`
- `destinationAddressStatus`
- `catchAllStatus`
- `needsConfirmation`

### 5. Deploy State Model
建议分两层：

#### 5.1 Global Steps
- `validate_token`
- `inspect_domains`
- `confirm_changes`
- `prepare_infrastructure`
- `deploy_worker`
- `deploy_pages`
- `configure_email_routing`
- `finalize`

状态值只保留：
- `pending`
- `running`
- `success`
- `failed`
- `blocked_by_confirmation`
- `blocked_by_manual`

#### 5.2 Per-Domain State
每个域名单独记录：
- `pending`
- `success`
- `warning`
- `failed`
- `blocked`

### 6. Installation Output Model
安装完成后保存：
- Worker 名称
- Pages 名称
- D1 名称
- frontend URL
- API URL
- wildcard rules
- destination address
- 各域名 Email Routing 结果摘要

## Execution Flow

### 1. High-Level Pipeline
推荐任务流水线：
1. `validate_token`
2. `fetch_accounts_and_zones`
3. `resolve_selected_domains`
4. `inspect_domain_mail_state`
5. `confirm_destructive_actions`
6. `create_or_prepare_d1`
7. `apply_database_schema`
8. `build_and_deploy_worker`
9. `build_and_deploy_pages`
10. `bind_custom_domains`
11. `enable_email_routing_per_domain`
12. `create_destination_address`
13. `configure_catch_all_per_domain`
14. `write_initial_wildcard_settings`
15. `finalize_manual_checklist`

### 2. Domain-Scoped Steps
对每个选中的 root domain，至少要执行：
- 检查 Email Routing 状态
- 检查现有 MX
- 开启 / 修复 Email Routing DNS
- 更新 catch-all -> Worker
- 记录是否等待 destination 验证

### 3. Initial Wildcard Bootstrap
部署基础设施完成后，installer 必须把以下配置初始化到系统中：
- `cloudflare_wildcard_domains`
- `cloudflare_active_wildcard_domains`
- `cloudflare_address_retention_days = 90`

这一步可以通过当前仓库已有的 admin settings API 或 DB settings 初始化路径完成；本设计倾向于走“与产品运行态一致”的配置入口，而不是绕过系统语义直接手改不透明状态。

## Email Routing Design

### 1. Shared Destination Address
首版多个 root domains 共用一个 destination address。

**Why**
- 最符合 KISS
- 最有利于一次性部署成功
- 降低用户输入成本
- 降低状态复杂度

### 2. Per-Domain Routing
虽然 destination address 共享，但 Email Routing 的启用与规则配置必须是**逐域执行**，因为：
- Email Routing 是 zone scoped
- MX 冲突是按域名存在
- catch-all 是按域名存在

### 3. Old MX Detection
对于每个选中的 root domain，installer 必须检测是否存在现有 MX。

如果存在，进入：
- warning 状态
- 列出记录
- 标记需要用户确认

### 4. Old MX Deletion Policy
默认策略：
- **不自动删除**
- 必须显式确认
- 删除前展示域名、priority、content

这一步是本流程的 destructive checkpoint。

### 5. Manual Verification Boundary
installer 可以自动创建 destination address，但不能可靠自动完成验证。

因此最终状态必须区分：
- 自动配置完成
- destination verification 待人工完成

不能把“已创建 destination address”错误地表达成“收件已 fully ready”。

## Error Handling and Recovery

### 1. Principles
首版只做：
- checkpoint
- retry
- 明确错误
- 明确阻塞点

首版不做：
- 自动回滚所有资源
- 自动 DNS 自愈
- 自动验证 destination address

### 2. Manual Confirmation Points
必须显式阻塞的点只有两个：

#### 2.1 Old MX Deletion
- 检测到冲突 MX
- 用户未确认删除前不可继续相关域名配置

#### 2.2 Destination Verification
- 资源已创建
- Email Routing 逻辑已配置
- 但 destination address 未验证
- 全局状态进入 `ready_with_manual_steps` 或等价表达

### 3. Typical Failure Scenarios

#### 3.1 Token Permission Missing
在 Step 2 直接拦截并显示缺失权限，不进入后续部署。

#### 3.2 Some Domains Unusable
如果部分域名不适合启用 Email Routing：
- 在 Domain Checks 中标红
- 允许移除这些域名后继续
- 不应让整套流程完全不可理解

#### 3.3 Wrangler Deployment Failure
如果 Worker / Pages / D1 部署失败：
- 停在当前 checkpoint
- 展示失败摘要
- 提供完整日志
- 允许重试当前步骤

#### 3.4 Partial Multi-Domain Success
如果 `a.com` 成功但 `b.net` 失败：
- 全局状态标记为 `partial_success`
- 明确按域名展示结果
- 允许只重试失败域名相关步骤

### 4. Final Statuses
推荐最终结果只使用三类表达：
- `success`
- `success_with_manual_steps`
- `partial_success`

这比单一“部署成功”更真实，也更符合 Cloudflare Email Routing 的平台约束。

## Testing Strategy

### 1. Unit-Level Validation
至少覆盖：
- installer config 解析
- wildcard rules 派生逻辑
- 多域名输入校验
- destructive confirmation 条件判断
- deploy state 状态迁移

### 2. Adapter-Level Tests
至少覆盖：
- Cloudflare API adapter 的 response 映射
- Wrangler command builder
- checkpoint persistence
- per-domain status aggregation

### 3. Integration-Level Tests
至少覆盖：
- 从 token 校验到 deploy plan 生成
- 模拟旧 MX 冲突阻塞
- 模拟部分域名成功 / 部分失败
- 模拟 destination verification 未完成的最终状态

### 4. UI Tests
至少覆盖：
- wizard step navigation
- MX 删除确认页
- deploy progress page
- final manual checklist page

## Rollout Strategy

### Phase 1: Installer MVP
实现：
- 单账号
- 多 root domain
- 共享 destination address
- setup assistant UI
- Cloudflare API + Wrangler 混合编排
- old MX destructive confirmation
- 最终人工收尾页

### Phase 2: Post-MVP Improvements
未来可考虑：
- 历史安装记录
- 多安装 profile
- 更精细的 retry / resume
- installer 后台管理页
- destination verification 状态主动轮询
- “重新配置某个域名”独立 flow

### Explicit Non-Goals For Phase 1
首版明确不做：
- 支持任意 repo / 源码目录
- 多账号
- 每个 root domain 配不同 destination
- 自动发测试邮件
- 自动完成 destination verification
- 自动回滚
- 外部发信平台一键接入

## Open Questions Resolved
本次 brainstorming 中已明确决策：
- 运行形态：**本地 Web UI**
- 使用人群：**内部人员**
- Token：**明文本地落盘**
- 风格：**Setup Assistant / 出厂配置流程**
- 安装模型：**单账号 + 多 root domain + 单 destination address**
- 多域名：**一次安装中一起配置**
- Email Routing：**尽量程序完成，验证保留人工**
- 测试邮件：**人工发送**
- 旧 MX：**检测、告警、用户选择是否删除**

## Summary
本设计将当前仓库的部署体验定义为一个**面向内部人员的多域名安装向导**：
- 不是脚本包装器
- 不是泛化的 Cloudflare 平台
- 而是一个围绕 `cloudflare_temp_email` 当前仓库量身定制的 Setup Assistant

它的核心价值在于：
- 让多 root domain wildcard 模式的 Cloudflare 部署变得可理解
- 尽可能自动化 D1 / Worker / Pages / Email Routing
- 在 Cloudflare 平台要求人工验证的地方明确停下，而不是制造“伪全自动”预期
- 用低认知负担的安装流程替代零散文档和手工控制台操作

在当前约束下，这是一个**实现性高、MVP 成功率高、且明显值得落地**的方案。

## References
- Cloudflare API token permissions reference: https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- Cloudflare Email Routing destination addresses API: https://developers.cloudflare.com/api/resources/email_routing/subresources/addresses/methods/create/
- Cloudflare Email Routing rules API: https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/methods/create/
- Cloudflare Email Routing catch-all API: https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/subresources/catch_alls/methods/update/
- Cloudflare Email Routing DNS API: https://developers.cloudflare.com/api/resources/email_routing/subresources/dns/methods/get/
- Cloudflare Email Routing enable/setup docs: https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/
- Cloudflare custom domains docs: https://developers.cloudflare.com/workers/configuration/routing/custom-domains
- Reference wrapper project: https://github.com/bbbbbbbin/one-click-deploy-tempmail
