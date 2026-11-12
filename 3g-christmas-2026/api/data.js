import store, { K, persistent } from "../lib/store.js";
import { send, query, checkAccess } from "../lib/http.js";

// Everything the page needs in one call. ?since=<version> returns {changed:false} when nothing
// changed, so polling every few seconds is almost free.
export default async function handler(req, res) {
  if (!checkAccess(req, res)) return;
  try {
    const q = query(req);
    const ver = await store.version();
    const warn = !persistent && process.env.VERCEL ? "no_database" : process.env.VERCEL_ENV === "preview" ? "preview" : undefined;
    if (q.since !== undefined && Number(q.since) === ver) return send(res, 200, { version: ver, changed: false, warn });
    const [event, people, items, potluck] = await Promise.all([
      store.getJSON(K.event), store.all(K.people), store.all(K.items), store.all(K.potluck),
    ]);
    send(res, 200, { version: ver, changed: true, warn, event: event || {}, people, items, potluck });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Server error" });
  }
}
