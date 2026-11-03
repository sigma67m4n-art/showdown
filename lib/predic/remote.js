import { LEAGUE_PRESETS } from "./config.js";
import { clamp, daysBetween } from "./util.js";
import {
  getRoster,
  getSchedule,
  getScoreboardMonth,
  getStandings,
  getSummary,
  matchMonth,
  parseEvent,
  parseOdds,
  parseRoster,
  parseStandings,
  parseSummaryBox,
  parseSummaryRoster,
  searchTeam,
} from "./providers/espn.js";
import { getLeagueXg, lookupTeam, matchXg, seasonSplits } from "./providers/xg.js";

const PRESET_MAP = [
  [/premier league/i, "epl"],
  [/la liga/i, "laliga"],
  [/serie a/i, "seriea"],
  [/bundesliga/i, "bundesliga"],
  [/ligue 1/i, "ligue1"],
  [/eredivisie/i, "eredivisie"],
  [/champions league/i, "champions"],
  [/world cup|european championship|copa america|copa libertadores/i, "international"],
];

function presetFor(name) {
  for (const [re, key] of PRESET_MAP) if (re.test(String(name || ""))) return key;
  return "default";
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function leagueBaseline(rows, name) {
  const cleanName = String(name || "Unknown League").replace(/^\d{4}(?:-\d{2,4})?\s+/, "");
  const presetKey = presetFor(cleanName);
  const preset = LEAGUE_PRESETS[presetKey] || LEAGUE_PRESETS.default;
  let avgHome = preset.avgHomeGoals;
  let avgAway = preset.avgAwayGoals;
  const played = rows.reduce((a, r) => a + num(r.played), 0);
  const goals = rows.reduce((a, r) => a + num(r.goalsFor), 0);
  if (played > 0) {
    const avg = clamp(goals / (played / 2), 2.0, 3.8);
    const share = preset.avgHomeGoals / (preset.avgHomeGoals + preset.avgAwayGoals);
    avgHome = +(avg * share).toFixed(3);
    avgAway = +(avg * (1 - share)).toFixed(3);
  }
  return {
    name: cleanName,
    preset: presetKey,
    avgHomeGoals: avgHome,
    avgAwayGoals: avgAway,
    avgGoals: +(avgHome + avgAway).toFixed(3),
    homeAdvantage: preset.homeAdvantage,
  };
}

function aggregateForm(matches) {
  if (!matches.length) return { ppg: 1.35, gd: 0, gf: 0, ga: 0, n: 0, points: 0 };
  const points = matches.reduce((a, m) => a + (m.result === "W" ? 3 : m.result === "D" ? 1 : 0), 0);
  const gf = matches.reduce((a, m) => a + m.goalsFor, 0);
  const ga = matches.reduce((a, m) => a + m.goalsAgainst, 0);
  return { ppg: points / matches.length, gd: (gf - ga) / matches.length, gf, ga, n: matches.length, points };
}

function splitsFrom(matches) {
  const out = {};
  for (const venue of ["home", "away"]) {
    const games = matches.filter((m) => m.venue === venue);
    if (games.length < 2) continue;
    const gf = games.reduce((a, m) => a + m.goalsFor, 0);
    const ga = games.reduce((a, m) => a + m.goalsAgainst, 0);
    const withXg = games.filter((m) => m.xgFor !== null && m.xgFor !== undefined);
    out[venue] = {
      played: games.length,
      goalsFor: gf,
      goalsAgainst: ga,
      xgFor: withXg.length === games.length ? withXg.reduce((a, m) => a + m.xgFor, 0) : null,
      xgAgainst: withXg.length === games.length ? withXg.reduce((a, m) => a + m.xgAgainst, 0) : null,
      wins: games.filter((m) => m.result === "W").length,
      draws: games.filter((m) => m.result === "D").length,
      losses: games.filter((m) => m.result === "L").length,
      points: games.reduce((a, m) => a + (m.result === "W" ? 3 : m.result === "D" ? 1 : 0), 0),
    };
  }
  return out;
}

function summaryAggregate(summaries, teamId) {
  const items = summaries.map((s) => s.box?.[String(teamId)]).filter(Boolean);
  if (!items.length) return null;
  const avg = (key) => items.reduce((a, x) => a + (Number(x[key]) || 0), 0) / items.length;
  const passVals = items.map((x) => x.passPct).filter((x) => Number.isFinite(x));
  return {
    matches: items.length,
    shots: avg("shots"),
    shotsOnTarget: avg("shotsOnTarget"),
    possession: avg("possession"),
    corners: avg("corners"),
    yellow: avg("yellow"),
    red: avg("red"),
    saves: avg("saves"),
    passPct: passVals.length ? passVals.reduce((a, b) => a + b, 0) / passVals.length : null,
    tackles: avg("tackles"),
    interceptions: avg("interceptions"),
  };
}

function continuity(summaries) {
  if (summaries.length < 2) return 0.75;
  const a = new Set(summaries[0].roster?.starters || []);
  const b = new Set(summaries[1].roster?.starters || []);
  if (!a.size || !b.size) return 0.75;
  let same = 0;
  for (const id of a) if (b.has(id)) same++;
  return clamp(same / Math.max(11, a.size), 0, 1);
}

function buildTeam(info, ctx) {
  const {
    fixtures, standings, roster, summaries, matchDate, kickoff, league, warnings, side, upcoming,
  } = ctx;
  const teamId = String(info.id);
  const teamName = info.name;
  const games = fixtures
    .map((e) => parseEvent(e, teamId, info.leagueName))
    .filter((e) => e && e.state === "post" && e.result)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const last = games.slice(0, 6);
  const ppgById = new Map(standings.filter((r) => r.played > 0).map((r) => [String(r.id), r.points / r.played]));
  for (const m of last) {
    m.opponentStrength = ppgById.get(String(m.opponentId)) ?? null;
  }

  const xgTeam = ctx.xgLeague ? lookupTeam(ctx.xgLeague, teamName) : null;
  if (xgTeam) {
    for (const m of last) {
      const found = matchXg(xgTeam, m.date, m.opponent);
      if (found && found.xgFor !== null && found.xgAgainst !== null) {
        m.xgFor = found.xgFor;
        m.xgAgainst = found.xgAgainst;
      }
    }
  }
  const xgSplits = xgTeam ? seasonSplits(xgTeam) : null;

  const row = standings.find((r) => String(r.id) === teamId) || null;
  const played = row?.played || last.length;
  const rank = row?.position ?? null;
  const totalTeams = standings.length || 20;
  const form = aggregateForm(last);
  const rest = last[0]?.date ? Math.max(0, daysBetween(last[0].date, matchDate) ?? 5) : null;
  const restHours = last[0]?.date && kickoff
    ? +((new Date(kickoff).getTime() - new Date(last[0].date).getTime()) / 3600000).toFixed(1)
    : null;
  const congestion14 = last.filter((m) => {
    const d = daysBetween(m.date, matchDate);
    return d !== null && d >= 0 && d <= 14;
  }).length;
  const congestion7 = last.filter((m) => {
    const d = daysBetween(m.date, matchDate);
    return d !== null && d >= 0 && d <= 7;
  }).length;
  const agg = summaryAggregate(summaries, teamId);
  const lineupContinuity = continuity(summaries);

  const fatigueBase = rest === null ? 5
    : rest <= 2 ? 8.2
    : rest === 3 ? 6.4
    : rest <= 5 ? 4.5
    : rest <= 7 ? 3.8 : 3.2;
  const morale = clamp(5.4 + (form.ppg - 1.35) * 1.35 + form.gd * 0.45, 0, 10);
  const pressure = rank === null ? 5
    : rank <= 2 ? 7.5
    : rank <= 4 ? 6.5
    : rank >= totalTeams - 3 ? 7.8 : 5;
  const stakes = rank === null ? 5
    : rank <= 2 ? 9
    : rank <= 4 ? 7.5
    : rank >= totalTeams - 3 ? 8.5 : 5.5;

  const players = parseRoster(roster, played);
  const gks = players.filter((p) => p.position === "GK" && p.status === "available").sort((a, b) => b.rating - a.rating);
  const savePct = agg && agg.saves > 0 ? null : null;
  const gkQuality = gks[0]?.rating ?? (agg ? clamp(6.2 + (agg.saves / Math.max(1, agg.saves + 1.4)) * 0.8, 5.8, 8.2) : 6.8);

  if (!players.length) warnings.push(`${teamName}: player roster unavailable; individual/injury factors are ignored.`);
  if (!agg && !ctx.fast) warnings.push(`${teamName}: detailed match stats unavailable; style factors use neutral defaults.`);
  if (!xgTeam) warnings.push(`${teamName}: real xG unavailable for this league/team; goals are used instead.`);

  const next = upcoming
    .filter((e) => {
      const c = e.competitions?.[0];
      const involved = c?.competitors?.some((x) => String(x.team?.id) === teamId);
      return involved && new Date(e.date) > new Date(matchDate) && String(e.id) !== String(ctx.fixtureId);
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const nextMatchDays = ctx.hypothetical ? null : next[0]?.date ? daysBetween(matchDate, next[0].date) : null;

  const possession = agg?.possession ?? 50;
  const pressProxy = agg ? clamp(5 + (agg.tackles + agg.interceptions - 20) * 0.15, 0, 10) : 5;
  const setPiece = agg ? clamp(5 + (agg.corners - 4.5) * 0.5, 0, 10) : 5;
  const discipline = agg ? clamp(9.5 - agg.yellow * 0.7 - agg.red * 3, 0, 10) : 5;
  const directness = agg?.passPct !== null && agg?.passPct !== undefined ? clamp((0.9 - agg.passPct) * 22, 0, 10) : 5;

  return {
    name: teamName,
    season: {
      played,
      wins: row?.wins ?? last.filter((m) => m.result === "W").length,
      draws: row?.draws ?? last.filter((m) => m.result === "D").length,
      losses: row?.losses ?? last.filter((m) => m.result === "L").length,
      goalsFor: row?.goalsFor ?? form.gf,
      goalsAgainst: row?.goalsAgainst ?? form.ga,
      points: row?.points ?? form.points,
      position: rank,
      xgFor: xgTeam && xgTeam.xgPlayed ? +((xgTeam.xgFor / xgTeam.xgPlayed) * played).toFixed(3) : null,
      xgAgainst: xgTeam && xgTeam.xgPlayed ? +((xgTeam.xgAgainst / xgTeam.xgPlayed) * played).toFixed(3) : null,
    },
    splits: xgSplits || splitsFrom(last),
    lastMatches: last,
    players,
    condition: {
      morale,
      fatigue: clamp(fatigueBase + Math.max(0, congestion14 - 3) * 0.35, 0, 10),
      sharpness: clamp(7 + (last.length - 3) * 0.25 - (rest !== null && rest > 14 ? 1 : 0), 0, 10),
      cohesion: clamp(5.5 + lineupContinuity * 3, 0, 10),
      lineupContinuity,
      managerChangeDays: null,
      pressure,
      confidence: clamp(4.5 + form.ppg * 1.35 + form.gd * 0.3, 0, 10),
    },
    schedule: {
      daysSinceLastMatch: rest,
      restHours,
      matchesLast14Days: congestion14,
      matchesLast7Days: congestion7,
      travelKm: 0,
      extraTimeLastMatch: false,
      nextMatchDays,
      nextMatchImportance: 5,
      continentalMidweek: false,
    },
    style: {
      possession,
      pressIntensity: pressProxy,
      setPieceStrength: setPiece,
      counterAttack: 5,
      discipline,
      directness,
    },
    goalkeeper: { quality: gkQuality, savePct },
    motivation: {
      stakes,
      mustWin: rank !== null && rank >= totalTeams - 2 && played > 20,
      titleRace: rank !== null && rank <= 2 && played > 15,
      relegationBattle: rank !== null && rank >= totalTeams - 3 && played > 15,
    },
    h2h: [],
    extraFactors: [],
    _meta: {
      id: teamId,
      league: info.league,
      leagueName: info.leagueName,
      side,
      matchesUsed: last.length,
      summariesUsed: summaries.length,
      venue: ctx.venue,
      xgSource: xgTeam ? "football-data.co.uk" : null,
    },
  };
}

function mergeOverlay(target, overlay) {
  if (!overlay) return target;
  const out = { ...target };
  for (const [k, v] of Object.entries(overlay)) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      out[k] = mergeOverlay(target[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function loadTeam(info, opts) {
  const year = new Date().getUTCFullYear();
  const settled = await Promise.allSettled([
    getSchedule(info.league, info.id, year, opts),
    getStandings(info.league, year, opts),
    getRoster(info.league, info.id, opts),
    loadMonths(info.league, opts),
  ]);
  let schedule = settled[0].status === "fulfilled" ? settled[0].value : [];
  let standings = settled[1].status === "fulfilled" ? settled[1].value : [];
  const roster = settled[2].status === "fulfilled" ? settled[2].value : [];
  const events = settled[3].status === "fulfilled" ? settled[3].value : [];
  if (!schedule.length || !standings.length) {
    const prev = await Promise.allSettled([
      schedule.length ? Promise.resolve(schedule) : getSchedule(info.league, info.id, year - 1, opts),
      standings.length ? Promise.resolve(standings) : getStandings(info.league, year - 1, opts),
    ]);
    if (prev[0].status === "fulfilled") schedule = prev[0].value;
    if (prev[1].status === "fulfilled") standings = prev[1].value;
  }
  return { schedule, standings: parseStandings(standings), roster, events };
}

async function loadMonths(league, opts) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const months = [matchMonth(prev), matchMonth(now), matchMonth(next)];
  const settled = await Promise.allSettled(months.map((m) => getScoreboardMonth(league, m, opts)));
  const events = [];
  for (const r of settled) if (r.status === "fulfilled") events.push(...r.value);
  return events;
}

async function loadSummaries(events, league, teamId, opts) {
  const picked = events.slice(0, 3);
  const settled = await Promise.allSettled(picked.map(async (e) => {
    const data = await getSummary(league, e.id, opts);
    return {
      eventId: e.id,
      box: parseSummaryBox(data),
      roster: parseSummaryRoster(data, teamId),
    };
  }));
  return settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
}

function findFixture(events, homeId, awayId) {
  const today = new Date().toISOString().slice(0, 10);
  return events
    .filter((e) => {
      const c = e.competitions?.[0];
      if (!c) return false;
      const home = c.competitors?.find((x) => x.homeAway === "home");
      const away = c.competitors?.find((x) => x.homeAway === "away");
      const state = c.status?.type?.state || e.status?.type?.state;
      return state !== "post"
        && String(home?.team?.id) === String(homeId)
        && String(away?.team?.id) === String(awayId)
        && String(e.date).slice(0, 10) >= today;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;
}

export async function buildRemoteInput({ homeName, awayName, opts = {}, overlay = null }) {
  const warnings = [];
  const [homeInfo, awayInfo] = await Promise.all([searchTeam(homeName, opts), searchTeam(awayName, opts)]);
  if (String(homeInfo.id) === String(awayInfo.id)) {
    const err = new Error("Home and away teams must be different");
    err.code = "SAME_TEAM";
    err.exitCode = 2;
    throw err;
  }

  const [homeData, awayData] = await Promise.all([loadTeam(homeInfo, opts), loadTeam(awayInfo, opts)]);
  const sameLeague = homeInfo.league === awayInfo.league;
  const allEvents = [...homeData.events, ...(sameLeague ? [] : awayData.events)];
  const fixture = findFixture(allEvents, homeInfo.id, awayInfo.id);
  const fixtureDate = fixture?.date?.slice(0, 10) || null;
  const today = new Date().toISOString().slice(0, 10);
  const matchDate = opts.date || fixtureDate || today;
  const fixtureMatchesDate = Boolean(fixture) && (!opts.date || opts.date === fixtureDate);
  const scheduleFixture = fixtureMatchesDate ? fixture : null;
  const kickoff = opts.time && matchDate
    ? `${matchDate}T${opts.time}:00`
    : (scheduleFixture?.date || null);
  const hypothetical = !fixture;
  if (hypothetical) {
    warnings.push(`${homeInfo.name} vs ${awayInfo.name} is not on the schedule; using ${matchDate} and assuming ${homeInfo.name} plays at home.`);
  } else if (opts.date && opts.date !== fixtureDate) {
    warnings.push(`Match date overridden to ${opts.date} (ESPN fixture date is ${fixtureDate}); market odds and fixture metadata are not used.`);
  }

  const baselineRows = homeData.standings.length ? homeData.standings : awayData.standings;
  const leagueName = homeData.schedule[0]?.season?.displayName || homeInfo.leagueName || "Unknown League";
  const league = leagueBaseline(baselineRows, leagueName);

  const [homeSummaries, awaySummaries] = opts.fast ? [[], []] : await Promise.all([
    loadSummaries(homeData.schedule.filter((e) => e.competitions?.[0]?.status?.type?.state === "post").sort((a, b) => new Date(b.date) - new Date(a.date)), homeInfo.league, homeInfo.id, opts),
    loadSummaries(awayData.schedule.filter((e) => e.competitions?.[0]?.status?.type?.state === "post").sort((a, b) => new Date(b.date) - new Date(a.date)), awayInfo.league, awayInfo.id, opts),
  ]);
  if (opts.fast) warnings.push("--fast mode: match detail is skipped; real xG is still used.");

  const leagueSlugs = [...new Set([homeInfo.league, awayInfo.league].filter(Boolean))];
  const xgLeagues = {};
  const xgSettled = await Promise.allSettled(leagueSlugs.map((slug) => getLeagueXg(slug, matchDate, opts)));
  leagueSlugs.forEach((slug, i) => {
    xgLeagues[slug] = xgSettled[i].status === "fulfilled" ? xgSettled[i].value : null;
  });
  if (!leagueSlugs.some((slug) => xgLeagues[slug])) {
    warnings.push("Real xG (football-data.co.uk) is unavailable for this league; goals are used instead.");
  }

  const home = buildTeam(homeInfo, {
    fixtures: homeData.schedule,
    standings: homeData.standings,
    roster: homeData.roster,
    summaries: homeSummaries,
    matchDate,
    kickoff,
    league,
    warnings,
    side: "home",
    upcoming: homeData.events,
    hypothetical,
    fixtureId: fixture?.id,
    venue: "home",
    fast: Boolean(opts.fast),
    xgLeague: xgLeagues[homeInfo.league] || null,
  });
  const away = buildTeam(awayInfo, {
    fixtures: awayData.schedule,
    standings: awayData.standings,
    roster: awayData.roster,
    summaries: awaySummaries,
    matchDate,
    kickoff,
    league,
    warnings,
    side: "away",
    upcoming: sameLeague ? homeData.events : awayData.events,
    hypothetical,
    fixtureId: fixture?.id,
    venue: "away",
    fast: Boolean(opts.fast),
    xgLeague: xgLeagues[awayInfo.league] || null,
  });

  if (!fixture) warnings.push("H2H is not computed because the match is not scheduled on ESPN.");

  const odds = scheduleFixture ? parseOdds(scheduleFixture.competitions?.[0]?.odds) : null;
  const input = {
    league,
    match: {
      date: matchDate,
      kickoff,
      time: opts.time || (scheduleFixture?.date ? scheduleFixture.date.slice(11, 16) : null),
      venue: opts.neutral ? "neutral" : "home",
      competition: scheduleFixture?.league?.name || homeInfo.leagueName || league.name,
      leagueShort: homeInfo.leagueName || league.name,
      importance: clamp((home.motivation.stakes + away.motivation.stakes) / 2, 0, 10),
      isDerby: false,
      neutral: Boolean(opts.neutral),
    },
    context: {
      weather: { condition: "normal", tempC: 20, windKph: 10, rainMm: 0 },
      pitch: { quality: 8, widthM: 68, lengthM: 105 },
      referee: { strictness: 5, penaltyRate: 0.25, homeBias: 0 },
      crowd: { attendance: scheduleFixture?.competitions?.[0]?.attendance || null, capacity: null, awaySupport: null },
    },
    home,
    away,
    market: overlay?.market || opts.market || odds || null,
    teams: { [homeInfo.name]: home, [awayInfo.name]: away },
    meta: {
      provider: "espn",
      xgProvider: "football-data.co.uk",
      fixtureId: fixture?.id || null,
      date: matchDate,
      kickoff,
      stadium: scheduleFixture?.competitions?.[0]?.venue?.fullName || null,
      league: leagueName,
      home: { id: homeInfo.id, logo: homeInfo.logo },
      away: { id: awayInfo.id, logo: awayInfo.logo },
      odds: Boolean(odds),
      fetchedAt: new Date().toISOString(),
    },
    warnings,
  };

  if (overlay) {
    const merged = mergeOverlay(input, overlay);
    merged.warnings = [...new Set([...(input.warnings || []), ...(overlay.warnings || [])])];
    return merged;
  }
  return input;
}