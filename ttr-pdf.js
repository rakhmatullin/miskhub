const CELLS = {
  workersPlan: [200.2, 266.7],
  workersFact: [266.7, 325.0],
  itrPlan: [325.0, 396.7],
  itrFact: [396.7, 447.5],
  techPlan: [447.5, 508.3],
  techFact: [508.3, 566.7],
  sumPlan: [266.7, 396.7],
  sumFact: [447.5, 566.7],
};

const ROW_TOP = 479.4;
const ROW_BOT = 596.6;
const SUM_TOP = 599.3;
const SUM_BOT = 612.8;
const NUM_BASELINE_TOP = 542.25073;
const SUM_BASELINE_TOP = 609.20081;
const DATE_BASELINE_TOP = 206.95074;
const DATE_X = 446.65;

export function createMakePdf({ PDFDocument, rgb }, fontkit) {
  return async function makePdf(templateBytes, fontBytes, spec) {
    const doc = await PDFDocument.load(templateBytes);
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes, { subset: true });
    const page = doc.getPages()[0];
    const pageH = page.getHeight();
    const white = rgb(1, 1, 1);
    const black = rgb(0, 0, 0);

    function wipe(x0, top, x1, bot) {
      page.drawRectangle({
        x: x0,
        y: pageH - bot,
        width: x1 - x0,
        height: bot - top,
        color: white,
        borderWidth: 0,
      });
    }

    function centerText(text, x0, x1, baselineTop, size) {
      let s = size;
      const maxW = x1 - x0 - 4;
      while (font.widthOfTextAtSize(text, s) > maxW && s > 7) s -= 0.25;
      const w = font.widthOfTextAtSize(text, s);
      page.drawText(text, {
        x: x0 + (x1 - x0 - w) / 2,
        y: pageH - baselineTop,
        size: s,
        font,
        color: black,
      });
    }

    wipe(444.2, 193.2, 560, 211.4);
    page.drawText(spec.dateLabel, {
      x: DATE_X,
      y: pageH - DATE_BASELINE_TOP,
      size: 14,
      font,
      color: black,
    });

    const pairs = [
      [CELLS.workersPlan, `${spec.workers}*`],
      [CELLS.workersFact, String(spec.workers)],
      [CELLS.itrPlan, `${spec.itr}*`],
      [CELLS.itrFact, String(spec.itr)],
      [CELLS.techPlan, `${spec.tech}*`],
      [CELLS.techFact, String(spec.tech)],
    ];
    for (const [[x0, x1], text] of pairs) {
      wipe(x0 + 1.4, ROW_TOP, x1 - 1.4, ROW_BOT);
      centerText(text, x0, x1, NUM_BASELINE_TOP, 12);
    }
    const sum = spec.workers + spec.itr + spec.tech;
    wipe(CELLS.sumPlan[0] + 1.4, SUM_TOP, CELLS.sumPlan[1] - 1.4, SUM_BOT);
    wipe(CELLS.sumFact[0] + 1.4, SUM_TOP, CELLS.sumFact[1] - 1.4, SUM_BOT);
    centerText(`${sum}*`, CELLS.sumPlan[0], CELLS.sumPlan[1], SUM_BASELINE_TOP, 12);
    centerText(String(sum), CELLS.sumFact[0], CELLS.sumFact[1], SUM_BASELINE_TOP, 12);
    return doc.save();
  };
}
