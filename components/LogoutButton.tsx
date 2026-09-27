"use client";
import { csrfToken } from "@/components/webauthn-client";
export function LogoutButton({ redirectUri, label = "退出中央登录" }: { redirectUri?: string; label?: string }) {
  async function logout() {
    const endpoint = redirectUri ? `/api/logout?redirect_uri=${encodeURIComponent(redirectUri)}` : "/api/logout";
    const response = await fetch(endpoint, { method: "POST", headers: { "X-CSRF-Token": csrfToken() }, redirect: "follow" });
    window.location.assign(response.url || "/login");
  }
  return <button className="text-button" onClick={logout}>{label}</button>;
}
