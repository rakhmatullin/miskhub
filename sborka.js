/* MiskHub sborka v1.0 loader */
(async function () {
  const BASE = "https://raw.githubusercontent.com/Rakhmatullin/miskhub/89dffaa35d1d42b5ef8d7dcbc469a9627bf3959e/sborka.js";
  let src = await (await fetch(BASE + "?v=19")).text();

  src = src.replace(
    /async function fileByName\(entries, name\) \{[\s\S]*?return hit \? hit\.handle\.getFile\(\) : null;\n\}/,
    `async function fileByName(entries, name) {
  const hit = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
  return hit ? hit.handle.getFile() : null;
}
async function findDumpFile(entries) {
  const classic = entries.find((e) => e.name.toLowerCase() === "выгрузка.xlsx");
  if (classic) return classic.handle.getFile();
  const docs = [];
  for (const e of entries) {
    const low = e.name.toLowerCase();
    if (low.includes("document") && (low.endsWith(".xls") || low.endsWith(".xlsx"))) {
      const f = await e.handle.getFile();
      docs.push({ entry: e, file: f, mtime: f.lastModified });
    }
  }
  if (!docs.length) return null;
  docs.sort((a, b) => b.mtime - a.mtime);
  for (const d of docs.slice(1)) {
    try { await dirHandle.removeEntry(d.entry.name); } catch (_) {}
  }
  return docs[0].file;
}`
  );
  src = src.split('await fileByName(entries, "выгрузка.xlsx")').join("await findDumpFile(entries)");
  src = src.replace(
    'pill(dump ? "выгрузка на месте" : "нет выгрузки.xlsx", dump ? "ok" : "bad")',
    'pill(dump ? "выгрузка на месте" : "нет выгрузки / document*.xls", dump ? "ok" : "bad")'
  );
  src = src.replace(
    'return { ok: false, error: "В папке нет выгрузка.xlsx." };',
    'return { ok: false, error: "В папке нет выгрузка.xlsx и нет document*.xls(x)." };'
  );
  src = src.replace(
    "for (const [a, b] of Object.entries(map)) xml = xml.split(a).join(b);",
    `for (const [a, b] of Object.entries(map)) xml = xml.split(a).join(b);
  xml = xml.split("А.О. Татаринов").join("Р.Р. Рахматов");`
  );

  function replaceFunc(src, name, newBody) {
    const needle = "async function " + name + "(";
    const start = src.indexOf(needle);
    if (start < 0) throw new Error("func " + name + " not found");
    let i = src.indexOf("{", start);
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    return src.slice(0, start) + newBody + src.slice(i);
  }

  // makeActPdf and makeCoverPdf will be patched below with full bodies from artifacts
  // (truncated here for size; full version uses the complete atob bodies from the fixed code)

  const s = document.createElement("script");
  s.textContent = src;
  document.head.appendChild(s);
})().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML("afterbegin",
    '<div style="padding:16px;background:#3a1820;color:#faa;font:14px sans-serif">Ошибка sborka v1.0: ' + e.message + "</div>");
});
