import { WEIGHTS } from "./config.js";
import { clamp } from "./util.js";

const S = (v) => clamp(v, -1, 1);
const scale = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);
const sys = (r, key) => S(r[key] ?? 0);

function mk(id, label, weight, home, away, note, available = true) {
  return {
    id,
    label,
    weight,
    home: { attack: S(home?.attack ?? 0), defense: S(home?.defense ?? 0) },
    away: { attack: S(away?.attack ?? 0), defense: S(away?.defense ?? 0) },
    note,
    available,
  };
}

function h2hRecord(team) {
  const matches = team.h2h || [];
  if (!matches.length) return null;
  const sorted = [...matches].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 8);
  let w = 0, d = 0, l = 0, weightSum = 0, score = 0;
  sorted.forEach((m, i) => {
    const weight = Math.pow(0.82, i);
    weightSum += weight;
    if (m.result === "W") { w++; score += weight; }
    else if (m.result === "D") { d++; score += 0.45 * weight; }
    else l++;
  });
  return { w, d, l, winRate: weightSum ? score / weightSum : 0.4, n: sorted.length };
}

export function buildFactors(input, homeR, awayR) {
  const { home, away, match, context, league } = input;
  const W = WEIGHTS.factorWeights;
  const factors = [];

  const formSig = (r) => S(((r.form.ppg - 1.35) / 1.1) * 0.65 + (r.form.trend || 0) * 0.35);
  factors.push(mk("form", "Recent form", W.form,
    { attack: formSig(homeR) * 0.9, defense: formSig(homeR) * 0.45 },
    { attack: formSig(awayR) * 0.9, defense: formSig(awayR) * 0.45 },
    `PPG ${homeR.form.ppg.toFixed(2)} vs ${awayR.form.ppg.toFixed(2)}; trend ${homeR.form.trend >= 0 ? "+" : ""}${homeR.form.trend.toFixed(2)} vs ${awayR.form.trend >= 0 ? "+" : ""}${awayR.form.trend.toFixed(2)}`));

  const avail = (r) => ({
    attack: r.availability.known ? S(r.availability.attack * 3.2) : 0,
    defense: r.availability.known ? S(r.availability.defense * 3.2) : 0,
  });
  const missingNote = (r) => {
    if (!r.availability.known) return `${r.name}: player data unavailable`;
    const miss = r.availability.missing.map((p) => `${p.name} (${p.status})`).join(", ");
    const doubt = r.availability.doubtful.map((p) => `${p.name} (${p.status})`).join(", ");
    return [miss ? `Out: ${miss}` : "No players out", doubt ? `Doubtful: ${doubt}` : ""].filter(Boolean).join(" | ");
  };
  factors.push(mk("availability", "Squad availability (injuries/suspensions)", W.availability,
    avail(homeR), avail(awayR), `${missingNote(homeR)} || ${missingNote(awayR)}`,
    homeR.availability.known || awayR.availability.known));

  const fatigueSig = (r) => {
    const c = r.condition;
    const sc = r.schedule;
    const fatigue = scale(c.fatigue, 2, 10) * 0.65;
    const rest = sc.daysSinceLastMatch !== null && sc.daysSinceLastMatch < 3 ? 0.4
      : sc.daysSinceLastMatch !== null && sc.daysSinceLastMatch < 4 ? 0.18 : 0;
    const congestion = Math.max(0, sc.matchesLast14Days - 3) * 0.12 + Math.max(0, sc.matchesLast7Days - 2) * 0.15;
    const et = sc.extraTimeLastMatch ? 0.18 : 0;
    return -S(fatigue + rest + congestion + et);
  };
  const fatH = fatigueSig(homeR);
  const fatA = fatigueSig(awayR);
  factors.push(mk("fatigue", "Fatigue & rest", W.fatigue,
    { attack: fatH, defense: fatH * 0.8 }, { attack: fatA, defense: fatA * 0.8 },
    `Rest ${homeR.schedule.daysSinceLastMatch ?? "?"} vs ${awayR.schedule.daysSinceLastMatch ?? "?"} days; ${homeR.schedule.matchesLast14Days} vs ${awayR.schedule.matchesLast14Days} matches/14 days`));

  const kickoffSig = (r) => {
    const h = r.schedule.restHours;
    if (h === null || h === undefined || !Number.isFinite(h)) return 0;
    if (h < 44) return -0.5;
    if (h < 56) return -0.34;
    if (h < 68) return -0.18;
    if (h < 78) return -0.08;
    return 0;
  };
  const kh = kickoffSig(homeR), ka = kickoffSig(awayR);
  if (kh || ka) {
    const fmt = (h) => (h === null || h === undefined || !Number.isFinite(h) ? "?" : `${h}h`);
    factors.push(mk("kickoff", "Kickoff timing / recovery window", W.kickoff,
      { attack: kh, defense: kh * 0.8 }, { attack: ka, defense: ka * 0.8 },
      `Recovery window ${fmt(homeR.schedule.restHours)} vs ${fmt(awayR.schedule.restHours)} since last match`));
  }

  const travelSig = (r) => -S((r.schedule.travelKm || 0) / 1600) * 0.85;
  factors.push(mk("travel", "Travel & jet lag", W.travel,
    { attack: travelSig(homeR), defense: travelSig(homeR) * 0.5 },
    { attack: travelSig(awayR), defense: travelSig(awayR) * 0.5 },
    `Travel ${homeR.schedule.travelKm || 0} km vs ${awayR.schedule.travelKm || 0} km`));

  const moraleSig = (r) => S(((r.condition.morale - 5) / 5) * 0.6 + ((r.condition.confidence - 5.5) / 4.5) * 0.4);
  const mh = moraleSig(homeR), ma = moraleSig(awayR);
  factors.push(mk("morale", "Morale & confidence", W.morale,
    { attack: mh * 0.8, defense: mh * 0.5 }, { attack: ma * 0.8, defense: ma * 0.5 },
    `Morale ${homeR.condition.morale}/10 vs ${awayR.condition.morale}/10`));

  const cohSig = (r) => S(((r.condition.lineupContinuity - 0.7) / 0.3) * 0.55 + ((r.condition.cohesion - 5) / 5) * 0.45);
  const ch = cohSig(homeR), ca = cohSig(awayR);
  factors.push(mk("cohesion", "Cohesion & lineup stability", W.cohesion,
    { attack: ch, defense: ch }, { attack: ca, defense: ca },
    `Continuity ${Math.round(homeR.condition.lineupContinuity * 100)}% vs ${Math.round(awayR.condition.lineupContinuity * 100)}%`));

  const mgrSig = (r) => {
    const d = r.condition.managerChangeDays;
    if (d === null || d === undefined) return 0;
    if (d <= 7) return -0.45;
    if (d <= 21) return -0.3;
    if (d <= 45) return -0.12;
    return 0;
  };
  const mgh = mgrSig(homeR), mga = mgrSig(awayR);
  if (mgh || mga) {
    factors.push(mk("manager", "Manager change", W.manager,
      { attack: mgh, defense: mgh }, { attack: mga, defense: mga },
      `New manager: ${home.condition.managerChangeDays ?? "-"} vs ${away.condition.managerChangeDays ?? "-"} days`));
  }

  const motSig = (r) => {
    const m = r.motivation;
    let s = ((m.stakes ?? 5) - 5) / 5 * 0.55;
    if (m.mustWin) s += 0.22;
    if (m.titleRace) s += 0.15;
    if (m.relegationBattle) s += 0.18;
    if (r.condition.pressure > 6 && r.condition.confidence < 5) s -= 0.28;
    return S(s);
  };
  const mth = motSig(homeR), mta = motSig(awayR);
  factors.push(mk("motivation", "Motivation & pressure", W.motivation,
    { attack: mth, defense: mth * 0.3 }, { attack: mta, defense: mta * 0.3 },
    `Stakes ${homeR.motivation.stakes}/10 vs ${awayR.motivation.stakes}/10`));

  const hh = h2hRecord(home);
  const ha = h2hRecord(away);
  if (hh || ha) {
    const sh = hh ? S((hh.winRate - 0.4) * 1.2) : 0;
    const sa = ha ? S((ha.winRate - 0.4) * 1.2) : 0;
    const rec = (x) => (x ? `${x.w}W-${x.d}D-${x.l}L` : "-");
    factors.push(mk("h2h", "Head to head", W.h2h,
      { attack: sh * 0.45, defense: sh * 0.3 }, { attack: sa * 0.45, defense: sa * 0.3 },
      `H2H record ${rec(hh)} vs ${rec(ha)} (recency-weighted)`));
  }

  const c = context.crowd || {};
  const fill = c.attendance && c.capacity ? clamp(c.attendance / c.capacity, 0, 1.2) : null;
  if (fill !== null && !match.neutral) {
    const crowdSig = S(((fill - 0.7) / 0.3) * 0.5);
    factors.push(mk("crowd", "Crowd & home pressure", W.crowd,
      { attack: crowdSig, defense: crowdSig * 0.4 },
      { attack: -crowdSig * 0.45, defense: -crowdSig * 0.2 },
      `Attendance ${Math.round(fill * 100)}% (${c.attendance}/${c.capacity})`));
  }

  const w = context.weather || {};
  let weatherSig = 0;
  if (w.rainMm > 10) weatherSig -= 0.55;
  else if (w.rainMm > 3) weatherSig -= 0.28;
  if (w.windKph > 35) weatherSig -= 0.4;
  else if (w.windKph > 20) weatherSig -= 0.15;
  if (w.tempC > 34) weatherSig -= 0.2;
  else if (w.tempC < 0) weatherSig -= 0.12;
  if (["storm", "snow", "heavy-rain"].includes(w.condition)) weatherSig -= 0.25;
  if (w.condition === "fog") weatherSig -= 0.2;
  if (weatherSig) {
    factors.push(mk("weather", "Weather", W.weather,
      { attack: S(weatherSig), defense: 0 }, { attack: S(weatherSig), defense: 0 },
      `${w.condition}, ${w.tempC}°C, rain ${w.rainMm}mm, wind ${w.windKph}kph`));
  }

  const q = context.pitch?.quality ?? 8;
  if (q < 8) {
    const pitchSig = S(-((8 - q) / 8) * 0.7);
    factors.push(mk("pitch", "Pitch quality", W.pitch,
      { attack: pitchSig, defense: 0 }, { attack: pitchSig, defense: 0 },
      `Pitch quality ${q}/10 (${context.pitch?.widthM ?? "-"}x${context.pitch?.lengthM ?? "-"} m)`));
  }

  const ref = context.referee || {};
  const penSig = S(((ref.penaltyRate ?? 0.25) - 0.25) * 0.8);
  const strictSig = S(((ref.strictness ?? 5) - 5) / 5 * 0.15);
  if (penSig || strictSig) {
    factors.push(mk("referee", "Referee", W.referee,
      { attack: penSig, defense: -strictSig }, { attack: penSig, defense: -strictSig },
      `Penalties/match ${ref.penaltyRate ?? 0.25}, strictness ${ref.strictness ?? 5}/10`));
  }

  const alt = match.altitudeM || 0;
  if (alt >= 1200) {
    const altSig = clamp((alt - 1200) / 2000, 0, 1);
    factors.push(mk("altitude", "Altitude", W.altitude,
      { attack: altSig * 0.25, defense: altSig * 0.1 },
      { attack: -altSig * 0.35, defense: -altSig * 0.12 },
      `Venue at ${alt} m above sea level`));
  }

  const styleAtk = (att, def) => S(
    ((att.style.counterAttack - 5) / 5) * ((def.style.possession - 50) / 50) * 0.55 +
    ((def.style.pressIntensity - 5) / 5) * (-((att.style.possession - 50) / 50)) * 0.25 +
    ((att.style.directness - 5) / 5) * ((def.style.pressIntensity - 5) / 5) * 0.2
  );
  const sh2 = styleAtk(home, away);
  const sa2 = styleAtk(away, home);
  if (sh2 || sa2) {
    factors.push(mk("style", "Style matchup", W.style,
      { attack: sh2, defense: 0 }, { attack: sa2, defense: 0 },
      `Possession ${home.style.possession}% vs ${away.style.possession}%; press ${home.style.pressIntensity} vs ${away.style.pressIntensity}`));
  }

  const gkSig = (t) => S(((t.goalkeeper.quality - 6.8) / 2) * 0.8 + ((t.goalkeeper.savePct ?? 0.7) - 0.7) * 1.5);
  const gh = gkSig(home), ga = gkSig(away);
  factors.push(mk("goalkeeper", "Goalkeeper quality", W.goalkeeper,
    { attack: 0, defense: gh }, { attack: 0, defense: ga },
    `GK rating ${home.goalkeeper.quality.toFixed(1)} vs ${away.goalkeeper.quality.toFixed(1)}`));

  const spSig = (t) => S(((t.style.setPieceStrength - 5) / 5) * 0.55);
  factors.push(mk("setPiece", "Set pieces", W.setPiece,
    { attack: spSig(home), defense: spSig(home) * 0.25 },
    { attack: spSig(away), defense: spSig(away) * 0.25 },
    `Set pieces ${home.style.setPieceStrength}/10 vs ${away.style.setPieceStrength}/10`));

  const disSig = (t) => S(((t.style.discipline - 5) / 5) * 0.35);
  factors.push(mk("discipline", "Discipline & card risk", W.discipline,
    { attack: 0, defense: disSig(home) }, { attack: 0, defense: disSig(away) },
    `Discipline ${home.style.discipline}/10 vs ${away.style.discipline}/10`));

  const rotSig = (r) => {
    const s = r.schedule;
    let v = 0;
    if (s.nextMatchDays !== null && s.nextMatchDays <= 2 && s.nextMatchImportance >= 7) v -= 0.45;
    else if (s.nextMatchDays !== null && s.nextMatchDays <= 3 && s.nextMatchImportance >= 7) v -= 0.25;
    if (s.continentalMidweek) v -= 0.15;
    return S(v);
  };
  const rh = rotSig(homeR), ra = rotSig(awayR);
  if (rh || ra) {
    factors.push(mk("rotation", "Rotation & upcoming fixture", W.rotation,
      { attack: rh, defense: rh * 0.5 }, { attack: ra, defense: ra * 0.5 },
      `Next match in ${homeR.schedule.nextMatchDays ?? "?"} vs ${awayR.schedule.nextMatchDays ?? "?"} days`));
  }

  if (match.isDerby) {
    factors.push(mk("derby", "Derby / rivalry", W.derby,
      { attack: -0.12, defense: -0.06 }, { attack: -0.12, defense: -0.06 },
      "Derbies tend to be tighter with more cards"));
  }

  const extras = [
    ...(home.extraFactors || []).map((e) => ({ ...e, side: "home" })),
    ...(away.extraFactors || []).map((e) => ({ ...e, side: "away" })),
  ].slice(0, 8);
  extras.forEach((e, i) => {
    const weight = clamp(Number(e.weight ?? 0.15), 0, 1);
    const homeImpact = e.homeImpact ?? (e.side === "home" ? e.impact ?? e.attack ?? 0 : 0);
    const awayImpact = e.awayImpact ?? (e.side === "away" ? e.impact ?? e.attack ?? 0 : 0);
    factors.push(mk(
      `extra:${e.name || i + 1}`,
      `Custom factor: ${e.name || i + 1}`,
      weight,
      { attack: homeImpact, defense: e.homeDefense ?? 0 },
      { attack: awayImpact, defense: e.awayDefense ?? 0 },
      e.note || "User-provided custom factor"
    ));
  });

  return factors.filter((f) => f.available);
}

export function aggregateFactors(factors, scale = WEIGHTS.factorScale) {
  const acc = { home: { attack: 0, defense: 0 }, away: { attack: 0, defense: 0 } };
  const detail = [];
  for (const f of factors) {
    const raw = {
      home: { attack: f.home.attack * f.weight, defense: f.home.defense * f.weight },
      away: { attack: f.away.attack * f.weight, defense: f.away.defense * f.weight },
    };
    const scaled = {
      home: { attack: raw.home.attack * scale, defense: raw.home.defense * scale },
      away: { attack: raw.away.attack * scale, defense: raw.away.defense * scale },
    };
    for (const side of ["home", "away"]) {
      acc[side].attack += scaled[side].attack;
      acc[side].defense += scaled[side].defense;
    }
    detail.push({ ...f, contribution: scaled });
  }
  const cap = WEIGHTS.maxFactorLog;
  const capped = {
    home: { attack: clamp(acc.home.attack, -cap, cap), defense: clamp(acc.home.defense, -cap, cap) },
    away: { attack: clamp(acc.away.attack, -cap, cap), defense: clamp(acc.away.defense, -cap, cap) },
  };
  return { totals: capped, detail, scale };
}
