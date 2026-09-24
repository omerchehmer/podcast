import { useEffect, useState } from "react";
import type { QuickTag } from "@briefcast/shared";
import { api, type EpisodeDetail, type FeedbackInput } from "../api";
import { QUICK_TAGS } from "../copy";

/** Under 20 seconds: stars, thumbs per idea, "go deeper", quick options, optional note. */
export function Feedback({ id, onDone }: { id: string; onDone: () => void }) {
  const [ep, setEp] = useState<EpisodeDetail | null>(null);
  const [f, setF] = useState<FeedbackInput>({ stars: null, quickTags: [], note: "", segments: [] });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getEpisode(id).then(setEp);
    api.getFeedback(id).then((x) => x && setF(x));
  }, [id]);
  if (!ep) return null;

  const ideas = ep.segments.filter((s) => s.kind === "idea");
  const segOf = (sid: string) => f.segments.find((s) => s.segmentId === sid) ?? { segmentId: sid, thumb: null, goDeeper: false };
  const setSeg = (sid: string, patch: Partial<FeedbackInput["segments"][number]>) => {
    const others = f.segments.filter((s) => s.segmentId !== sid);
    // only one "go deeper" at a time: it decides the next episode
    const cleared = patch.goDeeper ? others.map((s) => ({ ...s, goDeeper: false })) : others;
    setF({ ...f, segments: [...cleared, { ...segOf(sid), ...patch }] });
  };
  const toggleTag = (t: QuickTag) =>
    setF({ ...f, quickTags: f.quickTags.includes(t) ? f.quickTags.filter((x) => x !== t) : [...f.quickTags, t] });

  if (saved) {
    const deeper = f.segments.find((s) => s.goDeeper);
    return (
      <div style={{ paddingTop: "10vh" }} className="stack">
        <h1>Thank you</h1>
        <p>Your next episode will use this feedback.</p>
        {deeper && <p className="note">✦ Your next episode will be a deep dive on “{ep.segments.find((s) => s.id === deeper.segmentId)?.title}”. You can also make it now from the Today screen.</p>}
        <button className="btn" onClick={onDone}>Done</button>
      </div>
    );
  }

  return (
    <div>
      <button className="back" onClick={onDone}>‹ Close</button>
      <h1>How was it?</h1>
      <p className="muted">{ep.title}</p>

      <div className="stars" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={(f.stars ?? 0) >= n ? "on" : ""} onClick={() => setF({ ...f, stars: n })} aria-label={`${n} stars`}>★</button>
        ))}
      </div>

      {ideas.length > 0 && <h2>Each idea</h2>}
      {ideas.map((s) => {
        const cur = segOf(s.id);
        return (
          <div className="card" key={s.id}>
            <b>{s.title}</b>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="thumbs">
                <button className={cur.thumb === 1 ? "on" : ""} onClick={() => setSeg(s.id, { thumb: cur.thumb === 1 ? null : 1 })} aria-label="Thumbs up">👍</button>
                <button className={cur.thumb === -1 ? "on" : ""} onClick={() => setSeg(s.id, { thumb: cur.thumb === -1 ? null : -1 })} aria-label="Thumbs down">👎</button>
              </div>
              <div className="space" />
              <button className={`btn small ${cur.goDeeper ? "" : "secondary"}`} onClick={() => setSeg(s.id, { goDeeper: !cur.goDeeper })}>
                {cur.goDeeper ? "Going deeper ✓" : "Go deeper"}
              </button>
            </div>
          </div>
        );
      })}

      <h2>Quick notes</h2>
      <div className="chips">
        {QUICK_TAGS.map(([t, label]) => (
          <button key={t} className={`chip ${f.quickTags.includes(t) ? "on" : ""}`} onClick={() => toggleTag(t)}>{label}</button>
        ))}
      </div>

      <label className="field"><span>What should be different next time? (optional)</span>
        <textarea className="input" style={{ minHeight: 110 }} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={1000} />
      </label>

      <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await api.saveFeedback(id, f); setSaved(true); setBusy(false); }}>
        Send feedback
      </button>
    </div>
  );
}
