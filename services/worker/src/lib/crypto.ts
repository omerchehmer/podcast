/**
 * Encryption for the listener profile (AES-256-GCM).
 * Stored format: 12-byte IV, then ciphertext, then 16-byte auth tag.
 * This is the same layout WebCrypto uses, so the Edge Function (Deno) and the worker (Node)
 * can read each other's data. The key is 32 random bytes, base64, in CONTEXT_ENCRYPTION_KEY.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(b64 = process.env.CONTEXT_ENCRYPTION_KEY): Buffer {
  if (!b64) throw new Error("CONTEXT_ENCRYPTION_KEY is not set");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("CONTEXT_ENCRYPTION_KEY must be 32 bytes (base64)");
  return k;
}

export function encryptText(plain: string, b64Key?: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(b64Key), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]);
}

export function decryptText(data: Buffer, b64Key?: string): string {
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const body = data.subarray(12, data.length - 16);
  const d = createDecipheriv("aes-256-gcm", key(b64Key), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

/** Postgres bytea comes back from the REST API as "\x<hex>". */
export function byteaToBuffer(v: string): Buffer {
  return Buffer.from(v.startsWith("\\x") ? v.slice(2) : v, "hex");
}
export function bufferToBytea(b: Buffer): string {
  return "\\x" + b.toString("hex");
}
