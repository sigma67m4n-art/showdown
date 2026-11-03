const $ = (id) => document.getElementById(id);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SPRITE_COLS = 7;
const SPRITE_FRAMES = 45;
const SPRITE_STEP = 66.66666666666667;
const ON_BG = "https://cdn.fcmobileforum.com/card-art/proto_PLAYERS_S2:44/playercardui_fcm25_showdown_B_FCM25_SHOWDOWNON_STATIC";
const ON_SPRITE = "https://cdn.fcmobileforum.com/card-art/proto_PLAYERS_S2:44/playercardui_fcm25_showdown_B_FCM25_SHOWDOWNON_LOOP";

const TZO = -new Date().getTimezoneOffset() / 60;
const TZS = "GMT" + (TZO >= 0 ? "+" : "") + (TZO % 1 ? TZO.toFixed(1) : TZO);

const fmtDay = (iso) => {
  const d = new Date(iso);
  return `${MON[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
};
const fmtKick = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${MON[d.getMonth()]} ${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())} ${TZS}`;
};

const LAYOUT = {
  ovr: { posX: 36, posY: 4, sizeX: 80, sizeY: 80, fontSize: 36 },
  pos: { posX: 56, posY: 64, sizeX: 40, sizeY: 20, fontSize: 24 },
  name: { posX: 128, posY: 178, sizeX: 140, sizeY: 28, originX: 0.5, originY: 0.5, fontSize: 22 },
  flag: { posX: 64, posY: 188, sizeX: 24, sizeY: 24 },
  league: { posX: 116, posY: 188, sizeX: 24, sizeY: 24 },
  club: { posX: 168, posY: 188, sizeX: 24, sizeY: 24 }
};

const leftTop = (el, a) => ({
  left: (el.posX - (el.originX || 0) * el.sizeX) * a,
  top: (el.posY - (el.originY || 0) * el.sizeY) * a
});

const framePos = (f) => {
  const n = ((f % SPRITE_FRAMES) + SPRITE_FRAMES) % SPRITE_FRAMES;
  return { x: (n % SPRITE_COLS) * 256, y: 256 * Math.floor(n / SPRITE_COLS) };
};

const loadImg = (src) => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error("load failed"));
  i.src = src;
});

const emblem = (p) => ({
  flag: p.countryId != null ? `https://cdn.fcmobileforum.com/emblems/nation/Nation_${p.countryId}.png` : p.flag,
  league: p.leagueId != null ? `https://cdn.fcmobileforum.com/emblems/league/League_${p.leagueId}.png` : p.leagueLogo,
  club: p.clubId != null ? `https://cdn.fcmobileforum.com/emblems/club/Club_${p.clubId}.png` : p.clubLogo
});

const mkLabel = (el, a, text, cls) => {
  const d = document.createElement("div");
  d.className = `fcmc-lbl ${cls}`;
  const lt = leftTop(el, a);
  d.style.left = lt.left + "px";
  d.style.top = lt.top + "px";
  d.style.width = el.sizeX * a + "px";
  d.style.height = el.sizeY * a + "px";
  d.style.fontSize = el.fontSize * a + "px";
  d.textContent = text;
  return d;
};

const mkIcon = (el, a, src) => {
  const i = document.createElement("img");
  i.className = "fcmc-ic";
  i.alt = "";
  i.draggable = false;
  const lt = leftTop(el, a);
  i.style.left = lt.left + "px";
  i.style.top = lt.top + "px";
  i.style.width = el.sizeX * a + "px";
  i.style.height = el.sizeY * a + "px";
  if (src) i.src = src;
  return i;
};

const fitName = (span, boxW, baseFs, a) => {
  span.style.transform = "scaleX(1)";
  span.style.fontSize = baseFs + "px";
  const t = span.offsetWidth;
  if (!t || t <= boxW) return;
  const l = Math.max(0.55, boxW / t);
  const i = t * l;
  let s = baseFs;
  if (i > boxW) s = Math.max(12 * a, Math.floor(boxW / i * baseFs * 2) / 2);
  span.style.fontSize = s + "px";
  span.style.transform = `scaleX(${l})`;
};

const buildCard = (p, a, on) => {
  const O = Math.round(256 * a);
  const bgSrc = on ? ON_BG : p.cardBg;
  const spriteSrc = on ? ON_SPRITE : p.cardSprite;
  const root = document.createElement("div");
  root.className = "fcmc";
  root.style.width = O + "px";
  root.style.height = O + "px";
  root.style.borderRadius = 8 * a + "px";

  if (bgSrc) {
    const bg = document.createElement("img");
    bg.className = "fcmc-bg";
    bg.alt = "";
    bg.draggable = false;
    bg.src = bgSrc;
    root.appendChild(bg);
  } else {
    const g = document.createElement("div");
    g.className = "fcmc-grad";
    root.appendChild(g);
  }

  let sprite = null;
  if (spriteSrc) {
    sprite = document.createElement("div");
    sprite.className = "fcmc-sprite";
    sprite.style.backgroundImage = `url("${spriteSrc}")`;
    sprite.style.backgroundSize = `${7 * O}px ${7 * O}px`;
    sprite.style.backgroundPosition = "0px 0px";
    root.appendChild(sprite);
  }

  if (p.cardImg) {
    const pw = document.createElement("div");
    pw.className = "fcmc-pic";
    pw.style.left = "0px";
    pw.style.top = "0px";
    pw.style.width = 256 * a + "px";
    pw.style.height = 256 * a + "px";
    const pi = document.createElement("img");
    pi.alt = "";
    pi.draggable = false;
    pi.src = p.cardImg;
    pw.appendChild(pi);
    root.appendChild(pw);
  }

  root.appendChild(mkLabel(LAYOUT.ovr, a, p.rating, "fcmc-ovr"));
  root.appendChild(mkLabel(LAYOUT.pos, a, p.position, ""));

  const nb = document.createElement("div");
  nb.className = "fcmc-name";
  const nlt = leftTop(LAYOUT.name, a);
  nb.style.left = nlt.left + "px";
  nb.style.top = nlt.top + "px";
  nb.style.width = LAYOUT.name.sizeX * a + "px";
  nb.style.height = LAYOUT.name.sizeY * a + "px";
  const span = document.createElement("span");
  span.textContent = String(p.cardName || "").toUpperCase();
  nb.appendChild(span);
  root.appendChild(nb);
  const doFit = () => fitName(span, LAYOUT.name.sizeX * a, LAYOUT.name.fontSize * a, a);
  doFit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(doFit);

  const em = emblem(p);
  root.appendChild(mkIcon(LAYOUT.flag, a, em.flag));
  root.appendChild(mkIcon(LAYOUT.league, a, em.league));
  root.appendChild(mkIcon(LAYOUT.club, a, em.club));

  if (sprite) {
    Promise.all([loadImg(spriteSrc), bgSrc ? loadImg(bgSrc) : Promise.resolve()]).then(() => {
      sprite.style.opacity = "1";
      let frame = 0;
      let last = 0;
      let visible = true;
      if (typeof IntersectionObserver !== "undefined") {
        new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(sprite);
      }
      const step = (t) => {
        if (!last) last = t;
        const d = t - last;
        if (d >= SPRITE_STEP) {
          last = t - (d % SPRITE_STEP);
          if (visible) {
            frame = (frame + 1) % SPRITE_FRAMES;
            const fp = framePos(frame);
            sprite.style.backgroundPosition = `-${Math.round(fp.x / 256 * O)}px -${Math.round(fp.y / 256 * O)}px`;
          }
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }).catch(() => {});
  }

  return root;
};

const ACCENTS = {
  GREEN: { fill: "#1F6B3A", on: "#FFFFFF", hi: "#C3EDCE" },
  BLUE: { fill: "#1F4F8F", on: "#FFFFFF", hi: "#C4D8F5" },
  RED: { fill: "#A3312B", on: "#FFFFFF", hi: "#F6C9C4" },
  ORANGE: { fill: "#B4561D", on: "#FFFFFF", hi: "#F7D4BC" },
  PURPLE: { fill: "#5B3A9A", on: "#FFFFFF", hi: "#DDCFF5" },
  MONO: { fill: "#F2F2F2", on: "#0A0A0A", hi: "#F2F2F2" }
};
const NAMED = {
  "tijjani noslin": ACCENTS.BLUE,
  "nabil bentaleb": ACCENTS.RED,
  "mahdi camara": ACCENTS.ORANGE,
  "lorenzo lucca": ACCENTS.GREEN
};
const KEYS = ["GREEN", "BLUE", "RED", "ORANGE", "PURPLE", "MONO"];
const accentFor = (name) => {
  const k = (name || "").toLowerCase().trim();
  if (NAMED[k]) return NAMED[k];
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return ACCENTS[KEYS[h % KEYS.length]];
};

const ICON_SVG = {
  swap_horiz: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.99 11 3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/></svg>',
  schedule: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>',
  arrow_outward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  emoji_events: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>'
};

let iconsSettled = false;
const fixIcons = (root) => {
  if (!iconsSettled) return;
  if (document.fonts && document.fonts.check('18px "Material Symbols Outlined"')) return;
  root.querySelectorAll(".ms[data-ic]").forEach((el) => {
    const svg = ICON_SVG[el.dataset.ic];
    if (!svg) return;
    el.classList.add("ms-svg");
    el.innerHTML = svg;
    el.removeAttribute("data-ic");
  });
};
const settleIcons = () => {
  if (iconsSettled) return;
  iconsSettled = true;
  fixIcons(document);
};
if (document.fonts && document.fonts.ready) document.fonts.ready.then(settleIcons);
window.addEventListener("load", settleIcons);
setTimeout(settleIcons, 2500);

const fitCard = (host, make) => {
  let lastW = -1;
  const build = () => {
    const w = host.clientWidth;
    if (!w || w === lastW) return;
    lastW = w;
    const a = Math.min(1, Math.max(0.42, w / 256));
    host.innerHTML = "";
    const fit = document.createElement("div");
    fit.className = "cardfit";
    fit.appendChild(make(a));
    host.appendChild(fit);
  };
  build();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(build).observe(host);
  else window.addEventListener("resize", build);
};

const matchupBlock = (m) => {
  const homeWin = m.home.p > m.away.p;
  const awayWin = m.away.p > m.home.p;
  const winner = homeWin ? m.home.player : awayWin ? m.away.player : null;
  const homeAcc = accentFor(m.home.player.name);
  const awayAcc = accentFor(m.away.player.name);
  const acc = winner ? (homeWin ? homeAcc : awayAcc) : ACCENTS.MONO;

  const side = (pl, key, win) => {
    const div = document.createElement("div");
    div.className = `mside ${key}`;
    const box = document.createElement("div");
    box.className = "cardbox";
    div.appendChild(box);
    const info = document.createElement("div");
    info.className = "minfo";
    info.innerHTML = `
      <div class="n">${pl.name}${win ? `<span class="wtag"><span class="ms" data-ic="emoji_events">emoji_events</span>WINNER</span>` : ""}</div>
      <div class="c">${pl.clubLogo ? `<img src="${pl.clubLogo}" alt="">` : ""}${pl.club || "unknown club"}</div>`;
    div.appendChild(info);
    fitCard(box, (a) => buildCard(pl, a, win));
    return div;
  };

  const el = document.createElement("div");
  el.className = "mcard";
  el.style.setProperty("--af", acc.fill);
  el.style.setProperty("--ao", acc.on);
  el.style.setProperty("--ah", acc.hi);
  el.innerHTML = `
    <div class="mhead">
      <span class="kick"><span class="ms" data-ic="schedule">schedule</span>${fmtKick(m.date)}</span>
      <span>${m.league} ${m.round}</span>
    </div>
    <div class="mtop"></div>
    <div class="bars">
      <div class="brow"><div class="lbl">${m.home.player.club || m.home.player.name}</div><div class="track"><div class="fill"></div></div><div class="pct">${(m.home.p * 100).toFixed(1)}%</div></div>
      <div class="brow"><div class="lbl">Draw</div><div class="track"><div class="fill"></div></div><div class="pct">${(m.draw * 100).toFixed(1)}%</div></div>
      <div class="brow"><div class="lbl">${m.away.player.club || m.away.player.name}</div><div class="track"><div class="fill"></div></div><div class="pct">${(m.away.p * 100).toFixed(1)}%</div></div>
    </div>
    <div class="mfoot">
      <div class="winline">${winner ? `<b>${winner.name}</b> ${winner.club} to win` : "Draw looks most likely"}</div>
    </div>`;
  const mtop = el.querySelector(".mtop");
  mtop.appendChild(side(m.home.player, "home", homeWin));
  const mid = document.createElement("div");
  mid.className = "mid";
  mid.innerHTML = `<span class="ms" data-ic="swap_horiz">swap_horiz</span>`;
  mtop.appendChild(mid);
  mtop.appendChild(side(m.away.player, "away", awayWin));
  const fills = el.querySelectorAll(".fill");
  fills[0].style.background = homeAcc.fill;
  fills[0].style.width = (m.home.p * 100).toFixed(1) + "%";
  fills[1].style.background = "var(--muted)";
  fills[1].style.width = (m.draw * 100).toFixed(1) + "%";
  fills[2].style.background = awayAcc.fill;
  fills[2].style.width = (m.away.p * 100).toFixed(1) + "%";
  fixIcons(el);
  return el;
};

const render = async () => {
  let d;
  try {
    d = await (await fetch("/api/data")).json();
  } catch (e) {
    $("matches").innerHTML = `<div class="none">Failed to load data: ${e.message}</div>`;
    return;
  }

  const updated = d.players.reduce((mx, p) => (p.created > mx ? p.created : mx), d.players[0] ? d.players[0].created : "");
  $("meta").innerHTML = updated ? `<span class="chip">Updated ${fmtDay(updated)} (card added)</span>` : "";

  const mc = $("matches");
  mc.innerHTML = "";
  if (!d.matches.length) {
    mc.innerHTML = `<div class="none">No head-to-head fixtures found within the 11-day window</div>`;
  } else {
    d.matches.forEach((m) => mc.appendChild(matchupBlock(m)));
  }
  fixIcons(mc);
};

document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("dragstart", (e) => e.preventDefault());

render();
