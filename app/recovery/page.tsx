import Link from "next/link";
import { RecoveryForm } from "@/components/RecoveryForm";
export default function RecoveryPage() {
  return <section className="auth-card"><div className="brand-mark muted" aria-hidden="true">06</div><p className="eyebrow">RECOVERY</p><h1>恢复访问</h1><p className="lede">输入身份验证器中的 6 位验证码。成功后请立即注册新的 Passkey。</p><RecoveryForm /><Link className="secondary-link" href="/login">返回 Passkey 登录</Link><p className="privacy-note">连续失败会触发临时锁定。</p></section>;
}

