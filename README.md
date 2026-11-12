# 🎄 3G Christmas 2026

A shared family website with no login. Anyone with the link can view, add, edit and delete.

| Route | Page |
|---|---|
| `/` | Landing page: live countdown to 25 Dec 2026 (Asia/Jakarta) and links to Dinner and Wishlist |
| `/dinner` | Christmas Dinner details (editable) + Potluck, grouped by category |
| `/wishlist` | Christmas Wishlist: filter by person, Open/Purchased status, summary per person. `?person=<id>` opens one person's list |

**Stack:** static page (`public/index.html`, vanilla JS) + Vercel serverless functions (`api/`) + Upstash Redis. There's no framework and nothing to bundle.

## 1. Put the code on GitHub
1. Unzip, then create a new repository on GitHub (for example `3g-christmas-2026`).
2. Upload the folder contents (the GitHub web "uploading an existing file" option works), or from a terminal:
   ```bash
   cd 3g-christmas-2026
   git init && git add . && git commit -m "3G Christmas 2026"
   git branch -M main
   git remote add origin https://github.com/<you>/3g-christmas-2026.git
   git push -u origin main
   ```
   **Updating an existing repo:** replace the old files with these and push. `.gitignore` already keeps `node_modules` and `.env*` out of the repo.

## 2. Import into Vercel
1. In Vercel, choose **Add New → Project** and import the GitHub repo.
2. Use **Framework Preset: Other**. The build command (`npm run build`) and output directory (`public`) come from `package.json` and `vercel.json`; no changes needed.
3. Deploy.

If you already have the earlier wishlist project on Vercel, keep using that same project. It is already connected to the database, so all existing data stays.

## 3. Connect the Upstash Redis database
- **Existing project:** nothing to do. The database connection carries over.
- **New project:** go to **Storage → Connect Database → Upstash for Redis**, pick your **existing** database (or create one), and connect it to the project. Then **Redeploy**.

### Environment variables (created by Vercel when you connect Upstash)
| Variable | Required | Notes |
|---|---|---|
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | ✅ | Either naming style works. These are used server-side only and never sent to the browser. |
| `ACCESS_CODE` | optional | If set, visitors enter this code once before the site opens. |
| `WRITE_LIMIT_PER_MIN` | optional | Maximum changes per minute from one IP address (default 90). |
| `KEY_PREFIX` | optional | Leave empty in production. See "Preview deployments" below. |

See `.env.example`. Never commit real tokens.

## 4. Automatic updates
Every push to `main` redeploys production automatically. Pushes to other branches create **preview** deployments.

**Preview deployments never touch production data.** When `VERCEL_ENV=preview`, every database key automatically gets the prefix `preview:`, so previews start empty and show a "preview" banner.

## Data and safety
- **Data:** Upstash Redis is the only source of truth. The browser stores nothing important (only your last-typed name, used to prefill forms).
- **Keys:** the same Redis keys as before (`wl:people`, `wl:items`, `wl:potluck`, `wl:event`, `wl:photo:*`), so existing people, gifts, purchases, potluck items and dinner details are kept. No migration is needed.
- **No silent overwrites:** edits are compare-and-set (atomic Lua scripts). If someone else changed the record first, the edit is refused, the latest version is shown, and the person is asked to review. Marking a gift as purchased is atomic, so only one buyer can win.
- **Double taps:** each new record gets its ID when the form opens, so repeated taps or retries never create duplicates. Person names are unique, ignoring capitalization and extra spaces.
- **Validation and abuse protection:** server-side validation, length limits, http(s)-only links, a per-IP write rate limit, and caps on record counts. The link-preview fetcher blocks private network addresses.
- **Sync:** the site refreshes every 10 seconds while open and whenever the tab regains focus. API responses are `no-store`.

## Run locally
```bash
npm install
npm run dev     # http://localhost:3000 — in-memory data unless you set the Upstash env vars
npm run build   # syntax and import check (the same check Vercel runs)
```
