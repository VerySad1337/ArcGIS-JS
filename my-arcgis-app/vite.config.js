import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  build: {
    // The default ('baseline-widely-available') downlevels syntax the ArcGIS
    // SDK already requires a modern engine for anyway, which only inflates a
    // bundle this size. Every browser that can run a WebGL SceneView supports
    // es2022.
    target: 'es2022',

    rollupOptions: {
      output: {
        // @arcgis/core is deliberately NOT force-bundled into one vendor
        // chunk. It relies on its own dynamic imports for lazy loading
        // (SceneView/3D, VideoLayer, ImageryLayer, arcade, ...), and Rollup
        // already splits those out - see the ~1400 hashed chunks in dist/ and
        // nginx.conf's immutable /assets/ policy. A manualChunks rule that
        // swept it into one file would collapse that back into a single
        // multi-megabyte download on first paint. Only React itself is pinned
        // out, because it is tiny, changes on a completely different cadence
        // from the app code, and therefore caches well on its own.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) return 'react-vendor';
          return undefined;
        }
      }
    },

    // Default is 500 kB, which this app can never meet - the ArcGIS SDK's own
    // core chunks exceed it by construction. Raised so the warning stays
    // meaningful (i.e. fires on something actually actionable) instead of
    // being noise on every build.
    chunkSizeWarningLimit: 1500
  },

  optimizeDeps: {
    // Dev-server only. Without these, Vite discovers @arcgis/core's thousands
    // of deep ES modules lazily and the dev server re-optimizes (and reloads
    // the page) partway through the first few loads. Naming the entry points
    // up front makes it prebundle them once, on start.
    include: [
      '@arcgis/core/Graphic',
      '@arcgis/core/layers/GraphicsLayer',
      '@arcgis/core/layers/FeatureLayer',
      '@arcgis/core/widgets/Sketch/SketchViewModel'
    ]
  }
})
