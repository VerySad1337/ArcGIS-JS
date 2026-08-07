# Deployment & Build

**Purpose:** Documents how the app is built and containerized for deployment.

**Key Files:**
- `Dockerfile` (repo root) – multi-stage build: `node:22-alpine` builds the Vite app in `my-arcgis-app/`, then `nginx:alpine` serves the resulting `dist/` on port 80.
- `docker-compose.yml` (repo root) – one `arcgis-app` service that builds from the repo-root context and publishes `8080:80`. It passes `VITE_ARCGIS_API_KEY: ${VITE_ARCGIS_API_KEY}` as a build arg.
- `.dockerignore` (repo root) – excludes `node_modules`, `dist`, `.git`, `.vscode`, `.vite`, `.scannerwork`, `coverage`, `sonar-project.properties`, and `Dockerfile` itself from the build context.
- `my-arcgis-app/package.json` – `build` script (`vite build`) invoked inside the Docker build stage.

**Build-time configuration:**
- `VITE_ARCGIS_API_KEY` is passed as a Docker build `ARG` and baked into the static bundle at build time (Vite inlines `VITE_*` env vars at build, not runtime). It must be supplied via `--build-arg` (or a build-time `.env` consumed by Vite) — it is **not** read from the container at runtime.
- Do not commit real API keys in a tracked `.env` file. See Repository Access Rules below.

**There is exactly one `.env`, and it belongs to Vite, not to the repo root.**

| File | Read by | Purpose |
| --- | --- | --- |
| `my-arcgis-app/.env` | **Vite** (`npm run dev`, `npm run build`) | The app's only config file: `VITE_ARCGIS_API_KEY`, `VITE_ARCGIS_OAUTH_CLIENT_ID`, `VITE_ARCGIS_PORTAL_URL`. Vite loads `.env` from **its own project root only** — it does not read a parent directory's `.env`. Untracked, and must stay that way. |
| `.env` (repo root) | — | **Removed.** It duplicated only `VITE_ARCGIS_API_KEY`, was invisible to Vite, and was git-tracked with a real key. See *Known issue* below. |

Consequences of that removal:
- `npm run dev`, `npm test`, `npm run build`, and `docker build --build-arg VITE_ARCGIS_API_KEY=<key> .` are all unaffected — none of them ever read the root `.env`.
- **`docker compose` must now be pointed at the app's `.env` explicitly:**
  ```
  docker compose --env-file my-arcgis-app/.env up --build
  ```
  Compose interpolates build args from *its own* env file, which defaults to a `.env` beside `docker-compose.yml`. `--env-file` redirects that to the one file Vite already reads, so the secret exists in exactly one untracked place.

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

# Compose — reads VITE_ARCGIS_API_KEY from the ambient environment
export VITE_ARCGIS_API_KEY=<key>
docker compose up --build
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
