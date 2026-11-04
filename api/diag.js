const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FCF = "https://fcmobileforum.com/api/v1/program-players/programname_showdown25?limit=500&offset=0";
const JINA = "https://r.jina.ai/";

const probe = async (url, headers) => {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers });
    const t = await r.text();
    let players = null;
    const s = t.indexOf('{"players"');
    if (s >= 0) {
      try {
        players = JSON.parse(t.slice(s)).players.length;
      } catch {
        players = "parse-fail";
      }
    }
    return { status: r.status, len: t.length, ms: Date.now() - t0, players, head: t.slice(0, 180).replace(/\s+/g, " ") };
  } catch (e) {
    return { err: String((e && e.message) || e), ms: Date.now() - t0 };
  }
};

export default async function handler(_req, res) {
  const out = {
    jina: await probe(JINA + FCF, { "User-Agent": UA }),
    direct: await probe(FCF, { "User-Agent": UA }),
    jinaHtml: await probe(JINA + FCF, { "User-Agent": UA, "x-return-format": "html" }),
  };
  res.status(200).json(out);
}
