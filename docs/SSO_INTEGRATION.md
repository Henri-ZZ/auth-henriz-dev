# 其他平台接入 henriz-auth 标准操作

本文是接入 `auth.henriz.dev` 的**唯一操作文档**。协议细节与安全模型见 [`HENRIZ_AUTH_SPEC.md`](./HENRIZ_AUTH_SPEC.md) §16–§18、§27。

接入方式：**自研的最小 OAuth2 授权码 + PKCE + client secret**。不是标准 OIDC —— 没有 discovery、id_token、JWKS、refresh token、scope，因此 **Auth.js / next-auth 的 OIDC provider 用不了**，请按本文自己写（依赖复用模块后约 40 行）。

```
后台 App                       浏览器                         auth.henriz.dev
  │  受保护路径，未登录          │                               │
  ├───────────────────────────► │ 302 /authorize?...            │
  │                             ├──────────────────────────────► │ 校验 client + redirect_uri
  │                             │                               │ 已有中央 session → 直接发 code
  │                             │                               │ 否则 → 登录页（Passkey 或动态码）
  │                             │ ◄── 303 callback?code&state ──┤
  │ ◄── GET /auth/callback ─────┤                               │
  ├── 服务端 POST /api/token ──────────────────────────────────► │ 校验 secret + PKCE，原子消费 code
  │ ◄── { sub, auth_time, auth_method, ... } ───────────────────┤
  └── 用 sub 建本地 session，303 到干净 URL（无 query）
```

---

## 0. 前置：注册 client

每个平台一个独立 client（独立 secret、独立 callback），**绝不共用**。注册/改地址/启停/轮换都用同一个受审计 CLI：

```sh
# 注册（secret 只打印这一次，立刻存进该 app 的服务端环境变量）
pnpm db:add-client --client-id edit-page-admin --name "Edit Page" \
  --redirect https://edit.henriz.dev/auth/callback

# 本地开发用独立 client，不要把 localhost 混进生产 client
pnpm db:add-client --client-id edit-page-admin-dev --name "Edit Page (local)" \
  --redirect https://localhost:3000/auth/callback

pnpm db:add-client --list                                # 查看已注册 client（不打印 secret）
pnpm db:add-client --client-id edit-page-admin --redirect https://new.example.com/auth/callback
pnpm db:add-client --client-id edit-page-admin --rotate  # 轮换 secret，旧 secret 保留 24h 宽限
pnpm db:add-client --client-id edit-page-admin --disable # 立即失效（无宽限）
```

规则：

- `redirectUri` 必须 HTTPS（`localhost` 例外，但本地也建议 `next dev --experimental-https`，因为 `__Host-` Cookie 必须 Secure）、无 fragment、无 userinfo，且与注册值**逐字符一致**（大小写、端口、末尾斜杠都算）。
- 想用自定义 secret 就在调用前设 `CLIENT_SECRET`（≥32 字符），避免它出现在 shell 历史里。
- 轮换顺序必须是：先 `--rotate` 写入宽限 → 更新 app 的 env → 部署 → 等宽限期过。宽限期长度用 `CLIENT_SECRET_GRACE_HOURS` 调整（默认 24）。
- 若在 Nest/其它非 Node-app 场景，secret 直接通过密码管理器交付，不要走聊天/邮件。

app 侧需要三个服务端环境变量（**都不能进浏览器**）：

```dotenv
HENRIZ_AUTH_BASE_URL=https://auth.henriz.dev
HENRIZ_AUTH_CLIENT_ID=edit-page-admin
HENRIZ_AUTH_CLIENT_SECRET=<add-client 输出的 secret>
HENRIZ_AUTH_REDIRECT_URI=https://edit.henriz.dev/auth/callback
```

## 1. 选择接入模式

| | 模式 A：纯后台 | 模式 B：官网 + 受保护后台 |
|---|---|---|
| 典型平台 | Licentra、Verbia（整站只有自己用） | Edit Page（官网面向用户，只有 `/admin` 是后台） |
| 未登录访问受保护路径 | **302 跳 auth 登录页**，登录后回到原路径 | **302 跳官网首页**，不给访客看登录界面 |
| 登录入口 | 用户访问任意页面即触发 | 只有管理员知道/使用的 `/auth/login`；首页可放一个不显眼的「管理」链接 |
| 受保护范围 | 全站（白名单放行 `/auth/*`、静态资源） | 仅 `/admin/*` |
| 本地 session | 必须有（8–12h idle / 24h absolute） | 同 |

两种模式共用同一套 `/auth/login` + `/auth/callback`，区别只在「谁来触发登录」和「未登录时跳哪里」。

## 2. 复用模块

把 [`../sdk/henriz-auth-client.ts`](../sdk/henriz-auth-client.ts) 复制到各 app 的 `lib/henriz-auth-client.ts`（它是 server-only，只依赖 `node:crypto` 和全局 `fetch`；**不要**被 client component 引用）。

```ts
// lib/henriz-auth.ts
import { createHenrizAuthClient } from "./henriz-auth-client";

export const henrizAuth = createHenrizAuthClient({
  baseUrl: process.env.HENRIZ_AUTH_BASE_URL!,
  clientId: process.env.HENRIZ_AUTH_CLIENT_ID!,
  clientSecret: process.env.HENRIZ_AUTH_CLIENT_SECRET!,
  redirectUri: process.env.HENRIZ_AUTH_REDIRECT_URI!,
});
```

## 3. 共用：登录与回调

```ts
// app/auth/login/route.ts
import { NextResponse } from "next/server";
import { henrizAuth } from "@/lib/henriz-auth";

export const runtime = "nodejs";   // 需要 node:crypto

export async function GET(request: Request) {
  const returnTo = new URL(request.url).searchParams.get("returnTo");
  const { authorizeUrl, cookie } = henrizAuth.beginLogin(returnTo ?? "/");
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
```

```ts
// app/auth/callback/route.ts —— state/PKCE 校验与换码全在服务端
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { henrizAuth } from "@/lib/henriz-auth";
import { createLocalSession } from "@/lib/session";   // 各 app 自己实现

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const transaction = (await cookies()).get(henrizAuth.transactionCookieName)?.value;
  const result = await henrizAuth.completeLogin({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    transaction,
  });

  if (!result.ok) {
    // 失败不复用 code，直连 /auth/login 重来；对外只说“请重新登录”
    const retry = NextResponse.redirect(new URL("/auth/login", url.origin));
    const cleared = henrizAuth.clearTransaction();
    retry.cookies.set(cleared.name, cleared.value, cleared.options);
    return retry;
  }

  // 本地 session 只存摘要；claims.sub 是稳定用户标识，auth_time 用于判断认证新鲜度
  const response = NextResponse.redirect(new URL(result.returnTo, url.origin), { status: 303 });
  await createLocalSession(result.claims, response);
  const cleared = henrizAuth.clearTransaction();
  response.cookies.set(cleared.name, cleared.value, cleared.options);
  return response;
}
```

拿到 `claims` 后：

- `claims.sub` → 本地用户主键（中央 Admin id，稳定不变）。
- `claims.auth_time` → 可用于「认证超过 N 小时则要求重新认证」。
- `claims.auth_method` → `passkey` / `totp` / `bootstrap`。对动态码登录不放心的后台可以据此加二次确认。
- **绝不**把中央 code 当 session 用，也绝不返回中央 session token。
- 本地 session：`__Host-<app>_session`，值用 32-byte CSPRNG，服务端只存 HMAC 摘要；建议 idle 8–12h、absolute 24h。

## 4. 模式 A：纯后台（Licentra / Verbia）

全站要登录，用一个路由组统一守卫；未登录直接跳到 auth 的登录页，并带回来路。

```ts
// proxy.ts —— 只做一件事：把当前路径写进请求头，供 Node 侧守卫读取（Edge 不能连数据库）
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/).*)"] };
```

```tsx
// app/(protected)/layout.tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readLocalSession } from "@/lib/session";
import { henrizAuth } from "@/lib/henriz-auth";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  if (await readLocalSession()) return <>{children}</>;
  const pathname = (await headers()).get("x-pathname") ?? "/";
  redirect(`/auth/login?returnTo=${encodeURIComponent(henrizAuth.sanitizeReturnTo(pathname))}`);
}
```

用户视角：访问 `/licentra/license` → 未登录 → 直接落在 auth 的自研登录页（Passkey 或动态码任选）→ 成功后回到 `/licentra/license`。如果中央 session 还在（用户刚在别的后台登录过），全程无感，不会看到登录页。

## 5. 模式 B：官网 + 受保护 `/admin`（Edit Page）

公开页面完全不动；只有后台路由组做守卫，未登录**跳首页**而不是登录页。

```tsx
// app/admin/layout.tsx
import { redirect } from "next/navigation";
import { readLocalSession } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await readLocalSession())) redirect("/");   // 未登录：静默回首页
  return <>{children}</>;
}
```

要点：

- `/admin` 未登录时跳首页，**不要**渲染登录表单或返回 401；访客永远看不到登录界面。
- 管理员入口：首页页脚放一个不显眼的「管理」链接指向 `/auth/login?returnTo=/admin`；已知链接、已登录（中央 session 或本地 session有效）时 `/auth/login` 会立刻完成并回到 `/admin`。
- 如果本地 session 过期但中央 session 还在，用户点「管理」会瞬间重新完成 SSO，不需要重新认证。
- 想让首页在「被踢回来」时给个提示，用 `/admin` → `/` 落地时附加一个**非敏感**标记（例如 `/?from=admin`），首页据此显示「请先登录」。不要把失败原因写进 URL。

## 6. 登出与撤销

- **只退出当前 app**：清掉本地 session，保留中央 session —— 下次访问会无感 SSO 直接回来。适合「切换账号」之外的普通场景。
- **同时退出中央登录**（`Sign out` 按钮推荐这么做）：中央 session 的 Cookie 只属于 `auth.henriz.dev`，跨站清不掉，所以把浏览器**整页**带过去就行：

```ts
// app/api/auth/logout/route.ts（app 侧）
await clearLocalSession();
return Response.json({ ok: true, redirectTo: `${process.env.HENRIZ_AUTH_BASE_URL}/logout` });
```

```ts
// 客户端按钮
const { redirectTo } = await (await fetch("/api/auth/logout", { method: "POST" })).json();
window.location.assign(redirectTo);   // 整页跳转，不是让 fetch 去跟随
```

`GET /logout` **访问即退出**：revoke 中央 session、清 Cookie，然后 303 到 `/signed-out` 显示「已退出登录」。没有确认步骤，也不回跳。

三条硬约束：

- **用整页跳转，别用 `fetch` 去跟随**：`/logout` 会整页导航到 `/signed-out`；如果跨域去 `fetch` 跟随跳转，会被 CSP `connect-src 'self'` 拦掉，控制台只报 `Failed to fetch`，用户以为退出失败（其实服务端已经退了）。
- **不要回跳原 app**：app 的登录页会自动跳 SSO，回跳等于立刻又推进一轮授权（刚点完退出就被签回来）。终态留在 auth 域名即可。
- **别只清本地 Cookie 就完事**：中央 session 还在的话，app 只要跳到登录页就会被静默签回。

- 中央退出**不会**自动使各后台已建立的本地 session 失效（没有 back-channel logout），所以 UI 文案不要承诺「退出所有设备」；本地 session 按各自 TTL 过期。
- 需要立刻失效所有后台时：在 `/security` 撤销该 Admin 的中央 sessions（并递增 `sessionVersion`），各后台按本地 TTL 过期或做一次重新认证。
- 高安全后台可以把本地 TTL 收短（例如 2h）。

## 7. 排错

| 现象 | 原因 |
|---|---|
| `/authorize` 返回纯文本 `Invalid authorization request` | `response_type` 非 `code`、`code_challenge_method` 非 `S256`、`state` 长度/字符不符（32–512，`[A-Za-z0-9._~-]`）、client 不存在或已停用、redirect_uri 与注册值不完全一致、非 HTTPS（localhost 例外）。原因不返回给浏览器，需查 auth 侧日志 |
| 登录后回到 `/security` 而不是你的 callback | 该 Admin 状态不是 `ACTIVE`（还没注册过任何 Passkey），先完成 Passkey 注册 |
| 一直跳 `/auth/login` 循环 | 事务 Cookie 没落住：名字必须是 `__Host-` 前缀，且 `Secure + Path=/ + 不带 Domain`；本地开发也必须 HTTPS（`next dev --experimental-https`）。或 code 已超 60 秒 |
| `/api/token` 400 `invalid_grant` | code 过期/已使用、`redirect_uri` 与授权时不同、PKCE verifier 不匹配、client secret 错误 —— 故意统一成同一个错误 |
| 换了 secret 后立刻 401 | 没用 `--rotate`（宽限 24h），或 app 没部署新 secret 且宽限已过 |
| 回调报 `state_mismatch` | 用户在别的标签页发起了新的登录（事务 Cookie 被覆盖），或 returnTo 被篡改 |
| 点退出后控制台报 `connect-src 'self'` / `Failed to fetch` | 用 `fetch(..., { redirect: "follow" })` 去访问了会整页跳转的退出地址。退出用整页跳转（`window.location.assign`）或普通链接（见 §6） |
| 点退出后立刻又被签回 | 中央 session 没死：app 只清了本地 Cookie，或没把浏览器带到 auth 的 `/logout` |

## 8. 上线检查清单

- [ ] 独立 client、独立 secret、redirect URI 精确（含本地开发地址）
- [ ] secret 只在服务端 env；浏览器端 bundle / 日志里搜不到
- [ ] `/auth/login`、`/auth/callback` 均为 `runtime = "nodejs"`，`/auth/*` 不被自己的守卫拦截
- [ ] 本地 session Cookie 使用 `__Host-` 前缀 + `Secure + HttpOnly + Path=/`，不放 `Domain`
- [ ] 未登录行为符合所选模式（A 跳 auth 登录页并带回 `returnTo`；B 静默跳首页）
- [ ] 回调后 303 到无 query 的干净 URL，`Referrer-Policy: no-referrer`
- [ ] 日志/监控不记录 `code`、`state`、`verifier`、client secret、claims 全文
- [ ] 退出语义与文案一致（中央退出 ≠ 退出该 app）
- [ ] 在真实设备上跑通：首次登录、已登录无感 SSO、动态码登录路径、退出后再进
