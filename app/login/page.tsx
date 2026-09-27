import Link from "next/link";
import { redirect } from "next/navigation";
import { PasskeyLogin } from "@/components/PasskeyLogin";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await getSession()) redirect("/security");
  return <section className="auth-card"><div className="brand-mark" aria-hidden="true">HZ</div><p className="eyebrow">HENRI Z · PRIVATE ACCESS</p><h1>欢迎回来</h1><p className="lede">使用你已注册设备上的 Passkey 安全登录。</p><PasskeyLogin /><div className="divider"><span>无法使用 Passkey？</span></div><Link className="secondary-link" href="/recovery">使用恢复验证码</Link><p className="privacy-note">只有已授权的管理员可以访问。</p></section>;
}

