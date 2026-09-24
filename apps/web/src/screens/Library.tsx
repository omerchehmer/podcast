import { useEffect, useState } from "react";
import { api, type EpisodeSummary } from "../api";
import { formatTime, friendlyDate } from "../copy";
import type { Go } from "../App";

export function Library({ go }: { go: Go }) {
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { api.listEpisodes().then(setEpisodes); }, []);

  const shown = episodes.filter((e) => e.status === "ready" && (!q || `${e.title} ${e.summary}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <h1>Library</h1>
      <input className="input" type="search" placeholder="Search your episodes" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 && <p className="muted" style={{ marginTop: 16 }}>{q ? "Nothing found." : "Your episodes will appear here."}</p>}
      <div style={{ marginTop: 8 }}>
        {shown.map((e) => (
          <button key={e.id} className="list-item" style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--line)", textAlign: "left", cursor: "pointer" }}
            onClick={() => go({ name: "episode", id: e.id })}>
            <div className="space">
              <div style={{ fontWeight: 600 }}>{e.title}</div>
              <div className="muted small">{friendlyDate(e.scheduledFor)} · {e.episodeType === "deep_dive" ? "Deep dive" : "Mix"}{e.durationSec ? ` · ${formatTime(e.durationSec)}` : ""}</div>
            </div>
            <span>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
