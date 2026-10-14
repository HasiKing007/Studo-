// Mensa-Speiseplan über OpenMensa (offene, kostenlose API; die Österreichischen Mensen
// werden dort täglich eingespielt). Antworten werden am Cloudflare-Rand 30 Minuten gecacht.

const API = "https://openmensa.org/api/v2/canteens";

function price(p = {}) {
  const v = p.students ?? p.others ?? p.employees ?? p.pupils;
  return typeof v === "number" ? v : null;
}

/** OpenMensa-Antwort -> [{ date, closed, meals: [{ name, category, price }] }] */
export function mapDays(raw, limit = 7) {
  return (Array.isArray(raw) ? raw : []).slice(0, limit).map((d) => ({
    date: d.date,
    closed: !!d.closed,
    meals: (d.meals || []).map((m) => ({ name: String(m.name || "").trim(), category: m.category || null, price: price(m.prices) }))
      .filter((m) => m.name),
  }));
}

export async function fetchMensa(canteens, fetchImpl = (...a) => fetch(...a)) {
  return Promise.all(canteens.map(async (c) => {
    try {
      const res = await fetchImpl(`${API}/${c.id}/meals`, {
        headers: { "User-Agent": "StudoPlus/1.0", Accept: "application/json" },
        cf: { cacheTtl: 1800, cacheEverything: true },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { id: c.id, name: c.name, hours: c.hours || null, days: mapDays(await res.json()) };
    } catch (e) {
      return { id: c.id, name: c.name, hours: c.hours || null, days: [], error: e.message };
    }
  }));
}
