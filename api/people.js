import store, { K } from "../lib/store.js";
import { send, query, body, checkAccess, writeGuard, str, clientId, baseOf } from "../lib/http.js";
import { randomUUID } from "node:crypto";

const MAX_PEOPLE = 300;
const clean = v => str(v, 40).replace(/\s+/g, " ");
const keyOf = n => clean(n).toLowerCase(); // duplicate check ignores capitalization and extra spaces

export default async function handler(req, res) {
  if (!checkAccess(req, res)) return;
  if (!(await writeGuard(req, res))) return;
  const q = query(req);
  try {
    const b = req.method === "GET" || req.method === "DELETE" ? {} : await body(req);

    // Finds an existing person with this name (index first, then a scan for records made before the index existed).
    const findByName = async (n, exceptId) => {
      const id = await store.nameGet(keyOf(n));
      if (id && id !== exceptId) { const p = await store.get(K.people, id); if (p) return p; }
      return (await store.all(K.people)).find(p => p.id !== exceptId && keyOf(p.name) === keyOf(n)) || null;
    };

    if (req.method === "POST") {
      const name = clean(b.name);
      if (!name) return send(res, 400, { error: "Name is required" });
      const id = clientId(b.id) || randomUUID();
      const again = await store.get(K.people, id);
      if (again) return send(res, 200, { person: again, duplicate: true }); // repeated tap
      const dup = await findByName(name);
      if (dup) return send(res, 409, { error: `"${dup.name}" is already on the list`, person: dup });
      if ((await store.count(K.people)) >= MAX_PEOPLE) return send(res, 400, { error: "Too many people" });
      if (!(await store.nameClaim(keyOf(name), id))) {
        const p = await findByName(name);
        if (p) return send(res, 409, { error: `"${p.name}" is already on the list`, person: p });
        await store.nameDel(keyOf(name)); await store.nameClaim(keyOf(name), id); // stale index entry
      }
      const now = Date.now();
      const person = { id, name, notes: "", createdAt: now, updatedAt: now };
      await store.create(K.people, person); await store.bump();
      return send(res, 201, { person });
    }

    if (req.method === "PATCH") {
      const cur = await store.get(K.people, q.id);
      if (!cur) return send(res, 404, { error: "Person not found" });
      const next = { ...cur, updatedAt: Date.now() };
      let claimed = null;
      if ("name" in b) {
        const name = clean(b.name);
        if (!name) return send(res, 400, { error: "Name is required" });
        if (keyOf(name) !== keyOf(cur.name)) {
          const dup = await findByName(name, cur.id);
          if (dup) return send(res, 409, { error: `"${dup.name}" is already on the list` });
          if (!(await store.nameClaim(keyOf(name), cur.id))) return send(res, 409, { error: `"${name}" is already on the list` });
          claimed = keyOf(name);
        }
        next.name = name;
      }
      if ("notes" in b) next.notes = str(b.notes, 1000);
      const r = await store.cas(K.people, next, baseOf(b));
      if (r !== "ok") {
        if (claimed) await store.nameDel(claimed);
        return send(res, r === "missing" ? 404 : 409, { error: r === "missing" ? "Person not found" : "conflict", current: await store.get(K.people, q.id) });
      }
      if (claimed) { if ((await store.nameGet(keyOf(cur.name))) === cur.id) await store.nameDel(keyOf(cur.name)); }
      else await store.nameClaim(keyOf(next.name), cur.id); // backfill index for older records
      return send(res, 200, { person: next });
    }

    if (req.method === "DELETE") {
      // Removes the person and every gift on their list.
      const cur = await store.get(K.people, q.id);
      const items = (await store.all(K.items)).filter(i => i.personId === q.id);
      for (const i of items) { await store.del(K.items, i.id); await store.setPhoto(i.id, null); }
      await store.del(K.people, q.id);
      if (cur && (await store.nameGet(keyOf(cur.name))) === cur.id) await store.nameDel(keyOf(cur.name));
      await store.bump();
      return send(res, 200, { ok: true, removedItems: items.length });
    }

    send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Server error" });
  }
}
