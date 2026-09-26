import { useEffect, useState } from "react";
import { api, type EpisodeSummary, type Settings } from "../api";
import { DAYS, formatTime, friendlyDate, nextEpisodeAt, nextEpisodeLabel } from "../copy";
import type { Go } from "../App";

export function Today({ go }: { go: Go }) {
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listEpisodes().then(setEpisodes);
    api.getSettings().then(setSettings);
    api.getProfile().then((p) => { setName(p.displayName); if (p.timeZone) setTimeZone(p.timeZone); });
  }, []);

  const latest = episodes?.find((e) => e.status === "ready");
  const working = episodes?.find((e) => e.status !== "ready" && e.status !== "failed");
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <h1>{hello}{name ? `, ${name}` : ""}</h1>

      {working && (
        <button className="card" style={{ width: "100%", textAlign: "left", cursor: "pointer", marginTop: 12 }} onClick={() => go({ name: "making", id: working.id })}>
          <div className="row"><div className="spinner" /><b>A new episode is being made…</b></div>
          <p className="muted small">Tap to see the progress.</p>
        </button>
      )}

      {latest ? (
        <div className="card" style={{ marginTop: 12 }}>
          <span className="pill">{friendlyDate(latest.scheduledFor)} · {latest.episodeType === "deep_dive" ? "Deep dive" : "Mix"}{latest.durationSec ? ` · ${Math.round(latest.durationSec / 60)} min` : ""}</span>
          <h2 style={{ marginTop: 12 }}>{latest.title}</h2>
          <p>{latest.summary}</p>
          {latest.changeNote && <p className="note">✦ {latest.changeNote}</p>}
          <button className="btn" style={{ marginTop: 12 }} onClick={() => go({ name: "episode", id: latest.id, autoplay: true })}>▶ Play</button>
          <button className="btn ghost" onClick={() => go({ name: "feedback", id: latest.id })}>Give feedback</button>
        </div>
      ) : episodes && !working ? (
        <div className="card" style={{ marginTop: 12 }}>
          <p>No episodes yet.</p>
        </div>
      ) : null}

      {settings && (() => {
        const next = nextEpisodeAt(settings, timeZone);
        const days = settings.frequency === "daily" ? "every day" : settings.frequency === "weekdays" ? "Monday to Friday" : settings.customDays.map((d) => DAYS[d - 1]).join(", ");
        return (
          <p className="muted small" style={{ marginTop: 16 }}>
            {next
              ? <>Next episode: <b>{nextEpisodeLabel(next, timeZone)}</b>, {settings.lengthMinutes} minutes. Schedule: {days}.</>
              : <>No days chosen, so no episodes are scheduled. Choose days in Settings.</>}
          </p>
        );
      })()}

      {!working && (
        <>
          <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { go({ name: "making", id: await api.requestEpisodeNow() }); }
            catch (e) { setError(e instanceof Error ? e.message : "Could not start"); }
            setBusy(false);
          }}>Make a new episode now</button>
          <p className="muted small center">If you tapped "Go deeper" on an idea, the next episode is a deep dive on it.</p>
        </>
      )}
      {error && <p className="error">{error}</p>}

      {episodes && episodes.filter((e) => e.status === "ready").length > 1 && (
        <>
          <h2>Earlier</h2>
          {episodes.filter((e) => e.status === "ready" && e.id !== latest?.id).slice(0, 3).map((e) => (
            <button key={e.id} className="list-item" style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--line)", textAlign: "left", cursor: "pointer" }}
              onClick={() => go({ name: "episode", id: e.id })}>
              <div className="space"><div>{e.title}</div><div className="muted small">{friendlyDate(e.scheduledFor)}{e.durationSec ? ` · ${formatTime(e.durationSec)}` : ""}</div></div>
              <span>›</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
