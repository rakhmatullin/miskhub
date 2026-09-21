/* overlay */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  function dedupeTape() {
    const seen = new Set();
    document.querySelectorAll("#tape .cal-day").forEach(function (day) {
      day.querySelectorAll("[data-jump]").forEach(function (btn) {
        const n = String(btn.dataset.jump);
        if (seen.has(n)) btn.remove(); else seen.add(n);
      });
    });
  }
  function scrollTapeEnd() {
    const el = $("tape");
    if (!el || el.dataset.scrolled === "1") return;
    if (!el.querySelector(".cal-day") && !el.querySelector(".today")) return;
    const today = el.querySelector(".today");
    if (today) today.scrollIntoView({ inline: "end", block: "nearest" });
    else el.scrollLeft = el.scrollWidth;
    el.dataset.scrolled = "1";
  }
  function fixLabels() {
    document.querySelectorAll(".sent").forEach(function (el) {
      if ((el.textContent || "").indexOf("на согласование") >= 0) {
        el.innerHTML = el.innerHTML.replace("на согласование", "на согласовании");
      }
    });
  }
  function ensureSort() {
    if ($("btnSort")) return;
    const bar = $("toolbar"); if (!bar) return;
    const b = document.createElement("button");
    b.id = "btnSort"; b.type = "button";
    b.textContent = "№ ↑";
    b.addEventListener("click", function () {
      const next = b.textContent.indexOf("↑") >= 0 ? -1 : 1;
      b.textContent = next === 1 ? "№ ↑" : "№ ↓";
      const tb = document.querySelector("#tableWrap tbody"); if (!tb) return;
      const rows = Array.from(tb.querySelectorAll("tr"));
      rows.sort(function (a, c) {
        return next * ((parseInt(a.id.replace("act-",""),10)||0) - (parseInt(c.id.replace("act-",""),10)||0));
      });
      rows.forEach(function (r) { tb.appendChild(r); });
    });
    bar.prepend(b);
  }
  async function hydrateNotes(box) {
    var val = "";
    try {
      const r = await fetch("https://kvs.ix.workers.dev/miskhub-akty-state-rakhmatullin-2026.json?t=" + Date.now(), { cache: "no-store", mode: "cors" });
      if (r.ok) {
        const s = await r.json();
        val = s.notes2812 || "";
      }
    } catch (e) {}
    if (!val) val = localStorage.getItem("miskhub.notes2812") || "";
    $("notes2812text").value = val;
  }
  function openNotes() {
    let box = $("notes2812");
    if (!box) {
      box = document.createElement("div");
      box.id = "notes2812";
      box.innerHTML = '<div class="n2812"><h3>Фиксы и улучшения</h3><textarea id="notes2812text" placeholder="вставь текст"></textarea><div class="n2812-act"><button type="button" id="notes2812save">Сохранить</button><button type="button" id="notes2812close">Закрыть</button></div></div>';
      document.body.appendChild(box);
      box.addEventListener("click", function (e) { if (e.target === box) box.classList.remove("on"); });
      $("notes2812close").addEventListener("click", function () { box.classList.remove("on"); });
      $("notes2812save").addEventListener("click", async function () {
        const val = $("notes2812text").value || "";
        localStorage.setItem("miskhub.notes2812", val);
        $("notes2812save").textContent = "сохраняю…";
        try {
          if (window.MiskSync) await window.MiskSync.savePartial({ notes2812: val });
          else {
            const r = await fetch("https://kvs.ix.workers.dev/miskhub-akty-state-rakhmatullin-2026.json?t=" + Date.now());
            const s = r.ok ? await r.json() : {};
            s.notes2812 = val; s.updatedAt = Date.now();
            await fetch("https://kvs.ix.workers.dev/miskhub-akty-state-rakhmatullin-2026.json", { method: "PUT", mode: "cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
          }
          $("notes2812save").textContent = "сохранено";
        } catch (e) {
          $("notes2812save").textContent = "ошибка";
        }
        setTimeout(function () { $("notes2812save").textContent = "Сохранить"; box.classList.remove("on"); }, 500);
      });
    }
    hydrateNotes(box);
    box.classList.add("on");
  }
  var seq = "";
  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    seq = (seq + e.key).slice(-4);
    if (seq === "2812") openNotes();
  });
  document.addEventListener("click", function (e) {
    const jump = e.target.closest("#tape [data-jump]");
    if (!jump) return;
    const row = document.getElementById("act-" + jump.dataset.jump);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  setInterval(function () { dedupeTape(); fixLabels(); ensureSort(); scrollTapeEnd(); }, 400);
})();
