# Deployment & Build

**Purpose:** Documents how the app is built and containerized for deployment.

**Key Files:**
- `Dockerfile` (repo root) – multi-stage build: `node:22-alpine` builds the Vite app in `my-arcgis-app/`, then `nginx:alpine` serves the resulting `dist/` on port 80, using `nginx.conf` (below) instead of the image's default server block.
- `nginx.conf` (repo root) – sets the caching policy the SPA needs (see "Stale-deploy 404s on 2D/3D toggle" below): `/assets/*` (Vite's content-hashed JS/CSS chunks) get `Cache-Control: public, max-age=31536000, immutable`; `index.html` gets `Cache-Control: no-cache` so it always revalidates. `location / { try_files $uri $uri/ /index.html; }` is the standard SPA fallback (the app has no client-side router today, but this costs nothing and avoids a 404 if one is added later).
- `docker-compose.yml` (repo root) – one `arcgis-app` service that builds from the repo-root context and publishes `8080:80`. It passes `VITE_ARCGIS_API_KEY: ${VITE_ARCGIS_API_KEY}` as a build arg.
- `.dockerignore` (repo root) – excludes `node_modules`, `dist`, `.git`, `.vscode`, `.vite`, `.scannerwork`, `coverage`, `sonar-project.properties`, and `Dockerfile` itself from the build context. `nginx.conf` is **not** excluded — it must reach the build context for `COPY nginx.conf /etc/nginx/conf.d/default.conf` to succeed.
- `my-arcgis-app/package.json` – `build` script (`vite build`) invoked inside the Docker build stage.

### Stale-deploy 404s on 2D/3D toggle (2026-08)

**Symptom:** after a redeploy (`docker compose up --build`) lands while a browser tab is still open on the old build, toggling from 2D to 3D throws a wall of `Failed to load resource: 404` for `@arcgis/core`'s SceneView-only chunks (`I3SIndexInfo-*.js`, `SceneService-*.js`, `GraphicsLayerView3D-*.js`, `editingTools-*.js`, etc.), followed by `Failed to fetch dynamically imported module` and every layer failing to create a layerview.

**Root cause:** Vite content-hashes every file under `dist/assets/` (the hash is part of the filename, e.g. `I3SIndexInfo-CpQp5Naa.js`), and a fresh `vite build` gives most of them new hashes. `@arcgis/core`'s 3D code path is only `import()`-ed the first time a view actually switches to `SceneView` — everything the *2D* `MapView` needs was already fetched (successfully, against the *old* build) when the page first loaded. If the container gets rebuilt with a new image in between, the already-open tab is still running the old build's JS, which still references the old chunk hashes — hashes that no longer exist once nginx is serving the new `dist/`. The 2D→3D toggle is just the first moment that stale bundle tries to fetch something it hadn't needed yet, so the failure looks 3D-specific even though the actual cause is unrelated to 3D or to this app's own code.
- Confirmed by diffing a fresh local `npm run build` output against the hash named in the browser error: the locally rebuilt `dist/assets/I3SIndexInfo-*.js` had a different hash than the one the browser tried to fetch — proof the running server and the loaded page were from two different builds, not that the build itself was missing files.

**Fix:** `nginx.conf` (above) sets `Cache-Control: no-cache` on `index.html` specifically (nginx's stock config sets no explicit caching header on it, which lets a browser apply its own heuristic caching and hold onto a stale copy for a while) so a reload always revalidates and picks up the current build's asset references, while `/assets/*` — which never changes contents for a given filename — is still cached aggressively. This does not fix an *already-open* tab that loaded before the nginx config existed or before a given redeploy; the immediate remedy there is always a hard refresh (Ctrl+Shift+R) or a fresh tab.

**Build-time configuration:**
- `VITE_ARCGIS_API_KEY` is passed as a Docker build `ARG` and baked into the static bundle at build time (Vite inlines `VITE_*` env vars at build, not runtime). It must be supplied via `--build-arg` (or a build-time `.env` consumed by Vite) — it is **not** read from the container at runtime.
- Do not commit real API keys in a tracked `.env` file. See Repository Access Rules below.

**There are two `.env` files, both untracked, and they must be kept in sync by hand.**

| File | Read by | Purpose |
| --- | --- | --- |
| `my-arcgis-app/.env` | **Vite** (`npm run dev`, `npm run build`) | The app's real config file: `VITE_ARCGIS_API_KEY`, `VITE_ARCGIS_OAUTH_CLIENT_ID`, `VITE_ARCGIS_PORTAL_URL`. Vite loads `.env` from **its own project root only** — it does not read a parent directory's `.env`. This is the source of truth; edit the key here first. |
| `.env` (repo root) | **Docker Compose** (`docker compose up --build`, with no `--env-file` flag) | A copy of `my-arcgis-app/.env`, kept only so plain `docker compose up --build` works without extra flags — Compose auto-loads a `.env` sitting next to `docker-compose.yml` for build-arg interpolation and has no way to be pointed elsewhere from inside the YAML itself. |

A root `.env` was previously removed entirely (see *Postmortem* below) because it had been git-tracked with a real key. It has since been reintroduced, but **only as an untracked copy** — `.gitignore` line 1 covers it, and it must never be `git add`ed. A symlink (`ln -s my-arcgis-app/.env .env`) was tried first, to make this a true single source of truth with no sync step, but failed silently on this checkout's filesystem/Windows privileges and fell back to a plain file copy — verify with `ls -la .env` (a symlink shows `l...` and a small size; a copy shows a regular file the same size as `my-arcgis-app/.env`) if this is retried elsewhere.

**Consequence: after changing `VITE_ARCGIS_API_KEY` (or any other var) in `my-arcgis-app/.env`, re-copy it to the root before the next `docker compose up --build`:**
```
cp my-arcgis-app/.env .env
```
Forgetting this step does **not** fail loudly — Compose will happily build with the *old* key from the stale root copy, which is exactly the kind of misleading failure mode described in the Postmortem below (a key mismatch surfaces later as portal/subscription 499s, not as a build error).

If you'd rather not maintain two files by hand, `docker compose --env-file my-arcgis-app/.env up --build` still works and reads directly from the single real file — see *Build & run* below.

### Postmortem: deleting the root `.env` silently broke the deployed app

This is worth stating plainly because the failure mode was badly misleading, and the diagnosis initially went the wrong way.

Removing the root `.env` left `${VITE_ARCGIS_API_KEY}` with nothing to interpolate from. Compose substituted an **empty string** and emitted only a warning, so:

1. `docker compose up --build` reported success.
2. The image was built with `esriConfig.apiKey` empty.
3. Public layers still worked, so the map looked fine.
4. **Esri subscription content began returning error 499** ("Token Required for subscription content") — most visibly when adding a layer from the portal panel.
5. `IdentityManager` answers a 499 by opening its own sign-in dialog.

The app therefore appeared to have "started requiring a login," with no error anywhere pointing at a missing build arg. Verified by grepping the served bundle in both images: the pre-deletion image contained the key, the post-deletion one contained zero occurrences of it.

Two lessons encoded in the current setup:
- **`${VAR:?message}`, never bare `${VAR}`, for anything that must be present at build time.** The compose file now aborts instead of shipping an image with an empty key. Confirmed both ways: `docker compose config` fails without `--env-file` and resolves with it.
- **A missing build-time secret does not fail where it is missing.** It fails much later, in a subsystem that looks unrelated, as an authentication prompt. When "the app suddenly wants a login," check what got baked into the bundle before investigating auth code:
  ```
  docker exec <container> grep -ro "AAPT" /usr/share/nginx/html/assets | wc -l
  ```
- **Check how the app is actually run before touching build configuration.** `npm run dev` and `docker compose` read different env files; a file that is inert for one can be load-bearing for the other.
- **OAuth cannot be configured for a Docker/Compose build at all.** `VITE_ARCGIS_OAUTH_CLIENT_ID` and `VITE_ARCGIS_PORTAL_URL` are read by the app but never passed through as build args — `docker-compose.yml` forwards only `VITE_ARCGIS_API_KEY` and the `Dockerfile` declares only that one `ARG`. A containerized deployment therefore always runs anonymous-only, regardless of what `my-arcgis-app/.env` says, because that file is `.dockerignore`d/not copied and Vite inlines these at build time. Fixing this needs a new `ARG`/`ENV` pair in the `Dockerfile` plus a matching entry under `build.args` in `docker-compose.yml`.

**Build & run:**
```
# Plain Docker — key passed explicitly
docker build --build-arg VITE_ARCGIS_API_KEY=<key> -t arcgis-app .
docker run -p 8080:80 arcgis-app

# Compose — reads the root .env automatically (must be kept in sync
# with my-arcgis-app/.env by hand; see table above)
docker compose up --build

# Compose — or skip the root .env/sync step and read the real file directly
docker compose --env-file my-arcgis-app/.env up --build
```

**Known gap:** the Docker build does not run the test suite (`npm test`) or lint (`npm run lint`) before `vite build` — a broken component can still produce a "successful" image. If build-time gating is desired, add a `RUN npm test` step (and copy test config/fixtures) before `RUN npm run build`, or run tests in CI ahead of the Docker build.

**Secrets:** the ArcGIS API key must never be committed to a tracked `.env` file. Use `.env.example` with a placeholder, keep the real `.env` untracked, and supply the real value via `--build-arg` or CI/CD secret injection.

**Resolved issue — the root `.env` was git-tracked despite being in `.gitignore`.** Both `.env` and `my-arcgis-app/.env` are listed in the root `.gitignore`, but `.gitignore` has no effect on a path git is *already* tracking, and the root `.env` had been committed before the ignore rule was added. It carried a real ArcGIS API key into pushed history. It has since been deleted and untracked, and the history rewritten to purge it.

Verify no `.env` is tracked:

```
git ls-files '*.env'
```

Any output means that file's contents are in the repository history.

**The key must still be rotated.** A history rewrite removes the value from the repository, but it cannot un-share what was already pushed, cloned, forked, or cached by GitHub. Any key that reached a remote must be treated as compromised and regenerated at the provider (ArcGIS Developer dashboard → API keys); rotation is the only step that actually revokes access.

**To avoid a repeat:** never `git add` a `.env`. Keep secrets in `my-arcgis-app/.env` (untracked), commit a placeholder `my-arcgis-app/.env.example` instead, and supply real values to builds via `--build-arg` or CI/CD secret injection.
