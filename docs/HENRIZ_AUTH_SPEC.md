# Henri Z 统一管理员认证服务技术方案

> 文件：`HENRIZ_AUTH_SPEC.md`  
> 状态：可实施设计（v1）  
> 核对日期：2026-09-27  
> 目标域名：`https://auth.henriz.dev`

## 1. 摘要与关键决策

建立一个仅供 Henri Z 自用的中央认证服务，供 Edit Page、Licentra、Verbia 等后台统一登录。认证服务使用 Next.js App Router + TypeScript，部署到 Vercel；数据存储使用独立 Neon Postgres 项目，通过 Prisma 访问。

核心决策：

- 日常主认证为 Passkey/WebAuthn；同一 Admin 可注册多个独立凭据（Mac、iPhone、备用安全密钥等），不要求 iCloud 同步。
- 现有 TOTP 保留为 bootstrap/recovery credential，不作为默认登录入口。
- 中央认证域仅设置 host-only Cookie；绝不设置 `Domain=.henriz.dev`。
- 各后台拥有自己的独立 HttpOnly session。没有本地 session 时跳转中央 `/authorize`。
- 中央 session 有效时直接签发短期、单次 authorization code；否则先完成认证再签发。
- 后台只在服务器端向中央 `/api/token` 交换 code；设计借鉴 OAuth 2.0 Authorization Code Flow，但不宣称完整实现 OAuth 2.0/OIDC，也不签发通用 access/refresh token。
- authorization code、session token、challenge 均使用 CSPRNG；数据库只保存不可逆摘要。redirect URI 必须精确匹配 allowlist。
- SimpleWebAuthn 仅负责 WebAuthn 协议细节；实现时必须按锁定版本核对当前 API，禁止手写 WebAuthn 密码学。

## 2. 套餐适用性（截至 2026-09-27）

### 2.1 Neon Free Plan

Neon 2026-09-17 的官方说明称，Free Plan 包含 **100 个项目**，每项目 **100 CU-hours/月、0.5 GB 数据库存储、10 个分支**。这是比 2025 年“10 个项目/每项目 50 CU-hours”更新的官方信息，实施时应以 Neon Console 显示的账户配额与[最新定价页](https://neon.com/pricing)为最终依据。来源：[Neon backend GA 官方公告](https://neon.com/blog/neon-backend-is-ga)。

结论：已有两个免费 Neon 项目时，通常仍可创建第三个独立项目 `henriz-auth`，无需复用现有业务库。单用户、低频认证的数据量（凭据、session、code、审计记录）远低于 0.5 GB，计算用量也通常适合免费层。建议：

- 创建独立项目而不是在某个业务库内增加 schema，缩小故障域和权限范围。
- 生产连接使用 pooled connection string；迁移使用 direct connection string。
- 设置合理 idle suspend，并接受冷启动可能增加首次登录延迟。
- 免费层不是高可用承诺；额度、暂停策略、备份/恢复窗口和产品条款可能变化。上线前与每季度复核控制台及官方定价。
- 认证成为多个后台的共同依赖后，若停机影响不可接受，应升级付费方案并建立外部备份；“数据量够用”不等于“可用性满足生产要求”。

### 2.2 Vercel Hobby

Vercel 官方文档（最后更新 2026-09-14）说明 Hobby 面向个人、非商业、小规模项目，包含每月 100 GB Fast Data Transfer、1,000,000 Edge Requests、1,000,000 Function Invocations、4 CPU-hours、360 GB-hours 内存，最多 200 个项目；超额后免费资源通常会暂停，且 Hobby 仅允许个人非商业用途。来源：[Vercel Hobby Plan](https://vercel.com/docs/plans/hobby)。

结论：若这些后台确属 Henri Z 的个人、非商业、自用工具，Hobby 在容量上适合该单人低流量服务。若后台服务商业活动、客户或团队，或认证可用性有业务承诺，应使用 Pro/合适付费方案。无论使用 Hobby 还是 Neon Free，本方案**不承诺 SLA**。

## 3. Goals

- 一个 Admin 身份登录多个自有后台。
- Passkey-first，支持多设备、多凭据独立注册、命名、查看最后使用时间与撤销。
- 保留 TOTP 作为首个 Passkey bootstrap 和 Passkey 全部不可用时的恢复路径。
- 已有中央 session 时，在后台之间跳转可无感完成。
- 每个后台隔离 session；一个后台 Cookie 泄露不能直接作为其他后台或中央认证 Cookie 使用。
- code 短期、单次使用、绑定 client/redirect URI/PKCE，并能抗重放。
- 所有高风险动作有 step-up、审计和会话撤销能力。
- 可在 Vercel/Neon 免费层低流量运行，且能平滑迁移到付费层。

## 4. Non-goals

- 不做公开注册、多租户、社交登录、密码登录、邮箱找回。
- 不做完整 OAuth 2.0/OIDC provider，不提供 discovery、通用 scope、consent、refresh token 或第三方开发者平台。
- 不让浏览器或后台直接读取中央 session。
- 不使用跨子域共享 Cookie，不在 URL 中传递 session/token/secret。
- v1 不支持 native app、跨顶级域 RP、企业目录或复杂 RBAC。
- TOTP 不是默认日常登录方式，也不是降低 step-up 要求的捷径。

## 5. Threat model

### 5.1 保护资产

- Admin 身份、Passkey public key/credential metadata、TOTP secret。
- 中央与各后台 session、authorization code、client secret、加密主密钥。
- client allowlist、审计记录和修改安全设置的权限。

### 5.2 主要攻击者与风险

- 互联网攻击者：暴力尝试 TOTP、code 猜测、扫描接口、DoS。
- 恶意网站：登录 CSRF、跨站请求、点击劫持、WebAuthn origin 混淆。
- XSS：窃取页面可读数据、代替用户发起操作。
- 某一后台被攻陷：偷取该 client secret、本地 session 或 code。
- 数据库只读泄露：读取 session/code 摘要、TOTP 密文和 WebAuthn public key。
- 日志/监控泄露：URL、header、secret 被意外记录。
- 设备丢失：某个 Passkey 可被本机解锁机制使用。

### 5.3 信任边界与假设

- HTTPS、浏览器 WebAuthn 实现和设备 authenticator 可信。
- `auth.henriz.dev` DNS、Vercel 与部署账号需强 MFA；其失陷等同认证服务失陷。
- 后台服务器可信地保管各自 client secret。
- TOTP seed 的加密密钥与数据库分离，放在 Vercel encrypted environment variables/secret store。
- 单个 client 被攻陷不应自动攻陷其他 client；但它仍可冒充自身向中央换码。

## 6. 架构

```text
Browser
  │
  ├── app session cookie ──> admin.editpage.example
  │                              │ server-to-server /api/token
  ├── app session cookie ──> admin.licentra.example ──────────┐
  │                                                          │
  └── host-only __Host-henriz_auth ──> auth.henriz.dev <──────┘
                                           │
                                           ├── Prisma
                                           └── Neon Postgres
```

部署组件：

- `auth.henriz.dev`：Next.js App Router Node.js runtime；登录 UI、WebAuthn、session、authorize、token exchange、安全设置。
- 各 Admin app：redirect 发起端、callback、服务端 token exchange、本地 session。
- Neon：认证唯一事实源。
- 可选外部备份目标：加密后的 `pg_dump`，不与 Neon/Vercel 同账号保存。

## 7. SSO 时序

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as Admin App
  participant H as auth.henriz.dev
  participant D as Neon

  B->>A: GET /admin
  A-->>B: 302 /authorize?client_id&redirect_uri&state&code_challenge
  B->>H: GET /authorize
  H->>D: validate client + central session
  alt central session valid
    H->>D: create one-time code (hashed, <=60s)
  else no/expired session
    H-->>B: minimal Passkey login page
    B->>H: authentication options
    H->>D: store short-lived challenge
    H-->>B: PublicKeyCredentialRequestOptionsJSON
    B->>B: navigator.credentials.get()
    B->>H: authentication response
    H->>D: verify, update counter, create central session + code
  end
  H-->>B: 302 exact redirect_uri?code=...&state=...
  B->>A: GET /auth/callback?code&state
  A->>A: constant-time validate state; consume state record
  A->>H: POST /api/token (code, client auth, redirect_uri, verifier)
  H->>D: atomic consume code
  H-->>A: subject assertion + auth metadata
  A->>A: rotate/create independent HttpOnly session
  A-->>B: 303 clean post-login URL
```

## 8. 项目结构

```text
henriz-auth/
├── app/
│   ├── (public)/login/page.tsx
│   ├── (protected)/security/page.tsx
│   ├── (public)/recovery/page.tsx
│   ├── authorize/route.ts
│   └── api/
│       ├── webauthn/register/options/route.ts
│       ├── webauthn/register/verify/route.ts
│       ├── webauthn/authenticate/options/route.ts
│       ├── webauthn/authenticate/verify/route.ts
│       ├── totp/verify/route.ts
│       ├── passkeys/[id]/route.ts
│       ├── sessions/route.ts
│       ├── sessions/revoke/route.ts
│       ├── token/route.ts
│       ├── logout/route.ts
│       └── health/route.ts
├── components/PasskeyButton.tsx
├── lib/
│   ├── auth/session.ts
│   ├── auth/step-up.ts
│   ├── webauthn/config.ts
│   ├── webauthn/service.ts
│   ├── totp/service.ts
│   ├── sso/authorize.ts
│   ├── sso/code.ts
│   ├── crypto/aead.ts
│   ├── crypto/token-hash.ts
│   ├── rate-limit.ts
│   ├── audit.ts
│   ├── db.ts
│   └── env.ts
├── prisma/schema.prisma
├── middleware.ts
├── tests/{unit,integration,e2e}/
└── scripts/{bootstrap-admin,rotate-key,backup-verify}.ts
```

所有敏感 route 强制 Node.js runtime，避免 Prisma/加密库与 Edge runtime 差异。Server Components 不得把 secret、完整 credential 或 session 序列化给客户端。

## 9. 极简 UI

### 9.1 `/login`

- Henri Z 标识、一个主按钮“使用 Passkey 登录”。
- 浏览器调用 `navigator.credentials.get()`；失败只显示可理解的通用错误。
- 次级链接“Passkey 不可用？使用恢复方式”，进入 `/recovery`。
- 不显示用户名枚举信息；单管理员可用 discoverable credential/usernameless flow。
- 登录成功继续原始、服务器保存且已校验的 authorize transaction；禁止信任任意 `returnTo`。

### 9.2 `/security`

- Passkey 列表：名称、设备类型（若可知）、创建时间、最后使用时间、备份状态、撤销按钮。
- “添加 Passkey”先完成 step-up，再要求输入容易识别的名称。
- TOTP 状态：已启用/未启用、最后使用；修改/关闭入口。
- 活跃中央 session 列表：近似设备信息、创建/最后活动时间、撤销。
- “退出所有设备”与高风险操作明确分开。

### 9.3 `/recovery`

- 输入 6 位 TOTP；不泄露凭据是否存在。
- 成功只建立受限、短时 recovery/step-up 状态，立即引导注册新 Passkey。
- 若仍有 Passkey，TOTP 登录完成后也建议使用 Passkey 再确认高风险操作。
- 不提供电子邮件自动恢复。TOTP 也丢失时走离线人工灾难恢复流程。

## 10. WebAuthn 配置

生产固定配置：

```ts
export const webauthnConfig = {
  rpName: "Henri Z Admin",
  rpID: "auth.henriz.dev",
  expectedOrigins: ["https://auth.henriz.dev"],
  timeoutMs: 60_000,
} as const;
```

- RP ID 必须为当前 origin 的有效 registrable-domain suffix。生产推荐精确使用 `auth.henriz.dev`，使凭据仅可在该 host 范围使用；不要用 `henriz.dev` 扩大范围。
- `expectedOrigin` 必须精确为 HTTPS origin，不允许通配符、preview URL 或从请求 Host 动态推导。
- 本地开发独立配置：例如 `rpID=localhost`、`origin=http://localhost:3000`；测试数据与生产数据库隔离。
- Vercel preview deployment 不得连接生产 auth 数据库，也不得被加入生产 expected origins。
- 注册使用 `residentKey: "required"`、`userVerification: "required"`；认证同样要求 `userVerification: "required"`。
- attestation 默认 `none`，不基于设备厂商作授权判断。
- 注册时传入当前 Admin 的 `excludeCredentials`，防止重复注册同一 credential。

## 11. WebAuthn challenge 流程

### 11.1 注册

1. 要求有效中央 session，且最近 5 分钟内完成 step-up。
2. 服务端生成注册 options；`user.id` 为稳定、非邮箱的随机 bytes，`challenge` 由成熟库/CSPRNG 生成。
3. 保存 challenge 摘要、用途 `REGISTRATION`、Admin、transaction id、过期时间（5 分钟）和 attempt 限制；或将同等内容放入加密且完整性保护的短期 host-only Cookie。不得仅存在 React state/localStorage。
4. 浏览器调用 `startRegistration()`（SimpleWebAuthn browser 包）。
5. verify endpoint 原子消费 challenge，使用 `verifyRegistrationResponse()` 校验 challenge、origin、RP ID、UV。
6. 在事务中创建 `PasskeyCredential`；credential ID 唯一。成功后记录审计事件。
7. 首次 bootstrap 完成前，至少保留一个 TOTP；首次 Passkey 写入成功后才允许进入正常状态。

### 11.2 认证

1. 生成 authentication options。优先 usernameless/discoverable credential，不传用户名；`allowCredentials` 可省略。
2. 保存 `AUTHENTICATION` challenge，5 分钟过期且单次使用。
3. 浏览器调用 `startAuthentication()`。
4. 依据 response credential ID 查询未撤销凭据与 Admin；调用 `verifyAuthenticationResponse()`，严格校验 challenge、origin、RP ID、UV、public key 和 counter。
5. 验证成功后更新 `counter`、`lastUsedAt`、备份状态，并旋转/建立中央 session。
6. counter 回退或异常不得简单忽略：拒绝此次认证或标记风险并要求另一凭据/TOTP；具体按锁定版本 SimpleWebAuthn 对 multi-device credential 的建议实现并测试。

> 实现要求：安装时查阅 [SimpleWebAuthn 官方文档](https://simplewebauthn.dev/docs/) 与所锁定版本类型定义；API 字段会变化。禁止自行解析 authenticator data、验证签名或实现 COSE。

## 12. 多 Passkey 管理

- 每个凭据有用户可编辑的 `name`，默认如“MacBook Pro · 2026-09-27”，名称 1–80 字符并做输出编码。
- 不假设 transport 或 deviceType 能唯一识别物理设备；它们只用于展示。
- 添加任意新 Passkey 必须 step-up：已有 Passkey 或 TOTP，完成时间不超过 5 分钟。
- 修改名称要求当前 session + CSRF；不必 step-up。
- revoke 要求 step-up；不物理删除，设置 `revokedAt`，并记录审计。
- 禁止撤销最后一个 Passkey，除非 TOTP 已验证可用并明确确认；推荐始终保留两个独立设备凭据。
- 凭据撤销后无法恢复，只能重新注册。

## 13. TOTP

### 13.1 存储与加密

- 使用成熟 TOTP 库，参数默认 SHA-1、6 digits、30 秒，以兼容主流 authenticator；不要手写 HOTP/TOTP。
- seed 以 AES-256-GCM 加密，存储 `ciphertext`、随机 96-bit nonce、auth tag、`keyVersion`；AAD 至少绑定 `adminId|credentialId|purpose`。
- `TOTP_ENCRYPTION_KEYS` 仅在服务端环境保存，格式为版本到 32-byte key 的映射；当前写入 key 与历史解密 key 可并存以支持轮换。
- 数据库泄露与环境密钥泄露同时发生才能直接得到 seed。日志、错误、审计、analytics 永不保存 seed、otpauth URI、QR 内容或完整 OTP。

### 13.2 验证、限速与防重放

- 接受时钟窗口默认当前 step ±1（总计 90 秒），部署时可收紧；记录成功使用的 `lastUsedTimeStep`。
- 同一 TOTP time-step 只允许成功一次：事务中仅当新 step 大于 `lastUsedTimeStep` 才更新，否则拒绝重放。
- 使用恒定时间比较库能力；响应统一，不区分错误原因。
- 多层限速：IP、Admin/credential、transaction。建议 5 次/10 分钟后指数退避，连续失败 10 次锁定 TOTP 30 分钟；成功后清理短期失败计数但保留审计。
- Serverless 内存限流不是安全边界。v1 可用数据库事务表/计数列；流量增长后使用托管原子限流存储。
- 反向代理 IP 只信任 Vercel 提供的受控 header 语义，不盲目信任客户端 `X-Forwarded-For`。

## 14. Bootstrap、step-up 与 recovery

### 14.1 首次 bootstrap

1. 通过一次性管理脚本创建唯一 Admin 和已加密的现有 TOTP seed；脚本从交互式 stdin/安全环境读取 secret，不进入 shell history、源码或日志。
2. Admin 打开 `/recovery?bootstrap=<one-time-token>`。bootstrap token 为 32-byte random，数据库仅存摘要，15 分钟过期、单次使用。
3. 验证现有 TOTP。
4. 建立 `BOOTSTRAP` assurance，5 分钟内注册首个 Passkey。
5. 只有 Passkey 注册事务提交后才把 Admin 状态从 `BOOTSTRAP_REQUIRED` 改为 `ACTIVE`。
6. 清除 bootstrap token，轮换 session，并记录 `ADMIN_BOOTSTRAPPED`。

### 14.2 Step-up 规则

| 操作 | 必需认证 | 新鲜度 |
|---|---|---:|
| 添加 Passkey | 已有 Passkey 或 TOTP | 5 分钟 |
| revoke Passkey | Passkey 优先；否则 TOTP | 5 分钟 |
| 修改/关闭 TOTP | **Passkey 必需**（正常情况） | 5 分钟 |
| 重置 TOTP（旧 seed 丢失） | Passkey + 明确确认 | 5 分钟 |
| 撤销所有 sessions | Passkey 优先；recovery 模式可 TOTP | 5 分钟 |
| 普通 SSO authorize | 有效中央 session | 按 session 策略 |

step-up 状态保存在服务端 session 中：`authMethod`、`authenticatedAt`、`assurance`。不能由客户端参数声明。

### 14.3 Recovery

- 有 TOTP：验证后建立最多 10 分钟的受限 recovery session，只能注册 Passkey、查看/撤销 session、退出；完成新 Passkey 注册后轮换为正常 session。
- 有其他 Passkey：直接使用它登录并添加新凭据。
- Passkey 全失且 TOTP 全失：无在线自动绕过。使用离线 runbook：确认操作者身份和控制权、进入维护窗口、备份数据库、通过受审计 CLI 创建一次性 bootstrap token；完成后立刻注册两个 Passkey、重置 TOTP、撤销全部历史 session/client code。该流程的风险由所有者承担。

## 15. Session 设计

### 15.1 中央 session

- Cookie 名：`__Host-henriz_auth`。
- 属性：`Secure; HttpOnly; Path=/; SameSite=Lax`；不设置 `Domain`。`__Host-` 前缀保证 host-only + `/`。
- 值为 32-byte CSPRNG opaque token（base64url）；数据库只存 `HMAC-SHA-256(SESSION_HASH_KEY, token)`。
- 建议 idle TTL 12 小时、absolute TTL 7 天；每次有效使用更新 `lastSeenAt`，写放大可按 5 分钟节流。
- 登录、step-up/recovery 升级、权限变化时 rotate token，防 session fixation。
- `AuthSession` 保存 `authMethod`、`authenticatedAt`、`expiresAt`、`revokedAt` 和粗粒度 UA/IP hash；避免保存不必要个人数据。
- logout 后清 Cookie 并在数据库 revoke；过期记录异步/每日清理。

### 15.2 各 Admin 独立 session

- 每个后台自行使用 `__Host-<app>_session`，同样 Secure/HttpOnly/Path=/、无 Domain。
- token 仅在该 app 数据库保存摘要，或使用带 server-side revocation 的成熟 session 库。
- 从 token exchange 得到稳定 `sub`、`auth_time`、`session_id` 后创建本地 session；绝不把中央 code 当 session。
- 本地 session 建议 idle 8–12 小时、absolute 24 小时或按 app 风险确定。

## 16. Client 注册

每个后台一条 `Client`：

- 随机不可猜 `clientId`（可读前缀 + 随机部分）。
- 独立 client secret，只在创建/轮换时显示一次；中央数据库只存 Argon2id hash（或 HMAC-SHA-256，因 secret 本身高熵）。
- `redirectUris` 为精确 HTTPS URL 数组；生产禁止通配符、前缀匹配、用户提供 host、URL fragment 和非默认隐式端口差异。
- 本地开发 redirect URI 单独 client；不要把 localhost 混入生产 client。
- `active=false` 立即禁止 authorize/token；secret 支持双 key 短暂轮换窗口。
- 初始 clients：`edit-page-admin`、`licentra-admin`、`verbia-admin`。

## 17. Authorization code flow

### 17.1 Authorize request

```http
GET /authorize?response_type=code
  &client_id=edit-page-admin_xxx
  &redirect_uri=https%3A%2F%2Fadmin.example.com%2Fauth%2Fcallback
  &state=<app-random-state>
  &code_challenge=<S256>
  &code_challenge_method=S256
```

要求：

- `response_type` 仅允许 `code`。
- client 存在且 active；redirect URI 解析规范化后仍须与预存值**完整字符串匹配**。更安全做法是注册时存规范形式，请求时拒绝任何不同字符串。
- state 由 app 生成至少 32 bytes，绑定发起浏览器 session、原始目标路径和 10 分钟过期；callback 先恒定时间比较再消费。
- PKCE S256 必需，即使 client 是 confidential server app；`code_verifier` 只保存在 app 的服务端 transaction/session 中。
- 未登录时，authorize 参数保存为服务端 transaction；登录完成只按 transaction 继续，不接受新的客户端 `returnTo`。

### 17.2 Code 生成与跳转

- code 为 32-byte CSPRNG base64url，熵至少 256 bit；数据库只存 `HMAC-SHA-256(AUTH_CODE_HASH_KEY, code)`。
- TTL 60 秒（最多 120 秒）；单次使用；绑定 `clientId`、精确 `redirectUri`、Admin、中央 `authSessionId`、PKCE challenge、`authTime`。
- 302/303 到已注册 redirect URI：`?code=...&state=...`。
- `Referrer-Policy: no-referrer`；callback 立即服务端换码并 303 到无 query 的干净 URL，避免 code 留在历史/日志/Referer。

### 17.3 Token exchange

```http
POST /api/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=authorization_code&code=...&redirect_uri=...&code_verifier=...
```

- 仅允许 HTTPS server-to-server POST；`Cache-Control: no-store`。
- 校验 client secret、code 摘要、client、redirect URI、expiry、PKCE。
- 在单个数据库事务中用条件更新 `usedAt IS NULL AND expiresAt > now()` 原子消费；受影响行数必须为 1。
- 无论后续响应是否被网络丢失，code 都保持已消费；app 必须重新发起 authorize，不能重试同 code。
- 返回最小化 JSON，不返回中央 session token：

```json
{
  "sub": "adm_...",
  "auth_time": 1790480000,
  "auth_method": "passkey",
  "central_session_id": "ses_...",
  "issued_at": 1790480012
}
```

- 响应不是标准 OAuth token；字段由内部 TypeScript contract 版本化，如 header `Henriz-Auth-Version: 1`。

## 18. 退出与撤销

- **退出当前应用**：仅 revoke/删除该 app 的本地 session，不影响中央 session 或其他 app。
- **中央退出**：浏览器 POST `https://auth.henriz.dev/api/logout`（CSRF 防护）revoke 当前中央 session 并清中央 Cookie；已建立的 app sessions 默认继续有效，直至各自过期/退出。
- **退出所有设备**：revoke Admin 所有中央 sessions；同时递增 `Admin.sessionVersion`。各 app 可在下次 SSO 或可选 back-channel revocation 时失效本地 session。
- v1 若不实现可靠 back-channel logout，UI 必须明确说明“中央退出不会自动退出已打开的后台”。高安全 app 可用短本地 TTL，并定期调用受认证 introspection/revocation version endpoint。
- Passkey revoke 默认不强制撤销所有 session；UI 提供勾选项。若因设备丢失而 revoke，应默认撤销全部中央 sessions。

## 19. Prisma 数据模型

以下 schema 是实现基线；migration 前用当前 Prisma 版本验证 PostgreSQL 类型与索引语法。

```prisma
enum AdminStatus { BOOTSTRAP_REQUIRED ACTIVE DISABLED }
enum AuthMethod { PASSKEY TOTP BOOTSTRAP }
enum ChallengeKind { REGISTRATION AUTHENTICATION }

model Admin {
  id             String   @id @default(cuid())
  webauthnUserId Bytes    @unique
  displayName    String
  status         AdminStatus @default(BOOTSTRAP_REQUIRED)
  sessionVersion Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  passkeys       PasskeyCredential[]
  totp           TotpCredential?
  sessions       AuthSession[]
  codes          AuthorizationCode[]
  auditLogs      AuditLog[]
}

model PasskeyCredential {
  id                 String   @id @default(cuid())
  adminId            String
  credentialId       String   @unique // base64url canonical form
  publicKey           Bytes
  counter             BigInt   @default(0)
  transports          String[]
  deviceType          String?
  backedUp            Boolean?
  name                String
  createdAt           DateTime @default(now())
  lastUsedAt          DateTime?
  revokedAt           DateTime?
  admin               Admin    @relation(fields: [adminId], references: [id], onDelete: Cascade)
  @@index([adminId, revokedAt])
}

model TotpCredential {
  id               String   @id @default(cuid())
  adminId          String   @unique
  ciphertext       Bytes
  nonce            Bytes
  authTag          Bytes
  keyVersion       Int
  lastUsedTimeStep BigInt?
  failedAttempts   Int      @default(0)
  lockedUntil      DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  disabledAt       DateTime?
  admin            Admin    @relation(fields: [adminId], references: [id], onDelete: Cascade)
}

model AuthSession {
  id              String   @id @default(cuid())
  adminId         String
  tokenHash       Bytes    @unique
  authMethod      AuthMethod
  authenticatedAt DateTime
  createdAt       DateTime @default(now())
  lastSeenAt      DateTime @default(now())
  idleExpiresAt   DateTime
  absoluteExpiresAt DateTime
  revokedAt       DateTime?
  sessionVersion  Int
  userAgentHash   Bytes?
  ipPrefixHash    Bytes?
  admin           Admin    @relation(fields: [adminId], references: [id], onDelete: Cascade)
  codes           AuthorizationCode[]
  @@index([adminId, revokedAt])
  @@index([idleExpiresAt])
}

model Client {
  id                 String   @id @default(cuid())
  clientId           String   @unique
  name               String
  secretHash         String
  previousSecretHash String?
  previousValidUntil DateTime?
  redirectUris       String[]
  active             Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  codes              AuthorizationCode[]
}

model AuthorizationCode {
  id                  String   @id @default(cuid())
  codeHash            Bytes    @unique
  adminId             String
  clientId            String
  authSessionId       String
  redirectUri         String
  codeChallenge       String
  codeChallengeMethod String   @default("S256")
  authTime            DateTime
  createdAt           DateTime @default(now())
  expiresAt           DateTime
  usedAt              DateTime?
  admin                Admin      @relation(fields: [adminId], references: [id], onDelete: Cascade)
  client               Client     @relation(fields: [clientId], references: [id], onDelete: Cascade)
  authSession          AuthSession @relation(fields: [authSessionId], references: [id], onDelete: Cascade)
  @@index([expiresAt, usedAt])
}

model WebAuthnChallenge {
  id          String   @id @default(cuid())
  adminId     String?
  kind        ChallengeKind
  hash        Bytes    @unique
  transactionId String?
  attempts    Int      @default(0)
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  usedAt      DateTime?
  @@index([expiresAt, usedAt])
}

model AuditLog {
  id           BigInt   @id @default(autoincrement())
  adminId      String?
  event        String
  outcome      String
  actorSessionId String?
  targetType   String?
  targetId     String?
  requestId    String?
  ipPrefixHash Bytes?
  userAgentHash Bytes?
  metadata     Json?
  createdAt    DateTime @default(now())
  admin        Admin?   @relation(fields: [adminId], references: [id], onDelete: SetNull)
  @@index([adminId, createdAt])
  @@index([event, createdAt])
}
```

生产 migration 可增加数据库 `CHECK`（nonce 长度、过期时间关系等）和部分索引。Prisma 不直接表达的约束通过 SQL migration 添加。

## 20. 敏感字段策略

| 数据 | 存储方式 | 原因 |
|---|---|---|
| Passkey public key | 明文 Bytes | 非 secret，验证必需 |
| credential ID | 明文 canonical base64url | 非 secret，查询必需 |
| TOTP seed | AES-256-GCM + versioned key + AAD | 必须可恢复用于验证 |
| session/code/challenge/bootstrap token | HMAC-SHA-256 + 独立 pepper key | 高熵 token 无需可逆，HMAC 防 DB-only 离线枚举 |
| client secret | Argon2id hash（高熵时可 HMAC） | client 验证；不需恢复 |
| IP/UA | 截断/规范化后 HMAC | 降低隐私风险，仅供安全审计 |

不同用途使用独立 key：`SESSION_HASH_KEY`、`AUTH_CODE_HASH_KEY`、`CHALLENGE_HASH_KEY`、`TOTP_ENCRYPTION_KEY_V1`。禁止一个 `AUTH_SECRET` 派生所有用途，除非使用有明确 context 的 HKDF 并记录方案。

## 21. API endpoints

| Method | Endpoint | 认证 | 作用 |
|---|---|---|---|
| GET | `/login` | 无 | 极简登录页 |
| GET | `/authorize` | client 参数 | 验证 request、登录或签发 code |
| POST | `/api/token` | client secret | 原子换码 |
| POST | `/api/webauthn/authenticate/options` | transaction/限速 | 生成认证 challenge |
| POST | `/api/webauthn/authenticate/verify` | challenge | 验证 assertion、建 session |
| POST | `/api/webauthn/register/options` | session + step-up + CSRF | 注册 options |
| POST | `/api/webauthn/register/verify` | session + challenge + CSRF | 写入凭据 |
| PATCH | `/api/passkeys/:id` | session + CSRF | 改名 |
| DELETE | `/api/passkeys/:id` | session + step-up + CSRF | revoke |
| POST | `/api/totp/verify` | recovery transaction | TOTP 验证 |
| PUT | `/api/totp` | session + Passkey step-up + CSRF | 重置/启用 |
| DELETE | `/api/totp` | session + Passkey step-up + CSRF | 关闭 |
| GET | `/api/sessions` | session | 列出中央 sessions |
| POST | `/api/sessions/revoke` | session + step-up + CSRF | 撤销一个/全部 |
| POST | `/api/logout` | session + CSRF | 中央退出 |
| GET | `/api/health` | 无 | 只返回 liveness，不泄露依赖详情 |

所有 JSON/body 使用 Zod 等 runtime schema 严格解析、限制长度、拒绝未知字段（兼容字段另行版本化）。

## 22. TypeScript contracts 与伪代码

```ts
type AuthMethod = "passkey" | "totp" | "bootstrap";

interface AuthorizeInput {
  response_type: "code";
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
}

interface ExchangeResult {
  sub: string;
  auth_time: number;
  auth_method: AuthMethod;
  central_session_id: string;
  issued_at: number;
}
```

签发 code：

```ts
async function issueCode(input: ValidatedAuthorize, session: AuthSession) {
  const raw = randomBytes(32).toString("base64url");
  const codeHash = hmacSha256(env.AUTH_CODE_HASH_KEY, raw);
  await prisma.authorizationCode.create({ data: {
    codeHash, adminId: session.adminId, clientId: input.clientDbId,
    authSessionId: session.id, redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge, authTime: session.authenticatedAt,
    expiresAt: addSeconds(new Date(), 60),
  }});
  return raw;
}
```

原子消费（推荐原生 SQL 事务，避免先查后改竞态）：

```sql
UPDATE "AuthorizationCode"
SET "usedAt" = now()
WHERE "codeHash" = $1
  AND "usedAt" IS NULL
  AND "expiresAt" > now()
  AND "clientId" = $2
  AND "redirectUri" = $3
RETURNING *;
```

callback：

```ts
const tx = await consumeLocalLoginTransaction(browserSessionId);
timingSafeEqualOrThrow(hash(req.state), tx.stateHash);
const assertion = await exchangeOnServer({
  code: req.code,
  redirect_uri: EXACT_CALLBACK,
  code_verifier: tx.codeVerifier,
  clientCredentials: envForThisApp,
});
await rotateAndCreateLocalSession(assertion.sub, assertion);
return redirect(tx.validatedRelativeReturnPath, 303);
```

## 23. CSRF、XSS 与协议防护

- 所有状态变更 endpoint 仅 POST/PUT/PATCH/DELETE；验证 `Origin` 精确为 `https://auth.henriz.dev`，并使用 session-bound synchronizer CSRF token。SameSite 只是纵深防御。
- `/authorize` 可 GET，但只创建短期 code；client callback 的 state 必须防 login CSRF。不得通过 GET 修改凭据或 logout。
- React 默认 escaping；禁止渲染不可信 HTML。Passkey 名称、client 名称与错误文本按普通文本输出。
- CSP 使用 nonce：`default-src 'self'; script-src 'self' 'nonce-...'; style-src 'self' 'nonce-...'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`。按 Next.js 实际需要最小调整，生产禁用 `unsafe-eval`。
- headers：HSTS（确认所有子域均 HTTPS 后再考虑 `includeSubDomains`）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Permissions-Policy: publickey-credentials-get=(self), publickey-credentials-create=(self)`、`Cache-Control: no-store`（认证页面/API）。
- 禁止 iframe（CSP `frame-ancestors 'none'`），降低点击劫持。
- session fixation：每次认证/权限提升 rotate；忽略用户提供的 session id。
- open redirect：只跳精确 client allowlist 或服务端验证过的同源相对路径；禁止 `//host`、反斜杠、混淆编码。
- replay：challenge/code/TOTP step 均单次使用；数据库原子消费；code 绑定 client、redirect URI、PKCE。
- brute force：按 IP/credential/transaction 限速；client secret 失败也限速；错误响应一致并加入抖动。
- body ≤ 64 KB；字段长度上限；request timeout；数据库 statement timeout。
- 不把 secret、code、state、challenge、assertion、Cookie 或完整 URL query 写入日志。Vercel request logs 前做 URL/query redaction。
- 使用依赖锁文件、自动依赖扫描；WebAuthn/Prisma/Next.js 安全升级需回归测试。

## 24. Audit log

至少记录：登录成功/失败、TOTP 锁定、Passkey 添加/改名/revoke、TOTP 重置/关闭、中央 session 创建/revoke、client 修改/secret 轮换、code exchange 异常重放、bootstrap/离线恢复。

日志只含事件名、结果、时间、Admin id、内部 target id、request id、HMAC 后 IP prefix/UA、非敏感原因码。禁止记录任何 seed、OTP、private data、raw token/code/challenge、client secret、WebAuthn response 或 Cookie。建议保留 90 天后批量删除；灾难事件日志可导出到受控存储。

## 25. 环境变量与 secrets

```dotenv
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=require
DIRECT_URL=postgresql://.../neondb?sslmode=require
AUTH_BASE_URL=https://auth.henriz.dev
WEBAUTHN_RP_ID=auth.henriz.dev
WEBAUTHN_ORIGINS=https://auth.henriz.dev
SESSION_HASH_KEY=<32+ random bytes, base64>
AUTH_CODE_HASH_KEY=<32+ random bytes, base64>
CHALLENGE_HASH_KEY=<32+ random bytes, base64>
TOTP_ENCRYPTION_KEY_V1=<32 random bytes, base64>
TOTP_ACTIVE_KEY_VERSION=1
```

- Vercel Production/Preview/Development 环境变量完全分离；preview 不能持有 production `DATABASE_URL` 或密钥。
- 不把 `.env*`、Prisma URL、client secret 提交 Git；提供 `.env.example` 只列名称。
- secret 轮换 runbook：添加新版本 → 部署双读单写 → 后台重加密 → 验证 → 移除旧 key。HMAC key 轮换会使对应 token 失效，按计划执行。
- 各后台单独保存自己的 `HENRIZ_AUTH_CLIENT_ID/SECRET`，绝不共享 secret。

## 26. 部署步骤

1. 在 Neon 创建独立 `henriz-auth` 项目，选择接近 Vercel function 的 region；创建最小权限 app role 与 migration role。
2. 建立 production/dev 数据库或分支；确认 preview 不会复制生产 TOTP/session 数据。
3. 创建 Next.js 项目、锁定 Node/Next/Prisma/SimpleWebAuthn 版本；配置 Prisma pooled `DATABASE_URL` 与 direct `DIRECT_URL`。
4. 编写 migration，并在空库和脱敏副本验证 forward migration；生产 deploy 使用 `prisma migrate deploy`，不能用 `db push`。
5. 在 Vercel 创建项目、添加 production secrets、绑定 `auth.henriz.dev`、验证 DNS/TLS。
6. 配置 security headers、日志 redaction、错误追踪采样与健康检查。
7. 通过受控 CLI 写入 Admin/TOTP 与一次性 bootstrap token；完成首个和第二个 Passkey 注册。
8. 创建三个 Client，逐一安全分发 secret 到对应 app。
9. 先接入测试后台，完成完整安全测试，再灰度迁移现有后台。
10. 设置 Neon/Vercel 使用量告警与每季度套餐复核。不要把免费额度当 SLA。

## 27. 三个后台迁移计划

### Phase 0：准备

- 抽取统一的 `henriz-auth-client` server-only 模块：生成 state/PKCE、authorize URL、callback 换码、建立本地 session。
- 每个 app 使用独立 client、callback 和 secret。
- 保留现有登录作为 feature flag 下的 emergency fallback，但默认隐藏，并设定删除日期。

### Phase 1：Edit Page 试点

- 增加 `/auth/login` 与 `/auth/callback`。
- 未登录访问 admin 时保存**已验证的站内相对路径**，跳中央 authorize。
- callback 验 state、服务端 exchange、创建本地 session、清理 query。
- 观察一周：成功率、冷启动、code exchange 错误、退出语义。

### Phase 2：Licentra

- 复用已审计模块但使用新 client secret。
- 验证中央 session 存在时无感 SSO。
- 验证 Edit Page session/secret 不可用于 Licentra。

### Phase 3：Verbia

- 同上；完成后三个后台默认关闭旧登录。
- 再观察一周，删除旧凭据、路由和数据库字段；保留经演练的中央离线恢复 runbook，而非应用级后门。

回滚：每个 app 可暂时重新开启自身旧登录；不得回滚到共享跨域 Cookie。中央数据库 migration 必须 backward-compatible 一个发布周期，再清理旧列。

## 28. 测试计划

### 28.1 单元测试

- redirect URI 精确匹配与混淆 URL（大小写、端口、编码、userinfo、双斜杠）。
- token HMAC、AEAD encrypt/decrypt/AAD/key version。
- session idle/absolute expiry、step-up freshness、session rotation。
- PKCE S256、state 校验、TOTP window 与相同 time-step replay。
- 错误响应不泄露 Admin/credential 存在性。

### 28.2 集成测试

- WebAuthn registration/authentication 使用虚拟 authenticator；错误 origin/RP ID/challenge/UV 必须失败。
- 同一 code 并发交换 20 次，仅一次成功。
- 已过期、错误 client、错误 redirect URI、错误 verifier、revoke session 全部失败。
- 两个 Passkey 独立使用/revoke；最后凭据保护。
- TOTP 锁定、解锁、±1 window、重放与事务竞争。
- CSRF Origin/token 缺失、错误 Content-Type、超大 body。

### 28.3 E2E

- 无中央 session：App → auth Passkey → callback → 本地 session。
- 有中央 session：第二 app 无 UI 提示完成 SSO。
- 当前 app logout 不影响其他 app；中央 logout 后新 authorize 要求登录。
- recovery TOTP → 注册新 Passkey；受限 recovery session 不能执行未授权功能。
- Safari/iPhone、Safari/macOS、Chrome/macOS 至少各完成真实设备测试；不依赖同步 Passkey。
- Neon suspend 后冷启动体验；Vercel redeploy 后 session 仍有效（服务端持久化验证）。

### 28.4 安全测试

- XSS payload、CSP、点击劫持、open redirect、login CSRF、session fixation。
- authorization code/transaction/OTP brute force 和 rate-limit 绕过。
- 日志扫描确保无 secret/token/code/OTP/PII。
- 依赖漏洞扫描、secret scan、生产 env 与 preview 隔离检查。

## 29. 验收标准

- [ ] Admin 可在至少两台不同设备各注册独立 Passkey，并分别命名/revoke。
- [ ] 无需 iCloud 同步，任一已注册设备可独立登录。
- [ ] 正常登录只展示 Passkey；TOTP 仅在 recovery/bootstrap 流程出现。
- [ ] 首次 TOTP bootstrap 成功注册首个 Passkey；失败/过期 token 不可重用。
- [ ] 添加 Passkey 与修改 TOTP 均执行规定 step-up。
- [ ] 三个后台均通过中央 authorize/code exchange 登录并建立独立 host-only session。
- [ ] 浏览器 Cookie 中不存在 `Domain=.henriz.dev`；中央 Cookie 使用 `__Host-`。
- [ ] redirect URI 非精确 allowlist 一律拒绝；state/PKCE 必需。
- [ ] code ≤60 秒、仅单次使用；并发重放仅一次成功；数据库无 raw code/session token。
- [ ] WebAuthn 错误 origin、RP ID、challenge、UV 均失败。
- [ ] TOTP seed 在库中为 AEAD 密文；同一 time-step 不可重放；限速有效。
- [ ] 当前应用退出与中央退出语义符合 UI 文案；session 可撤销。
- [ ] 安全 headers、CSRF、CSP、open redirect、XSS 测试通过。
- [ ] 日志/审计抽查不含 secret、OTP、code、Cookie 或 WebAuthn payload。
- [ ] 从加密备份恢复到隔离库的演练成功，并能用备用 Passkey 登录。

## 30. 灾难恢复

### 30.1 备份

- 不只依赖免费层即时恢复窗口。至少每周导出加密 `pg_dump`；认证配置变化后额外备份。
- 备份在客户端使用独立 key 加密后上传到与 Neon/Vercel 不同账号的存储；保留 4–8 个滚动版本。
- 单独离线保存：TOTP encryption keys 的版本、HMAC keys、client secret 恢复材料、DNS/Vercel/Neon 账号恢复码。密钥与数据库备份分开保存。
- 每季度在隔离环境恢复并执行 schema/登录验证；未经演练的备份不算可恢复。

### 30.2 事件 runbook

- **数据库损坏/误删**：冻结写入 → 保全审计 → 恢复最近可信备份 → 轮换所有 session/code keys（使旧 token 失效）→ 检查 Passkey/TOTP 状态 → 恢复服务。
- **数据库泄露**：撤销 sessions/codes；轮换 client secrets 与 HMAC keys；若加密 key 可能同时泄露，重置 TOTP；Passkey public key 泄露本身不等于私钥泄露。
- **Vercel/env 泄露**：视为可解密 TOTP；先禁用服务/限制访问，轮换所有 server secrets、client secrets、TOTP seed，撤销 sessions。
- **域名/DNS 失陷**：暂停 authorize/token，恢复 DNS 与部署控制，视情况让所有 Passkey 在安全 origin 重新注册；调查期间禁止绕过 origin 校验。
- **所有凭据丢失**：执行第 14.3 节离线人工恢复；禁止临时硬编码后门或直接把 session 写入浏览器。

恢复目标按个人项目务实设定，例如 RPO 24 小时、RTO 4 小时；这只是运维目标，不是 Neon Free/Vercel Hobby SLA。若不能接受，升级托管计划并提高备份频率。

## 31. 实现顺序与 Definition of Done

推荐顺序：基础项目/env 校验 → Prisma schema/migrations → crypto/session → WebAuthn → TOTP/bootstrap → security UI → clients/code flow → 第一个 app SDK/迁移 → 其余 apps → 运维与恢复演练。

完成定义：所有验收项通过；生产至少有两个独立 Passkey；离线恢复材料已保存；三个 app secret 相互独立；生产/preview 隔离；套餐适用性由控制台复核；真实浏览器 E2E、安全回归、备份恢复演练均留有不含 secret 的记录。

## 32. 官方参考

- [Neon backend GA / 2026 Free Plan 配额](https://neon.com/blog/neon-backend-is-ga)
- [Neon Pricing（实施时复核）](https://neon.com/pricing)
- [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- [SimpleWebAuthn Documentation](https://simplewebauthn.dev/docs/)
- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [RFC 6749 OAuth 2.0](https://www.rfc-editor.org/rfc/rfc6749)
- [RFC 7636 PKCE](https://www.rfc-editor.org/rfc/rfc7636)
- [RFC 6238 TOTP](https://www.rfc-editor.org/rfc/rfc6238)

