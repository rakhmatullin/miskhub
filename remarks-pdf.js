// All exports use the same detail page and the same snapshot of the assignments.
function remarkPdfText(pdf, font) {
  const supported = new Set(font.getCharacterSet());
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const scale = 4;
  const pending = [];
  const graphemes = new Intl.Segmenter(undefined, {granularity: "grapheme"});

  function native(text) {
    for (const char of text) if (!supported.has(char.codePointAt(0))) return false;
    return true;
  }
  function measure(text, size) {
    if (native(text)) return font.widthOfTextAtSize(text, size);
    ctx.font = (size * scale) + 'px "Times New Roman", serif';
    return ctx.measureText(text).width / scale;
  }
  return {
    measure, graphemes,
    draw(page, text, options) {
      if (native(text)) {
        page.drawText(text, {...options, font});
      } else {
        // Keep Unicode available as text when the visible glyphs use system fonts.
        const properties = pdf.context.obj({ActualText: PDFLib.PDFHexString.fromText(text)});
        page.pushOperators(PDFLib.PDFOperator.of("BDC", [PDFLib.PDFName.of("Span"), properties]));
        page.drawText(" ", {...options, font, opacity: 0});
        page.pushOperators(PDFLib.endMarkedContent());
        pending.push({page, text, ...options});
      }
    },
    async finish() {
      for (const {page, text, x, y, size} of pending) {
        canvas.width = Math.ceil(measure(text, size) * scale) + 4;
        canvas.height = size * scale * 2;
        ctx.font = (size * scale) + 'px "Times New Roman", serif';
        const baseline = Math.ceil(size * scale * 1.25);
        ctx.fillText(text, 1, baseline);
        const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        const image = await pdf.embedPng(await png.arrayBuffer());
        page.drawImage(image, {
          x: x - 1 / scale, y: y - (canvas.height - baseline) / scale,
          width: canvas.width / scale, height: canvas.height / scale
        });
      }
    }
  };
}

function pdfLines(value, text, size, width) {
  const lines = [];
  const fits = value => text.measure(value, size) <= width;
  for (const paragraph of String(value ?? "").split(/\r\n?|\n/u)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/u)) {
      const joined = line ? line + " " + word : word;
      if (fits(joined)) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      if (!fits(word)) {
        line = "";
        for (const {segment} of text.graphemes.segment(word)) {
          if (line && !fits(line + segment)) {
            lines.push(line);
            line = "";
          }
          line += segment;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

function cellLines(value, text, size, width, max) {
  const lines = pdfLines(String(value).replace(/\s+/gu, " "), text, size, width);
  if (lines.length <= max) return lines;
  const last = Array.from(text.graphemes.segment(lines[max - 1]), item => item.segment);
  while (last.length && text.measure(last.join("") + "…", size) > width) last.pop();
  return [...lines.slice(0, max - 1), last.join("").trimEnd() + "…"];
}

async function embedPhoto(pdf, entry) {
  if (!entry) return null;
  const file = await entry.handle.getFile(), bytes = await file.arrayBuffer();
  try { return await pdf.embedJpg(bytes); } catch {}
  try { return await pdf.embedPng(bytes); } catch {}
  return pdf.embedJpg((await toJpeg(file)).bytes);
}

function drawPhotoGrid(page, images, x, top, width, height, gutter) {
  const count = images.length;
  if (!count) return;
  // Estimate the number of columns from the shape of the box and of the
  // images, then compare nearby choices using the actual fitted areas.
  const aspect = images.reduce((sum, image) =>
    sum + Math.log(Math.max(.15, Math.min(6, image.width / image.height))), 0) / count;
  const center = Math.sqrt(count * width / height / Math.exp(aspect));
  const limit = value => Math.max(1, Math.min(count, value));
  const candidates = new Set([
    1, count, ...[-2, -1, 0, 1, 2, 3].map(delta => limit(Math.floor(center) + delta))
  ]);
  let best;
  for (const cols of candidates) {
    const rows = Math.ceil(count / cols);
    const gapX = Math.min(gutter, width / cols / 5);
    const gapY = Math.min(gutter, height / rows / 5);
    const w = (width - (cols - 1) * gapX) / cols;
    const h = (height - (rows - 1) * gapY) / rows;
    const area = images.reduce((sum, image) => {
      const scale = Math.min(w / image.width, h / image.height);
      return sum + image.width * image.height * scale * scale;
    }, 0);
    if (!best || area > best.area) best = {cols, gapX, gapY, w, h, area};
  }

  const {cols, gapX, gapY, w, h} = best;
  images.forEach((image, index) => {
    const scale = Math.min(w / image.width, h / image.height);
    const imageWidth = image.width * scale, imageHeight = image.height * scale;
    const left = x + (index % cols) * (w + gapX);
    const cellTop = top - Math.floor(index / cols) * (h + gapY);
    page.drawImage(image, {x: left + (w - imageWidth) / 2,
      y: cellTop - (h + imageHeight) / 2, width: imageWidth, height: imageHeight});
  });
}

function detailPage(pdf, text, {act, person, photos, notes}, headings) {
  let page = pdf.addPage([595, 842]);
  let y = 794;
  text.draw(page, "Акт об устранении № " + act.act_no, {x: 36, y, size: 16});
  y -= 22;
  if (photos.length) {
    // Keep the entire set on the first page for this remark. Only text may
    // continue on later pages, as in the previous version.
    const height = 388;
    drawPhotoGrid(page, photos, 36, y, 523, height, 5);
    y -= height + 15;
  }
  function paragraph(value, size = 10) {
    for (const line of pdfLines(value, text, size, 523)) {
      if (y < 38) {
        page = pdf.addPage([595, 842]);
        text.draw(page, "Замечание № " + act.act_no + " · продолжение", {x: 36, y: 804, size: 10});
        y = 777;
      }
      text.draw(page, line, {x: 36, y, size});
      y -= size + 4;
    }
  }

  if (act.integration) paragraph("Инт. № " + act.integration);
  paragraph("Дата предписания: " + (act.pred_date || "—") + "    Срок: " + (act.deadline || "—"));
  y -= 4;
  if (person) {
    paragraph("Ответственный", 12);
    for (const [key, label] of [["organization","Организация"], ["name","Имя"], ["phone","Телефон"], ["email","Электронная почта"]]) {
      if (person[key]) paragraph(label + ": " + person[key]);
    }
  } else {
    paragraph("Ответственный: Не назначен");
  }
  y -= 4;
  paragraph("Описание: " + (act.description || "—"));
  if (notes.c1) paragraph(headings.c1 + ": " + notes.c1);
  if (notes.c2) paragraph(headings.c2 + ": " + notes.c2);
}

function summaryPages(pdf, text, rows, headings) {
  const columns = [
    ["№", 36], ["Инт. №", 64], ["Описание", 195], ["Ответственный", 156],
    ["Фото", 67], [headings.c1, 134], [headings.c2, 134]
  ];
  const size = 9, leading = 12, margin = 28;
  let page, top;
  function putCells(cells, y) {
    let x = margin;
    cells.forEach((lines, i) => {
      lines.forEach((line, j) => text.draw(page, line, {x: x + 2, y: y - size - 2 - j * leading, size}));
      x += columns[i][1];
    });
  }
  function rule(thickness) {
    page.drawLine({start: {x: margin, y: top}, end: {x: 814, y: top}, thickness, color: PDFLib.rgb(.55, .55, .55)});
  }
  function nextPage() {
    page = pdf.addPage([842, 595]);
    text.draw(page, "Устранение нарушений", {x: margin, y: 553, size: 16});
    text.draw(page, "Всего: " + rows.length, {x: margin, y: 532, size: 10});
    top = 518;
    const labels = columns.map(([label, width]) => cellLines(label, text, size, width - 6, 2));
    putCells(labels, top);
    top -= 5 + leading * Math.max(...labels.map(lines => lines.length));
    rule(.6);
  }

  nextPage();
  const photosLeft = margin + columns.slice(0, 4).reduce((sum, column) => sum + column[1], 0);
  for (const {act, person, notes, photos} of rows) {
    const values = [act.act_no, act.integration || "—", act.description || "—", RemarksStore.label(person), "", notes.c1 || "", notes.c2 || ""];
    const cells = values.map((value, i) => cellLines(value, text, size, columns[i][1] - 6, 3));
    const photoHeight = photos.length ? Math.min(96, 6 + Math.ceil(Math.sqrt(photos.length) * 16)) : 0;
    const height = Math.max(26, photoHeight, 7 + leading * Math.max(...cells.map(lines => lines.length)));
    if (top - height < margin) nextPage();
    putCells(cells, top - 2);
    drawPhotoGrid(page, photos, photosLeft + 2, top - 3, 63, height - 6, 2);
    top -= height;
    rule(.3);
  }
}

async function exportRemarksPdf(numbers, summary) {
  const folder = dirHandle;
  await RemarksStore.refresh();
  const entries = await listEntries(folder);
  const photoIndex = RemarkPhotos.index(entries);
  const dump = await findDumpFile(entries);
  if (!dump) throw new Error("Нет Excel-выгрузки.");
  const acts = new Map(parseDump(await dump.arrayBuffer()).map(act => [act.act_no, act]));
  if (folder !== dirHandle || !RemarksStore.ready) throw new Error("Рабочая папка изменилась. Повторите экспорт.");
  const missing = [], rows = [], warnings = [];
  for (const n of numbers) {
    const act = acts.get(n);
    if (!act || act.status !== "К устранению") {
      missing.push(n);
      continue;
    }
    const note = comments[n];
    rows.push({
      act: {...act, integration: intMap[n] || act.integration},
      notes: dictionary(note) ? {...note} : {c1: note || ""},
      person: RemarksStore.forNumber(n)
    });
  }
  if (missing.length) {
    const warning = "В выгрузке нет открытых замечаний № " + missing.join(", ") + ".";
    if (summary || !rows.length) throw new Error(warning);
    warnings.push(warning);
  }
  const headings = {c1: colNames.c1 || "Комментарий", c2: colNames.c2 || "Примечание"};
  const pdf = await PDFLib.PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const style = remarkPdfText(pdf, await pdf.embedFont(await getCyrFont()));
  for (const row of rows) {
    row.photos = [];
    for (const entry of photoIndex.get(row.act.act_no) || []) {
      try {
        row.photos.push(await embedPhoto(pdf, entry));
      } catch {
        warnings.push("Не удалось прочитать фото «" + entry.name + "».");
      }
    }
  }
  if (summary) summaryPages(pdf, style, rows, headings);
  for (const row of rows) detailPage(pdf, style, row, headings);
  await style.finish();
  return {bytes: await pdf.save(), warnings};
}

async function saveRemarksPdf(numbers, journal = false) {
  if (!numbers.length) return;
  if (RemarkPhotos.busy()) {
    $("hint").textContent = "Дождитесь окончания записи вложений.";
    return;
  }
  $("hint").textContent = "Создаём PDF…";
  try {
    const {bytes, warnings} = await exportRemarksPdf(numbers, journal);
    const name = journal ? "журнал.pdf" : numbers.length === 1 ? "Акт_" + numbers[0] + ".pdf" : "акты.pdf";
    await downloadPdf(bytes, name);
    $("hint").textContent = ["PDF готов.", ...warnings].join(" ");
  } catch (error) {
    $("hint").textContent = error.message;
    if (!RemarksStore.ready) {
      $("retryFolder").hidden = false;
      RemarksUI.refresh();
    }
  }
}

$("pdfBtn").addEventListener("click", () => saveRemarksPdf(expandNumbers($("num").value)));
$("journalBtn").addEventListener("click", () => saveRemarksPdf(openRows.map(row => row.act_no), true));
