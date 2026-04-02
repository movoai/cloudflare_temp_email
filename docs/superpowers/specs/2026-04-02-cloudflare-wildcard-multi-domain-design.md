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

### 2. Domain Rule Semantics
系统只接受符合以下语义的 Cloudflare 根规则：
- 必须是 `*.` 开头
- 只允许标准域名后缀
- 例如：`*.a.com`、`*.mail.example.net`

运行时区分：
- **Rule domain**：配置中的泛规则，如 `*.a.com`
- **Concrete domain**：创建时展开后的具体子域，如 `silverharbor.a.com`

所有真正写入数据库、JWT、对外返回、收件匹配的地址都必须使用 **concrete domain**。

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

### 9. Mail Receive Compatibility
Cloudflare 侧继续依赖泛域名路由：
- DNS / Email Routing 规则需保持 wildcard 生效
- Worker 接收的收件地址将是具体子域邮箱地址
- 当前 `email()` 存储逻辑仍然以具体收件地址为准，无需改变总体模型

关键点在于：
- 只要 Cloudflare wildcard routing 持续有效
- 且本地 `address` 记录在 90 天内未被 cleanup 删除
- 对应地址就能继续接收新邮件

## File/Module Impact
### Worker backend
预计需要改动：
- `worker/src/utils.ts`
  - 增加 Cloudflare wildcard 配置解析与规则校验辅助函数
- `worker/src/common.ts`
  - 增加 wildcard 规则选择、随机展开、具体域名解析与 `expires_at` 写入逻辑
  - 调整 cleanup 对地址生命周期的判断
- `worker/src/types.d.ts`
  - 增加新的配置与数据结构类型
- `worker/src/commom_api.ts`
  - 向前端暴露 Cloudflare wildcard 配置
- `worker/src/admin_api/worker_config.ts`
  - 返回管理端 Cloudflare wildcard 配置
- `worker/src/admin_api/index.ts` 或新增专门模块
  - 提供读写 Cloudflare wildcard 配置的 API

### Database
预计需要新增 migration：
- 为 `address` 表增加 `expires_at`
- 必要时为 `expires_at` 增加索引，以支持 cleanup 查询

### Frontend
预计需要改动：
- `frontend/src/views/admin/WorkerConfig.vue`
  - 从纯 JSON 展示改为包含 Cloudflare wildcard 配置编辑区
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
