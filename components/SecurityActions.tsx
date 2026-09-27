"use client";
import { useState } from "react";
import { createCredential, csrfToken, supportsPasskeys } from "@/components/webauthn-client";
export function SecurityActions() {
  const [message, setMessage] = useState("");
  async function addPasskey() {
    if (!supportsPasskeys()) { setMessage("此浏览器不支持 Passkey。"); return; }
    const name = window.prompt("给这个 Passkey 起一个容易识别的名称", "我的设备"); if (!name) return;
    try {
      const headers = { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() };
      const optionsResponse = await fetch("/api/webauthn/register/options", { method: "POST", headers });
      if (!optionsResponse.ok) throw new Error("请先重新验证身份");
      const credential = await createCredential(await optionsResponse.json());
      const response = await fetch("/api/webauthn/register/verify", { method: "POST", headers, body: JSON.stringify({ name, credential }) });
      const result = await response.json(); if (!response.ok) throw new Error("添加失败"); window.location.assign(result.redirectTo || "/security");
    } catch (error) { setMessage(error instanceof Error ? error.message : "添加失败"); }
  }
  return <div className="action-stack"><button className="primary-button" onClick={addPasskey}>添加 Passkey</button><p className="status" role="status">{message}</p></div>;
}
