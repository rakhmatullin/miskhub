/* overlay + shared persist */
(function () {
  const $ = (id) => document.getElementById(id);
  function dedupeTape() {
    const seen = new Set();
    document.querySelectorAll("#tape .cal-day").forEach((day) => {
      day.querySelectorAll("[data-jump]").forEach((btn) => {
        const n = String(btn.dataset.jump);
        if (seen.has(n)) btn.remove(); else seen.add(n);
      });
    });
  }
  function fixLabels() {
    document.querySelectorAll(".sent").forEach((el) => {
      if ((el.textContent || "").includes("на согласование")) {
        el.innerHTML = el.innerHTML.replace("на согласование", "на согласовании");
      }
    });
  }
  function ensureSort() {
    if ($("btnSort")) return;
    const bar = $("toolbar"); if (!bar) return;
    const b = document.createElement("button");
    b.id = "btnSort"; b.type = "button";
    const dir = localStorage.getItem("miskhub.sortDir") === "-1" ? -1 : 1;
    b.textContent = dir === 1 ? "№ ↑" : "№ ↓";
    b.addEventListener("click", () => {
      const next = localStorage.getItem("miskhub.sortDir") === "-1" ? 1 : -1;
      localStorage.setItem("miskhub.sortDir", String(next));
      b.textContent = next === 1 ? "№ ↑" : "№ ↓";
      if (window.MiskSync) window.MiskSync.savePartial({ sortDir: next });
      const tb = document.querySelector("#tableWrap tbody"); if (!tb) return;
      const rows = [...tb.querySelectorAll("tr")];
      rows.sort((a, c) => next * ((parseInt(a.id.replace("act-",""),10)||0) - (parseInt(c.id.replace("act-",""),10)||0)));
      rows.forEach((r) => tb.appendChild(r));
    });
    bar.prepend(b);
  }
  function openNotes() {
    let box = $("notes2812");
    if (!box) {
      box = document.createElement("div");
      box.id = "notes2812";
      box.innerHTML = '<div class="n2812"><h3>Фиксы и улучшения</h3><textarea id="notes2812text" placeholder="вставь текст"></textarea><div class="n2812-act"><button type="button" id="notes2812save">Сохранить</button><button type="button" id="notes2812close">Закрыть</button></div></div>';
      document.body.appendChild(box);
      box.addEventListener("click", (e) => { if (e.target === box) box.classList.remove("on"); });
      $("notes2812close").addEventListener("click", () => box.classList.remove("on"));
      $("notes2812save").addEventListener("click", async () => {
        const val = $("notes2812text").value || "";
        localStorage.setItem("miskhub.notes2812", val);
        if (window.MiskSync) await window.MiskSync.savePartial({ notes2812: val });
        box.classList.remove("on");
      });
    }
    const cur = localStorage.getItem("miskhub.notes2812") || "";
    $("notes2812text").value = cur;
    if (window.MiskSync) {
      /* hydrate from last pushed IDB on open */
    }
    box.classList.add("on");
  }
  let seq = "";
  document.addEventListener("keydown", (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    seq = (seq + e.key).slice(-4);
    if (seq === "2812") openNotes();
  });
  document.addEventListener("click", (e) => {
    const jump = e.target.closest("#tape [data-jump]");
    if (!jump) return;
    const row = document.getElementById("act-" + jump.dataset.jump);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  setInterval(function () { dedupeTape(); fixLabels(); ensureSort(); }, 400);
})();
