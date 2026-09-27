import Link from "next/link";
import { redirect } from "next/navigation";
import { SecurityActions } from "@/components/SecurityActions";
import { SecurityList } from "@/components/SecurityList";
import { PasskeyLogin } from "@/components/PasskeyLogin";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export default async function SecurityPage() {
  const session = await getSession(); if (!session) redirect("/login");
  const now = new Date();
  const [passkeys, totp, sessions] = await Promise.all([
    db.passkeyCredential.findMany({ where: { adminId: session.adminId, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    db.totpCredential.findUnique({ where: { adminId: session.adminId } }),
    db.authSession.findMany({ where: { adminId: session.adminId, revokedAt: null, absoluteExpiresAt: { gt: now } }, orderBy: { lastSeenAt: "desc" } }),
  ]);
  const stepUpFresh = Boolean(session.stepUpAt && now.getTime() - session.stepUpAt.getTime() < 5 * 60 * 1000);
  return <section className="security-page"><header className="security-header"><div><p className="eyebrow">HENRI Z · SECURITY</p><h1>安全中心</h1><p className="lede">管理登录设备与中央会话。</p></div><Link className="text-button" href="/logout">退出中央登录</Link></header>
    {session.authMethod === "TOTP" && <div className="notice">你正在使用动态码登录。动态码可被钓鱼页面转发，建议注册 Passkey 作为抗钓鱼的登录方式。</div>}
    {!stepUpFresh && <section className="panel step-up"><div><h2>请重新验证身份</h2><p>添加或撤销凭据前，需要一次最近的 Passkey 验证。</p></div><PasskeyLogin label="验证身份" stepUp /></section>}
    <section className="panel"><div className="panel-title"><div><h2>Passkey</h2><p>{passkeys.length} 个独立凭据</p></div>{stepUpFresh && <SecurityActions />}</div><SecurityList passkeys={passkeys.map((item) => ({ id: item.id, name: item.name, createdAt: item.createdAt.toISOString(), lastUsedAt: item.lastUsedAt?.toISOString() || null, backedUp: item.backedUp }))} /></section>
    <section className="panel two-column"><div><h2>恢复验证码</h2><p className="metric">{totp && !totp.disabledAt ? "已启用" : "未启用"}</p><p>仅用于 Passkey 不可用时的恢复。</p></div><div><h2>中央会话</h2><p className="metric">{sessions.length} 个活跃会话</p><p>中央退出不会自动退出已登录的后台。</p></div></section>
  </section>;
}
