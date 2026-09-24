// Starts the episode worker right away (GitHub Actions "workflow_dispatch"),
// so a new episode does not wait for the next hourly run.
// Needs secrets: GITHUB_TOKEN (fine-grained, Actions: read and write on this repo), GITHUB_REPO ("owner/name").
import { cors, currentUser, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await currentUser(req))) return json({ error: "not signed in" }, 401);
  const token = Deno.env.get("GITHUB_TOKEN");
  const repo = Deno.env.get("GITHUB_REPO");
  const ref = Deno.env.get("GITHUB_REF") ?? "main";
  if (!token || !repo) return json({ started: false, reason: "not configured; the hourly run will pick it up" });
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/worker.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "briefcast" },
    body: JSON.stringify({ ref }),
  });
  return json({ started: res.status === 204 });
});
