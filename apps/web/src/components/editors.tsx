/**
 * Editors shared by onboarding and the "You" tab: interests, sources, about you, podcast settings.
 */
import { useEffect, useState } from "react";
import { LIMITS, VOICES, type InterestWeight } from "@briefcast/shared";
import { api, type Category, type Interest, type MySource, type PodcastHit, type Settings, type SourceOption } from "../api";

const KIND_LABEL: Record<SourceOption["kind"], string> = {
  podcast: "Podcast", rss: "Website", website: "Website", newsletter_email: "Newsletter", youtube: "YouTube", book: "Book",
};
import { DAYS, LANGUAGES, PROFILE_PROMPT } from "../copy";

// ---------- Interests ----------

const NEXT_WEIGHT: Record<InterestWeight | "none", InterestWeight | "none"> = {
  none: "some", some: "a_lot", a_lot: "a_little", a_little: "none", avoid: "none",
};
const WEIGHT_LABEL: Record<InterestWeight, string> = { a_lot: "a lot", some: "some", a_little: "a little", avoid: "avoid" };

export function InterestsEditor({ value, onChange }: { value: Interest[]; onChange: (v: Interest[]) => void }) {
  const [cats, setCats] = useState<Category[]>([]);
  const [text, setText] = useState("");
  const [avoidText, setAvoidText] = useState("");
  useEffect(() => { api.getCategories().then(setCats); }, []);

  const find = (label: string) => value.find((i) => i.label.toLowerCase() === label.toLowerCase());
  const set = (label: string, weight: InterestWeight | "none", categoryId?: string) => {
    const rest = value.filter((i) => i.label.toLowerCase() !== label.toLowerCase());
    onChange(weight === "none" ? rest : [...rest, { label, weight, categoryId: categoryId ?? find(label)?.categoryId ?? null }]);
  };
  const add = (raw: string, weight: InterestWeight) => {
    for (const label of raw.split(",").map((s) => s.trim()).filter(Boolean)) set(label.slice(0, 60), weight);
  };
  const custom = value.filter((i) => i.weight !== "avoid" && !cats.some((c) => c.name === i.label));
  const avoid = value.filter((i) => i.weight === "avoid");

  return (
    <div>
      <p className="muted small">Tap once for "some", twice for "a lot", three times for "a little". Tap again to remove.</p>
      <div className="chips">
        {cats.map((c) => {
          const cur = find(c.name);
          return (
            <button key={c.id} className={`chip ${cur ? "on" : ""}`} onClick={() => set(c.name, NEXT_WEIGHT[cur?.weight ?? "none"], c.id)}>
              {c.name}{cur ? ` · ${WEIGHT_LABEL[cur.weight]}` : ""}
            </button>
          );
        })}
        {custom.map((i) => (
          <button key={i.label} className="chip on" onClick={() => set(i.label, NEXT_WEIGHT[i.weight])}>
            {i.label} · {WEIGHT_LABEL[i.weight]}
          </button>
        ))}
      </div>
      <form className="row" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); add(text, "some"); setText(""); }}>
        <input className="input" placeholder="Add your own topic, e.g. pricing strategy" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn small" disabled={!text.trim()}>Add</button>
      </form>

      <h3>Topics to avoid</h3>
      <div className="chips">
        {avoid.map((i) => (
          <button key={i.label} className="chip avoid" onClick={() => set(i.label, "none")} aria-label={`Stop avoiding ${i.label}`}>{i.label} ✕</button>
        ))}
      </div>
      <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); add(avoidText, "avoid"); setAvoidText(""); }}>
        <input className="input" placeholder="e.g. sports, celebrity news" value={avoidText} onChange={(e) => setAvoidText(e.target.value)} />
        <button className="btn small secondary" disabled={!avoidText.trim()}>Avoid</button>
      </form>
    </div>
  );
}

// ---------- Sources ----------

const WEIGHT_RANK: Record<InterestWeight, number> = { a_lot: 3, some: 2, a_little: 1, avoid: 0 };

interface SourceGroup { key: string; title: string; weight: InterestWeight | null; items: SourceOption[] }

/**
 * Groups catalog sources by the listener's interests, strongest interest first.
 * A source goes under its main topic when the listener follows it, else under its second topic.
 * Sources in an avoided topic are hidden; the rest go under "Other topics".
 */
export function groupByInterests(catalog: SourceOption[], interests: Interest[], cats: Category[]): SourceGroup[] {
  const mine = interests.filter((i) => i.categoryId && i.weight !== "avoid").sort((a, b) => WEIGHT_RANK[b.weight] - WEIGHT_RANK[a.weight]);
  const avoided = new Set(interests.filter((i) => i.weight === "avoid" && i.categoryId).map((i) => i.categoryId!));
  const groups: SourceGroup[] = mine.map((i) => ({ key: i.categoryId!, title: cats.find((c) => c.id === i.categoryId)?.name ?? i.label, weight: i.weight, items: [] }));
  const other: SourceGroup = { key: "other", title: "Other topics", weight: null, items: [] };
  for (const src of catalog) {
    if (src.categories.some((c) => avoided.has(c))) continue;
    const home = src.categories.map((c) => groups.find((g) => g.key === c)).find(Boolean) ?? other;
    home.items.push(src);
  }
  // Feeds before books, then best quality first.
  for (const g of [...groups, other]) g.items.sort((a, b) => Number(a.kind === "book") - Number(b.kind === "book") || (b.quality ?? 0) - (a.quality ?? 0));
  return [...groups, other].filter((g) => g.items.length);
}

function WhyPicked({ source }: { source: SourceOption }) {
  if (!source.why && !source.evidence?.length) return null;
  return (
    <div className="why">
      {source.why && <p className="small">{source.why}</p>}
      {!!source.evidence?.length && (
        <ul className="evidence">
          {source.evidence.map((e) => (
            <li key={e.url + e.label}><a href={e.url} target="_blank" rel="noreferrer">{e.label}</a></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SourcesEditor() {
  const [mine, setMine] = useState<MySource[]>([]);
  const [discovery, setDiscovery] = useState<SourceOption[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [tab, setTab] = useState<"suggested" | "podcast" | "web" | "book">("suggested");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PodcastHit[] | null>(null);
  const [url, setUrl] = useState("");
  const [book, setBook] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => api.getMySources().then(setMine);
  useEffect(() => {
    reload();
    api.getDiscoverySources().then(setDiscovery);
    api.getInterests().then(setInterests);
    api.getCategories().then(setCats);
  }, []);
  const has = (id: string) => mine.some((m) => m.id === id);
  const groups = groupByInterests(discovery, interests, cats);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await reload(); setMsg(ok); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong"); }
    setBusy(false);
  };

  const sourceCard = (d: SourceOption) => (
    <div className="source-card" key={d.id}>
      <div className="list-item">
        <div className="space">
          <div><b>{d.title}</b></div>
          <div className="muted small">{KIND_LABEL[d.kind]}{d.url ? <> · <a href={d.url} target="_blank" rel="noreferrer">open</a></> : null}</div>
        </div>
        {has(d.id)
          ? <button className="btn small secondary" disabled={busy} onClick={() => run(() => api.removeSource(d.id), "Removed")}>Added ✓</button>
          : <button className="btn small" disabled={busy} onClick={() => run(() => api.followSource(d.id), `Added ${d.title}`)}>Add</button>}
      </div>
      <WhyPicked source={d} />
    </div>
  );

  return (
    <div>
      <div className="segmented" style={{ marginBottom: 14 }}>
        {(["suggested", "podcast", "web", "book"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); setMsg(null); }}>
            {{ suggested: "For you", podcast: "Podcasts", web: "Websites", book: "Books" }[t]}
          </button>
        ))}
      </div>

      {tab === "suggested" && (
        <div>
          <p className="muted small">
            We researched these for your interests. Under each one you can see why we picked it, with links to the proof.
          </p>
          {groups.filter((g) => g.key !== "other").map((g) => {
            const missing = g.items.filter((d) => d.kind !== "book" && !has(d.id));
            return (
              <div key={g.key}>
                <div className="group-head">
                  <h3>{g.title}{g.weight ? <span className="muted small"> · {WEIGHT_LABEL[g.weight]}</span> : null}</h3>
                  {missing.length > 1 && (
                    <button className="btn small ghost" disabled={busy}
                      onClick={() => run(async () => { for (const d of missing) await api.followSource(d.id); }, `Added ${missing.length} sources for ${g.title}`)}>
                      Add all
                    </button>
                  )}
                </div>
                <div className="card">{g.items.map(sourceCard)}</div>
              </div>
            );
          })}
          {groups.length > 0 && groups.every((g) => g.key === "other") && (
            <p className="note">Choose some interests first. Then we show the best sources for them here.</p>
          )}
          {groups.filter((g) => g.key === "other").map((g) => (
            <details key={g.key} className="more">
              <summary>Other topics ({g.items.length})</summary>
              <div className="card">{g.items.map(sourceCard)}</div>
            </details>
          ))}
        </div>
      )}

      {tab === "podcast" && (
        <div>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setHits(await api.searchPodcasts(q).catch(() => [])); setBusy(false); }}>
            <input className="input" placeholder="Search podcasts by name" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn small" disabled={!q.trim() || busy}>Search</button>
          </form>
          <p className="muted small">We use episode titles and show notes, and link to the original shows.</p>
          {hits && hits.length === 0 && <p className="muted">No podcasts found.</p>}
          {hits?.map((h) => (
            <div className="list-item" key={h.feedUrl}>
              <div className="space"><div>{h.title}</div><div className="muted small">{h.author}</div></div>
              <button className="btn small" disabled={busy} onClick={() => run(() => api.addSource({ kind: "podcast", title: h.title, feedUrl: h.feedUrl }), `Added ${h.title}`)}>Add</button>
            </div>
          ))}
        </div>
      )}

      {tab === "web" && (
        <form onSubmit={(e) => {
          e.preventDefault();
          const feed = url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`;
          let host: string;
          try { host = new URL(feed).hostname; } catch { setMsg("This does not look like a web address. Example: stratechery.com/feed"); return; }
          if (!host.includes(".")) { setMsg("This does not look like a web address. Example: stratechery.com/feed"); return; }
          run(() => api.addSource({ kind: "rss", title: host.replace(/^www\./, ""), url: feed, feedUrl: feed }), "Added. We will check the feed when we make your next episode.");
          setUrl("");
        }}>
          <label className="field"><span>Website or RSS feed address</span>
            <input className="input" inputMode="url" placeholder="e.g. stratechery.com/feed" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <p className="muted small">Blogs and newsletters with an RSS feed work best. Tip: many sites have their feed at /feed or /rss.</p>
          <button className="btn" disabled={!url.trim() || busy}>Add website</button>
        </form>
      )}

      {tab === "book" && (
        <form onSubmit={(e) => { e.preventDefault(); run(() => api.addSource({ kind: "book", title: book.trim() }), "Added"); setBook(""); }}>
          <label className="field"><span>A book you are reading</span>
            <input className="input" placeholder="Title and author" value={book} onChange={(e) => setBook(e.target.value)} />
          </label>
          <p className="muted small">We use books as themes and references. We never read book text.</p>
          <button className="btn" disabled={!book.trim() || busy}>Add book</button>
        </form>
      )}

      {msg && <p className="note">{msg}</p>}

      <h3>Your sources ({mine.length})</h3>
      {mine.length === 0 && <p className="muted">None yet. You can skip this: we will use trusted sources that match your interests.</p>}
      {mine.length > 0 && (
        <div className="card">
          {mine.map((m) => (
            <div className="list-item" key={m.id}>
              <div className="space">
                <div>{m.title}</div>
                <div className="muted small">{KIND_LABEL[m.kind]}{m.addedBy === "system" ? " · picked for you" : ""}</div>
              </div>
              <button className="btn small ghost" onClick={() => run(() => api.removeSource(m.id), "Removed")} aria-label={`Remove ${m.title}`}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- About you ----------

export function AboutYouEditor({ onSaved }: { onSaved?: () => void }) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ removed: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.getContext().then((t) => { setText(t); setLoaded(true); }).catch(() => setLoaded(true)); }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(PROFILE_PROMPT); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>The fast way: ask your AI assistant</h3>
        <p className="small">1. Copy this prompt. 2. Paste it into Claude, ChatGPT or Gemini. 3. Paste the answer below.</p>
        <div className="code-box">{PROFILE_PROMPT}</div>
        <button className="btn secondary" style={{ marginTop: 12 }} onClick={copy}>{copied ? "Copied ✓" : "Copy the prompt"}</button>
      </div>

      <label className="field"><span>About you</span>
        <textarea className="input" disabled={!loaded} placeholder="Paste the answer here, or write a few lines: your role, company, goals, and how you like to learn."
          value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} maxLength={6000} />
      </label>
      <p className="muted small">
        We store this encrypted and use it only to make your episodes. We never use it to train AI models.
        We remove card numbers, bank details, ID numbers, emails and phone numbers automatically.
      </p>
      {result && (
        <p className="ok">Saved ✓{result.removed.length ? ` We removed ${result.removed.join(", ")}.` : ""}</p>
      )}
      <button className="btn" disabled={busy || !text.trim()} onClick={async () => {
        setBusy(true);
        const r = await api.saveContext(text, "paste");
        setText(r.text); setResult(r); setBusy(false); onSaved?.();
      }}>Save</button>
    </div>
  );
}

// ---------- Podcast settings ----------

export function SettingsEditor({ value, onChange }: { value: Settings; onChange: (s: Settings) => void }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...value, [k]: v });
  const pick = <T extends string | number>(options: readonly (readonly [T, string])[], cur: T, onPick: (v: T) => void) => (
    <div className="segmented">
      {options.map(([v, label]) => <button key={String(v)} className={cur === v ? "on" : ""} onClick={() => onPick(v)}>{label}</button>)}
    </div>
  );
  return (
    <div>
      <h3>How often</h3>
      {pick([["weekdays", "Weekdays"], ["daily", "Every day"], ["custom", "Choose days"]] as const, value.frequency, (v) => set("frequency", v))}
      {value.frequency === "custom" && (
        <div className="chips" style={{ marginTop: 10 }}>
          {DAYS.map((d, i) => {
            const n = i + 1;
            const on = value.customDays.includes(n);
            return <button key={d} className={`chip ${on ? "on" : ""}`} onClick={() => set("customDays", on ? value.customDays.filter((x) => x !== n) : [...value.customDays, n].sort())}>{d}</button>;
          })}
        </div>
      )}

      <label className="field"><span>Ready by</span>
        <input className="input" type="time" value={value.deliveryTime} onChange={(e) => set("deliveryTime", e.target.value)} />
      </label>

      <h3>Length</h3>
      {pick(LIMITS.lengthOptions.map((m) => [m, `${m} min`] as const), value.lengthMinutes as (typeof LIMITS.lengthOptions)[number], (v) => set("lengthMinutes", v))}

      <h3>Format</h3>
      {pick([["solo", "One host"], ["conversation", "Two hosts"]] as const, value.format, (v) => set("format", v))}
      <p className="muted small">{value.format === "solo" ? "Like a personal briefing from a smart friend." : "Two hosts who discuss and sometimes disagree."}</p>

      <label className="field"><span>{value.format === "solo" ? "Voice" : "First host"}</span>
        <select className="input" value={value.voiceA} onChange={(e) => set("voiceA", e.target.value)}>
          {VOICES.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.description}</option>)}
        </select>
      </label>
      {value.format === "conversation" && (
        <label className="field"><span>Second host</span>
          <select className="input" value={value.voiceB} onChange={(e) => set("voiceB", e.target.value)}>
            {VOICES.filter((v) => v.id !== value.voiceA).map((v) => <option key={v.id} value={v.id}>{v.name} — {v.description}</option>)}
          </select>
        </label>
      )}

      <h3>Episode type</h3>
      {pick([["mix", "Mix"], ["deep_dive", "Deep dive"]] as const, value.episodeType, (v) => set("episodeType", v))}
      <p className="muted small">{value.episodeType === "mix"
        ? "A few short ideas, each with why it matters to you and a question. You pick one."
        : "One idea in depth: facts, the other side, what it means for you, your options."}</p>

      <h3>Tone</h3>
      {pick([["direct", "Direct and challenging"], ["calm", "Calm and explaining"]] as const, value.tone, (v) => set("tone", v))}

      <label className="field"><span>Episode language</span>
        <select className="input" value={value.language} onChange={(e) => set("language", e.target.value)}>
          {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
    </div>
  );
}
