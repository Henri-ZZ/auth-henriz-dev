"use client";
import { FormEvent, useState } from "react";

export function TotpForm({ label, action, autoFocus = false }: { label: string; action: string; autoFocus?: boolean }) {
  const [message, setMessage] = useState(""); const [working, setWorking] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); setMessage(""); const form = new FormData(event.currentTarget);
    const response = await fetch("/api/totp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: form.get("token") }) });
    const result = await response.json(); setWorking(false); if (response.ok) window.location.assign(result.redirectTo || "/security"); else setMessage("验证码无效、已使用或暂时锁定。");
  }
  return <form onSubmit={submit} className="form-stack"><label htmlFor="token">{label}</label><input id="token" name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus={autoFocus} placeholder="000000" /><button className="primary-button" disabled={working}>{working ? "正在验证…" : action}</button><p className="status" role="status" aria-live="polite">{message}</p></form>;
}
