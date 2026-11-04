import { getJson } from "../http.js";
import { clamp, normalizeName } from "../util.js";

const SITE = "https://site.api.espn.com/apis/site/v2";
const CORE = "https://site.api.espn.com/apis/v2";
const WEB = "https://site.web.api.espn.com/apis/site/v2";
const SEARCH = "https://site.web.api.espn.com/apis/search/v2";

const TTL = {
  search: 604800,
  schedule: 600,
  standings: 3600,
  roster: 21600,
  summary: 86400,
  scoreboard: 600,
};

function season(year) {
  return Number(year) || new Date().getUTCFullYear();
}

function teamIdFrom(team) {
  const m = String(team?.uid || "").match(/~t:(\d+)/);
  if (m) return m[1];
  return /^\d+$/.test(String(team?.id || "")) ? String(team.id) : null;
}

function scoreOf(competitor) {
  const s = competitor?.score;
  const v = s && typeof s === "object" ? s.value : s;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function statMap(stats = []) {
  const out = {};
  for (const s of stats) if (s?.name) out[s.name] = s.value ?? s.displayValue;
  return out;
}

function flattenPlayerStats(player) {
  const out = {};
  const cats = player?.statistics?.splits?.categories || [];
  for (const cat of cats) for (const s of cat.stats || []) out[s.name] = s.value;
  return out;
}

function canonClub(value) {
  return normalizeName(value)
    .replace(/\bmunchen\b/g, "munich")
    .replace(/\bkoln\b/g, "cologne");
}

function seniorPenalty(name, subtitle, slug) {
  const text = `${name} ${subtitle}`;
  let p = 0;
  if (/women|frauen|feminin|femminile|femenino|damen/.test(text) || /wchampions|women/.test(slug || "")) p -= 60;
  if (/(^|\s)(ii|b|u1[5-9]|u2[0-3]|academy|reserves?|youth)(\s|$)/.test(name)) p -= 40;
  return p;
}

export async function searchTeam(name, opts = {}) {
  const q = String(name || "").trim();
  if (!q) throw new Error("Club name is empty");
  const data = await getJson(`${SEARCH}?query=${encodeURIComponent(q)}&limit=20`, {
    ttl: TTL.search,
    refresh: opts.refresh,
  });
  const teams = [];
  for (const group of data?.results || []) {
    if (group.type !== "team") continue;
    for (const item of group.contents || []) {
      if (item.sport !== "soccer") continue;
      teams.push(item);
    }
  }
  if (!teams.length) {
    const err = new Error(`Club "${name}" not found`);
    err.code = "TEAM_NOT_FOUND";
    err.exitCode = 2;
    throw err;
  }
  const qn = canonClub(q);
  const scored = teams.map((t) => {
    const n = canonClub(t.displayName);
    const sub = normalizeName(t.subtitle);
    let score = 0;
    if (n === qn) score = 100;
    else if (n.startsWith(qn)) score = 85;
    else if (n.includes(qn)) score = 75;
    else if (sub.includes(qn)) score = 50;
    score += seniorPenalty(n, sub, t.defaultLeagueSlug);
    return { t, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0].t;
  return {
    id: teamIdFrom(best),
    name: best.displayName,
    league: best.defaultLeagueSlug,
    leagueName: best.subtitle,
    logo: best.image?.default || null,
  };
}

export async function getSchedule(league, teamId, year, opts = {}) {
  const u = `${WEB}/sports/soccer/${league}/teams/${teamId}/schedule?season=${season(year)}`;
  const data = await getJson(u, { ttl: TTL.schedule, refresh: opts.refresh });
  return data?.events || [];
}

export async function getStandings(league, year, opts = {}) {
  const u = `${CORE}/sports/soccer/${league}/standings?season=${season(year)}`;
  const data = await getJson(u, { ttl: TTL.standings, refresh: opts.refresh });
  const entries = [];
  for (const child of data?.children || []) {
    const rows = child?.standings?.entries || [];
    for (const row of rows) entries.push(row);
  }
  return entries;
}

export async function getRoster(league, teamId, opts = {}) {
  const u = `${WEB}/sports/soccer/${league}/teams/${teamId}/roster`;
  const data = await getJson(u, { ttl: TTL.roster, refresh: opts.refresh });
  return data?.athletes || [];
}

export async function getSummary(league, eventId, opts = {}) {
  const u = `${SITE}/sports/soccer/${league}/summary?event=${eventId}`;
  const data = await getJson(u, { ttl: TTL.summary, refresh: opts.refresh });
  return data || {};
}

export async function getScoreboardMonth(league, yyyymm, opts = {}) {
  const u = `${SITE}/sports/soccer/${league}/scoreboard?dates=${yyyymm}`;
  const data = await getJson(u, { ttl: TTL.scoreboard, refresh: opts.refresh });
  return data?.events || [];
}

export function parseEvent(event, teamId, leagueName) {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  const isHome = String(home.team?.id) === String(teamId);
  const own = isHome ? home : away;
  const opp = isHome ? away : home;
  const gf = scoreOf(own);
  const ga = scoreOf(opp);
  const state = comp.status?.type?.state || event.status?.type?.state;
  return {
    id: event.id,
    date: event.date,
    opponent: opp.team?.displayName || opp.team?.name,
    opponentId: String(opp.team?.id),
    venue: isHome ? "home" : "away",
    competition: event.season?.displayName || leagueName || event.league?.name || null,
    goalsFor: gf ?? 0,
    goalsAgainst: ga ?? 0,
    result: gf !== null && ga !== null ? (gf > ga ? "W" : gf === ga ? "D" : "L") : null,
    state,
    neutral: Boolean(comp.neutralSite),
    venueName: comp.venue?.fullName || null,
    attendance: comp.attendance || null,
  };
}

export function parseStandings(entries = []) {
  const rows = [];
  for (const entry of entries) {
    const stats = statMap(entry.stats);
    const team = entry.team || {};
    const played = Number(stats.gamesPlayed) || 0;
    if (!played) continue;
    rows.push({
      id: String(team.id),
      name: team.displayName || team.name,
      played,
      wins: Number(stats.wins) || 0,
      draws: Number(stats.ties) || 0,
      losses: Number(stats.losses) || 0,
      goalsFor: Number(stats.pointsFor) || 0,
      goalsAgainst: Number(stats.pointsAgainst) || 0,
      points: Number(stats.points) || 0,
      position: Number(stats.rank) || (rows.length + 1),
    });
  }
  rows.sort((a, b) => a.position - b.position);
  return rows;
}

export function parseRoster(athletes = [], teamGames = 0) {
  const out = [];
  for (const p of athletes) {
    const posRaw = String(p.position?.abbreviation || p.position?.name || "M").toUpperCase();
    const position = ["G", "GK", "GOALKEEPER"].includes(posRaw) ? "GK"
      : ["D", "DF", "DEFENDER"].includes(posRaw) ? "DF"
      : ["F", "FW", "FORWARD", "ST", "ATTACKER"].includes(posRaw) ? "FW" : "MF";
    const s = flattenPlayerStats(p);
    const games = Number(s.appearances) || 0;
    const goals = Number(s.totalGoals) || 0;
    const assists = Number(s.goalAssists) || 0;
    const saves = Number(s.saves) || 0;
    const conceded = Number(s.goalsConceded) || 0;
    const share = teamGames ? clamp(games / teamGames, 0, 1.2) : clamp(games / 20, 0, 1.2);
    const injuries = Array.isArray(p.injuries) ? p.injuries : [];
    let status = "available";
    for (const inj of injuries) {
      const text = `${inj.status || ""} ${inj.type || ""} ${inj.detail || ""} ${inj.description || ""}`.toLowerCase();
      if (/suspend/.test(text)) { status = "suspended"; break; }
      if (/doubt|question/.test(text)) { status = "doubtful"; break; }
      if (/out|injur|ill|surgery/.test(text)) { status = "injured"; break; }
      status = "doubtful";
    }
    if (p.status?.type && /injur|suspend/.test(String(p.status.type).toLowerCase())) {
      status = /suspend/.test(String(p.status.type).toLowerCase()) ? "suspended" : "injured";
    }
    if (!games && status === "available" && !injuries.length) continue;
    const savePct = saves + conceded > 0 ? saves / (saves + conceded) : null;
    const ratingProxy = clamp(
      6.2 + share * 0.65 + goals * 0.07 + assists * 0.05 + (position === "GK" && savePct ? (savePct - 0.65) * 1.2 : 0),
      5.6, 8.8
    );
    const posBoost = position === "GK" ? 0.8 : position === "DF" ? 0.5 : position === "MF" ? 0.4 : 0.3;
    const importance = clamp(2 + share * 5 + goals * 0.3 + assists * 0.25 + posBoost, 0, 10);
    out.push({
      id: String(p.id || ""),
      name: p.displayName || p.fullName,
      position,
      status,
      importance,
      rating: +ratingProxy.toFixed(2),
      minutes: games * 90,
      minutesShare: share,
      goals,
      assists,
      form: +ratingProxy.toFixed(2),
      age: p.age ?? null,
      note: injuries[0]?.detail || injuries[0]?.description || null,
    });
  }
  return out;
}

export function parseSummaryBox(data = {}) {
  const out = {};
  for (const t of data.boxscore?.teams || []) {
    const id = String(t.team?.id || "");
    if (!id) continue;
    const s = statMap(t.statistics);
    const shots = Number(s.totalShots) || 0;
    const sot = Number(s.shotsOnTarget) || 0;
    out[id] = {
      shots,
      shotsOnTarget: sot,
      possession: Number(s.possessionPct) || 50,
      passPct: s.passPct !== undefined ? Number(s.passPct) : null,
      corners: Number(s.wonCorners) || 0,
      yellow: Number(s.yellowCards) || 0,
      red: Number(s.redCards) || 0,
      saves: Number(s.saves) || 0,
      fouls: Number(s.foulsCommitted) || 0,
      tackles: Number(s.totalTackles) || 0,
      interceptions: Number(s.interceptions) || 0,
    };
  }
  return out;
}

export function parseSummaryRoster(data = {}, teamId) {
  for (const r of data.rosters || []) {
    if (String(r.team?.id) !== String(teamId)) continue;
    const roster = r.roster || [];
    const starters = roster.filter((p) => p.starter).map((p) => String(p.athlete?.id)).filter(Boolean);
    const squad = roster.map((p) => String(p.athlete?.id)).filter(Boolean);
    return { starters, squad, formation: r.formation || null };
  }
  return { starters: [], squad: [], formation: null };
}

function americanToDecimal(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const n = Number(raw.replace("+", ""));
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? +(1 + n / 100).toFixed(3) : +(1 + 100 / Math.abs(n)).toFixed(3);
}

export function parseOdds(source) {
  const list = Array.isArray(source) ? source : source?.odds || [];
  for (const o of list) {
    const ml = o?.moneyline;
    const home = americanToDecimal(ml?.home?.close?.odds ?? ml?.home?.open?.odds ?? o?.homeTeamOdds?.moneyLine);
    const draw = americanToDecimal(ml?.draw?.close?.odds ?? ml?.draw?.open?.odds ?? o?.drawOdds?.moneyLine);
    const away = americanToDecimal(ml?.away?.close?.odds ?? ml?.away?.open?.odds ?? o?.awayTeamOdds?.moneyLine);
    if (home && draw && away) return { home, draw, away, provider: o.provider?.name || null, overUnder: o.overUnder ?? null };
  }
  return null;
}

export function matchMonth(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}