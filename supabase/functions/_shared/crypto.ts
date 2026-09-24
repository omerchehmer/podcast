// AES-256-GCM with WebCrypto. Same format as services/worker/src/lib/crypto.ts:
// 12-byte IV, then ciphertext + 16-byte tag (WebCrypto puts the tag at the end).

async function key(): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(Deno.env.get("CONTEXT_ENCRYPTION_KEY")!), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** Returns a Postgres bytea literal ("\x…") ready to insert through the REST API. */
export async function encryptToBytea(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return "\\x" + toHex(out);
}

export async function decryptFromBytea(bytea: string): Promise<string> {
  const data = fromHex(bytea.startsWith("\\x") ? bytea.slice(2) : bytea);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, await key(), data.slice(12));
  return new TextDecoder().decode(pt);
}
