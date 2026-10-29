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
    "ZHJhd1RleHQoc2xvdHNbaV0ubGFiZWwsIHsgeDogeCArIGR3IC8gMiAtIDEyLCB5OiB5IC0gMTIsIHNp" +
    "emU6IDgsIGZvbnQgfSk7CiAgICAgIH0gY2F0Y2ggKF8pIHt9CiAgICB9CiAgfQogIGxldCB5ID0gbWlk" +
    "WSAtIDI0OwogIHBhZ2UuZHJhd1RleHQoItCj0YHRgtGA0LDQvdGR0L3QvdGL0LUg0LfQsNC80LXRh9Cw" +
    "0L3QuNGPOiIsIHsgeDogNDAsIHksIHNpemU6IDExLCBmb250IH0pOwogIHkgLT0gMTY7CiAgbGV0IHJl" +
    "c3QgPSAoaW5mby5hY3QuZGVzY3JpcHRpb24gfHwgIuKAlCIpOwogIGNvbnN0IG1heENoYXJzID0gOTA7" +
    "CiAgd2hpbGUgKHJlc3QgJiYgeSA+IDYwKSB7CiAgICBsZXQgbGluZSA9IHJlc3Quc2xpY2UoMCwgbWF4" +
    "Q2hhcnMpOwogICAgaWYgKHJlc3QubGVuZ3RoID4gbWF4Q2hhcnMpIHsKICAgICAgY29uc3QgY3V0ID0g" +
    "bGluZS5sYXN0SW5kZXhPZigiICIpOwogICAgICBpZiAoY3V0ID4gNDApIGxpbmUgPSBsaW5lLnNsaWNl" +
    "KDAsIGN1dCk7CiAgICB9CiAgICBwYWdlLmRyYXdUZXh0KGxpbmUsIHsgeDogNDAsIHksIHNpemU6IDEw" +
    "LCBmb250LCBtYXhXaWR0aDogNTE1IH0pOwogICAgcmVzdCA9IHJlc3Quc2xpY2UobGluZS5sZW5ndGgp" +
    "LnRyaW1TdGFydCgpOwogICAgeSAtPSAxNDsKICB9CiAgeSAtPSA4OwogIHBhZ2UuZHJhd1RleHQoItCU" +
    "0LDRgtCwINC/0YDQtdC00L/QuNGB0LDQvdC40Y86ICIgKyAoaW5mby5hY3QucHJlZF9kYXRlIHx8ICLi" +
    "gJQiKSArICIgICAg0KHRgNC+0Lo6ICIgKyAoaW5mby5hY3QuZGVhZGxpbmUgfHwgIuKAlCIpLCB7IHg6" +
    "IDQwLCB5LCBzaXplOiA5LCBmb250IH0pOwogIHkgLT0gMTQ7CiAgY29uc3QgcmF3ID0gY29tbWVudHNb" +
    "U3RyaW5nKG4pXTsKICBjb25zdCBjYyA9IChyYXcgJiYgdHlwZW9mIHJhdyA9PT0gIm9iamVjdCIpID8g" +
    "cmF3IDogeyBjMTogcmF3IHx8ICIiLCBjMjogIiIgfTsKICBjb25zdCBjMW4gPSAoY29sTmFtZXMgJiYg" +
    "Y29sTmFtZXMuYzEpIHx8ICLQmtC+0LzQvNC10L3RgtCw0YDQuNC5IjsKICBjb25zdCBjMm4gPSAoY29s" +
    "TmFtZXMgJiYgY29sTmFtZXMuYzIpIHx8ICLQn9GA0LjQvNC10YfQsNC90LjQtSI7CiAgaWYgKGNjLmMx" +
    "IHx8IGNjLmMyKSB7CiAgICBwYWdlLmRyYXdUZXh0KGMxbiArICI6ICIgKyAoY2MuYzEgfHwgIuKAlCIp" +
    "ICsgIiAgICAiICsgYzJuICsgIjogIiArIChjYy5jMiB8fCAi4oCUIiksIHsgeDogNDAsIHksIHNpemU6" +
    "IDksIGZvbnQsIG1heFdpZHRoOiA1MTUgfSk7CiAgfQogIHJldHVybiBhd2FpdCBwZGYuc2F2ZSgpOwp9"
  ));
  src = replaceFunc(src, "makeCoverPdf", atob(
"YXN5bmMgZnVuY3Rpb24gbWFrZUNvdmVyUGRmKG5vcykgewogIGNvbnN0IHsgUERGRG9jdW1lbnQgfSA9" +
    "IFBERkxpYjsKICBjb25zdCBwZGYgPSBhd2FpdCBQREZEb2N1bWVudC5jcmVhdGUoKTsKICBwZGYucmVn" +
    "aXN0ZXJGb250a2l0KGZvbnRraXQpOwogIGNvbnN0IHBhZ2UgPSBwZGYuYWRkUGFnZShbNTk1LCA4NDJd" +
    "KTsKICBjb25zdCBmb250ID0gYXdhaXQgcGRmLmVtYmVkRm9udChhd2FpdCBnZXRDeXJGb250KCkpOwog" +
    "IGNvbnN0IGJvbGQgPSBmb250OwogIHBhZ2UuZHJhd1RleHQoItCe0LHQu9C+0LbQutCwINCw0LrRgtC+" +
    "0LIg0L7QsSDRg9GB0YLRgNCw0L3QtdC90LjQuCIsIHsgeDogMzAsIHk6IDgxMCwgc2l6ZTogMTMsIGZv" +
    "bnQ6IGJvbGQgfSk7CiAgcGFnZS5kcmF3VGV4dCgi0J3QtdC30LDQutGA0YvRgtGL0YUgKNC6INGD0YHR" +
    "gtGA0LDQvdC10L3QuNGOKTogIiArIG5vcy5sZW5ndGgsIHsgeDogMzAsIHk6IDc5Miwgc2l6ZTogMTAs" +
    "IGZvbnQgfSk7CiAgbGV0IHkgPSA3NzA7CiAgY29uc3QgYzFuID0gKGNvbE5hbWVzICYmIGNvbE5hbWVz" +
    "LmMxKSB8fCAi0JrQvtC80LzQtdC90YLQsNGA0LjQuSI7CiAgY29uc3QgYzJuID0gKGNvbE5hbWVzICYm" +
    "IGNvbE5hbWVzLmMyKSB8fCAi0J/RgNC40LzQtdGH0LDQvdC40LUiOwogIHBhZ2UuZHJhd1RleHQoIuKE" +
    "liIsIHsgeDogMzAsIHksIHNpemU6IDgsIGZvbnQ6IGJvbGQgfSk7CiAgcGFnZS5kcmF3VGV4dCgi0JjQ" +
    "vdGCLiDihJYiLCB7IHg6IDYwLCB5LCBzaXplOiA4LCBmb250OiBib2xkIH0pOwogIHBhZ2UuZHJhd1Rl" +
    "eHQoItCe0L/QuNGB0LDQvdC40LUiLCB7IHg6IDExNSwgeSwgc2l6ZTogOCwgZm9udDogYm9sZCB9KTsK" +
    "ICBwYWdlLmRyYXdUZXh0KGMxbi5zbGljZSgwLCAxMiksIHsgeDogMzQwLCB5LCBzaXplOiA4LCBmb250" +
    "OiBib2xkIH0pOwogIHBhZ2UuZHJhd1RleHQoYzJuLnNsaWNlKDAsIDEyKSwgeyB4OiA0NTUsIHksIHNp" +
    "emU6IDgsIGZvbnQ6IGJvbGQgfSk7CiAgeSAtPSA0OwogIHBhZ2UuZHJhd0xpbmUoeyBzdGFydDogeyB4" +
    "OiAzMCwgeSB9LCBlbmQ6IHsgeDogNTY1LCB5IH0sIHRoaWNrbmVzczogMC41IH0pOwogIHkgLT0gMTE7" +
    "CiAgY29uc3Qgcm93SCA9IE1hdGgubWF4KDksIE1hdGgubWluKDE0LCAoeSAtIDI4KSAvIE1hdGgubWF4" +
    "KG5vcy5sZW5ndGgsIDEpKSk7CiAgZm9yIChjb25zdCBuIG9mIG5vcykgewogICAgaWYgKHkgPCAyOCkg" +
    "YnJlYWs7CiAgICBjb25zdCBpbmZvID0gYXdhaXQgbG9va3VwKG4pOwogICAgY29uc3QgaW50biA9IGlu" +
    "Zm8ub2sgPyAoaW5mby5hY3QuaW50ZWdyYXRpb24gfHwgIuKAlCIpIDogIuKAlCI7CiAgICBjb25zdCBk" +
    "ZXNjID0gaW5mby5vayA/IChpbmZvLmFjdC5kZXNjcmlwdGlvbiB8fCAiIikuc2xpY2UoMCwgNDIpIDog" +
    "IiI7CiAgICBjb25zdCByYXcgPSBjb21tZW50c1tTdHJpbmcobildOwogICAgY29uc3QgY2MgPSAocmF3" +
    "ICYmIHR5cGVvZiByYXcgPT09ICJvYmplY3QiKSA/IHJhdyA6IHsgYzE6IHJhdyB8fCAiIiwgYzI6ICIi" +
    "IH07CiAgICBwYWdlLmRyYXdUZXh0KFN0cmluZyhuKSwgeyB4OiAzMCwgeSwgc2l6ZTogNywgZm9udCB9" +
    "KTsKICAgIHBhZ2UuZHJhd1RleHQoU3RyaW5nKGludG4pLCB7IHg6IDYwLCB5LCBzaXplOiA3LCBmb250" +
    "IH0pOwogICAgcGFnZS5kcmF3VGV4dChkZXNjLCB7IHg6IDExNSwgeSwgc2l6ZTogNywgZm9udCwgbWF4" +
    "V2lkdGg6IDIxNSB9KTsKICAgIHBhZ2UuZHJhd1RleHQoKGNjLmMxIHx8ICIiKS5zbGljZSgwLCAyMiks" +
    "IHsgeDogMzQwLCB5LCBzaXplOiA3LCBmb250LCBtYXhXaWR0aDogMTEwIH0pOwogICAgcGFnZS5kcmF3" +
    "VGV4dCgoY2MuYzIgfHwgIiIpLnNsaWNlKDAsIDIyKSwgeyB4OiA0NTUsIHksIHNpemU6IDcsIGZvbnQs" +
    "IG1heFdpZHRoOiAxMTAgfSk7CiAgICB5IC09IHJvd0g7CiAgfQogIHJldHVybiBhd2FpdCBwZGYuc2F2" +
    "ZSgpOwp9"
  ));

  const s = document.createElement("script");
  s.textContent = src;
  document.head.appendChild(s);
})().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML("afterbegin",
    '<div style="padding:16px;background:#3a1820;color:#faa;font:14px sans-serif">Ошибка sborka v1.0: ' + e.message + "</div>");
});
