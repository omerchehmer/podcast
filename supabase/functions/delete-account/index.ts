// Deletes the signed-in user's account and all their data (App Store rule, and simply right).
// Database rows go with the auth user (ON DELETE CASCADE). Audio files are removed here.
import { admin, cors, currentUser, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const user = await currentUser(req);
  if (!user) return json({ error: "not signed in" }, 401);
  const db = admin();

  const { data: files } = await db.storage.from("episodes").list(user.id, { limit: 1000 });
  if (files?.length) await db.storage.from("episodes").remove(files.map((f) => `${user.id}/${f.name}`));
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) return json({ error: "could not delete account" }, 500);
  return json({ ok: true });
});
