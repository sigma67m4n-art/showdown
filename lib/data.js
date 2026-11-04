import { discoverMatch, settleMatch } from "./predict.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FCF_API = "https://fcmobileforum.com/api/v1/program-players/programname_showdown25?limit=500&offset=0";
const JINA = "https://r.jina.ai/";
const TTL = 5 * 60 * 1000;
const MAX_DAY_DIFF = 11;

const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(ss|ssc|sc|fc|acf|stade|club|calcio|lo|de|as|sv|cf)\b/g, " ")
    .split(" ")
    .filter(Boolean)
    .join(" ")
    .replace(/\brennais\b/g, "rennes")
    .replace(/\binternazionale\b/g, "inter");

const utcDay = (iso) => {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const rzm = (s) => s.replace(/_/g, " ").replace(/\s+enilive\s*$/i, "").trim();

const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
};

const proxy = async (url, html) => {
  const headers = { "User-Agent": UA };
  if (html) headers["x-return-format"] = "html";
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(JINA + url, { headers });
      if (res.ok) return res.text();
      last = new Error(`jina ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw last;
};

const direct = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.text();
};

let cache = null;
let cachedAt = 0;

const mapPlayer = (p) => ({
  name: p.fullName || p.playerName || "",
  cardName: p.playerName || p.fullName || "",
  position: p.position,
  rating: p.rating,
  height: p.height,
  weight: p.weight,
  weakFoot: p.weakFoot,
  strongFoot: p.strongFoot || (p.strongFootValue === 1 ? "Right" : "Left"),
  added: p.createdAt || p.createdDate || "",
  created: p.createdAt || p.createdDate || "",
  club: p.club ? rzm(p.club) : "",
  league: p.league ? rzm(p.league) : "",
  nation: p.nation || "",
  cardImg: p.playerImage || "",
  cardBg: p.cardArtBackgroundUrl || "",
  cardSprite: p.cardArtSpriteUrl || "",
  clubLogo: p.clubLogoUrl || "",
  leagueLogo: p.leagueLogoUrl || "",
  flag: p.nationFlagUrl || "",
  clubId: p.clubId ?? null,
  leagueId: p.leagueId ?? null,
  countryId: p.countryId ?? null,
  isNationalTeam: Boolean(p.isNationalTeam) || rzm(p.league || "") === "International",
});

const fetchPlayers = async () => {
  const sources = [() => proxy(FCF_API, false), () => direct(FCF_API), () => proxy(FCF_API, false)];
  let lastErr;
  for (const source of sources) {
    try {
      const text = await source();
      const start = text.indexOf('{"players"');
      const j = JSON.parse(start >= 0 ? text.slice(start) : text);
      const rows = Array.isArray(j) ? j : j.players || [];
      if (rows.length) {
        return [...rows]
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .map(mapPlayer);
      }
      lastErr = new Error("no players");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no players");
};

const todayUtc = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const windowFor = (batch) => {
  const days = batch.map((p) => utcDay(p.added));
  return { start: Math.max(...days), end: Math.min(...days) + MAX_DAY_DIFF * 86400000 };
};

const buildMatches = async (batch) => {
  const lists = [batch.filter((p) => !p.isNationalTeam), batch.filter((p) => p.isNationalTeam)];
  const matches = [];
  for (const list of lists) {
    if (list.length < 2) continue;
    const pairs = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) pairs.push([i, j]);
    }
    const found = await mapLimit(pairs, 3, async ([i, j]) => {
      const A = list[i];
      const B = list[j];
      if (!A.club || !B.club || norm(A.club) === norm(B.club)) return null;
      const r = await discoverMatch(A.club, B.club);
      if (!r || !r.matchDate) return null;
      const { start, end } = windowFor([A, B]);
      const kick = utcDay(r.matchDate);
      if (kick < start || kick > end) return null;
      return { i, j, r };
    });
    for (const f of found) {
      if (!f) continue;
      const { i, j, r } = f;
      const A = list[i];
      const B = list[j];
      const homeP = r.homeName === A.club ? A : B;
      const awayP = homeP === A ? B : A;
      matches.push({
        home: { player: homeP, p: r.homeWin },
        away: { player: awayP, p: r.awayWin },
        draw: r.draw,
        league: r.league || "",
        round: "",
        date: r.date,
        url: "",
        homeName: homeP.club,
        awayName: awayP.club,
      });
    }
  }
  return matches;
};

export async function getData() {
  if (cache && Date.now() - cachedAt < TTL) return cache;

  const startedAt = Date.now();
  const budgetMs = 32000;
  const players = await fetchPlayers().catch(() => []);

  const groups = new Map();
  for (const p of players) {
    const key = p.added || "";
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const today = todayUtc();
  const versions = [];
  const settled = [];
  const finished = [];

  for (const [key, batch] of groups) {
    const { end } = windowFor(batch);
    if (end < today) {
      if (batch.length >= 2 && batch.length <= 6 && utcDay(key) >= today - 180 * 86400000) {
        finished.push({ key, batch });
      }
      continue;
    }

    const matches = (await buildMatches(batch)).filter((m) => m.date && utcDay(m.date) >= today);
    if (!matches.length) continue;
    versions.push({ id: key, date: key.slice(0, 10), matches });
  }

  finished.sort((a, b) => (a.key < b.key ? 1 : -1));

  for (const { key, batch } of finished.slice(0, 12)) {
    if (Date.now() - startedAt > budgetMs) break;
    const index = new Map();
    for (const p of batch) if (p.club) index.set(p.club, p);
    const pairs = [];
    for (let i = 0; i < batch.length; i++) {
      for (let j = i + 1; j < batch.length; j++) pairs.push([i, j]);
    }
    const results = await mapLimit(pairs, 3, async ([i, j]) => {
      const A = batch[i];
      const B = batch[j];
      if (!A.club || !B.club || norm(A.club) === norm(B.club)) return null;
      return settleMatch(A.club, B.club).catch(() => null);
    });
    for (const r of results) {
      if (!r) continue;
      const homeP = index.get(r.home);
      const awayP = index.get(r.away);
      if (!homeP || !awayP) continue;
      settled.push({
        home: { player: homeP, p: r.homeWin },
        away: { player: awayP, p: r.awayWin },
        draw: r.draw,
        league: r.league || "",
        date: r.date,
        homeScore: r.homeScore,
        awayScore: r.awayScore,
        pick: r.pick,
        actual: r.actual,
        correct: r.correct,
        outcome: r.outcome,
        version: key.slice(0, 10),
      });
    }
  }

  settled.sort((a, b) => new Date(b.date) - new Date(a.date));
  const played = settled.length;
  const draws = settled.filter((m) => m.outcome === "draw").length;
  const correct = settled.filter((m) => m.outcome === "correct").length;
  const wrong = settled.filter((m) => m.outcome === "wrong").length;
  const decided = correct + wrong;

  versions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const data = {
    players,
    versions,
    results: settled,
    stats: { played, decided, correct, wrong, draws, accuracy: decided ? correct / decided : 0 },
    matches: versions[0] ? versions[0].matches : [],
    fixturesCount: versions.reduce((n, v) => n + v.matches.length, 0),
    build: "predic",
  };
  if (players.length) {
    cache = data;
    cachedAt = Date.now();
  }
  return data;
}
