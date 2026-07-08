const { chromium } = require("playwright-core");
const path = require("path");

(async () => {
  const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = await chromium.launch({
    executablePath: edgePath,
    headless: true,
    args: ["--use-gl=swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"]
  });
  const page = await browser.newPage();

  page.on("console", (msg) => {
    console.log(`[console.${msg.type()}]`, msg.text());
  });
  page.on("pageerror", (err) => {
    console.log("[pageerror]", err.message, err.stack);
  });
  page.on("requestfailed", (req) => {
    console.log("[requestfailed]", req.url(), req.failure()?.errorText);
  });

  // Patch console.error/warn before app scripts run, to deep-stringify args
  // (including circular Esri error objects) instead of the default [object Object].
  await page.addInitScript(() => {
    function safeStringify(obj) {
      const seen = new WeakSet();
      try {
        return JSON.stringify(obj, (key, value) => {
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) return "[circular]";
            seen.add(value);
            if (value instanceof Error) {
              return { name: value.name, message: value.message, stack: value.stack, ...value };
            }
          }
          return value;
        }, 2);
      } catch (e) {
        return String(obj);
      }
    }
    window.__safeStringify = safeStringify;
    const origError = console.error.bind(console);
    console.error = (...args) => {
      origError(...args.map(a => (typeof a === "object" ? safeStringify(a) : a)));
    };
    window.addEventListener("unhandledrejection", (e) => {
      console.log("[UNHANDLED REJECTION]", safeStringify(e.reason));
    });
    window.addEventListener("error", (e) => {
      console.log("[WINDOW ERROR]", e.message, safeStringify(e.error));
    });
  });

  console.log("Navigating...");
  await page.goto("http://localhost:5178/", { waitUntil: "load", timeout: 60000 });

  console.log("Waiting for map view to be ready...");
  await page.waitForTimeout(8000);

  console.log("Locating file input...");
  const fileInput = page.locator('input[type="file"]');
  await fileInput.waitFor({ state: "attached", timeout: 15000 });

  const filePath = path.resolve(__dirname, "__repro.geojson");
  console.log("Uploading:", filePath);
  await fileInput.setInputFiles(filePath);

  console.log("Waiting after upload...");
  await page.waitForTimeout(5000);

  const SCRATCH = "C:/Users/eric3/AppData/Local/Temp/claude/c--Users-eric3-OneDrive-Documents-ArcGIS-JS/76701445-6ca1-4098-b48a-c7a89b09ca56/scratchpad";

  await page.screenshot({ path: path.resolve(SCRATCH, "after-upload.png") });

  console.log("Switching to 3D...");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.waitForTimeout(10000);

  await page.screenshot({ path: path.resolve(SCRATCH, "after-3d.png") });

  console.log("Switching back to 2D...");
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.waitForTimeout(10000);

  await page.screenshot({ path: path.resolve(SCRATCH, "after-2d-again.png") });

  console.log("Expanding Drawings layer style controls to count surviving style groups...");
  await page.getByRole("button", { name: "Toggle layer styling options" }).last().click();
  await page.waitForTimeout(500);
  const groupCount = await page.locator(".layer-style-group-label").count();
  console.log("RESULT drawings style group count after 2D->3D->2D:", groupCount);

  await browser.close();
  console.log("Done.");
})().catch((e) => {
  console.error("SCRIPT ERROR", e);
  process.exit(1);
});
