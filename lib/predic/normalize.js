import { DEFAULTS, LEAGUE_PRESETS, POSITION_ATTACK_WEIGHT, POSITION_DEFENSE_WEIGHT } from "./config.js";
import { deepMerge, num, clamp, daysBetween } from "./util.js";

const ALIASES = {
  lastMatches: ["form", "recentMatches", "matches", "last5", "fixtures"],
  goalsFor: ["gf", "scored", "goalsScored"],
  goalsAgainst: ["ga", "conceded", "goalsConceded"],
  xgFor: ["xg", "expectedGoalsFor"],
  xgAgainst: ["xga", "expectedGoalsAgainst"],
  venue: ["homeAway", "ha"],
  status: ["injury", "condition"],
  importance: ["weight", "keyness"],
  rating: ["formRating", "avgRating"],
};

function pick(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  for (const alt of ALIASES[key] || []) {
    if (obj[alt] !== undefined && obj[alt] !== null) return obj[alt];
  }
  return undefined;
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

export class InputError extends Error {
  constructor(message, code = "INVALID_INPUT", hint) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.exitCode = 2;
  }
}

export function normalizeLeague(raw = {}) {
  const league = deepMerge(DEFAULTS.league, raw || {});
  const preset = LEAGUE_PRESETS[league.preset] || LEAGUE_PRESETS.default;
  league.avgHomeGoals = n(league.avgHomeGoals, preset.avgHomeGoals);
  league.avgAwayGoals = n(league.avgAwayGoals, preset.avgAwayGoals);
  if (!raw.avgHomeGoals && !raw.avgAwayGoals && raw.avgGoals) {
    league.avgHomeGoals = n(raw.avgGoals) * 0.56;
    league.avgAwayGoals = n(raw.avgGoals) * 0.44;
  }
  league.avgGoals = league.avgHomeGoals + league.avgAwayGoals;
  league.avgGoalsPerTeam = league.avgGoals / 2;
  league.avgForPerTeam = league.avgGoalsPerTeam;
  league.homeAdvantage = n(league.homeAdvantage, 1);
  return league;
}

function normalizeMatch(rawMatch = {}, league) {
  const match = deepMerge(DEFAULTS.match, rawMatch || {});
  match.importance = clamp(n(match.importance, 5), 0, 10);
  match.neutral = match.venue === "neutral";
  if (match.neutral) match.homeAdvantage = 1;
  else match.homeAdvantage = n(match.homeAdvantage, league.homeAdvantage);
  return match;
}

function normalizeContext(rawContext = {}) {
  const ctx = deepMerge(DEFAULTS.context, rawContext || {});
  ctx.weather.condition = String(ctx.weather.condition || "normal").toLowerCase();
  ctx.weather.tempC = n(ctx.weather.tempC, 20);
  ctx.weather.windKph = n(ctx.weather.windKph, 10);
  ctx.weather.rainMm = n(ctx.weather.rainMm, 0);
  ctx.pitch.quality = clamp(n(ctx.pitch.quality, 8), 0, 10);
  ctx.referee.strictness = clamp(n(ctx.referee.strictness, 5), 0, 10);
  ctx.referee.penaltyRate = n(ctx.referee.penaltyRate, 0.25);
  return ctx;
}

function normalizeMatchEntry(m, teamName) {
  const venueRaw = String(pick(m, "venue") || "home").toLowerCase();
  const venue = ["away", "a"].includes(venueRaw) ? "away" : ["neutral", "n"].includes(venueRaw) ? "neutral" : "home";
  const goalsFor = n(pick(m, "goalsFor"), null);
  const goalsAgainst = n(pick(m, "goalsAgainst"), null);
  const xgFor = num(pick(m, "xgFor"), null);
  const xgAgainst = num(pick(m, "xgAgainst"), null);
  let result = m.result;
  if (!result && goalsFor !== null && goalsAgainst !== null) {
    result = goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L";
  }
  return {
    date: m.date || null,
    opponent: m.opponent || m.opponentName || "Unknown",
    opponentStrength: num(m.opponentStrength ?? m.opponentRating, null),
    venue,
    competition: m.competition || "league",
    goalsFor: goalsFor ?? 0,
    goalsAgainst: goalsAgainst ?? 0,
    xgFor,
    xgAgainst,
    result: result || "D",
    minutes: num(m.minutes, 90),
    notes: m.notes || null,
  };
}

function normalizePlayer(p, index = 0) {
  const rawStatus = String(pick(p, "status") || "available").toLowerCase().trim();
  const status = rawStatus.replace(/\s+/g, "-");
  const position = String(p.position || p.pos || "MF").toUpperCase();
  const pos = ["GK", "G", "GOALKEEPER"].includes(position) ? "GK"
    : ["DF", "D", "DEF", "DEFENDER"].includes(position) ? "DF"
    : ["FW", "F", "ST", "ATT", "FORWARD"].includes(position) ? "FW"
    : "MF";
  return {
    name: p.name || `Player ${index + 1}`,
    position: pos,
    status,
    importance: clamp(n(pick(p, "importance"), n(p.keyPlayer, false) ? 9 : 5), 0, 10),
    rating: clamp(n(pick(p, "rating"), 6.7), 0, 10),
    minutes: Math.max(0, n(p.minutes, 0)),
    minutesShare: clamp(n(p.minutesShare, n(p.minutes, 0) / 900), 0, 1.2),
    goals: Math.max(0, n(p.goals, 0)),
    assists: Math.max(0, n(p.assists, 0)),
    form: clamp(n(p.form, 6.7), 0, 10),
    age: num(p.age, null),
    expectedReturn: p.expectedReturn || null,
    note: p.note || null,
  };
}

export function normalizeTeam(rawTeam = {}, side = "home") {
  const team = deepMerge(DEFAULTS.team, rawTeam || {});
  team.name = rawTeam.name || rawTeam.team || rawTeam.club || `${side} team`;
  team.side = side;

  team.season = {
    played: n(team.season.played, 0),
    wins: n(team.season.wins, 0),
    draws: n(team.season.draws, 0),
    losses: n(team.season.losses, 0),
    goalsFor: n(team.season.goalsFor, 0),
    goalsAgainst: n(team.season.goalsAgainst, 0),
    points: n(team.season.points, 0),
    position: team.season.position ?? null,
    xgFor: num(team.season.xgFor, null),
    xgAgainst: num(team.season.xgAgainst, null),
    cleanSheets: num(team.season.cleanSheets, null),
  };
  if (!team.season.played && (team.season.wins || team.season.draws || team.season.losses)) {
    team.season.played = team.season.wins + team.season.draws + team.season.losses;
  }
  if (!team.season.points) team.season.points = team.season.wins * 3 + team.season.draws;

  const rawMatches = pick(rawTeam, "lastMatches") || [];
  team.lastMatches = rawMatches.map((m) => normalizeMatchEntry(m, team.name));

  const rawPlayers = Array.isArray(rawTeam.players) ? rawTeam.players : Array.isArray(rawTeam.squad) ? rawTeam.squad : [];
  team.players = rawPlayers.map(normalizePlayer);

  team.condition = {
    morale: clamp(n(team.condition.morale, 6), 0, 10),
    fatigue: clamp(n(team.condition.fatigue, 4), 0, 10),
    sharpness: clamp(n(team.condition.sharpness, 7), 0, 10),
    cohesion: clamp(n(team.condition.cohesion, 7), 0, 10),
    managerChangeDays: num(team.condition.managerChangeDays, null),
    lineupContinuity: clamp(n(team.condition.lineupContinuity, 0.75), 0, 1),
    pressure: clamp(n(team.condition.pressure, 5), 0, 10),
    confidence: clamp(n(team.condition.confidence, 6), 0, 10),
  };

  team.schedule = {
    daysSinceLastMatch: num(team.schedule.daysSinceLastMatch, 5),
    restHours: num(team.schedule.restHours, null),
    matchesLast14Days: Math.max(0, n(team.schedule.matchesLast14Days, 2)),
    matchesLast7Days: Math.max(0, n(team.schedule.matchesLast7Days, 1)),
    travelKm: Math.max(0, n(team.schedule.travelKm, 0)),
    extraTimeLastMatch: Boolean(team.schedule.extraTimeLastMatch),
    nextMatchDays: num(team.schedule.nextMatchDays, 4),
    nextMatchImportance: clamp(n(team.schedule.nextMatchImportance, 5), 0, 10),
    continentalMidweek: Boolean(team.schedule.continentalMidweek),
  };

  team.style = {
    possession: clamp(n(team.style.possession, 50), 0, 100),
    pressIntensity: clamp(n(team.style.pressIntensity, 5), 0, 10),
    setPieceStrength: clamp(n(team.style.setPieceStrength, 5), 0, 10),
    counterAttack: clamp(n(team.style.counterAttack, 5), 0, 10),
    discipline: clamp(n(team.style.discipline, 5), 0, 10),
    directness: clamp(n(team.style.directness, 5), 0, 10),
  };

  team.goalkeeper = {
    quality: clamp(n(team.goalkeeper.quality, 6.8), 0, 10),
    savePct: num(team.goalkeeper.savePct, null),
  };

  team.motivation = {
    stakes: clamp(n(team.motivation.stakes, 5), 0, 10),
    mustWin: Boolean(team.motivation.mustWin),
    titleRace: Boolean(team.motivation.titleRace),
    relegationBattle: Boolean(team.motivation.relegationBattle),
  };

  const rawSplits = team.splits && typeof team.splits === "object" ? team.splits : {};
  team.splits = {};
  for (const [key, val] of Object.entries(rawSplits)) {
    if (!val || typeof val !== "object") continue;
    team.splits[key] = {
      played: n(val.played, 0),
      goalsFor: n(val.goalsFor ?? val.gf, 0),
      goalsAgainst: n(val.goalsAgainst ?? val.ga, 0),
      xgFor: num(val.xgFor ?? val.xg, null),
      xgAgainst: num(val.xgAgainst ?? val.xga, null),
      wins: n(val.wins, 0),
      draws: n(val.draws, 0),
      losses: n(val.losses, 0),
      points: n(val.points, val.wins * 3 + val.draws),
    };
  }

  const rawH2h = Array.isArray(rawTeam.h2h) ? rawTeam.h2h : [];
  team.h2h = rawH2h.map((m) => normalizeMatchEntry(m, team.name));

  team.extraFactors = Array.isArray(rawTeam.extraFactors) ? rawTeam.extraFactors : [];

  team.availability = summarizeAvailability(team.players);
  return team;
}

function summarizeAvailability(players) {
  if (!players.length) return { known: false, attack: 0, defense: 0, missing: [], doubtful: [] };
  const missing = [];
  const doubtful = [];
  let attackLoss = 0;
  let defenseLoss = 0;
  let attackTotal = 0;
  let defenseTotal = 0;
  for (const p of players) {
    const availability = STATUS_AVAILABILITY_MAP[p.status] ?? 0.8;
    const imp = p.importance / 10;
    const share = clamp(p.minutesShare || 0.6, 0, 1);
    const atk = POSITION_ATTACK_WEIGHT[p.position] ?? 0.3;
    const def = POSITION_DEFENSE_WEIGHT[p.position] ?? 0.3;
    const wAtk = imp * share * atk;
    const wDef = imp * share * def;
    attackTotal += wAtk;
    defenseTotal += wDef;
    const loss = 1 - availability;
    attackLoss += wAtk * loss;
    defenseLoss += wDef * loss;
    if (availability < 0.25) missing.push({ name: p.name, position: p.position, status: p.status, importance: p.importance });
    else if (availability < 0.9) doubtful.push({ name: p.name, position: p.position, status: p.status, importance: p.importance });
  }
  return {
    known: true,
    attack: attackTotal > 0 ? clamp(-attackLoss / attackTotal, -0.6, 0) : 0,
    defense: defenseTotal > 0 ? clamp(-defenseLoss / defenseTotal, -0.6, 0) : 0,
    missing,
    doubtful,
    totalPlayers: players.length,
  };
}

const STATUS_AVAILABILITY_MAP = {
  available: 1, fit: 1, "match-fit": 1,
  doubtful: 0.45, "less-fit": 0.6, returning: 0.55,
  injured: 0, suspension: 0, suspended: 0, "out-for-season": 0, "international-duty": 0,
  absent: 0.2,
  unknown: 0.8,
};

export function listTeams(raw) {
  if (raw?.teams && typeof raw.teams === "object") {
    return Object.entries(raw.teams).map(([key, t]) => ({ key, name: t?.name || key }));
  }
  return [];
}

function resolveTeam(raw, selector, side) {
  if (selector && raw?.teams) {
    const entries = Object.entries(raw.teams);
    const sel = String(selector).toLowerCase();
    const hit = entries.find(([key, t]) => key.toLowerCase() === sel || String(t?.name || "").toLowerCase() === sel);
    if (hit) return { team: hit[1], key: hit[0] };
  }
  if (selector && raw?.[side] && String(raw[side]?.name || "").toLowerCase() === String(selector).toLowerCase()) {
    return { team: raw[side], key: side };
  }
  if (raw?.[side] && typeof raw[side] === "object") return { team: raw[side], key: side };
  if (selector && raw?.teams) {
    const names = Object.entries(raw.teams).map(([k, t]) => t?.name || k).join(", ");
    throw new InputError(`Team "${selector}" not found in data.`, "TEAM_NOT_FOUND", `Options: ${names}`);
  }
  throw new InputError(`Team data for ${side} is missing. Use --${side} <name> or provide "teams".`, "TEAM_MISSING");
}

export function buildMatchInput(raw, { homeSelector, awaySelector } = {}) {
  if (!raw || typeof raw !== "object") throw new InputError("Data must be a JSON object.", "INVALID_DATA");

  let homeRaw;
  let awayRaw;
  try {
    homeRaw = resolveTeam(raw, homeSelector, "home");
    awayRaw = resolveTeam(raw, awaySelector, "away");
  } catch (err) {
    throw err;
  }
  if (homeRaw.key === awayRaw.key && homeRaw.team === awayRaw.team) {
    throw new InputError("Home and away teams must be different.", "SAME_TEAM");
  }

  const league = normalizeLeague(raw.league);
  const match = normalizeMatch(
    { ...(raw.match || {}), ...(raw.fixture || {}) },
    league
  );
  if (homeSelector) match.homeSelection = homeSelector;
  const context = normalizeContext({ ...(raw.context || {}), ...(raw.conditions || {}) });

  const home = normalizeTeam(homeRaw.team, "home");
  const away = normalizeTeam(awayRaw.team, "away");
  if (match.venue === "neutral") {
    home.isNeutral = true;
    away.isNeutral = true;
  }

  return {
    league,
    match,
    context,
    home,
    away,
    market: raw.market || raw.odds || raw.betting || null,
    meta: raw.meta || null,
    raw: {
      league: raw.league || {},
      match: raw.match || {},
      context: raw.context || {},
      hasTeamsMap: Boolean(raw.teams),
    },
    warnings: validateCoverage(raw, home, away),
  };
}

function validateCoverage(raw, home, away) {
  const warnings = [];
  for (const team of [home, away]) {
    if (team.season.played < 3 && team.lastMatches.length < 3) {
      warnings.push(`Very small sample for ${team.name} (<3 matches). Prediction is less reliable.`);
    }
    if (!team.players.length) warnings.push(`Player list for ${team.name} is empty; injury/individual factors are not counted.`);
    else if (!team.availability.known) warnings.push(`Player status for ${team.name} is incomplete.`);
    if (!team.lastMatches.length && team.season.played === 0) {
      warnings.push(`No match data for ${team.name}; using league averages only.`);
    }
  }
  if (!raw?.context) warnings.push("Match context (weather, referee, pitch, crowd) was not provided; using neutral defaults.");
  return warnings;
}