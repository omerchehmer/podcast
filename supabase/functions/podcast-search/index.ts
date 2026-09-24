// Search podcasts by name with the free Apple Podcasts search API. Returns RSS feed URLs.
//   GET ?q=lenny
import { cors, currentUser, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await currentUser(req))) return json({ error: "not signed in" }, 401);
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100);
  if (!q) return json({ results: [] });
  const res = await fetch(`https://itunes.apple.com/search?media=podcast&limit=10&term=${encodeURIComponent(q)}`);
  if (!res.ok) return json({ error: "search failed" }, 502);
  const data = await res.json();
  const results = (data.results ?? [])
    .filter((r: Record<string, string>) => r.feedUrl)
    .map((r: Record<string, string>) => ({
      title: r.collectionName, author: r.artistName, feedUrl: r.feedUrl, image: r.artworkUrl100, url: r.collectionViewUrl,
    }));
  return json({ results });
});
