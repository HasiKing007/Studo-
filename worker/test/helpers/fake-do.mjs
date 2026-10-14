// Durable-Object-Umgebung für Tests: SQLite aus Node statt Cloudflare.
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

register("./cf-loader.mjs", import.meta.url);

export function fakeCtx() {
  const db = new DatabaseSync(":memory:");
  const cursor = (rows) => ({ toArray: () => rows, one: () => rows[0] });
  return {
    storage: {
      sql: {
        exec(q, ...binds) {
          if (!binds.length && q.trim().split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return cursor([]); }
          return cursor(db.prepare(q).all(...binds.map((b) => (typeof b === "boolean" ? +b : b))));
        },
      },
      getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {}, deleteAll: async () => {},
    },
    blockConcurrencyWhile: (fn) => fn(),
    waitUntil: () => {},
  };
}
