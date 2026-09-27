"use client";
import "webauthn-polyfills";

export function csrfToken() {
  return document.cookie.split("; ").find((row) => row.startsWith("__Host-henriz_csrf="))?.split("=").slice(1).join("=") || "";
}

export function supportsPasskeys() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && Boolean(navigator.credentials);
}

export async function requestCredential(options: PublicKeyCredentialRequestOptionsJSON) {
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options);
  const credential = await navigator.credentials.get({ publicKey });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("No credential returned");
  return credential.toJSON();
}

export async function createCredential(options: PublicKeyCredentialCreationOptionsJSON) {
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options);
  const credential = await navigator.credentials.create({ publicKey });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("No credential returned");
  return credential.toJSON();
}

