if (!process.env.PREDIC_CACHE_DIR && process.env.VERCEL) {
  process.env.PREDIC_CACHE_DIR = "/tmp/predic-cache";
}

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
  const remote = await buildRemoteInput({ homeName: home, awayName: away, opts });
  const input = buildMatchInput(remote);
  const pred = predict(input);
  const p = toPercentages(pred.probabilities);
  return { homeWin: p.homeWinPct / 100, draw: p.drawPct / 100, awayWin: p.awayWinPct / 100 };
}