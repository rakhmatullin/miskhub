/* MiskHub ustranenie 2.0 */
(function () {
  const ST = { x: ["X", "не исправлено"], in_progress: [".", "в работе"], question: ["?", "решить"], sent_albert: ["А", "Альберту"], shoot: ["кам", "сфоткать"] };
  const DB_NAME = "miskhub-ustranenie";
  let db, state;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&", "<": "<", ">": ">", '"': """ }[c]));
  function openDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta"); if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  function idbGet(store, key) { return new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  function idbPut(store, key, val) { return new Promise((res, rej) => { const q = db.transaction(store, "readwrite").objectStore(store).put(val, key); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); }
  async function loadState() { state = (await idbGet("meta", "state")) || { acts: {}, version: 1 }; if (!state.acts) state.acts = {}; }
  async function saveState() { state.version = (state.version || 1) + 1; await idbPut("meta", "state", state); }
  function parseDate(v) { if (v == null) return ""; const m = String(v).match(/(\d{1,2})[.](\d{1,2})[.](\d{4})/); return m ? m[1].padStart(2,"0")+"."+m[2].padStart(2,"0")+"."+m[3] : ""; }
  function dumpStatus(raw) { const s = String(raw || "").trim(); if (s === "Закрыто") return "closed"; if (s === "Удалено") return "deleted"; return "to_fix"; }
  function parseDump(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = () => rej(fr.error);
      fr.onload = () => {
        const wb = XLSX.read(fr.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        let hi = -1, map = {};
        for (let i = 0; i < Math.min(20, rows.length); i++) {
          const idx = {}; (rows[i] || []).forEach((v, c) => { if (String(v).trim()) idx[String(v).trim()] = c; });
          if (idx["Номер"] != null && idx["Статус"] != null) { hi = i; map = idx; break; }
        }
        if (hi < 0) return rej(new Error("нет строки Номер/Статус"));
        const out = [];
        for (let r = hi + 1; r < rows.length; r++) {
          const row = rows[r] || [];
          const n = parseInt(String(row[map["Номер"]] || "").trim(), 10);
          if (!n) continue;
          out.push({ act_no: n, dump_date: parseDate(row[map["Дата"]]), deadline: parseDate(row[map["Срок устранения"]]), dump_status: dumpStatus(row[map["Статус"]]), dump_description: String(row[map["Описание"]] || "").trim() });
        }
        res(out);
      };
      fr.readAsArrayBuffer(file);
    });
  }
  function previewDiff(incoming) {
    const neu = [], closed = [], reopened = [];
    incoming.forEach((inc) => {
      const old = state.acts[inc.act_no];
      if (!old && inc.dump_status === "to_fix") neu.push(inc.act_no);
      if (old && old.dump_status === "to_fix" && inc.dump_status !== "to_fix") closed.push(inc.act_no);
      if (old && old.dump_status !== "to_fix" && inc.dump_status === "to_fix") reopened.push(inc.act_no);
    });
    return { incoming, neu, closed, reopened };
  }
  async function applyDiff(incoming) {
    incoming.forEach((inc) => {
      const old = state.acts[inc.act_no] || {};
      state.acts[inc.act_no] = Object.assign({}, old, { act_no: inc.act_no, dump_date: inc.dump_date, deadline: inc.deadline, dump_status: inc.dump_status, dump_description: inc.dump_description, team_status: old.team_status || "x", location: old.location || "", comment: old.comment || "", hidden: inc.dump_status !== "to_fix", photo_before: old.photo_before || null, photo_after: old.photo_after || null, version: (old.version || 0) + 1 });
    });
    await saveState();
  }
  function list(archive) { return Object.values(state.acts).filter((a) => !!a.hidden === archive).sort((a, b) => a.act_no - b.act_no); }
  function fotoLabel(a) { if (a.photo_before && a.photo_after) return "ДО+ПОСЛЕ"; if (a.photo_before) return "ДО"; if (a.photo_after) return "ПОСЛЕ"; return "нет"; }
  function dot(st) { return '<span class="dot ' + (st || "x") + '">' + ((ST[st] || [st])[0]) + "</span>"; }
  function render() {
    const q = ($("#q").value || "").toLowerCase();
    const filt = (a) => !q || String(a.act_no).includes(q) || (a.comment || "").toLowerCase().includes(q) || (a.location || "").toLowerCase().includes(q) || (a.dump_description || "").toLowerCase().includes(q);
    const live = list(false).filter(filt);
    const arch = list(true).filter(filt);
    $("#nLive").textContent = list(false).length;
    $("#nArch").textContent = list(true).length;
    $("#nFoto").textContent = list(false).filter((a) => a.photo_before).length;
    $("#archN").textContent = "(" + list(true).length + ")";
    const head = '<table class="table"><thead><tr><th>№</th><th>Дата</th><th>Статус</th><th>Фото</th><th>Локация</th><th>Комментарий</th></tr></thead><tbody>';
    $("#tableWrap").innerHTML = head + (live.map((a) => '<tr data-no="' + a.act_no + '"><td class="num">' + a.act_no + "</td><td>" + esc(a.dump_date) + "</td><td>" + dot(a.team_status) + "</td><td>" + fotoLabel(a) + "</td><td>" + esc(a.location) + "</td><td>" + esc(a.comment) + "</td></tr>").join("") || '<tr><td colspan="6">загрузите выгрузку</td></tr>') + "</tbody></table>";
    $("#archWrap").innerHTML = '<table class="table"><thead><tr><th>№</th><th>Дата</th><th>Выгрузка</th><th>Фото</th><th>Описание</th></tr></thead><tbody>' + arch.map((a) => '<tr data-no="' + a.act_no + '"><td class="num">' + a.act_no + "</td><td>" + esc(a.dump_date) + "</td><td>" + a.dump_status + "</td><td>" + fotoLabel(a) + "</td><td class="desc">" + esc(a.dump_description) + "</td></tr>").join("") + "</tbody></table>";
  }
  async function photoUrl(id) { if (!id) return ""; const blob = await idbGet("photos", id); return blob ? URL.createObjectURL(blob) : ""; }
  function slotHtml(kind, title, url) {
    return '<div class="drop static"><strong>' + title + "</strong>" + (url ? '<img src="' + url + '" alt="' + title + '" style="width:100%;max-height:240px;object-fit:contain;margin:8px 0;border-radius:8px">' : "<em>нет фото</em>") + '<div class="slot-tools"><label class="btn-file">загрузить<input type="file" accept="image/*" data-up="' + kind + '" hidden></label>' + (url ? '<button type="button" data-rot="' + kind + '" data-deg="-90">↺</button><button type="button" data-rot="' + kind + '" data-deg="90">↻</button>' : "") + '</div><div class="bar" id="bar-' + kind + '"><i></i></div></div>';
  }
  async function openAct(no) {
    const a = state.acts[no]; if (!a) return;
    const ub = await photoUrl(a.photo_before); const ua = await photoUrl(a.photo_after);
    $("#card").innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h2 style="margin:0">Акт № ' + a.act_no + '</h2><button type="button" id="closeCard">закрыть</button></div><p class="lead">' + esc(a.dump_description) + " · предписание " + esc(a.dump_date) + " · срок " + esc(a.deadline) + '</p><div class="toolbar"><select id="st">' + Object.entries(ST).map(([k, v]) => '<option value="' + k + '"' + (a.team_status === k ? " selected" : "") + ">" + v[0] + " " + v[1] + "</option>").join("") + '</select><input id="loc" placeholder="локация" value="' + esc(a.location) + '"></div><textarea id="com" rows="2" style="width:100%;background:#09111e;color:#e8eefc;border:1px solid #1c2a44;border-radius:8px;padding:8px">' + esc(a.comment) + '</textarea><div class="toolbar"><button class="primary" id="saveMeta">Сохранить</button></div><div class="slots2">' + slotHtml("before", "ДО", ub) + slotHtml("after", "ПОСЛЕ", ua) + '</div><p class="kicker" id="uphint"></p>';
    $("#modal").classList.add("on");
    $("#closeCard").onclick = () => $("#modal").classList.remove("on");
    $("#saveMeta").onclick = async () => { a.team_status = $("#st").value; a.location = $("#loc").value; a.comment = $("#com").value; a.version = (a.version || 0) + 1; await saveState(); render(); $("#uphint").textContent = "сохранено"; };
    $("#card").querySelectorAll("input[data-up]").forEach((inp) => { inp.onchange = (ev) => upload(a, inp.dataset.up, ev.target.files[0]); });
    $("#card").querySelectorAll("button[data-rot]").forEach((b) => { b.onclick = () => rotate(a, b.dataset.rot, +b.dataset.deg); });
  }
  function readFileProgress(file, barId) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onprogress = (e) => { if (e.lengthComputable) { const el = document.querySelector("#" + barId + " i"); if (el) el.style.width = (e.loaded / e.total) * 100 + "%"; } };
      fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(file);
    });
  }
  async function normalizeBlob(blob, deg) {
    const bmp = await createImageBitmap(blob);
    const swap = Math.abs(deg) % 180 === 90;
    const w = swap ? bmp.height : bmp.width, h = swap ? bmp.width : bmp.height;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); ctx.translate(w / 2, h / 2); ctx.rotate(((deg || 0) * Math.PI) / 180); ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.92));
  }
  async function upload(a, kind, file) {
    if (!file) return;
    await readFileProgress(file, "bar-" + kind);
    let blob = file; try { blob = await normalizeBlob(file, 0); } catch (e) { blob = file; }
    const id = kind + "-" + a.act_no + "-" + Date.now();
    await idbPut("photos", id, blob);
    if (kind === "before") a.photo_before = id; else a.photo_after = id;
    await saveState(); openAct(a.act_no); render();
  }
  async function rotate(a, kind, deg) {
    const pid = kind === "before" ? a.photo_before : a.photo_after; if (!pid) return;
    const next = await normalizeBlob(await idbGet("photos", pid), deg);
    const id = kind + "-" + a.act_no + "-" + Date.now();
    await idbPut("photos", id, next);
    if (kind === "before") a.photo_before = id; else a.photo_after = id;
    await saveState(); openAct(a.act_no); render();
  }
  async function boot() {
    db = await openDb(); await loadState(); render();
    document.body.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-no]"); if (tr) openAct(+tr.dataset.no); });
    $("#q").oninput = render;
    $("#dumpFile").onchange = async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      $("#hint").textContent = "разбор…";
      try {
        const d = previewDiff(await parseDump(f));
        $("#diffBox").innerHTML = '<div class="cloud-bar"><div>новые: ' + (d.neu.join(", ") || "—") + "<br>закрыть: " + (d.closed.join(", ") || "—") + "<br>вернуть: " + (d.reopened.join(", ") || "—") + '</div><div class="cloud-actions"><button class="primary" id="applyDump">Применить</button><button id="cancelDump">Отмена</button></div></div>';
        $("#applyDump").onclick = async () => { await applyDiff(d.incoming); $("#diffBox").innerHTML = ""; render(); };
        $("#cancelDump").onclick = () => { $("#diffBox").innerHTML = ""; };
      } catch (err) { alert(err.message || err); }
      ev.target.value = ""; $("#hint").textContent = "";
    };
  }
  boot();
})();
