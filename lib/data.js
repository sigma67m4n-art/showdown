const SEARCH_URL =
  "https://renderz.app/api/search/23?v=1&q=bc6xCsJAEATQf5n6EAnaXCcIaqGRWKQIR9DcimLi4m6CxOP-Xc60Vgszw2MDXgPJCBtwYW7T7QbtYauAnqTTlCgP0tDsQeObxcNWOBb5pljt69M2L9d5eciWcDE6A73x0KaJMz-ofnLCXIwGyjLBZ-_JJ5jFk8DCkzaI0QScVanf_SudQT09MulX4Q52bqD3D8Fmi_gF";
const FCF_API = "https://fcmobileforum.com/api/v1/players";
const FIXTURES_URL = "https://theopenmodel.com/data/fixtures-2026-27.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_DAY_DIFF = 11;
const TTL = 5 * 60 * 1000;

const ALIASES = {
  "man united": "manchester united",
  "man city": "manchester city",
  "paris sg": "paris saint germain",
  "koeln": "koln",
  "losc": "lille",
};

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

const canon = (s) => {
  let t = norm(s);
  if (ALIASES[t]) t = norm(ALIASES[t]);
  return t;
};

const tokMatch = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

const sideMatch = (club, side) => {
  const c = club.split(" ");
  const s = side.split(" ");
  return c.every((ct) => s.some((st) => tokMatch(ct, st))) || s.every((st) => c.some((ct) => tokMatch(st, ct)));
};

const utcDay = (iso) => {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const titleCase = (s) => s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const pickSide = (club, fixtures) => {
  const cc = canon(club);
  if (!cc) return [];
  const cands = [];
  for (const f of fixtures) {
    if (sideMatch(cc, canon(f.home))) cands.push({ f, side: "home", name: f.home });
    if (sideMatch(cc, canon(f.away))) cands.push({ f, side: "away", name: f.away });
  }
  if (!cands.length) return [];
  const exact = cands.filter((c) => canon(c.name) === cc);
  const pool = exact.length ? exact : cands;
  if (new Set(pool.map((c) => c.name)).size > 1) return [];
  return pool;
};

let cache = null;
let cachedAt = 0;

export async function getData() {
  if (cache && Date.now() - cachedAt < TTL) return cache;

  const top4 = await (await fetch(SEARCH_URL, { headers: { "Content-Type": "application/json", "User-Agent": UA } })).json();

  const players = await Promise.all(
    top4.players.slice(0, 4).map(async (p) => {
      const name = `${p.firstName} ${p.lastName}`;
      const lastName = p.lastName;
      let card = null;
      try {
        let cardRes = null;
        try {
          const single = await (
            await fetch(`${FCF_API}/${p.assetId}`, { headers: { "User-Agent": UA } })
          ).json();
          cardRes = single?.player || null;
        } catch {
          cardRes = null;
        }
        if (!cardRes || cardRes.program !== "programname_showdown25") {
          const list = await (
            await fetch(`${FCF_API}?q=${encodeURIComponent(lastName)}&limit=50`, { headers: { "User-Agent": UA } })
          ).json();
          const rows = Array.isArray(list) ? list : list?.data || [];
          const byName = rows.find((c) => c.fullName?.toLowerCase() === name.toLowerCase() && c.program === "programname_showdown25");
          cardRes = byName || rows.find((c) => c.cardType === 5 && c.program === "programname_showdown25") || null;
        }
        card = cardRes;
      } catch {
        card = null;
      }
      const rzm = (s) => s.replace(/_/g, " ").replace(/\s+enilive\s*$/i, "").trim();
      const src = card || p;
      return {
        name,
        cardName: p.cardName,
        position: p.position,
        rating: p.rating,
        height: p.height,
        weight: p.weight,
        weakFoot: p.weakFoot,
        strongFoot: p.foot === 1 ? "Right" : "Left",
        added: p.added,
        created: card?.createdAt || p.added,
        club: card?.club ? rzm(card.club) : p.club,
        league: card?.league ? rzm(card.league) : p.league,
        nation: card?.nation || p.nation,
        cardImg: card?.playerImage || p.images.playerCardImage,
        cardBg: card?.cardArtBackgroundUrl || p.images.playerCardBackground,
        cardSprite: card?.cardArtSpriteUrl || p.animation.animations[0]?.animations?.[0]?.image,
        clubLogo: card?.clubLogoUrl || p.images.clubImage,
        leagueLogo: card?.leagueLogoUrl || p.images.leagueImage,
        flag: card?.nationFlagUrl || p.images.flagImage,
        clubId: card?.clubId ?? null,
        leagueId: card?.leagueId ?? null,
        countryId: card?.countryId ?? null,
      };
    })
  );

  let tom;
  try {
    tom = await (await fetch(FIXTURES_URL, { headers: { "User-Agent": UA } })).json();
  } catch {
    throw new Error(`failed to load The Open Model data (${FIXTURES_URL})`);
  }
  const fixtures = tom.rows;

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
        league: titleCase(fixture.league),
        round: fixture.round.replace("Regular Season - ", "MD"),
        date: fixture.date,
        url: fixture.url,
      });
    }
  }

  const data = { players, matches, fixturesCount: fixtures.length, build: tom.updated };
  cache = data;
  cachedAt = Date.now();
  return data;
}
