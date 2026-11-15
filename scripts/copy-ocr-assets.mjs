// Copies the Tesseract.js worker, WASM core and language data into public/ocr so the
// free on-device receipt OCR works without any third-party CDN. Runs on postinstall.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "public", "ocr");
fs.mkdirSync(path.join(out, "lang"), { recursive: true });

const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const copy = (from, to) => {
  fs.copyFileSync(from, path.join(out, to));
};

try {
  copy(path.join(pkgDir("tesseract.js"), "dist", "worker.min.js"), "worker.min.js");
  const core = pkgDir("tesseract.js-core");
  for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) copy(path.join(core, f), f);
  for (const lang of ["eng", "msa"]) {
    copy(path.join(pkgDir(`@tesseract.js-data/${lang}`), "4.0.0_best_int", `${lang}.traineddata.gz`), path.join("lang", `${lang}.traineddata.gz`));
  }
  console.log("[ocr] assets copied to public/ocr");
} catch (e) {
  // Never break installs (e.g. production installs without devDependencies); OCR just stays unavailable.
  console.warn("[ocr] could not copy OCR assets:", e.message);
}
