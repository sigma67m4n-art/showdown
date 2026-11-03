import { WEIGHTS } from "./config.js";
import { clamp, expDecay, num, safeDiv, weightedMean } from "./util.js";

function blendedRate(goals, xg, played, xgWeight) {
  if (!played) return null;
  const goalsRate = goals / played;
  if (xg === null || xg === undefined) return goalsRate;
  return xgWeight * (xg / played) + (1 - xgWeight) * goalsRate;
}

function shrink(rate, sample, prior, k = WEIGHTS.shrinkMatches) {
  if (rate === null) return prior;
  return (rate * sample + prior * k) / (sample + k);
}

function recentRates(matches, league, xgWeight, halfLife) {
  if (!matches.length) return { attack: null, defense: null, ppg: null, n: 0, goalDiff: 0 };
  const sorted = [...matches].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const recent = sorted.slice(0, 10);
  const weight = (m) => expDecay(recent.indexOf(m), halfLife) * (m.venue === "neutral" ? 0.85 : 1);
  const oppFactor = (m) => clamp((m.opponentStrength ?? 1.35) / 1.35, 0.7, 1.4);
  const attack = weightedMean(recent, weight, (m) => {
    const base = m.xgFor !== null && m.xgFor !== undefined
      ? xgWeight * m.xgFor + (1 - xgWeight) * m.goalsFor
      : m.goalsFor;
    return base * oppFactor(m);
  });
  const defense = weightedMean(recent, weight, (m) => {
    const base = m.xgAgainst !== null && m.xgAgainst !== undefined
      ? xgWeight * m.xgAgainst + (1 - xgWeight) * m.goalsAgainst
      : m.goalsAgainst;
    return base / oppFactor(m);
  });
  const points = recent.map((m) => (m.result === "W" ? 3 : m.result === "D" ? 1 : 0));
  const ppg = weightedMean(recent, weight, (m) => (m.result === "W" ? 3 : m.result === "D" ? 1 : 0));
  const goalsFor = weightedMean(recent, weight, (m) => m.goalsFor) || 0;
  const goalsAgainst = weightedMean(recent, weight, (m) => m.goalsAgainst) || 0;
  return {
    attack,
    defense,
    ppg,
    n: recent.length,
    goalDiff: goalsFor - goalsAgainst,
    points,
    goalsFor,
    goalsAgainst,
    wins: recent.filter((m) => m.result === "W").length,
    draws: recent.filter((m) => m.result === "D").length,
    losses: recent.filter((m) => m.result === "L").length,
  };
}

function splitRate(split, side, xgWeight) {
  if (!split || !split.played) return { attack: null, defense: null, n: 0 };
  return {
    attack: blendedRate(split.goalsFor, split.xgFor, split.played, xgWeight),
    defense: blendedRate(split.goalsAgainst, split.xgAgainst, split.played, xgWeight),
    n: split.played,
    ppg: (split.points || 0) / split.played,
  };
}

function trendOf(matches) {
  if (matches.length < 4) return 0;
  const sorted = [...matches].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const pts = (arr) => arr.reduce((s, m) => s + (m.result === "W" ? 3 : m.result === "D" ? 1 : 0), 0) / arr.length;
  const last3 = pts(sorted.slice(0, 3));
  const prev3 = pts(sorted.slice(3, 6));
  return clamp((last3 - prev3) / 3, -1, 1);
}

export function rateTeam(team, league, match, side) {
  const xgWeight = WEIGHTS.xgVsGoals;
  const basePerTeam = league.avgGoalsPerTeam;
  const sideGoalsBase = side === "home" ? league.avgHomeGoals : league.avgAwayGoals;

  let s = team.season;
  let seasonAttack = blendedRate(s.goalsFor, s.xgFor, s.played, xgWeight);
  let seasonDefense = blendedRate(s.goalsAgainst, s.xgAgainst, s.played, xgWeight);

  
  if (!s.played && team.lastMatches.length) {
    seasonAttack = team.lastMatches.reduce((a, m) => a + m.goalsFor, 0) / team.lastMatches.length;
    seasonDefense = team.lastMatches.reduce((a, m) => a + m.goalsAgainst, 0) / team.lastMatches.length;
    s = { ...s, played: team.lastMatches.length };
  }

  const recent = recentRates(team.lastMatches, league, xgWeight, WEIGHTS.formHalfLife);
  const splitKey = side; 
  const split = splitRate(team.splits[splitKey], side, xgWeight);

  
  const parts = [];
  if (s.played > 0) parts.push({ name: "season", weight: WEIGHTS.season, attack: seasonAttack, defense: seasonDefense, n: s.played });
  if (recent.n > 0) parts.push({ name: "recent", weight: WEIGHTS.recentForm, attack: recent.attack, defense: recent.defense, n: recent.n });
  if (split.n > 0) parts.push({ name: "split", weight: WEIGHTS.homeAwaySplit, attack: split.attack, defense: split.defense, n: split.n });

  let attackRate = basePerTeam;
  let defenseRate = basePerTeam;
  if (parts.length) {
    const wsum = parts.reduce((a, p) => a + p.weight, 0);
    attackRate = parts.reduce((a, p) => a + p.weight * (p.attack ?? basePerTeam), 0) / wsum;
    defenseRate = parts.reduce((a, p) => a + p.weight * (p.defense ?? basePerTeam), 0) / wsum;
  }

  const sampleForShrink = Math.min(14, (s.played || 0) * 0.7 + recent.n * 0.5 + split.n * 0.3);
  const shrunkAttack = shrink(attackRate, sampleForShrink, basePerTeam);
  const shrunkDefense = shrink(defenseRate, sampleForShrink, basePerTeam);

  const attackStrength = clamp(shrunkAttack / basePerTeam, 0.35, 2.4);
  const defenseStrength = clamp(shrunkDefense / basePerTeam, 0.35, 2.4);

  
  const splitAttackStrength = split.attack !== null
    ? clamp(split.attack / sideGoalsBase, 0.35, 2.4) : null;
  const splitDefenseStrength = split.defense !== null
    ? clamp(split.defense / sideGoalsBase, 0.35, 2.4) : null;

  const ppgSeason = s.played ? (s.points || (s.wins * 3 + s.draws)) / s.played : null;
  const ppg = recent.ppg ?? ppgSeason;

  const recentXg = team.lastMatches.slice(0, 10).filter((m) => m.xgFor !== null && m.xgFor !== undefined).length;
  const xgShare = recent.n ? clamp(recentXg / recent.n, 0, 1) : 0;
  const dataQuality = clamp(
    0.30 * clamp((s.played || 0) / 12, 0, 1) +
    0.27 * clamp(recent.n / 8, 0, 1) +
    0.13 * (split.n ? 1 : 0) +
    0.20 * clamp(team.players.length / 16, 0, 1) +
    0.10 * xgShare,
    0, 1
  );

  return {
    side,
    name: team.name,
    sample: {
      seasonMatches: s.played || 0,
      recentMatches: recent.n,
      splitMatches: split.n,
      players: team.players.length,
    },
    rates: {
      attack: attackRate,
      defense: defenseRate,
      shrunkAttack,
      shrunkDefense,
      xgWeight,
    },
    strengths: {
      attack: attackStrength,
      defense: defenseStrength,
      splitAttack: splitAttackStrength,
      splitDefense: splitDefenseStrength,
    },
    form: {
      ppg: ppg ?? 1.3,
      ppgSeason,
      goalDiffPerMatch: recent.n ? recent.goalDiff : null,
      trend: trendOf(team.lastMatches),
      wins: recent.wins ?? 0,
      draws: recent.draws ?? 0,
      losses: recent.losses ?? 0,
      last5: [...team.lastMatches]
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(0, 5)
        .map((m) => m.result),
      goalsFor: recent.goalsFor ?? null,
      goalsAgainst: recent.goalsAgainst ?? null,
    },
    availability: team.availability,
    condition: team.condition,
    schedule: team.schedule,
    motivation: team.motivation,
    dataQuality,
    season: s,
    
    venueBaseline: { goals: sideGoalsBase, attackRate: splitAttackStrength, defenseRate: splitDefenseStrength },
  };
}

export function leagueBaseline(league, match) {
  const homeAdv = match.neutral ? 1 : 1;
  return {
    homeGoals: league.avgHomeGoals * homeAdv,
    awayGoals: league.avgAwayGoals,
    avgPerTeam: league.avgGoalsPerTeam,
  };
}