"use client";
import { useState } from "react";
import { requestCredential, supportsPasskeys } from "@/components/webauthn-client";

export function PasskeyLogin({ label = "使用 Passkey 登录", stepUp = false }: { label?: string; stepUp?: boolean }) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  async function authenticate() {
    if (!supportsPasskeys()) { setStatus("error"); setMessage("此浏览器不支持 Passkey。请使用恢复方式。"); return; }
    setStatus("working"); setMessage("");
    try {
      const optionsResponse = await fetch("/api/webauthn/authenticate/options", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!optionsResponse.ok) throw new Error("无法开始验证");
      const credential = await requestCredential(await optionsResponse.json());
      const verifyResponse = await fetch("/api/webauthn/authenticate/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credential) });
      const result = await verifyResponse.json(); if (!verifyResponse.ok) throw new Error(result.error || "验证失败");
      window.location.assign(stepUp ? "/security" : result.redirectTo || "/security");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof DOMException && error.name === "NotAllowedError" ? "验证已取消或超时，请重试。" : "无法完成 Passkey 验证，请重试。");
    }
  }
  return <div className="action-stack"><button className="primary-button" onClick={authenticate} disabled={status === "working"}>{status === "working" ? "正在验证…" : label}</button><p className="status" role="status" aria-live="polite">{message}</p></div>;
}

