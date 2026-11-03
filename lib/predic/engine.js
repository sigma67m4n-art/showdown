import { WEIGHTS } from "./config.js";
import { aggregateFactors, buildFactors } from "./factors.js";
import { rateTeam } from "./ratings.js";
import { clamp, entropy, normalizeDistribution, poissonPmf, round, sum } from "./util.js";

function blend(a, b, weightB) {
  if (b === null || b === undefined) return a;
  return a * (1 - weightB) + b * weightB;
}

function dcTau(x, y, lambda, mu, rho) {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function scoreMatrix(lambda, mu, rho = WEIGHTS.rho, maxGoals = WEIGHTS.maxGoals) {
  const matrix = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    const row = [];
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(lambda, h) * poissonPmf(mu, a) * dcTau(h, a, lambda, mu, rho);
      row.push(Math.max(0, p));
      total += Math.max(0, p);
    }
    matrix.push(row);
  }
  for (const row of matrix) for (let i = 0; i < row.length; i++) row[i] /= total;
  return matrix;
}

export function outcomeFromMatrix(matrix) {
  let homeWin = 0, draw = 0, awayWin = 0, btts = 0, over25 = 0, over15 = 0, over35 = 0;
  let homeCS = 0, awayCS = 0, totalGoals = 0;
  const scores = [];
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const p = matrix[h][a];
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h > 0 && a > 0) btts += p;
      if (h + a > 1.5) over15 += p;
      if (h + a > 2.5) over25 += p;
      if (h + a > 3.5) over35 += p;
      if (a === 0) homeCS += p;
      if (h === 0) awayCS += p;
      totalGoals += (h + a) * p;
      if (p > 0.0005) scores.push({ score: `${h}-${a}`, home: h, away: a, probability: p });
    }
  }
  scores.sort((x, y) => y.probability - x.probability);
  const top = scores.slice(0, 8).map((s) => ({ ...s, probability: round(s.probability), percent: +(s.probability * 100).toFixed(1) }));
  const total = homeWin + draw + awayWin;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
    btts: btts / total,
    over15: over15 / total,
    over25: over25 / total,
    over35: over35 / total,
    homeCleanSheet: homeCS / total,
    awayCleanSheet: awayCS / total,
    expectedTotalGoals: totalGoals / total,
    topScorelines: top,
  };
}

export function expectedGoals(input, homeR, awayR, adj) {
  const { league, match } = input;
  const neutral = match.neutral;
  const baseHome = neutral ? league.avgGoalsPerTeam : league.avgHomeGoals * (match.homeAdvantage || 1);
  const baseAway = neutral ? league.avgGoalsPerTeam : league.avgAwayGoals;

  const attH = blend(homeR.strengths.attack, homeR.strengths.splitAttack, 0.22);
  const defH = blend(homeR.strengths.defense, homeR.strengths.splitDefense, 0.22);
  const attA = blend(awayR.strengths.attack, awayR.strengths.splitAttack, 0.22);
  const defA = blend(awayR.strengths.defense, awayR.strengths.splitDefense, 0.22);

  let lambda = baseHome * attH * defA;
  let mu = baseAway * attA * defH;

  const multHome = Math.exp(adj.totals.home.attack - adj.totals.away.defense);
  const multAway = Math.exp(adj.totals.away.attack - adj.totals.home.defense);
  lambda *= multHome;
  mu *= multAway;

  return {
    home: clamp(lambda, 0.12, 5.5),
    away: clamp(mu, 0.12, 5.5),
    raw: { home: lambda, away: mu },
    multipliers: { home: multHome, away: multAway },
    strengths: { attH, defH, attA, defA },
  };
}

function priorFromLeague(league, match) {
  const neutral = match.neutral;
  const lh = neutral ? league.avgGoalsPerTeam : league.avgHomeGoals;
  const la = neutral ? league.avgGoalsPerTeam : league.avgAwayGoals;
  const m = scoreMatrix(lh, la, WEIGHTS.rho);
  const o = outcomeFromMatrix(m);
  return { home: o.homeWin, draw: o.draw, away: o.awayWin };
}

function parseProbabilities(market) {
  if (!market || typeof market !== "object") return null;
  const directHome = market.homeWin ?? market.home ?? market["1"];
  const directDraw = market.draw ?? market["X"] ?? market["x"];
  const directAway = market.awayWin ?? market.away ?? market["2"];
  if (directHome === undefined || directDraw === undefined || directAway === undefined) return null;
  let h = Number(directHome), d = Number(directDraw), a = Number(directAway);
  if (![h, d, a].every(Number.isFinite)) return null;
  if (h <= 1 && d <= 1 && a <= 1) {
    const t = h + d + a;
    if (t <= 0) return null;
    return { home: h / t, draw: d / t, away: a / t, source: "probability" };
  }
  
  if (h <= 1 || d <= 1 || a <= 1) return null;
  const ih = 1 / h, id = 1 / d, ia = 1 / a;
  const t = ih + id + ia;
  return { home: ih / t, draw: id / t, away: ia / t, source: "odds", overround: t - 1 };
}

function blendMarket(model, market, quality) {
  if (!market) return { probabilities: model, market: null };
  const w = clamp(WEIGHTS.marketWeight * (0.9 + 0.2 * (1 - quality)), 0.2, 0.6);
  const probabilities = {
    home: model.home * (1 - w) + market.home * w,
    draw: model.draw * (1 - w) + market.draw * w,
    away: model.away * (1 - w) + market.away * w,
  };
  const t = probabilities.home + probabilities.draw + probabilities.away;
  probabilities.home /= t;
  probabilities.draw /= t;
  probabilities.away /= t;
  return { probabilities, market: { ...market, blendedWeight: round(w) } };
}

function sensitivity(lambda, mu, quality) {
  const spread = 0.10 + (1 - quality) * 0.12;
  const points = [];
  for (const dh of [-1, 0, 1]) {
    for (const da of [-1, 0, 1]) {
      const m = scoreMatrix(lambda * (1 + dh * spread), mu * (1 + da * spread), WEIGHTS.rho);
      points.push(outcomeFromMatrix(m));
    }
  }
  const range = (key) => {
    const vals = points.map((p) => p[key]);
    return { low: round(Math.min(...vals)), high: round(Math.max(...vals)) };
  };
  return {
    homeWin: range("homeWin"),
    draw: range("draw"),
    awayWin: range("awayWin"),
    note: "xG sensitivity range (not a statistical guarantee)",
  };
}

function confidenceOf(quality, probs) {
  const ent = entropy([probs.home, probs.draw, probs.away]);
  const maxEnt = Math.log(3);
  const decisiveness = 1 - ent / maxEnt;
  const score = clamp(0.65 * quality + 0.35 * decisiveness, 0, 1);
  const label = score >= WEIGHTS.minQualityForHighConfidence ? "high"
    : score >= WEIGHTS.minQualityForMediumConfidence ? "medium" : "low";
  return { score: round(score), label, entropy: round(ent), decisiveness: round(decisiveness) };
}

export function predict(input) {
  const homeR = rateTeam(input.home, input.league, input.match, "home");
  const awayR = rateTeam(input.away, input.league, input.match, "away");
  const factors = buildFactors(input, homeR, awayR);
  const adj = aggregateFactors(factors, WEIGHTS.factorScale);
  const xg = expectedGoals(input, homeR, awayR, adj);
  const rawMatrix = scoreMatrix(xg.home, xg.away, WEIGHTS.rho);
  const rawOutcome = outcomeFromMatrix(rawMatrix);

  const modelProbs = { home: rawOutcome.homeWin, draw: rawOutcome.draw, away: rawOutcome.awayWin };
  const prior = priorFromLeague(input.league, input.match);
  const quality = clamp((homeR.dataQuality * 0.5 + awayR.dataQuality * 0.5) * 0.9 + 0.1, 0, 1);
  const shrinkW = clamp(WEIGHTS.priorWeight * (1 - quality), 0, 0.35);
  const calibrated = {
    home: modelProbs.home * (1 - shrinkW) + prior.home * shrinkW,
    draw: modelProbs.draw * (1 - shrinkW) + prior.draw * shrinkW,
    away: modelProbs.away * (1 - shrinkW) + prior.away * shrinkW,
  };
  const totalP = calibrated.home + calibrated.draw + calibrated.away;
  calibrated.home /= totalP; calibrated.draw /= totalP; calibrated.away /= totalP;

  const market = parseProbabilities(input.market);
  const marketBlend = blendMarket(calibrated, market, quality);

  const finalMatrix = scoreMatrix(xg.home, xg.away, WEIGHTS.rho);
  const outcome = outcomeFromMatrix(finalMatrix);

  
  
  const scaleHome = marketBlend.probabilities.home / outcome.homeWin;
  const scaleDraw = marketBlend.probabilities.draw / outcome.draw;
  const scaleAway = marketBlend.probabilities.away / outcome.awayWin;
  let homeWin = outcome.homeWin * scaleHome;
  let draw = outcome.draw * scaleDraw;
  let awayWin = outcome.awayWin * scaleAway;
  const t2 = homeWin + draw + awayWin;
  homeWin /= t2; draw /= t2; awayWin /= t2;

  const probs = { home: homeWin, draw, away: awayWin };
  const confidence = confidenceOf(quality, probs);
  const sensitive = sensitivity(xg.home, xg.away, quality);

  return {
    probabilities: probs,
    outcome,
    xg,
    matrix: finalMatrix,
    homeRating: homeR,
    awayRating: awayR,
    factors,
    adjustments: adj,
    quality,
    shrinkWeight: shrinkW,
    market: marketBlend.market,
    confidence,
    sensitivity: sensitive,
    modelProbs,
    prior,
  };
}

export function toPercentages(probs) {
  return {
    homeWin: round(probs.home),
    draw: round(probs.draw),
    awayWin: round(probs.away),
    homeWinPct: +(probs.home * 100).toFixed(2),
    drawPct: +(probs.draw * 100).toFixed(2),
    awayWinPct: +(probs.away * 100).toFixed(2),
  };
}

export function fairOdds(p) {
  return p > 0 ? round(1 / p, 2) : null;
}

export function pickFavorite(probs) {
  const entries = [["home", probs.home], ["draw", probs.draw], ["away", probs.away]];
  entries.sort((a, b) => b[1] - a[1]);
  return { pick: entries[0][0], probability: entries[0][1], margin: round(entries[0][1] - entries[1][1]) };
}