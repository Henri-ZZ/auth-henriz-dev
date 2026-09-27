import Link from "next/link";
export default function SignedOutPage() {
  return <section className="auth-card"><div className="brand-mark muted" aria-hidden="true">07</div><p className="eyebrow">SIGNED OUT</p><h1>已退出登录</h1><p className="lede">中央会话已失效。各后台自身保存的会话仍会按各自的过期时间失效。</p><Link className="secondary-link" href="/login">重新登录</Link></section>;
}
