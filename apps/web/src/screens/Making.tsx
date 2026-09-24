import { useEffect, useState } from "react";
import { api, type EpisodeStatus } from "../api";
import { STEP_LABELS } from "../copy";

const ORDER: EpisodeStatus[] = ["queued", "collecting", "ranking", "planning", "writing", "checking", "voicing"];

/** Shows each step while the episode is made. Checks the status every few seconds. */
export function Making({ episodeId, onReady, onLeave }: { episodeId: string; onReady: () => void; onLeave: () => void }) {
  const [status, setStatus] = useState<EpisodeStatus>("queued");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const ep = await api.getEpisode(episodeId);
        if (stop) return;
        setStatus(ep.status);
        if (ep.status === "ready") return onReady();
        if (ep.status === "failed") return setError(ep.error?.startsWith("not_enough_content")
          ? "We could not find enough new content in your sources. Try adding a few more sources or interests."
          : "Something went wrong while making your episode. We will try again soon.");
      } catch { /* try again on the next tick */ }
      if (!stop) setTimeout(tick, api.mode === "preview" ? 900 : 4000);
    };
    tick();
    return () => { stop = true; };
  }, [episodeId, onReady]);

  const now = ORDER.indexOf(status);
  return (
    <div style={{ paddingTop: "8vh" }}>
      <h1>Making your episode</h1>
      <p className="muted">This takes about 3 to 5 minutes. You can close the app: the episode will be waiting for you.</p>
      <div className="card steps" style={{ marginTop: 20 }}>
        {ORDER.slice(1).map((s, n) => {
          const idx = n + 1;
          const state = idx < now ? "done" : idx === now ? "now" : "";
          return (
            <div key={s} className={`list-item ${state}`}>
              <span style={{ width: 24 }}>{state === "done" ? "✓" : state === "now" ? <div className="spinner" /> : "·"}</span>
              <span>{STEP_LABELS[s]}</span>
            </div>
          );
        })}
      </div>
      {status === "queued" && <p className="muted small">Waiting for the next free worker…</p>}
      {error && <p className="error">{error}</p>}
      <button className="btn secondary" style={{ marginTop: 20 }} onClick={onLeave}>Go to the app</button>
    </div>
  );
}
