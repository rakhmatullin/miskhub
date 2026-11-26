/* PDF assembly runs off the UI thread. Copy all original pages in one pass
   so matching resources in the source PDF are reused in the output. */
importScripts("./assets/pdf-pages-v2.2/pdf-lib.min.js");

function progress(message) {
  postMessage({ type: "progress", message });
}

async function insertImage(pdf, file) {
  const bitmap = await createImageBitmap(file);
  let canvas;
  try {
    const scale = Math.min(1, 8000 / Math.max(bitmap.width, bitmap.height), Math.sqrt(18_000_000 / bitmap.width / bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    const png = file.type === "image/png" || /\.png$/i.test(file.name);
    const encoded = await canvas.convertToBlob({ type: png ? "image/png" : "image/jpeg", quality: .94 });
    const bytes = await encoded.arrayBuffer();
    const image = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const fit = Math.min(595.28 / Math.min(w, h), 841.89 / Math.max(w, h));
    const width = w * fit, height = h * fit;
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 1;
  }
}

self.onmessage = async event => {
  const { file, order } = event.data;
  try {
    const { PDFDocument } = self.PDFLib;
    const result = await PDFDocument.create();
    const indices = order.filter(item => typeof item === "number").map(page => page - 1);
    let copies = [];
    if (indices.length) {
      progress("Читаем исходный PDF…");
      const original = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
      progress("Копируем исходные страницы…");
      copies = await result.copyPages(original, indices);
    }

    let position = 0;
    for (let i = 0; i < order.length; i++) {
      const item = order[i];
      if (typeof item === "number") result.addPage(copies[position++]);
      else await insertImage(result, item);
      if ((i + 1) % 100 === 0 || i + 1 === order.length) progress("Собрано страниц: " + (i + 1) + " из " + order.length);
    }

    progress("Подготавливаем файл…");
    const bytes = await result.save();
    postMessage({ type: "done", file: new Blob([bytes], { type: "application/pdf" }) });
  } catch {
    postMessage({ type: "error", message: "Не удалось собрать PDF. Проверьте исходный файл и добавленные изображения." });
  }
};
