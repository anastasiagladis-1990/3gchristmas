import store, { K } from "../lib/store.js";
import { send, body, checkAccess, writeGuard, str, httpUrl, baseOf } from "../lib/http.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;

// Christmas dinner details — anyone can edit. Only the fields sent are changed;
// older fields (title, host, end time…) are kept as they are.
export default async function handler(req, res) {
  if (!checkAccess(req, res)) return;
  if (!(await writeGuard(req, res))) return;
  if (req.method !== "PUT" && req.method !== "PATCH") return send(res, 405, { error: "Method not allowed" });
  try {
    const b = await body(req);
    const cur = (await store.getJSON(K.event)) || {};
    const next = { ...cur };
    if ("date" in b) next.date = DATE.test(b.date) ? b.date : "";
    if ("start" in b) next.start = TIME.test(b.start) ? b.start : "";
    if ("end" in b) next.end = TIME.test(b.end) ? b.end : "";
    if ("place" in b) next.place = str(b.place, 120);
    if ("address" in b) next.address = str(b.address, 250);
    if ("mapUrl" in b) next.mapUrl = httpUrl(b.mapUrl, 1000);
    if ("dress" in b) next.dress = str(b.dress, 150);
    if ("notes" in b) next.notes = str(b.notes, 2000);
    if ("host" in b) next.host = str(b.host, 80);
    if ("title" in b) next.title = str(b.title, 80);
    next.updatedBy = str(b.updatedBy, 60);
    next.updatedAt = Date.now();
    const r = await store.casJSON(K.event, next, baseOf(b));
    if (r === "conflict") return send(res, 409, { error: "conflict", current: await store.getJSON(K.event) });
    send(res, 200, { event: next });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Server error" });
  }
}
