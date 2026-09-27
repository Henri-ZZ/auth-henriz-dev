import { LogoutButton } from "@/components/LogoutButton";
import { getSession } from "@/lib/session";
import { safePostLogoutRedirect } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * RP-initiated logout. An app (e.g. Licentra's "Sign out") links the browser
 * here with `?redirect_uri=`, the user confirms, the central session is revoked
 * and the browser returns to the app. Without this step the central session
 * would survive and the next visit would silently sign the user back in.
 */
export default async function LogoutPage({ searchParams }: { searchParams: Promise<{ redirect_uri?: string }> }) {
  const target = await safePostLogoutRedirect((await searchParams).redirect_uri);
  const session = await getSession();
  return <section className="auth-card"><div className="brand-mark muted" aria-hidden="true">07</div><p className="eyebrow">SIGN OUT</p><h1>退出中央登录</h1><p className="lede">{session ? "退出后所有后台的中央会话都会失效，下次访问需要重新验证身份。" : "当前没有有效的中央会话。"}</p>{session ? <LogoutButton redirectUri={target} label="确认退出" /> : <a className="secondary-link" href={target}>返回应用</a>}<p className="privacy-note">各后台自身的会话仍按各自的过期时间失效。</p></section>;
}
