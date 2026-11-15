"use client";

/**
 * Free, on-device receipt OCR (Tesseract.js). The image never leaves the browser for this step.
 * Worker, WASM core and language data are self-hosted under /ocr (see scripts/copy-ocr-assets.mjs).
 */
import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;
let progressCb: ((p: number) => void) | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const origin = window.location.origin;
      const worker = await createWorker(["eng", "msa"], 1 /* OEM.LSTM_ONLY */, {
        workerPath: `${origin}/ocr/worker.min.js`,
        corePath: `${origin}/ocr`,
        langPath: `${origin}/ocr/lang`,
        gzip: true,
        logger: (m) => {
          if (m.status === "recognizing text") progressCb?.(Math.round(m.progress * 100));
        },
      });
      // Receipts are a single column of short lines; keep spacing between label and amount.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: "1", user_defined_dpi: "300" });
      return worker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Grayscale + contrast stretch + resize to ~1600px wide: noticeably better accuracy on phone photos. */
async function preprocess(file: Blob): Promise<HTMLCanvasElement | Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(2, 1600 / bitmap.width);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    let min = 255;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < d.length; i += 4) {
      const v = ((d[i] - min) / range) * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  } catch {
    return file;
  }
}

export async function ocrReceipt(file: Blob, onProgress?: (percent: number) => void): Promise<{ text: string; confidence: number }> {
  progressCb = onProgress ?? null;
  const worker = await getWorker();
  const input = await preprocess(file);
  const { data } = await worker.recognize(input);
  progressCb = null;
  return { text: data.text ?? "", confidence: data.confidence ?? 0 };
}
