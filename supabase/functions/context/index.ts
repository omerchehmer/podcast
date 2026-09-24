// "What the app knows about you".
//   GET    → the current profile text (decrypted)
//   PUT    { text, origin } → removes sensitive data, encrypts, saves a new version
//   DELETE → deletes the profile and all old versions
import { admin, cors, currentUser, json } from "../_shared/http.ts";
import { encryptToBytea, decryptFromBytea } from "../_shared/crypto.ts";
import { scrubSensitive, REMOVED_LABELS } from "../_shared/scrub.ts";

const MAX_CHARS = 6000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = await currentUser(req);
  if (!user) return json({ error: "not signed in" }, 401);
  const db = admin();

  if (req.method === "GET") {
    const { data } = await db.from("listener_context").select("ciphertext, origin, created_at, removed_items")
      .eq("user_id", user.id).eq("is_current", true).maybeSingle();
    if (!data) return json({ text: "", origin: null, updatedAt: null });
    return json({ text: await decryptFromBytea(data.ciphertext), origin: data.origin, updatedAt: data.created_at });
  }

  if (req.method === "PUT") {
    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "").slice(0, MAX_CHARS).trim();
    const origin = ["paste", "mcp", "manual"].includes(body.origin) ? body.origin : "manual";
    const { text: clean, removed } = scrubSensitive(text);
    await db.from("listener_context").update({ is_current: false }).eq("user_id", user.id).eq("is_current", true);
    const { error } = await db.from("listener_context").insert({
      user_id: user.id, ciphertext: await encryptToBytea(clean), origin, removed_items: removed, is_current: true,
    });
    if (error) return json({ error: "could not save" }, 500);
    // keep the last 10 versions only
    const { data: old } = await db.from("listener_context").select("id").eq("user_id", user.id)
      .order("created_at", { ascending: false }).range(10, 100);
    if (old?.length) await db.from("listener_context").delete().in("id", old.map((o) => o.id));
    return json({ text: clean, removed: removed.map((r) => REMOVED_LABELS[r]) });
  }

  if (req.method === "DELETE") {
    await db.from("listener_context").delete().eq("user_id", user.id);
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, 405);
});
