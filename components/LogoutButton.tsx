"use client";
import { csrfToken } from "@/components/webauthn-client";
export function LogoutButton() {
  async function logout() { const response = await fetch("/api/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, redirect: "follow" }); window.location.assign(response.url || "/login"); }
  return <button className="text-button" onClick={logout}>退出中央登录</button>;
}

