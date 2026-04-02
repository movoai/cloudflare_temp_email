# Cloudflare Wildcard Multi-Domain Design

## Goal
将当前 `cloudflare_temp_email` 改造成以 **Cloudflare 泛域名** 为唯一主入口的临时邮箱系统，支持多个主域名的泛解析规则（如 `*.a.com`、`*.b.net`），并允许管理员在现有管理界面中快速选择当前启用的泛域名集合。创建出的邮箱地址应为具体子域地址，并且地址可持续接收新邮件 **90 天**。

## Scope
本设计覆盖：
- Cloudflare 泛域名一体化配置模型
- 多主域名泛解析下的地址创建流程
- 管理端最小 UI 改造
- 地址生命周期与 90 天有效期
- 与当前 worker 邮件接收流程的兼容方式
- 测试与迁移要求

本设计不覆盖：
- 动态子域发信支持
- 自动续期 / 手动续期 / 永久保留
- Cloudflare API 自动创建新 DNS 记录
- 历史邮件强制保留 90 天

## Context and Constraints
### Current Repository State
当前仓库的核心行为仍基于：
- `DOMAINS` / `DEFAULT_DOMAINS` 作为可创建域名来源
- `newAddress()` 在写入前只校验域名是否在允许列表中
- 定时清理主要依赖 `created_at` / `updated_at`
- 地址本身没有显式的生命周期字段

此外，仓库中还有大量调用点仍隐式依赖 env-based exact-domain 语义，包括：
- `/open_api/settings`
- health check
- 用户角色域名过滤
- 前后台域名下拉
- 后台创建地址
- E2E fixtures

因此本次设计必须明确旧访问层如何迁移，而不能只新增一套 DB 配置后放任旧调用点继续各自读取 env。

### Reference Inputs
本次改造有两个直接参考：
1. `auto_reg_gpt` 中 Cloudflare temp mail 的泛域名展开方案：配置保留 `*.root-domain`，创建邮箱时再展开为具体随机子域。
2. 用户提供的 `/home/ootonn/Desktop/worker.txt`：该版本已经具备单域名 wildcard 规则匹配能力（如 `isWildcardDomainRule` / `isDomainAllowed`），可作为“规则匹配层”的参考，但其仍缺少：
   - 多主域名启用池
   - 自动生成随机具体子域
   - 地址 90 天有效期管理
   - 管理端一体化配置入口

### Product Constraints Confirmed with User
- Cloudflare 泛域名应作为**唯一主入口**，不是普通 `DOMAINS` 的附属能力。
- 管理端要能快速选择“当前使用哪几个主域名参与泛解析”。
- 泛解析地址只保证**收信**，不要求支持发信。
- 地址应能在创建后持续接收新邮件 **90 天**。
- 有效期采用**固定 90 天**，不是按收件或访问自动续期。
- 第一版不需要手动续期或长期保留功能。

## Options Considered
### Option A: Keep Patching `DOMAINS`
直接把 `*.a.com` 之类规则继续塞进 `DOMAINS`，然后在 `newAddress()` 内部加随机子域展开与生命周期逻辑。

**Pros**
- 代码改动少
- 兼容当前部分接口字段

**Cons**
- Cloudflare 语义不够一体化
- 管理端无法自然表达“泛域名池”和“启用集合”
- 后续功能扩展会继续纠缠在旧 exact-domain 模型里

### Option B: Cloudflare Wildcard as First-Class Configuration (**Recommended**)
将 Cloudflare 泛域名提升为单独的一体化配置模型，并以其驱动创建地址、UI 选择与生命周期控制。

**Pros**
- 与用户预期完全一致
- 能自然表达多主域名池与启用集合
- 可在不重做全部系统的前提下完成一体化改造

**Cons**
- 需要新增配置 API、UI 状态和地址过期字段

### Option C: Fully Generalized Domain Policy Engine
把 exact/wildcard/role/retention 都抽象成统一策略对象。

**Pros**
- 长期最灵活

**Cons**
- 对当前需求明显过度设计
- 改动面过大，风险高

## Selected Approach
采用 **Option B**：将 Cloudflare 泛域名配置做成系统主入口，并围绕它实现：
- 多主域名泛解析
- 管理端启用集合切换
- 创建时随机展开具体子域
- 地址固定 90 天有效期

## Architecture
### 1. Configuration Model
新增 Cloudflare 一体化配置，主存储位置为 **DB settings**，而不是仅依赖 Wrangler 环境变量。这样管理端可以真正做到在线配置与切换。

建议新增三个配置项：
- `cloudflare_wildcard_domains`
  - 全量泛域名池
  - 示例：`["*.a.com", "*.b.net", "*.c.org"]`
- `cloudflare_active_wildcard_domains`
  - 当前启用集合
  - 必须是全量池的子集
- `cloudflare_address_retention_days`
  - 默认地址有效期天数
  - 本次确认为 `90`

### 1.1 Source-of-truth transition
本次不采用“所有旧调用点各自重写”的方式，而是采用**集中配置访问层**：

- `cloudflare_wildcard_domains` / `cloudflare_active_wildcard_domains` / `cloudflare_address_retention_days`
  - 作为新的主配置来源
  - 持久化在 DB settings
- 新增 async 配置读取接口（例如 `getCloudflareWildcardConfig(c)`）
  - 优先读取 DB 中的 Cloudflare wildcard 配置
  - 若 DB 尚未配置，则回退到 env 的 `DOMAINS` / `DEFAULT_DOMAINS`
- 现有同步 `getDomains()` / `getDefaultDomains()`
  - 不直接升级成“同步读 DB”的伪兼容层
  - 要么保留为 env/bootstrap-only 辅助函数
  - 要么在实现中逐步退出核心创建路径

这样做的目的有两个：
- 明确承认 DB settings 读取是异步能力，不能假装无缝替换同步 helper
- 让现有大量依赖域名配置的 async 调用点逐步切换到统一配置读取接口
- 让 env 在迁移期只承担 bootstrap / fallback 角色，而不是长期主来源

### 1.2 Bootstrap behavior
对于尚未保存 DB 配置的新部署：
- 若 env 中已提供 wildcard 规则，则这些值可作为初始可用配置
- 若 env 与 DB 都为空，则系统视为未配置 Cloudflare wildcard，地址创建必须失败并给出明确错误

### 1.3 Dedicated admin settings API
由于当前 `WorkerConfig.vue` 和 `/admin/worker/configs` 是只读结构，本次不直接把它们改造成保存入口，而是新增专门的 Cloudflare wildcard 设置 API：
- `GET /admin/cloudflare_wildcard_settings`
- `POST /admin/cloudflare_wildcard_settings`

`/admin/worker/configs` 仍可保留为只读汇总接口，但新的可编辑表单应基于专门的 settings API。

### 2. Domain Rule Semantics
系统只接受符合以下语义的 Cloudflare 根规则：
- 必须是 `*.` 开头
- 只允许标准域名后缀
- 例如：`*.a.com`、`*.mail.example.net`

运行时区分：
- **Rule domain**：配置中的泛规则，如 `*.a.com`
- **Concrete domain**：创建时展开后的具体子域，如 `silverharbor.a.com`

所有真正写入数据库、JWT、对外返回、收件匹配的地址都必须使用 **concrete domain**。

### 2.1 Receive allow rule
在 Cloudflare wildcard-only 模式下，系统必须显式规定：

- 只有**已创建且未过期**的 concrete address 才允许接收邮件
- 对于任何“命中了 Cloudflare wildcard routing，但本地 `address` 表中不存在”的 concrete address，worker 必须拒收
- 该拒收行为不能再依赖 `blockReceiveUnknowAddressEmail` 的开关；在本模式下它是默认安全要求

### 2.2 Send-mail rule
在 Cloudflare wildcard-only 模式下，动态生成的 concrete subdomain address 明确定义为**仅收信地址**：

- 前台 `enableSendMail` 应视为 `false`
- 前台发送邮件入口应隐藏或禁用
- `/api/send_mail`、后台手动发信、SMTP 代理等发送路径若使用 wildcard-created address 作为发件地址，必须返回明确的“不支持该地址发信”错误

也就是说，本次不是“best effort 发信”，而是产品层明确声明为**不支持发信**。

### 3. Address Creation Flow
#### 3.1 Admin configuration stage
管理员先在管理端配置：
- 全量 Cloudflare 泛域名池
- 当前启用集合
- 地址有效期（默认 90 天）

#### 3.2 User/admin address creation stage
当 `/api/new_address` 或 `/admin/new_address` 被调用时：
1. 系统读取当前启用的 Cloudflare 泛域名集合
2. 若请求明确指定某条启用规则，则使用该规则
3. 若未指定，则按现有默认策略从启用集合中选一条
4. 对选中的 `*.root-domain` 执行随机子域展开
5. 拼出最终地址：`localpart@<random-subdomain>.<root-domain>`
6. 写入 `address` 表，并同时写入 `expires_at`

以下写地址入口都必须复用同一套逻辑：
- `/api/new_address`
- `/admin/new_address`
- Telegram 新建地址

### 4. Random Subdomain Expansion
随机子域生成遵循 `auto_reg_gpt` 的已验证思路：
- 对 `*.` 开头的规则执行展开
- 默认用两个英文单词拼接，全部小写
- 若清洗后结果为空，则回退到随机字母串
- 每创建一个邮箱生成一个新的具体子域，不复用旧子域

示例：
- `*.a.com` -> `mistbrook.a.com`
- `*.b.net` -> `silverharbor.b.net`

### 5. Address Lifetime Model
#### 5.1 New field
在 `address` 表新增：
- `expires_at DATETIME`

#### 5.2 Lifetime behavior
创建地址时：
- `expires_at = now + 90 days`

地址在 `expires_at` 之前视为**可继续收新邮件**。

#### 5.2.1 Expiration semantics
过期语义采用**立即失效**，而不是“等 cleanup 删除后才失效”：

- 当 `now >= expires_at` 时，该地址立即视为失效
- 即使 cleanup 尚未执行，也必须：
  - 拒绝继续收件
  - 拒绝基于该地址的登录 / JWT 访问 / 收件箱读取

因此，所有基于地址身份的关键流程都必须校验 `expires_at > now`，不能只检查地址记录是否存在。

#### 5.2.2 JWT handling
当前地址 JWT 没有独立的地址生命周期语义，因此本次不依赖 JWT 自带 `exp` 管地址有效期。

运行时应采用：
- 先通过 JWT 找到地址记录
- 再校验该地址的 `expires_at > now`

换句话说，旧 JWT 在地址过期后即使签名仍有效，也必须被视为不可用。

#### 5.3 Explicit non-goals
本次不实现：
- 收件自动续期
- 访问自动续期
- 管理员手动续期
- 永久保留标记

### 6. Cleanup Behavior
现有 cleanup 逻辑不能再只看 `created_at` / `updated_at`。对于地址相关清理，必须遵循：
- 若 `expires_at` 仍在未来，则不得删除该地址
- 只有 `expires_at <= now` 时，地址才可进入地址清理范围

这意味着以下行为需要调整：
- inactiveAddress cleanup
- addressCreated cleanup
- unboundAddress cleanup
- emptyAddress cleanup

### 6.1 Combined predicates
地址相关 cleanup 必须统一增加 `expires_at <= datetime('now')` 保护条件。也就是说：

- `inactiveAddress`
  - 仅删除 `updated_at` 满足阈值 **且** 已过期的地址
- `addressCreated`
  - 仅删除 `created_at` 满足阈值 **且** 已过期的地址
- `unboundAddress`
  - 仅删除未绑定用户 **且** 已过期的地址
- `emptyAddress`
  - 仅删除无邮件 **且** 已过期的地址

### 6.2 Custom SQL cleanup restriction
为了兑现“地址 90 天内可继续收件”的保证，第一版必须收紧 `customSqlCleanupList`：

- 不允许自定义 SQL 直接删除 `address` 表数据
- 如有必要，也可一并禁止删除 `users_address` 等地址关联核心表

换句话说，自定义 SQL cleanup 在第一版只能用于非地址生命周期主路径的数据清理，不能绕过 `expires_at` 保护。

本次目标只保证“地址 90 天内仍可收件”，因此：
- `raw_mails` 仍可按现有邮件级清理策略运行
- 不要求把历史邮件也统一保留 90 天

### 7. Open API and UI Data Shape
为了减少现有前端改动，建议新增而不是硬替换字段：
- `/open_api/settings` 增加：
  - `cloudflareWildcardDomains`
  - `activeCloudflareWildcardDomains`
  - `cloudflareAddressRetentionDays`

前台和管理台仍可保留原 `domains` 字段作为兼容层，但在 Cloudflare-only 模式下，其主语义变为“可选 wildcard rule 列表”，而不是 exact domain 列表。

### 7.1 Mapping to existing frontend structures
为了让当前前端最小改动可落地，兼容映射规则明确如下：

- `open_api.settings.domains`
  - 返回当前**启用中的 wildcard rules**
  - 例如：`["*.a.com", "*.b.net"]`
- `open_api.settings.defaultDomains`
  - 在 Cloudflare-only 模式下，默认与 `domains` 相同
  - 用于兼容现有匿名用户下拉逻辑
- `DOMAIN_LABELS`
  - 若继续保留，则按 wildcard rules 顺序一一对应
- `USER_ROLES[].domains`
  - 从“允许 exact domains”转为“允许的 wildcard rules 子集”
- 前台下拉框
  - 展示的是 wildcard rule
  - 用户选中后提交的也是 wildcard rule
  - 后端再将其展开为 concrete domain
- 返回给用户的地址
  - 永远是 concrete address

### 8. Admin UI Changes
在现有管理界面基础上做最小改造，不引入大规模页面重构。

建议在管理端增加一个 Cloudflare 配置区域，支持：
- 编辑全量泛域名池
- 多选当前启用集合
- 设置默认地址有效期（固定为 90 天，也可保留为可编辑输入框，默认值 90）

交互要求：
- 当前启用集合必须来源于全量池
- 空启用集合时应阻止创建地址，或给出明确错误
- 保存前做基础规则校验（必须是 `*.` 规则）

实现方式建议为：
- 在现有 `WorkerConfig` 页面中新增可编辑 Cloudflare 表单区，或新增独立管理子页
- 表单读写使用专门的 `GET/POST /admin/cloudflare_wildcard_settings`
- `GET /admin/worker/configs` 可保留调试用途，但不是保存入口

### 9. Mail Receive Compatibility
Cloudflare 侧继续依赖泛域名路由：
- DNS / Email Routing 规则需保持 wildcard 生效
- Worker 接收的收件地址将是具体子域邮箱地址
- 当前 `email()` 存储逻辑仍然以具体收件地址为准，无需改变总体模型

关键点在于：
- 只要 Cloudflare wildcard routing 持续有效
- 且本地 `address` 记录存在并且 `expires_at > now`
- 对应地址就能继续接收新邮件

## File/Module Impact
### Worker backend
预计需要改动：
- `worker/src/utils.ts`
  - 保留或收缩旧的同步 env helper
  - 增加 async Cloudflare wildcard 配置读取与规则校验辅助函数
- `worker/src/common.ts`
  - 增加 wildcard 规则选择、随机展开、具体域名解析与 `expires_at` 写入逻辑
  - 调整 cleanup 对地址生命周期的判断
- `worker/src/email/index.ts`
  - 在 Cloudflare wildcard-only 模式下，对未创建或已过期的 concrete address 强制拒收
- `worker/src/types.d.ts`
  - 增加新的配置与数据结构类型
- `worker/src/commom_api.ts`
  - 向前端暴露 Cloudflare wildcard 配置
- `worker/src/admin_api/worker_config.ts`
  - 返回管理端 Cloudflare wildcard 配置
- `worker/src/admin_api/index.ts` 或新增专门模块
  - 提供 `GET/POST /admin/cloudflare_wildcard_settings`
- `worker/src/mails_api/index.ts`
  - 地址 JWT 登录后的收件箱访问需要校验地址未过期
- `worker/src/mails_api/address_auth.ts`
  - 地址密码登录需要校验地址未过期
- `worker/src/worker.ts`
  - health check 中的域名配置判定要兼容 DB-first Cloudflare wildcard 配置
- `worker/src/user_api/bind_address.ts`
  - `transferAddress()` 这类重写 address 行的路径需要保留原地址的剩余有效期
- 所有当前同步依赖域名配置的关键调用点
  - 需要迁移到 async 配置访问模式，不能假设“同步 helper 可以无缝改成读 DB”

### Database
预计需要新增 migration：
- 为 `address` 表增加 `expires_at`
- 必要时为 `expires_at` 增加索引，以支持 cleanup 查询
- 通过现有 DB version / migration 机制接入，而不是只修改静态 `schema.sql`

### Frontend
预计需要改动：
- `frontend/src/views/admin/WorkerConfig.vue`
  - 从纯 JSON 展示扩展为 Cloudflare wildcard 配置编辑区，或拆分为新管理页面
- `frontend/src/api/index.js`
  - 接收并缓存 Cloudflare wildcard 配置
- 可能涉及域名选择组件
  - 让前台下拉展示 wildcard rules，而创建后显示具体地址

## Error Handling
需要新增并覆盖以下错误场景：
- 未配置任何 Cloudflare 泛域名池
- 当前启用集合为空
- 启用集合中包含不在全量池里的域名
- 泛规则格式非法（非 `*.` 开头）
- 创建地址时指定了未启用规则
- 地址过期后仍尝试使用旧 JWT/旧地址收件查询时的边界行为

## Testing Strategy
### Unit tests
至少覆盖：
- wildcard 规则合法性校验
- 多主域名启用集合选择逻辑
- 随机子域展开逻辑
- `newAddress()` 对 concrete domain 的写库行为
- `expires_at = now + 90 days`
- cleanup 对未过期地址的保护
- cleanup 对已过期地址的删除行为

为了让这些测试稳定可重复，本次还应同步抽出两个可注入依赖：
- 子域随机生成器（允许测试中传入固定 RNG / 固定输出）
- 当前时间提供器（允许测试中固定 `now`）

### Worker test harness
当前仓库几乎没有现成的 worker 单测基础设施，因此本次实现需要明确：
- 为 `worker` 增加最小可用的测试入口（推荐 Vitest）来覆盖纯函数和时间逻辑
- Playwright E2E 继续负责 API 和生命周期集成验证

### E2E tests
至少覆盖：
- 管理端保存 Cloudflare wildcard 配置
- 使用启用规则创建地址，返回 concrete domain
- 创建结果地址在 API 中可正常收件
- 未启用规则不可被创建
- 地址在有效期内不会被 cleanup 误删

## Migration Notes
### Existing deployments
对于已有部署，迁移时需要：
1. 给 `address` 表补 `expires_at`
2. 为历史地址设置兜底策略：
   - 可以选择 `created_at + 90 days`
   - 或对已有地址写入一个统一默认值
3. 管理端首次保存 Cloudflare wildcard 配置后，系统进入 Cloudflare-only 模式
4. 所有写 address 的路径必须统一审计：
   - `/api/new_address`
   - `/admin/new_address`
   - Telegram 新建地址
   - `transferAddress()` 这种“删除再重建”的路径

其中 `transferAddress()` 应保留原地址剩余有效期，不应重置为新的 90 天。

### Compatibility expectation
由于用户已确认采用 **Cloudflare wildcard-only** 方案，因此本次不要求继续把 exact-domain 作为主创建入口。兼容层仅用于减少前端一次性改动，不作为长期主模型。

## Summary
本设计将当前项目从“普通域名列表驱动”升级为“Cloudflare 泛域名一体化驱动”：
- 主配置变为 Cloudflare 泛域名池和启用集合
- 地址创建时将 wildcard 规则展开为随机具体子域
- 生成的地址只保证收信，不保证发信
- 地址创建后固定有效 90 天
- cleanup 必须尊重 `expires_at`
- 管理端可直接完成 Cloudflare 泛域名配置与启用切换
