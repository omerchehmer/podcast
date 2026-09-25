/**
 * Preview mode: the whole app with sample data in memory. No backend, no AI costs.
 * Used when the Supabase settings are missing, so anyone can click through the screens.
 * The sample episode has silent audio of the right length, so the player can be tested.
 */
import type {
  Api, Category, EpisodeDetail, EpisodeStatus, EpisodeSummary, FeedbackInput, Interest, MySource, PodcastHit, Profile, Settings, SourceOption,
} from "./types";

const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** A silent WAV file of the given length (very low sample rate, so it stays small). */
function silentWav(seconds: number): string {
  const rate = 1000;
  const n = Math.round(seconds * rate);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, "data"); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

const CATEGORIES: Category[] = [
  { id: "ai", name: "AI and technology" }, { id: "leadership", name: "Leadership and management" },
  { id: "strategy", name: "Strategy" }, { id: "markets", name: "Markets and economy" },
  { id: "product", name: "Product and design" }, { id: "startups", name: "Startups and venture" },
  { id: "travel", name: "Travel industry" }, { id: "geopolitics", name: "Geopolitics" },
  { id: "science", name: "Science" }, { id: "health", name: "Health and performance" },
  { id: "careers", name: "Careers and learning" }, { id: "climate", name: "Climate and energy" },
];

const DISCOVERY: SourceOption[] = [
  // A few real entries from supabase/catalog/sources.json
  {"id": "d1", "kind": "rss", "title": "Skift", "url": "https://skift.com/", "categories": ["travel", "strategy"], "why": "The main daily business news for travel. Strong on OTAs, Airbnb, AI agents and travel demand, so it is still the best base source.", "evidence": [{"label": "In Travel Trends Podcast's 'Top 10 Travel Industry Newsletters' (Skift Daily)", "url": "https://www.traveltrendspodcast.com/blog/top-10-travel-industry-newsletters"}, {"label": "First pick in Revfine's list of travel industry podcasts for professionals", "url": "https://www.revfine.com/travel-industry-podcasts/"}], "quality": 0.9},
  {"id": "d2", "kind": "rss", "title": "Travel Tech Essentialist", "url": "https://traveltechessentialist.substack.com/", "categories": ["travel", "strategy"], "why": "A deep newsletter every two weeks on distribution, OTA stocks and AI in travel, by the co-founder of eDreams. It gives a strategy view, not only news.", "evidence": [{"label": "Author Mauricio Prieto is the founder of eDreams (Mogu list of best travel newsletters)", "url": "https://moguplatform.com/en/blog/10-best-travel-industry-newsletters"}, {"label": "#1 in Travel Trends Podcast's 'Top 10 Travel Industry Newsletters'", "url": "https://www.traveltrendspodcast.com/blog/top-10-travel-industry-newsletters"}, {"label": "Calls itself the '#1 ranked travel business newsletter on Substack' (self-stated)", "url": "https://traveltechessentialist.substack.com/"}], "quality": 0.9},
  {"id": "d3", "kind": "rss", "title": "Harvard Business Review", "url": "https://hbr.org", "categories": ["leadership", "strategy"], "why": "The standard source for management research. Many short, practical articles each day on leading people, decisions and AI at work.", "evidence": [{"label": "Published by Harvard Business Publishing, an affiliate of Harvard Business School", "url": "https://hbr.org/corporate/about"}], "quality": 0.95},
  {"id": "d4", "kind": "rss", "title": "First Round Review", "url": "https://review.firstround.com", "categories": ["leadership", "startups"], "why": "Very practical, long guides from real operators on org design, hiring, meetings and scaling teams. Good for a COO who wants to copy what works.", "evidence": [{"label": "\"200K+ readers subscribe to The Review\" (stated on its homepage)", "url": "https://review.firstround.com/"}], "quality": 0.9},
  {"id": "d5", "kind": "rss", "title": "One Useful Thing — Ethan Mollick", "url": "https://www.oneusefulthing.org", "categories": ["leadership", "ai"], "why": "A Wharton professor explains what new AI means for work and organizations. Clear and honest about what AI can and cannot do yet.", "evidence": [{"label": "Over 478,000 subscribers (Substack page)", "url": "https://www.oneusefulthing.org/about"}, {"label": "Named in TIME100 AI 2024", "url": "https://time.com/collections/time100-ai-2024/7012859/ethan-mollick/"}], "quality": 0.9},
  {"id": "d6", "kind": "rss", "title": "Stratechery", "url": "https://stratechery.com", "categories": ["strategy", "ai"], "why": "The best writing on tech strategy, platforms and aggregators. It helps you see how AI changes who wins in online marketplaces.", "evidence": [{"label": "Fortune Creator 25 (2021); readers in 85 countries", "url": "https://fortune.com/ranking/creator-25/2021/ben-thompson-stratechery"}, {"label": "Author: Kellogg MBA, ex-Microsoft; writing since 2013", "url": "https://stratechery.com/about/"}], "quality": 0.95},
  {"id": "d7", "kind": "podcast", "title": "Odd Lots", "url": "https://www.bloomberg.com/oddlots", "categories": ["markets"], "why": "Bloomberg hosts talk with real experts about markets, rates, trade and supply chains. Great for understanding the forces behind demand and FX.", "evidence": [{"label": "Webby Award nominee, best business podcast (2022)", "url": "https://en.wikipedia.org/wiki/Tracy_Alloway_(journalist)"}, {"label": "Apple Podcasts 4.5/5 (1,918 ratings)", "url": "https://podcasts.apple.com/us/podcast/odd-lots/id1056200096"}], "quality": 0.9},
  {"id": "d8", "kind": "rss", "title": "Lenny's Newsletter", "url": "https://www.lennysnewsletter.com/", "categories": ["product"], "why": "The most-read product newsletter: clear, practical advice on product, growth and now AI in product teams.", "evidence": [{"label": "1,000,000+ subscribers", "url": "https://www.lennysnewsletter.com/about"}], "quality": 0.9},
  {"id": "d9", "kind": "rss", "title": "Quanta Magazine", "url": "https://www.quantamagazine.org", "categories": ["science"], "why": "Deep but clear stories about new ideas in physics, math, biology and computer science. Editorially independent and very careful.", "evidence": [{"label": "Won the 2022 Pulitzer Prize for Explanatory Reporting", "url": "https://www.quantamagazine.org/quantanews/quanta-magazines-natalie-wolchover-and-staff-awarded-the-2022-pulitzer-prize-for-explanatory-writing/"}, {"label": "Won 2025 National Magazine Award (Best Single-Topic Issue)", "url": "https://www.quantamagazine.org/quantanews/quanta-wins-2025-national-magazine-award-for-best-single-topic-issue-and-webby-peoples-voice-award/"}], "quality": 0.95},
];

function sampleEpisode(id: string, when: Date): EpisodeDetail {
  const seg = (idx: number, kind: EpisodeDetail["segments"][number]["kind"], title: string, start: number, end: number, mainIdea: string, question: string | null) =>
    ({ id: `${id}-s${idx}`, idx, kind, title, mainIdea, question, startSec: start, endSec: end });
  const segments = [
    seg(0, "intro", "Today", 2.5, 40, "Three ideas about AI agents, owners, and questions.", null),
    seg(1, "idea", "AI agents book trips", 41, 300, "AI agents may compare every seller, so brand loyalty gets weaker.", "If an AI agent picked your product today, why would it?"),
    seg(2, "idea", "One owner ships faster", 301, 560, "Teams with one clear owner move faster than committees.", "Which project in your team has three owners and no owner?"),
    seg(3, "idea", "Ask, don't answer", 561, 820, "Leaders who ask more questions build teams that solve problems alone.", "What problem will you not solve for your team this week?"),
    seg(4, "recap", "Pick one", 821, 900, "A short recap.", "Which one idea will you think about today?"),
  ];
  const line = (speaker: "HOST_A" | "HOST_B", text: string, startSec: number, endSec: number) => ({ speaker, text, startSec, endSec });
  return {
    id, status: "ready", title: "Agents, owners and questions", summary: "Why AI agents change loyalty, why one owner beats a committee, and the power of questions.",
    changeNote: "More about leadership, fewer market updates, as you asked.", episodeType: "mix", scheduledFor: when.toISOString(),
    durationSec: 900, error: null, segments,
    sources: [
      { title: "AI agents start booking travel for business users", source: "Sample Tech Weekly", url: "https://example.com/ai-agents-travel", segmentId: `${id}-s1` },
      { title: "Why single-threaded owners ship faster", source: "Sample Leadership Notes", url: "https://example.org/single-threaded-owners", segmentId: `${id}-s2` },
      { title: "Leaders who ask more questions build stronger teams", source: "Sample Leadership Notes", url: "https://example.org/questions", segmentId: `${id}-s3` },
    ],
    transcript: [
      line("HOST_A", "Good morning. This is your daily episode. It is made by AI, from sources you chose.", 2.5, 12),
      line("HOST_A", "Today we look at three ideas. AI agents that book travel. Why one owner beats a committee. And why good leaders ask more than they answer.", 12, 40),
      line("HOST_A", "First idea. A sample report says AI agents now book about five percent of business trips at large companies.", 41, 60),
      line("HOST_A", "Why does this matter to you? If an agent compares every seller, the customer may never see your brand. The agent sees your data, your price, and your reviews.", 60, 120),
      line("HOST_A", "There is another view. Some experts think agents will favour sellers with clean data and simple systems. That could be an advantage, not a threat.", 120, 300),
      line("HOST_A", "Second idea. A sample study of forty teams found that teams with one clear owner shipped thirty percent faster.", 301, 560),
      line("HOST_A", "Third idea. Managers who ask open questions had teams that solved more problems on their own.", 561, 820),
      line("HOST_A", "That is today. Three ideas: agents, owners, and questions. Pick one idea to think about today.", 821, 900),
    ],
    audioUrl: null,
  };
}

export class MockApi implements Api {
  readonly mode = "preview" as const;
  private signedIn = false;
  private profile: Profile = { displayName: "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, onboardingDone: false, hasAccess: true };
  private settings: Settings = {
    frequency: "weekdays", customDays: [], deliveryTime: "07:30", lengthMinutes: 15, format: "solo",
    voiceA: "marin", voiceB: "cedar", episodeType: "mix", tone: "direct", language: "en",
  };
  private interests: Interest[] = [];
  private mine: MySource[] = [];
  private context = "";
  private episodes: EpisodeDetail[] = [];
  private feedback = new Map<string, FeedbackInput>();
  private progress = new Map<string, number>();

  async isSignedIn() { await wait(); return this.signedIn; }
  async joinWithInvite(code: string) {
    await wait(400);
    if (!code.trim()) return "Please type your invite code.";
    this.signedIn = true;
    return null;
  }
  async signOut() { this.signedIn = false; }
  async deleteAccount() { await wait(); location.reload(); }

  async getProfile() { await wait(); return { ...this.profile }; }
  async saveProfile(p: Partial<Profile>) { await wait(); this.profile = { ...this.profile, ...p }; }
  async getSettings() { await wait(); return { ...this.settings }; }
  async saveSettings(s: Settings) { await wait(); this.settings = { ...s }; }

  async getCategories() { await wait(); return CATEGORIES; }
  async getInterests() { await wait(); return this.interests.map((i) => ({ ...i })); }
  async saveInterests(list: Interest[]) { await wait(); this.interests = list.map((i) => ({ learnedWeight: 1, ...i })); }

  async getDiscoverySources() { await wait(); return DISCOVERY; }
  async getMySources() { await wait(); return [...this.mine]; }
  async followSource(id: string) {
    await wait();
    const d = DISCOVERY.find((x) => x.id === id);
    if (d && !this.mine.some((m) => m.id === id)) this.mine.push({ ...d, addedBy: "user", trust: 1 });
  }
  async addSource(s: { kind: MySource["kind"]; title: string; url?: string; feedUrl?: string }) {
    await wait();
    this.mine.push({ id: crypto.randomUUID(), kind: s.kind, title: s.title, url: s.url ?? s.feedUrl, categories: [], addedBy: "user", trust: 1 });
  }
  async removeSource(id: string) { await wait(); this.mine = this.mine.filter((m) => m.id !== id); }
  async searchPodcasts(q: string): Promise<PodcastHit[]> {
    await wait(300);
    return [
      { title: `${q} — Sample Show`, author: "Sample Author", feedUrl: "https://example.com/feed.xml" },
      { title: `The ${q} Podcast`, author: "Another Author", feedUrl: "https://example.com/feed2.xml" },
    ];
  }

  async getContext() { await wait(); return this.context; }
  async saveContext(text: string) {
    await wait(300);
    const removed: string[] = [];
    let clean = text;
    if (/\b[\w.+-]+@[\w-]+\.[\w.]+\b/.test(clean)) { clean = clean.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[removed]"); removed.push("an email address"); }
    this.context = clean;
    return { text: clean, removed };
  }
  async deleteContext() { await wait(); this.context = ""; }

  async requestEpisodeNow() {
    await wait();
    if (this.episodes.some((e) => e.status !== "ready" && e.status !== "failed")) throw new Error("An episode is already being made. It will be ready soon.");
    const ep = sampleEpisode(crypto.randomUUID(), new Date());
    ep.status = "queued";
    ep.changeNote = this.episodes.length ? ep.changeNote : null; // no change note on the very first episode
    this.episodes.unshift(ep);
    this.progress.set(ep.id, 0);
    return ep.id;
  }

  /** Each time the app checks, a preview episode moves one step forward. */
  private advance(ep: EpisodeDetail) {
    const steps: EpisodeStatus[] = ["queued", "collecting", "ranking", "planning", "writing", "checking", "voicing", "ready"];
    const n = (this.progress.get(ep.id) ?? 7) + 1;
    this.progress.set(ep.id, n);
    ep.status = steps[Math.min(n, steps.length - 1)]!;
    if (ep.status === "ready" && !ep.audioUrl) ep.audioUrl = silentWav(ep.durationSec ?? 900);
  }

  async listEpisodes(): Promise<EpisodeSummary[]> { await wait(); return this.episodes.map(({ segments: _s, sources: _src, transcript: _t, audioUrl: _a, ...rest }) => rest); }
  async getEpisode(id: string) {
    await wait();
    const ep = this.episodes.find((e) => e.id === id);
    if (!ep) throw new Error("Episode not found");
    if (ep.status !== "ready") this.advance(ep);
    return { ...ep };
  }

  async getFeedback(id: string) { await wait(); return this.feedback.get(id) ?? null; }
  async saveFeedback(id: string, f: FeedbackInput) { await wait(); this.feedback.set(id, f); }
  async logListen() { /* not recorded in preview mode */ }
  async report() { await wait(); }
}
