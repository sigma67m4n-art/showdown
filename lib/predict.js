if (!process.env.PREDIC_CACHE_DIR && process.env.VERCEL) {
  process.env.PREDIC_CACHE_DIR = "/tmp/predic-cache";
}

const CLUB_PREFIX = /^(ssc|ss|sc|ac|acf|cf|as|sv|rc|ogc|osc|ud|cd|sd|us|cp|cs|rcd|ca|fk|bk|if|ff|vfb|vfl|bsc|tsv|tsg|fc|afc|aj|estac|olympique|ol)\s+/i;
const CLUB_SUFFIX = /\s+(fc|cf|sc|ac|calcio|club|ssc|ss)$/i;

const NAME_FIXES = [
  [/\bmünchen\b/gi, "Munich"],
  [/\bköln\b/gi, "Cologne"],
  [/\bgladbach\b/gi, "Mönchengladbach"],
];

const searchName = (club) => {
  let s = String(club || "").trim();
  let prev;
  do {
    prev = s;
    s = s.replace(CLUB_PREFIX, "").trim();
  } while (s && s !== prev);
  do {
    prev = s;
    s = s.replace(CLUB_SUFFIX, "").trim();
  } while (s && s !== prev);
  for (const [re, to] of NAME_FIXES) s = s.replace(re, to);
  return s || String(club || "").trim();
};

let modsPromise;

const load = () => {
  if (!modsPromise) {
    modsPromise = Promise.all([
      import("./predic/remote.js"),
      import("./predic/normalize.js"),
      import("./predic/engine.js"),
    ]).then(([remote, normalize, engine]) => ({
      buildRemoteInput: remote.buildRemoteInput,
      findFinishedFixture: remote.findFinishedFixture,
      buildMatchInput: normalize.buildMatchInput,
      predict: engine.predict,
      toPercentages: engine.toPercentages,
    }));
  }
  return modsPromise;
};

const run = async (home, away, date, time) => {
  const { buildRemoteInput, buildMatchInput, predict, toPercentages } = await load();
  const opts = { date: date || null, time: time || null, fast: true };
  const remote = await buildRemoteInput({ homeName: searchName(home), awayName: searchName(away), opts });
  const input = buildMatchInput(remote);
  const pred = predict(input);
  const p = toPercentages(pred.probabilities);
  return {
    hasFixture: Boolean(remote?.meta?.fixtureId),
    date: remote?.meta?.date ? String(remote.meta.date).slice(0, 10) : null,
    kickoff: remote?.meta?.kickoff || null,
    league: remote?.meta?.league || "",
    homeWin: p.homeWinPct / 100,
    draw: p.drawPct / 100,
    awayWin: p.awayWinPct / 100,
  };
};

export async function predictMatch({ home, away, date, time }) {
  const r = await run(home, away, date, time);
  if (!r.hasFixture) throw new Error("no scheduled fixture");
  return { homeWin: r.homeWin, draw: r.draw, awayWin: r.awayWin };
}

export async function discoverNationalMatch(a, b) {
  for (const [home, away] of [[a, b], [b, a]]) {
    try {
      const r = await run(home, away, null, null);
      if (r.hasFixture && r.date) {
        return { homeName: home, awayName: away, date: r.kickoff || r.date, matchDate: r.date, league: r.league, homeWin: r.homeWin, draw: r.draw, awayWin: r.awayWin };
      }
    } catch {}
  }
  return null;
}

export const pickOutcome = (r) => {
  const best = Math.max(r.homeWin, r.draw, r.awayWin);
  if (r.homeWin === best && r.homeWin > r.awayWin) return "home";
  if (r.awayWin === best && r.awayWin > r.homeWin) return "away";
  if (r.draw === best) return "draw";
  return r.homeWin >= r.awayWin ? "home" : "away";
};

export async function settleMatch(a, b) {
  const { findFinishedFixture } = await load();
  let fin;
  try {
    fin = await findFinishedFixture({ homeName: searchName(a), awayName: searchName(b) });
  } catch {
    return null;
  }
  if (!fin) return null;
  const home = fin.aIsHome ? a : b;
  const away = fin.aIsHome ? b : a;
  const date = String(fin.date).slice(0, 10);
  const time = String(fin.date).length >= 16 ? String(fin.date).slice(11, 16) : null;
  let r;
  try {
    r = await run(home, away, date, time);
  } catch {
    return null;
  }
  const pick = pickOutcome(r);
  const actual = fin.homeScore > fin.awayScore ? "home" : fin.homeScore < fin.awayScore ? "away" : "draw";
  return {
    home,
    away,
    date: fin.date,
    homeScore: fin.homeScore,
    awayScore: fin.awayScore,
    pick,
    actual,
    correct: pick === actual,
    homeWin: r.homeWin,
    draw: r.draw,
    awayWin: r.awayWin,
    league: fin.league || "",
  };
}
