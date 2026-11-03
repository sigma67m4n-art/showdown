import { getData } from "../lib/data.js";

export const config = { runtime: "edge" };

export default async function handler() {
  try {
    const d = await getData();
    return new Response(JSON.stringify(d), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
