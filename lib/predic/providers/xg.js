import { getText } from "../http.js";
import { normalizeName } from "../util.js";

const BASE = "https://www.football-data.co.uk/mmz4281";
const TTL = 21600;

export const DIVISIONS = {
  "eng.1": "E0",
  "esp.1": "SP1",
  "ger.1": "D1",
  "ita.1": "I1",
  "fra.1": "F1",
  "ned.1": "N1",
  "por.1": "P1",
  "tur.1": "T1",
  "bel.1": "B1",
  "sco.1": "SC0",
  "gre.1": "G1",
};

const CLUB_TOKENS = new Set([
  "fc", "cf", "ac", "sc", "ss", "ssc", "as", "afc", "rc", "ogc", "osc", "estac",
  "aj", "sv", "bv", "vfb", "vfl", "tsv", "tsg", "bsc", "sc", "if", "ff", "bk", "fk",
  "ca", "cd", "ud", "sd", "us", "cp", "cs", "de", "the", "club", "calcio",
  "olympique", "stade", "1",
]);

const ALIAS_GROUPS = [
  ["rennes", "rennais"],
  ["inter", "internazionale", "intermilan", "intermilano"],
  ["verona", "hellasverona"],
  ["parissg", "parissaintgermain", "psg", "parissaintgermain"],
  ["milan", "acmilan"],
  ["roma", "asroma"],
  ["lazio", "sslazio"],
  ["napoli", "sscnapoli"],
  ["paris", "parisfc"],
  ["brest", "brestois", "stadebrestois"],
  ["lyon", "lyonnais", "olympiquelyonnais"],
  ["marseille", "olympiquemarseille"],
  ["troyes", "estactroyes"],
  ["strasbourg", "strasbourgalsace"],
  ["reims", "stadereims"],
  ["nantes", "fcnantes"],
  ["nice", "ogcnice"],
  ["lens", "rclens"],
  ["monaco", "asmonaco"],
  ["lille", "lilleosc"],
  ["angers", "angerssco"],
  ["lemans", "lemansfc"],
  ["dortmund", "borussiadortmund"],
  ["munich", "bayernmunich", "bayern", "bayernmunchen"],
  ["leverkusen", "bayerleverkusen"],
  ["monchengladbach", "gladbach", "borussiamonchengladbach", "mgladbach"],
  ["frankfurt", "eintrachtfrankfurt", "einfrankfurt"],
  ["wolfsburg", "vflwolfsburg"],
  ["koln", "fckoln", "cologne"],
  ["hoffenheim", "tsghoffenheim"],
  ["mainz", "mainz05"],
  ["stuttgart", "vfbstuttgart"],
  ["unionberlin", "fcunionberlin", "1fcunionberlin"],
  ["freiburg", "scfreiburg"],
  ["hamburg", "hamburger", "hamburgersv"],
  ["mancity", "manchestercity"],
  ["manunited", "manchesterunited", "manutd"],
  ["newcastle", "newcastleunited"],
  ["tottenham", "tottenhamhotspur", "spurs"],
  ["wolves", "wolverhampton", "wolverhamptonwanderers"],
  ["brighton", "brightonhovealbion", "brightonandhovealbion"],
  ["leeds", "leedsunited"],
  ["leicester", "leicestercity"],
  ["norwich", "norwichcity"],
  ["ipswich", "ipswichtown"],
  ["luton", "lutontown"],
  ["sheffunited", "sheffieldunited"],
  ["nottmforest", "nottinghamforest", "forest"],
  ["athletic", "athleticclub", "athleticbilbao", "athbilbao"],
  ["atletico", "atleticomadrid", "athmadrid", "atlmadrid"],
  ["celta", "celtavigo"],
  ["santander", "racingsantander"],
  ["espanyol", "espanol"],
  ["betis", "realbetis"],
  ["sociedad", "realsociedad"],
  ["vallecano", "rayovallecano"],
];

const ALIAS = new Map();
for (const group of ALIAS_GROUPS) {
  const canonical = group[0];
  for (const variant of group) ALIAS.set(variant, canonical);
}

function tokens(name) {
  return normalizeName(name).split(" ").filter(Boolean);
}

function looseKey(name) {
  return tokens(name).filter((t) => !CLUB_TOKENS.has(t)).join("");
}

export function canonTeam(name) {
  const key = looseKey(name);
  return ALIAS.get(key) || key;
}

export function seasonCode(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const start = month >= 7 ? year : year - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

function toNum(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  const m = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0].split(",").map((s) => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cells[j] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

function addMatch(teams, name, match) {
  const key = canonTeam(name);
  let team = teams.get(key);
  if (!team) {
    team = {
      key,
      name,
      played: 0,
      xgPlayed: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      xgFor: 0,
      xgAgainst: 0,
      matches: [],
    };
    teams.set(key, team);
  }
  const result = match.goalsFor > match.goalsAgainst ? "W" : match.goalsFor === match.goalsAgainst ? "D" : "L";
  team.played++;
  team.goalsFor += match.goalsFor;
  team.goalsAgainst += match.goalsAgainst;
  if (match.xgFor !== null && match.xgAgainst !== null) {
    team.xgPlayed++;
    team.xgFor += match.xgFor;
    team.xgAgainst += match.xgAgainst;
  }
  team.matches.push({ ...match, result });
}

export function buildLeague(text) {
  const rows = parseCsv(text);
  const teams = new Map();
  for (const row of rows) {
    const home = row.HomeTeam;
    const away = row.AwayTeam;
    if (!home || !away) continue;
    const hg = toNum(row.FTHG);
    const ag = toNum(row.FTAG);
    if (hg === null || ag === null) continue;
    const hxg = toNum(row.HxG);
    const axg = toNum(row.AxG);
    const date = parseDate(row.Date);
    addMatch(teams, home, {
      date, opponent: away, venue: "home",
      goalsFor: hg, goalsAgainst: ag, xgFor: hxg, xgAgainst: axg,
    });
    addMatch(teams, away, {
      date, opponent: home, venue: "away",
      goalsFor: ag, goalsAgainst: hg, xgFor: axg, xgAgainst: hxg,
    });
  }
  for (const team of teams.values()) {
    team.matches.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  }
  return { teams };
}

export async function getLeagueXg(leagueSlug, date, opts = {}) {
  const division = DIVISIONS[leagueSlug];
  if (!division) return null;
  const code = seasonCode(date);
  const url = `${BASE}/${code}/${division}.csv`;
  try {
    const text = await getText(url, { ttl: TTL, refresh: opts.refresh });
    return buildLeague(text);
  } catch {
    return null;
  }
}

export function lookupTeam(league, name) {
  if (!league || !league.teams) return null;
  const target = canonTeam(name);
  if (league.teams.has(target)) return league.teams.get(target);
  if (target.length < 4) return null;
  let best = null;
  let bestScore = 0;
  for (const [key, team] of league.teams) {
    if (key.length < 4) continue;
    let score = 0;
    if (key.startsWith(target) || target.startsWith(key)) {
      score = Math.min(key.length, target.length) / Math.max(key.length, target.length);
    } else {
      const a = new Set(tokens(name).filter((t) => !CLUB_TOKENS.has(t)));
      const b = new Set(tokens(team.name).filter((t) => !CLUB_TOKENS.has(t)));
      let shared = 0;
      for (const t of a) if (b.has(t)) shared++;
      const union = new Set([...a, ...b]).size;
      if (union) score = (shared / union) * 0.9;
    }
    if (score > bestScore) {
      bestScore = score;
      best = team;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

function sumBy(items, fn) {
  return items.reduce((a, m) => a + (fn(m) ?? 0), 0);
}

export function seasonSplits(team) {
  if (!team || !team.matches.length) return null;
  const out = {};
  for (const venue of ["home", "away"]) {
    const games = team.matches.filter((m) => m.venue === venue);
    if (!games.length) continue;
    const withXg = games.filter((m) => m.xgFor !== null && m.xgAgainst !== null);
    const points = games.reduce((a, m) => a + (m.result === "W" ? 3 : m.result === "D" ? 1 : 0), 0);
    out[venue] = {
      played: games.length,
      goalsFor: sumBy(games, (m) => m.goalsFor),
      goalsAgainst: sumBy(games, (m) => m.goalsAgainst),
      xgFor: withXg.length === games.length ? sumBy(games, (m) => m.xgFor) : null,
      xgAgainst: withXg.length === games.length ? sumBy(games, (m) => m.xgAgainst) : null,
      wins: games.filter((m) => m.result === "W").length,
      draws: games.filter((m) => m.result === "D").length,
      losses: games.filter((m) => m.result === "L").length,
      points,
    };
  }
  return out;
}

export function matchXg(team, date, opponent) {
  if (!team || !team.matches.length || !date) return null;
  const day = String(date).slice(0, 10);
  const opp = canonTeam(opponent);
  for (const m of team.matches) {
    if (m.date !== day) continue;
    if (canonTeam(m.opponent) !== opp) continue;
    return { xgFor: m.xgFor, xgAgainst: m.xgAgainst };
  }
  return null;
}
