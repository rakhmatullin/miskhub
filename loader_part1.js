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

  src = replaceFunc(src, "makeActPdf", atob(
"YXN5bmMgZnVuY3Rpb24gbWFrZUFjdFBkZihuKSB7CiAgY29uc3QgaW5mbyA9IGF3YWl0IGxvb2t1cChu" +
    "KTsKICBpZiAoIWluZm8ub2sgfHwgIWluZm8uY2FuX2J1aWxkKSB0aHJvdyBuZXcgRXJyb3IoaW5mby5i" +
    "bG9jayB8fCBpbmZvLmVycm9yKTsKICBjb25zdCB7IFBERkRvY3VtZW50IH0gPSBQREZMaWI7CiAgY29u" +
    "c3QgcGRmID0gYXdhaXQgUERGRG9jdW1lbnQuY3JlYXRlKCk7CiAgcGRmLnJlZ2lzdGVyRm9udGtpdChm" +
    "b250a2l0KTsKICBjb25zdCBwYWdlID0gcGRmLmFkZFBhZ2UoWzU5NSwgODQyXSk7CiAgY29uc3QgZm9u" +
    "dCA9IGF3YWl0IHBkZi5lbWJlZEZvbnQoYXdhaXQgZ2V0Q3lyRm9udCgpKTsKICBjb25zdCBXID0gNTk1" +
    "LCBIID0gODQyOwogIGNvbnN0IG1pZFkgPSBIIC8gMjsKICBjb25zdCB0b3BNYXJnaW4gPSA1MCAqIDIu" +
    "ODM0NjU7CiAgY29uc3QgcGhvdG9NYXhIID0gbWlkWSAtIHRvcE1hcmdpbiAtIDE0OwogIGNvbnN0IHBo" +
    "b3RvTWF4VyA9IFcgLSA2MDsKICBwYWdlLmRyYXdUZXh0KCLQkNC60YIg0L7QsSDRg9GB0YLRgNCw0L3Q" +
    "tdC90LjQuCDihJYgIiArIG4sIHsgeDogNDAsIHk6IEggLSAzNiwgc2l6ZTogMTQsIGZvbnQgfSk7CiAg" +
    "Y29uc3QgaW50biA9IGluZm8uYWN0LmludGVncmF0aW9uIHx8ICIiOwogIGlmIChpbnRuKSBwYWdlLmRy" +
    "YXdUZXh0KCLQmNC90YIuIOKEliAiICsgaW50biwgeyB4OiA0MCwgeTogSCAtIDUyLCBzaXplOiA5LCBm" +
    "b250IH0pOwogIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBsaXN0RW50cmllcygpOwogIGNvbnN0IGJlZm9y" +
    "ZSA9IGZpbmRQaG90b0VudHJ5KGVudHJpZXMsIG4sIDEpOwogIGNvbnN0IGFmdGVyID0gZmluZFBob3Rv" +
    "RW50cnkoZW50cmllcywgbiwgMik7CiAgY29uc3Qgc2xvdHMgPSBbXTsKICBpZiAoYmVmb3JlKSBzbG90" +
    "cy5wdXNoKHsgZTogYmVmb3JlLCBsYWJlbDogItCU0J4iIH0pOwogIGlmIChhZnRlcikgc2xvdHMucHVz" +
    "aCh7IGU6IGFmdGVyLCBsYWJlbDogItCf0J7QodCb0JUiIH0pOwogIGlmIChzbG90cy5sZW5ndGgpIHsK" +
    "ICAgIGNvbnN0IGdhcCA9IDEyOwogICAgY29uc3Qgc2xvdFcgPSAocGhvdG9NYXhXIC0gKHNsb3RzLmxl" +
    "bmd0aCAtIDEpICogZ2FwKSAvIHNsb3RzLmxlbmd0aDsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc2xv" +
    "dHMubGVuZ3RoOyBpKyspIHsKICAgICAgdHJ5IHsKICAgICAgICBjb25zdCBieXRlcyA9IG5ldyBVaW50" +
    "OEFycmF5KGF3YWl0IChhd2FpdCBzbG90c1tpXS5lLmhhbmRsZS5nZXRGaWxlKCkpLmFycmF5QnVmZmVy" +
    "KCkpOwogICAgICAgIGxldCBpbWc7CiAgICAgICAgdHJ5IHsgaW1nID0gYXdhaXQgcGRmLmVtYmVkSnBn" +
    "KGJ5dGVzKTsgfSBjYXRjaCAoXykgeyBpbWcgPSBhd2FpdCBwZGYuZW1iZWRQbmcoYnl0ZXMpOyB9CiAg" +
    "ICAgICAgY29uc3Qgc2NhbGUgPSBNYXRoLm1pbihzbG90VyAvIGltZy53aWR0aCwgcGhvdG9NYXhIIC8g" +
    "aW1nLmhlaWdodCk7CiAgICAgICAgY29uc3QgZHcgPSBpbWcud2lkdGggKiBzY2FsZSwgZGggPSBpbWcu" +
    "aGVpZ2h0ICogc2NhbGU7CiAgICAgICAgY29uc3QgeCA9IDMwICsgaSAqIChzbG90VyArIGdhcCkgKyAo" +
    "c2xvdFcgLSBkdykgLyAyOwogICAgICAgIGNvbnN0IHkgPSBtaWRZICsgODsKICAgICAgICBwYWdlLmRy" +
    "YXdJbWFnZShpbWcsIHsgeCwgeSwgd2lkdGg6IGR3LCBoZWlnaHQ6IGRoIH0pOwogICAgICAgIHBhZ2Uu" +
    "ZHJhd1RleHQoc2xvdHNbaV0ubGFiZWwsIHsgeDog
