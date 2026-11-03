import { readFile } from "node:fs/promises";
import { buildMatchInput, InputError } from "./normalize.js";
import { predict } from "./engine.js";
import { buildReport, buildSimpleReport } from "./report.js";
import { buildRemoteInput } from "./remote.js";

const VERSION = "1.0.0";

const HELP = `predic ${VERSION} - football match predictor CLI (JSON)

Usage:
  predic --home "Arsenal" --away "Chelsea"
  predic --home "Real Madrid" --away "Barcelona" --neutral
  predic --home "Arsenal" --away "Chelsea" --odds "1.85,3.60,4.20"
  predic --home "Arsenal" --away "Chelsea" --date 2026-11-08 --time 20:45
  predic --home "Arsenal" --away "Chelsea" --data overlay.json
  predic --home "Arsenal" --away "Chelsea" --no-api --data local.json

Options:
  --home <club>        Home club (required unless local data provides it)
  --away <club>        Away club (required)
  --date <YYYY-MM-DD>  Match date (overrides the scheduled fixture date)
  --time <HH:MM>       Kickoff time in 24h format, e.g. 20:45
  --data <file>        JSON data overlay (xG, injuries, players, weather, odds, ...)
  --no-api             Offline mode, no API
  --fast               Skip match detail (real xG is still used)
  --full               Full detailed report (default is win/draw/away percentages only)
  --neutral            Neutral venue
  --odds "H,D,A"       Decimal odds for market calibration
  --refresh            Ignore cache
  --compact            Single-line JSON output
  --help               Help
  --version            Version

Output: JSON to stdout. By default only the home win / draw / away win percentages.
Use --full for the complete report. Errors: JSON { ok:false, error:{...} } to stdout.
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = (eq >= 0 ? arg.slice(2, eq) : arg.slice(2)).trim();
    if (eq >= 0) {
      out[key] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function parseOdds(value) {
  if (!value) return null;
  const parts = String(value).split(/[,;:/\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 1);
  if (parts.length !== 3) throw new InputError('Odds format must be "home,draw,away" (decimal), e.g. --odds "1.85,3.60,4.20"', "INVALID_ODDS");
  return { home: parts[0], draw: parts[1], away: parts[2] };
}

function parseDate(value) {
  if (value === undefined || value === null || value === true) return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new InputError("--date must be YYYY-MM-DD, e.g. --date 2026-11-08", "INVALID_DATE");
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new InputError(`--date "${s}" is not a valid calendar date.`, "INVALID_DATE");
  }
  return s;
}

function parseTime(value) {
  if (value === undefined || value === null || value === true) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) {
    throw new InputError("--time must be HH:MM in 24h format, e.g. --time 20:45", "INVALID_TIME");
  }
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) {
    throw new InputError(`--time "${s}" is out of range; use 00:00-23:59.`, "INVALID_TIME");
  }
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function applySchedule(input, date, time) {
  if (date) input.match.date = date;
  if (time) input.match.time = time;
  const base = date || input.match.date;
  if (date && time) input.match.kickoff = `${base}T${time}:00`;
  else if (date) input.match.kickoff = `${base}T00:00:00`;
  else if (time && base) {
    const current = input.match.kickoff;
    const day = current ? String(current).slice(0, 10) : base;
    input.match.kickoff = `${day}T${time}:00`;
  }
  return input;
}

export async function runCli(argv) {
  const started = performance.now();
  const args = parseArgs(argv);
  if (args.help || args.h) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(JSON.stringify({ ok: true, name: "predic", version: VERSION }) + "\n");
    return;
  }

  const homeName = args.home ?? args._[0];
  const awayName = args.away ?? args._[1];
  const dataPath = args.data;
  const date = parseDate(args.date);
  const time = parseTime(args.time);

  let overlay = null;
  let local = null;
  if (dataPath) {
    try {
      const txt = await readFile(dataPath, "utf8");
      const parsed = JSON.parse(txt);
      if (args["no-api"] || parsed.fixture || parsed.teams || (!parsed.home && !parsed.away)) local = parsed;
      else overlay = parsed;
    } catch (err) {
      throw new InputError(`Failed to read --data ${dataPath}: ${err.message}`, "DATA_READ_ERROR");
    }
  }

  if (args["no-api"] || !homeName || !awayName) {
    if (!local) {
      if (args["no-api"]) throw new InputError("--no-api mode requires --data containing match/team data.", "NO_LOCAL_DATA");
      throw new InputError('You must choose clubs: --home "Club Name" --away "Club Name".', "MISSING_TEAMS", 'Example: predic --home "Arsenal" --away "Chelsea"');
    }
    const input = buildMatchInput(local, { homeSelector: homeName, awaySelector: awayName });
    applySchedule(input, date, time);
    if (overlay) input.warnings = [...new Set([...(input.warnings || []), "The --data overlay is ignored because local data is already the primary source."])];
    return finish(input, args, started);
  }

  const opts = {
    refresh: Boolean(args.refresh),
    fast: Boolean(args.fast),
    neutral: Boolean(args.neutral),
    date,
    time,
  };
  const remote = await buildRemoteInput({ homeName, awayName, opts, overlay });
  if (args.odds) remote.market = parseOdds(args.odds);
  const input = buildMatchInput(remote);
  input.warnings = [...new Set([...(remote.warnings || []), ...(input.warnings || [])])];
  if (remote.meta) input.meta = remote.meta;
  return finish(input, args, started);
}

function finish(input, args, started) {
  const pred = predict(input);
  const full = Boolean(args.full || args.verbose || args.detailed);
  const report = full ? buildReport(input, pred) : buildSimpleReport(input, pred);
  if (full) {
    report.meta.elapsedMs = Math.round(performance.now() - started);
    if (input.meta) report.meta.source = input.meta;
  }
  const json = args.compact ? JSON.stringify(report) : JSON.stringify(report, null, 2);
  process.stdout.write(json + "\n");
}
