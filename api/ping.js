const FCF_API = "https://fcmobileforum.com/api/v1/program-players/programname_showdown25?limit=500&offset=0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export default async function handler(_req, res) {
  const out = { node: process.version };
  try {
    const r = await fetch(FCF_API, { headers: { "User-Agent": UA } });
    out.status = r.status;
    out.ct = r.headers.get("content-type");
    const text = await r.text();
    out.len = text.length;
    out.head = text.slice(0, 200);
  } catch (e) {
    out.err = String(e?.stack || e);
  }
  res.status(200).json(out);
}
