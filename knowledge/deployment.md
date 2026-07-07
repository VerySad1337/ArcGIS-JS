# Deployment & Build

**Purpose:** Documents how the app is built and containerized for deployment.

**Key Files:**
- `Dockerfile` (repo root) – multi-stage build: `node:22-alpine` builds the Vite app in `my-arcgis-app/`, then `nginx:alpine` serves the resulting `dist/` on port 80.
- `.dockerignore` (repo root) – excludes `node_modules`, `dist`, `.git`, `.vscode`, `.vite`, `.scannerwork`, `coverage`, `sonar-project.properties`, and `Dockerfile` itself from the build context.
- `my-arcgis-app/package.json` – `build` script (`vite build`) invoked inside the Docker build stage.

**Build-time configuration:**
- `VITE_ARCGIS_API_KEY` is passed as a Docker build `ARG` and baked into the static bundle at build time (Vite inlines `VITE_*` env vars at build, not runtime). It must be supplied via `--build-arg` (or a build-time `.env` consumed by Vite) — it is **not** read from the container at runtime.
- Do not commit real API keys in a tracked `.env` file. See Repository Access Rules below.

**Build & run:**
```
docker build --build-arg VITE_ARCGIS_API_KEY=<key> -t arcgis-app .
docker run -p 8080:80 arcgis-app
```

**Known gap:** the Docker build does not run the test suite (`npm test`) or lint (`npm run lint`) before `vite build` — a broken component can still produce a "successful" image. If build-time gating is desired, add a `RUN npm test` step (and copy test config/fixtures) before `RUN npm run build`, or run tests in CI ahead of the Docker build.

**Secrets:** the ArcGIS API key must never be committed to a tracked `.env` file. Use `.env.example` with a placeholder, keep the real `.env` untracked (already covered by root and app-level `.gitignore`), and supply the real value via `--build-arg` or CI/CD secret injection.
