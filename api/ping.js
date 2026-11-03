const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FCF = "https://fcmobileforum.com/api/v1/program-players/programname_showdown25?limit=500&offset=0";
const BASE = "https://www.oddalerts.com";

export default async function handler(_req, res) {
  const out = { node: process.version, steps: {} };
  try {
    const r = await fetch(FCF, { headers: { "User-Agent": UA } });
    out.steps.fcfDirect = { status: r.status };
  } catch (e) {
    out.steps.fcfDirect = { err: String(e.message) };
  }
  try {
    const r = await fetch("https://r.jina.ai/" + FCF, { headers: { "User-Agent": UA } });
    const t = await r.text();
    const i = t.indexOf('{"players"');
    let n = null;
    if (i >= 0) {
      try {
        n = JSON.parse(t.slice(i)).players.length;
      } catch {}
    }
    out.steps.fcfJina = { status: r.status, len: t.length, players: n };
  } catch (e) {
    out.steps.fcfJina = { err: String(e.message) };
  }
  try {
    const r = await fetch(BASE + "/simulations/serie-a", { headers: { "User-Agent": UA } });
    const h = await r.text();
    const links = [...h.matchAll(/href="\/simulations\/([a-z0-9-]+)-vs-([a-z0-9-]+)-prediction\/(\d+)"/g)];
    out.steps.oddLeague = { status: r.status, len: h.length, links: links.length };
    if (links.length) {
      const url = `/simulations/${links[0][1]}-vs-${links[0][2]}-prediction/${links[0][3]}`;
      const r2 = await fetch(BASE + url, { headers: { "User-Agent": UA } });
      const h2 = await r2.text();
      const ld = [...h2.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      out.steps.oddDetail = { status: r2.status, len: h2.length, ld: ld.length };
    }
  } catch (e) {
    out.steps.oddLeague = { err: String(e.message) };
  }
  res.status(200).json(out);
}