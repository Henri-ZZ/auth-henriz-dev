import { redirect } from "next/navigation";
import { PasskeyLogin } from "@/components/PasskeyLogin";
import { TotpForm } from "@/components/TotpForm";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await getSession()) redirect("/security");
  return <section className="auth-card"><div className="brand-mark" aria-hidden="true">HZ</div><p className="eyebrow">HENRI Z · PRIVATE ACCESS</p><h1>欢迎回来</h1><p className="lede">使用已注册设备上的 Passkey，或输入身份验证器中的动态码登录。</p><PasskeyLogin /><div className="divider"><span>或</span></div><TotpForm label="身份验证器动态码" action="使用动态码登录" /><p className="privacy-note">只有已授权的管理员可以访问。</p></section>;
}
