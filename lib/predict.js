if (!process.env.PREDIC_CACHE_DIR && process.env.VERCEL) {
  process.env.PREDIC_CACHE_DIR = "/tmp/predic-cache";
}

const CLUB_PREFIX = /^(ssc|ss|sc|ac|acf|cf|as|sv|rc|ogc|osc|ud|cd|sd|us|cp|cs|rcd|ca|fk|bk|if|ff|vfb|vfl|bsc|tsv|tsg|fc|afc|aj|estac|olympique|ol)\s+/i;
const CLUB_SUFFIX = /\s+(fc|cf|sc|ac|calcio|club|ssc|ss)$/i;

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
      buildMatchInput: normalize.buildMatchInput,
      predict: engine.predict,
      toPercentages: engine.toPercentages,
    }));
  }
  return modsPromise;
};

export async function predictMatch({ home, away, date, time }) {
  const { buildRemoteInput, buildMatchInput, predict, toPercentages } = await load();
  const opts = { date: date || null, time: time || null, fast: true };
  const remote = await buildRemoteInput({ homeName: searchName(home), awayName: searchName(away), opts });
  if (!remote?.meta?.fixtureId) throw new Error("no scheduled fixture");
  const input = buildMatchInput(remote);
  const pred = predict(input);
  const p = toPercentages(pred.probabilities);
  return { homeWin: p.homeWinPct / 100, draw: p.drawPct / 100, awayWin: p.awayWinPct / 100 };
}