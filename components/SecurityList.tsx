"use client";
import { csrfToken } from "@/components/webauthn-client";

type Passkey = { id: string; name: string; createdAt: string; lastUsedAt: string | null; backedUp: boolean | null };
export function SecurityList({ passkeys }: { passkeys: Passkey[] }) {
  async function revoke(id: string, name: string) {
    if (!window.confirm(`撤销“${name}”？这个操作不能撤销。`)) return;
    const response = await fetch(`/api/passkeys/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken() } });
    if (response.ok) window.location.reload(); else window.alert("撤销失败。请先重新验证身份，并确保仍有恢复方式。");
  }
  return <div className="credential-list">{passkeys.map((item) => <article className="credential-row" key={item.id}><div className="key-icon" aria-hidden="true">◆</div><div className="credential-copy"><strong>{item.name}</strong><span>添加于 {new Date(item.createdAt).toLocaleDateString("zh-CN")} · {item.lastUsedAt ? `最近使用 ${new Date(item.lastUsedAt).toLocaleDateString("zh-CN")}` : "尚未使用"}</span><span>{item.backedUp ? "已备份凭据" : "独立设备凭据"}</span></div><button className="text-button danger" onClick={() => revoke(item.id, item.name)}>撤销</button></article>)}</div>;
}

