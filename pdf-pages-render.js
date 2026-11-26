import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport } from "./assets/pdf-pages-v2.2/build/pdf.min.mjs";

const asset = path => new URL("./assets/pdf-pages-v2.2/" + path, import.meta.url).href;
GlobalWorkerOptions.workerSrc = asset("build/pdf.worker.min.mjs");

export const rasterSizes = {
  thumbnail: { scale: 1.8, edge: 280, pixels: 80_000, quality: .78 },
  viewer: { scale: 3, edge: 2700, pixels: 6_000_000, quality: .9 },
  download: { scale: 240 / 72, edge: 8000, pixels: 18_000_000, quality: .94 }
};

class LocalFileRanges extends PDFDataRangeTransport {
  constructor(file, initial) {
    super(file.size, initial, initial.length === file.size);
    this.file = file;
  }

  requestDataRange(begin, end) {
    this.file.slice(begin, end).arrayBuffer().then(bytes => {
      if (!this.aborted) this.onDataRange(begin, new Uint8Array(bytes));
    }).catch(error => {
      if (!this.aborted) {
        this.failure = error;
        this.stop?.();
      }
    });
  }

  abort() { this.aborted = true; }
}

export async function openPdf(file) {
  const chunkSize = 128 * 1024;
  const initial = new Uint8Array(await file.slice(0, chunkSize).arrayBuffer());
  const range = new LocalFileRanges(file, initial);
  const task = getDocument({
    range,
    rangeChunkSize: chunkSize,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    cMapUrl: asset("cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: asset("standard_fonts/"),
    wasmUrl: asset("wasm/"),
    iccUrl: asset("iccs/")
  });
  range.stop = () => task.destroy().catch(() => {});

  try {
    const doc = await task.promise;
    return { doc, file };
  } catch (error) {
    await task.destroy().catch(() => {});
    if (range.failure) throw new Error("Файл недоступен. Выберите его снова.");
    if (error.name === "PasswordException") throw new Error("Выберите PDF без защиты паролем.");
    throw new Error("Не удалось прочитать PDF. Проверьте файл.");
  }
}

function imageScale(width, height, size) {
  return Math.min(size.scale, size.edge / Math.max(width, height), Math.sqrt(size.pixels / width / height));
}

export async function rasterPage(entry, source, size, signal) {
  signal.throwIfAborted();
  let bitmap, pdfPage, viewport, canvas;
  let width, height;
  try {
    if (entry.file) {
      bitmap = await createImageBitmap(entry.file);
      const scale = imageScale(bitmap.width, bitmap.height, { ...size, scale: 1 });
      width = bitmap.width * scale;
      height = bitmap.height * scale;
    } else {
      pdfPage = await source.doc.getPage(entry.page);
      const original = pdfPage.getViewport({ scale: 1 });
      viewport = pdfPage.getViewport({ scale: imageScale(original.width, original.height, size) });
      ({ width, height } = viewport);
    }

    signal.throwIfAborted();
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    const graphics = canvas.getContext("2d", { alpha: false });
    if (!graphics) throw new Error("Браузер не смог создать холст для страницы.");
    if (bitmap) {
      graphics.fillStyle = "#fff";
      graphics.fillRect(0, 0, canvas.width, canvas.height);
      graphics.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } else {
      const render = pdfPage.render({ canvas, canvasContext: graphics, viewport, background: "#fff" });
      const cancel = () => render.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      try {
        await render.promise;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    }
    signal.throwIfAborted();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", size.quality));
    if (!blob) throw new Error("Не удалось получить изображение страницы.");
    signal.throwIfAborted();
    return blob;
  } finally {
    bitmap?.close();
    pdfPage?.cleanup();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
