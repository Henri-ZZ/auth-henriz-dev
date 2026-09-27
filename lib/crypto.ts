import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hmac(keyBase64: string, value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHmac("sha256", Buffer.from(keyBase64, "base64")).update(value, "utf8").digest());
}

export function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function safeStringEqual(left: string, right: string): boolean {
  return safeEqual(new Uint8Array(Buffer.from(left)), new Uint8Array(Buffer.from(right)));
}

export interface EncryptedValue {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

export function encryptAesGcm(plaintext: Buffer, keyBase64: string, aad: string): EncryptedValue {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyBase64, "base64").subarray(0, 32), nonce);
  cipher.setAAD(Buffer.from(aad));
  return {
    ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]),
    nonce,
    authTag: cipher.getAuthTag(),
  };
}

export function decryptAesGcm(value: EncryptedValue, keyBase64: string, aad: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyBase64, "base64").subarray(0, 32), value.nonce);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(value.authTag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]);
}
