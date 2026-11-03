const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FCF_API = "https://fcmobileforum.com/api/v1/program-players/programname_showdown25?limit=500&offset=0";
const BASE = "https://www.oddalerts.com";
const LEAGUES = [
  "serie-a",
  "premier-league",
  "la-liga",
  "ligue-1",
  "bundesliga",
  "championship",
  "efl-league-one",
  "efl-league-two",
  "uefa-champions-league",
  "uefa-europa-league",
  "netherlands-eredivisie",
  "argentina-liga-profesional",
  "brazil-serie-a",
  "brazil-serie-b",
  "saudi-pro-league",
  "mls",
  "usl-championship",
  "j1-league",
  "k-league-1",
  "chinese-super-league",
  "allsvenskan",
  "eliteserien",
  "veikkausliiga",
];
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

const ALIASES = {
  "man united": "manchester united",
  "man city": "manchester city",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "losc": "lille",
  "koeln": "koln",
  "celta": "celta vigo",
};

const canon = (s) => {
  let t = norm(s);
  if (ALIASES[t]) t = norm(ALIASES[t]);
  return t;
};

const utcDay = (iso) => {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const tokSet = (s) => new Set(canon(s).split(" ").filter(Boolean));

const sideMatch = (club, side) => {
  const c = tokSet(club);
  const s = tokSet(side);
  if (!c.size || !s.size) return false;
  const [small, big] = c.size <= s.size ? [c, s] : [s, c];
  for (const t of small) if (!big.has(t)) return false;
  return true;
};

const pickSide = (club, fixtures) => {
  const cc = canon(club);
  if (!cc) return [];
  const cands = [];
  for (const f of fixtures) {
    if (sideMatch(cc, f.home)) cands.push({ f, side: "home" });
    if (sideMatch(cc, f.away)) cands.push({ f, side: "away" });
  }
  return cands;
};

const titleCase = (s) => s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const rzm = (s) => s.replace(/_/g, " ").replace(/\s+enilive\s*$/i, "").trim();

const parseSimDescription = (desc) => {
  const pcts = [...desc.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
  if (pcts.length < 3) return null;
  return { pHome: pcts[0], pDraw: pcts[1], pAway: pcts[2] };
};

const extractSimData = (html) => {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  });
  const sim = ld.find((x) => x && x["@type"] === "SportsEvent");
  if (!sim) return null;
  const home = sim.homeTeam?.name;
  const away = sim.awayTeam?.name;
  const probs = parseSimDescription(sim.description || "");
  if (probs.pHome == null || probs.pAway == null || probs.pDraw == null) return null;
  return {
    home,
    away,
    pHome: probs.pHome / 100,
    pDraw: probs.pDraw / 100,
    pAway: probs.pAway / 100,
    date: sim.startDate,
    url: sim.url,
    leagueName: sim.location?.name || "",
  };
};

const extractSimLinks = (html) => {
  const set = new Set();
  const out = [];
  for (const m of html.matchAll(/href="\/simulations\/([a-z0-9-]+)-vs-([a-z0-9-]+)-prediction\/(\d+)"/g)) {
    const slug = `${m[1]}-vs-${m[2]}-prediction/${m[3]}`;
    if (!set.has(slug)) {
      set.add(slug);
      out.push(`/simulations/${slug}`);
    }
  }
  return out;
};

const parseSimLink = (url) => {
  const m = url.match(/^\/simulations\/(.+?)-vs-(.+?)-prediction\/(\d+)$/);
  if (!m) return null;
  return { homeSlug: m[1].replace(/-/g, " "), awaySlug: m[2].replace(/-/g, " "), id: m[3], url };
};

let cache = null;
let cachedAt = 0;

const fetchPlayers = async () => {
  const j = await (await fetch(FCF_API, { headers: { "User-Agent": UA } })).json();
  const rows = Array.isArray(j) ? j : j.players || [];
  const newest = [...rows]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 4);
  return newest.map((p) => ({
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
  }));
};

export async function getData() {
  if (cache && Date.now() - cachedAt < TTL) return cache;

  const players = await fetchPlayers().catch(() => []);

  const leagues = await Promise.all(
    LEAGUES.map(async (slug) => {
      try {
        const res = await fetch(`${BASE}/simulations/${slug}`, { headers: { "User-Agent": UA } });
        const html = await res.text();
        return { slug, links: extractSimLinks(html) };
      } catch {
        return { slug, links: [] };
      }
    })
  );

  const seen = new Set();
  const candidateLinks = [];
  for (const { slug, links } of leagues) {
    for (const url of links) {
      if (seen.has(url)) continue;
      seen.add(url);
      const parsed = parseSimLink(url);
      if (!parsed) continue;
      candidateLinks.push({ ...parsed, league: titleCase(slug) });
    }
  }

  const wanted = [];
  const wantedSeen = new Set();
  for (const link of candidateLinks) {
    for (const p of players) {
      if (!p.club) continue;
      if (sideMatch(p.club, link.homeSlug) || sideMatch(p.club, link.awaySlug)) {
        if (!wantedSeen.has(link.url)) {
          wantedSeen.add(link.url);
          wanted.push(link);
        }
        break;
      }
    }
  }

  const fixtures = (
    await Promise.all(
      wanted.map(async (link) => {
        try {
          const res = await fetch(`${BASE}${link.url}`, { headers: { "User-Agent": UA } });
          const html = await res.text();
          const data = extractSimData(html);
          if (!data) return null;
          return { ...data, league: link.league, round: "" };
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);

  const sides = players.map((p) => (p.club ? pickSide(p.club, fixtures) : []));

  const matches = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const A = players[i];
      const B = players[j];
      if (!A.club || !B.club || norm(A.club) === norm(B.club)) continue;
      const start = Math.max(utcDay(A.added), utcDay(B.added));
      const end = Math.min(utcDay(A.added), utcDay(B.added)) + MAX_DAY_DIFF * 86400000;
      const f = sides[i].find((ca) => {
        const cb = sides[j].find((x) => x.f === ca.f && x.side !== ca.side);
        if (!cb) return false;
        const kick = utcDay(ca.f.date);
        return kick >= start && kick <= end;
      });
      if (!f) continue;
      const fixture = f.f;
      const homeP = f.side === "home" ? A : B;
      const awayP = f.side === "home" ? B : A;
      matches.push({
        home: { player: homeP, p: fixture.pHome },
        away: { player: awayP, p: fixture.pAway },
        draw: fixture.pDraw,
        league: fixture.league,
        round: fixture.round,
        date: fixture.date,
        url: fixture.url,
      });
    }
  }

  const data = {
    players,
    matches,
    fixturesCount: fixtures.length,
    build: "oddalerts",
  };
  cache = data;
  cachedAt = Date.now();
  return data;
}
