import { MODEL_VERSION, WEIGHTS } from "./config.js";
import { fairOdds, pickFavorite, toPercentages } from "./engine.js";
import { round } from "./util.js";

function pct(v) {
  return +(v * 100).toFixed(2);
}

function teamBlock(name, rating, xg, probs, kind) {
  const win = kind === "home" ? probs.home : probs.away;
  const lose = kind === "home" ? probs.away : probs.home;
  return {
    team: name,
    side: kind,
    win: { probability: round(win), percent: pct(win), fairOdds: fairOdds(win) },
    draw: { probability: round(probs.draw), percent: pct(probs.draw), fairOdds: fairOdds(probs.draw) },
    lose: { probability: round(lose), percent: pct(lose), fairOdds: fairOdds(lose) },
    expectedGoals: round(xg, 2),
    expectedGoalsFor: round(xg, 2),
  };
}

function compactRating(r) {
  return {
    team: r.name,
    sample: r.sample,
    strengths: {
      attack: round(r.strengths.attack, 3),
      defense: round(r.strengths.defense, 3),
      note: "1.00 = league average",
    },
    form: {
      ppg: round(r.form.ppg, 2),
      ppgSeason: r.form.ppgSeason === null ? null : round(r.form.ppgSeason, 2),
      trend: round(r.form.trend, 3),
      last5: r.form.last5,
      wins: r.form.wins,
      draws: r.form.draws,
      losses: r.form.losses,
    },
    availability: {
      attackDelta: round(r.availability.attack, 3),
      defenseDelta: round(r.availability.defense, 3),
      missing: r.availability.missing,
      doubtful: r.availability.doubtful,
    },
    condition: r.condition,
    schedule: r.schedule,
    dataQuality: round(r.dataQuality, 3),
    venueSplit: {
      attack: r.strengths.splitAttack === null ? null : round(r.strengths.splitAttack, 3),
      defense: r.strengths.splitDefense === null ? null : round(r.strengths.splitDefense, 3),
    },
  };
}

function factorReport(f, fx) {
  const c = fx.contribution;
  const homeImpact = (Math.exp(c.home.attack - c.away.defense) - 1) * 100;
  const awayImpact = (Math.exp(c.away.attack - c.home.defense) - 1) * 100;
  return {
    id: f.id,
    label: f.label,
    weight: f.weight,
    homeImpactPct: round(homeImpact, 2),
    awayImpactPct: round(awayImpact, 2),
    homeSignals: { attack: round(f.home.attack, 3), defense: round(f.home.defense, 3) },
    awaySignals: { attack: round(f.away.attack, 3), defense: round(f.away.defense, 3) },
    note: f.note,
  };
}

function topFactors(factors, adj, limit = 6) {
  const list = factors.map((f) => {
    const c = adj.detail.find((d) => d.id === f.id)?.contribution || { home: { attack: 0, defense: 0 }, away: { attack: 0, defense: 0 } };
    const homeImpact = Math.abs(Math.exp(c.home.attack - c.away.defense) - 1);
    const awayImpact = Math.abs(Math.exp(c.away.attack - c.home.defense) - 1);
    return { ...factorReport(f, { contribution: c }), magnitude: homeImpact + awayImpact };
  });
  return list.sort((a, b) => b.magnitude - a.magnitude).slice(0, limit).map(({ magnitude, ...rest }) => rest);
}

function explanation(ctx) {
  const { probs, home, away, outcome, xg, confidence } = ctx;
  const fav = probs.home >= probs.away ? home : away;
  const favP = Math.max(probs.home, probs.away);
  const lines = [];
  lines.push(
    `${fav} is favored with a ${pct(favP).toFixed(1)}% win probability ` +
    `(home ${pct(probs.home).toFixed(1)}% | draw ${pct(probs.draw).toFixed(1)}% | away ${pct(probs.away).toFixed(1)}%).`
  );
  lines.push(
    `Projected score: ${home} ${round(xg.home, 2)} - ${round(xg.away, 2)} ${away} ` +
    `(total ${round(outcome.expectedTotalGoals, 2)} goals). Most likely scoreline ${outcome.topScorelines[0]?.score ?? "-"}.`
  );
  lines.push(
    `Model confidence: ${confidence.label} (${(confidence.score * 100).toFixed(0)}%). ` +
    (confidence.label === "high"
      ? "Data is fairly complete and the outcome is relatively decisive."
      : "Treat this as an estimate, not a certainty; add data for better accuracy.")
  );
  const tops = ctx.topFactors || [];
  if (tops.length) {
    lines.push(`Most influential factors: ${tops.slice(0, 4).map((f) => `${f.label} (${f.homeImpactPct >= 0 ? "+" : ""}${f.homeImpactPct}% home / ${f.awayImpactPct >= 0 ? "+" : ""}${f.awayImpactPct}% away)`).join("; ")}.`);
  }
  return lines;
}

export function buildSimpleReport(input, pred) {
  const p = toPercentages(pred.probabilities);
  return {
    home: input.home.name,
    away: input.away.name,
    homeWin: p.homeWinPct,
    draw: p.drawPct,
    awayWin: p.awayWinPct,
  };
}

export function buildReport(input, pred) {
  const { home, away, league, match, context } = input;
  const probs = pred.probabilities;
  const outcome = pred.outcome;
  const p = toPercentages(probs);
  const favorite = pickFavorite(probs);
  const homeBlock = teamBlock(home.name, pred.homeRating, pred.xg.home, probs, "home");
  const awayBlock = teamBlock(away.name, pred.awayRating, pred.xg.away, probs, "away");

  const factors = pred.factors.map((f) => {
    const fx = pred.adjustments.detail.find((d) => d.id === f.id);
    return factorReport(f, fx);
  });
  const tops = topFactors(pred.factors, pred.adjustments);

  const doubleChance = {
    homeOrDraw: { label: "1X", probability: round(probs.home + probs.draw), percent: pct(probs.home + probs.draw) },
    homeOrAway: { label: "12", probability: round(probs.home + probs.away), percent: pct(probs.home + probs.away) },
    drawOrAway: { label: "X2", probability: round(probs.draw + probs.away), percent: pct(probs.draw + probs.away) },
  };

  const generatedAt = new Date().toISOString();
  const kickoff = match.kickoff || null;
  const kickoffMs = kickoff ? new Date(kickoff).getTime() : NaN;
  const kickoffTime = kickoff ? String(kickoff).slice(11, 16) : (match.time ?? null);
  const hoursUntilMatch = Number.isFinite(kickoffMs) ? round((kickoffMs - Date.now()) / 3600000, 2) : null;

  const report = {
    ok: true,
    meta: {
      tool: "predic",
      modelVersion: MODEL_VERSION,
      generatedAt,
      algorithm: "Dixon-Coles bivariate Poisson + form/availability/schedule/context factors + calibration",
      language: "en",
    },
    match: {
      league: league.name,
      competition: match.competition,
      date: match.date,
      kickoff,
      kickoffTime,
      hoursUntilMatch,
      venue: match.venue,
      neutral: Boolean(match.neutral),
      importance: match.importance,
      home: home.name,
      away: away.name,
    },
    prediction: {
      percentages: {
        homeWin: p.homeWinPct,
        draw: p.drawPct,
        awayWin: p.awayWinPct,
      },
      probabilities: {
        homeWin: { probability: round(probs.home), percent: p.homeWinPct, fairOdds: fairOdds(probs.home) },
        draw: { probability: round(probs.draw), percent: p.drawPct, fairOdds: fairOdds(probs.draw) },
        awayWin: { probability: round(probs.away), percent: p.awayWinPct, fairOdds: fairOdds(probs.away) },
      },
      byTeam: {
        home: homeBlock,
        away: awayBlock,
      },
      favorite: {
        pick: favorite.pick,
        team: favorite.pick === "home" ? home.name : favorite.pick === "away" ? away.name : "Draw",
        probability: round(favorite.probability),
        percent: pct(favorite.probability),
        marginOverSecond: round(favorite.margin),
      },
      expectedGoals: {
        home: round(pred.xg.home, 2),
        away: round(pred.xg.away, 2),
        total: round(pred.xg.home + pred.xg.away, 2),
      },
      scoreline: {
        mostLikely: outcome.topScorelines[0]?.score ?? null,
        top: outcome.topScorelines.slice(0, 5),
      },
      goals: {
        over15: { probability: round(outcome.over15), percent: pct(outcome.over15) },
        over25: { probability: round(outcome.over25), percent: pct(outcome.over25) },
        over35: { probability: round(outcome.over35), percent: pct(outcome.over35) },
        under25: { probability: round(1 - outcome.over25), percent: pct(1 - outcome.over25) },
        btts: { probability: round(outcome.btts), percent: pct(outcome.btts) },
        homeCleanSheet: { probability: round(outcome.homeCleanSheet), percent: pct(outcome.homeCleanSheet) },
        awayCleanSheet: { probability: round(outcome.awayCleanSheet), percent: pct(outcome.awayCleanSheet) },
      },
      doubleChance,
      confidence: {
        ...pred.confidence,
        scorePercent: +(pred.confidence.score * 100).toFixed(0),
      },
      sensitivityRange: pred.sensitivity,
      market: pred.market ? {
        available: true,
        source: pred.market.source,
        blendedWeight: pred.market.blendedWeight,
        overround: pred.market.overround ?? null,
        impliedPercent: {
          homeWin: pct(pred.market.home),
          draw: pct(pred.market.draw),
          awayWin: pct(pred.market.away),
        },
      } : { available: false },
    },
    factors: {
      total: factors.length,
      top: tops,
      all: factors,
    },
    ratings: {
      home: compactRating(pred.homeRating),
      away: compactRating(pred.awayRating),
    },
    diagnostics: {
      dataQuality: round(pred.quality, 3),
      dataQualityPercent: +(pred.quality * 100).toFixed(0),
      calibration: {
        prior: {
          homeWin: round(pred.prior.home),
          draw: round(pred.prior.draw),
          awayWin: round(pred.prior.away),
        },
        priorWeight: round(pred.shrinkWeight, 3),
        uncalibrated: {
          homeWin: round(pred.modelProbs.home),
          draw: round(pred.modelProbs.draw),
          awayWin: round(pred.modelProbs.away),
        },
      },
      xgMultipliers: {
        home: round(pred.xg.multipliers.home, 4),
        away: round(pred.xg.multipliers.away, 4),
        note: "xG multiplier from aggregated factors (exp log-adjustment)",
      },
      adjustments: {
        home: pred.adjustments.totals.home,
        away: pred.adjustments.totals.away,
      },
      rho: WEIGHTS.rho,
      warnings: input.warnings,
    },
    explanation: explanation({
      probs,
      home: home.name,
      away: away.name,
      outcome,
      xg: pred.xg,
      confidence: pred.confidence,
      topFactors: tops,
    }),
    disclaimer: "Probabilistic prediction, not a guaranteed result. Use it responsibly.",
  };

  return report;
}
