    $("actDate")?.addEventListener("change", () => { renderActDate(); persistMeta(); });
    $("q")?.addEventListener("input", renderTable);
    $("btnXlsx")?.addEventListener("click", downloadList);
    $("btnActs")?.addEventListener("click", downloadActsOnly);
    $("btnPack")?.addEventListener("click", downloadPack);
    $("btnProject")?.addEventListener("click", downloadProject);
    $("fileProject")?.addEventListener("change", () => { const f = $("fileProject").files[0]; if (f) restoreProject(f); });
    $("tapeToggle")?.addEventListener("click", (e) => {
      e.preventDefault();
      const folded = localStorage.getItem("miskhub.tape.folded") !== "0";
      localStorage.setItem("miskhub.tape.folded", folded ? "0" : "1");
      applyTapeFold();
    });
    $("btnSort")?.addEventListener("click", async () => {
      S.sortDir = S.sortDir === -1 ? 1 : -1;
      await persistMeta();
      if ($("btnSort")) $("btnSort").textContent = S.sortDir === 1 ? "№ ↑" : "№ ↓";
      renderTable();
    });
    if ($("btnSort")) $("btnSort").textContent = S.sortDir === 1 ? "№ ↑" : "№ ↓";
    let seq = "";
    document.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      seq = (seq + e.key).slice(-4);
      if (seq === "2812") openNotes2812();
    });
    $("tape")?.addEventListener("click", (e) => {
      const jump = e.target.closest("[data-jump]");
      if (jump) {
        e.preventDefault();
        const row = document.getElementById("act-" + jump.dataset.jump);
        if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    });
    $("tableWrap")?.addEventListener("change", async (e) => {
      const sent = e.target.closest("input[data-sent]");
      if (sent) {
        if (sent.checked) S.sent.add(String(sent.dataset.sent));
        else S.sent.delete(String(sent.dataset.sent));
        await persistMeta();
        return;
      }
      const inp = e.target.closest("input[data-slot]");
      if (inp && inp.files[0]) await onPhotoFile(inp.dataset.slot, inp.files[0]);
    });
    $("tableWrap")?.addEventListener("click", async (e) => {
      const jump = e.target.closest("[data-jump]");
      if (jump) { e.preventDefault(); const row = document.getElementById("act-" + jump.dataset.jump); if (row) row.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      const view = e.target.closest("[data-view]");
      if (view) { e.preventDefault(); e.stopPropagation(); openLightbox(view.getAttribute("src"), view.getAttribute("alt")); return; }
      const dl = e.target.closest("[data-dl]");
      if (dl) {
        e.preventDefault(); e.stopPropagation();
        const ph = S.photos.get(dl.dataset.dl);
        if (!ph) return;
        saveBlob(ph.blob, ph.name || (dl.dataset.dl + ".jpg"));
        return;
      }
      const rot = e.target.closest("[data-rot]");
      if (rot) {
        e.preventDefault(); e.stopPropagation();
        await rotatePhoto(rot.dataset.rot, Number(rot.dataset.dir));
        return;
      }
      const comm = e.target.closest("[data-comm]");
      if (comm) {
        e.preventDefault();
        const num = comm.dataset.comm;
        const next = prompt("Комментарий к акту №" + num, S.comments[num] || "");
        if (next == null) return;
        if (next.trim()) S.comments[num] = next.trim(); else delete S.comments[num];
        await persistMeta();
        refresh({ y: window.scrollY });
        return;
      }
      const actFoto = e.target.closest("[data-actfoto]");
      if (actFoto) {
        e.preventDefault();
        const row = S.rows.find((r) => String(r.num) === String(actFoto.dataset.actfoto));
        if (!row) return;
        try {
          if (S.tplReady) await S.tplReady;
          saveBlob(await makeActBlob(row, true), actFileName(row.num).replace(".docx", "_фото.docx"));
        } catch (err) { alert(err.message || err); }
        return;
      }
      const actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        e.preventDefault();
        const row = S.rows.find((r) => String(r.num) === String(actBtn.dataset.act));
        if (!row) return;
        try {
          if (S.tplReady) await S.tplReady;
          saveBlob(await makeActBlob(row, false), actFileName(row.num));
        } catch (err) { alert(err.message || err); }
        return;
      }
      const btn = e.target.closest("[data-del]");
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      const key = btn.dataset.del;
      if (!confirm("Удалить фото " + key + "?")) return;
      await photoDel(key); refresh();
    });
    document.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
    document.addEventListener("drop", async (e) => {
      const named = [...(e.dataTransfer?.files || [])].filter((f) => /^\d+_[12]\.\w+$/i.test(f.name));
      if (!named.length) return; e.preventDefault();
      for (const f of named) { const m = f.name.match(/^(\d+)_([12])\./i); await onPhotoFile(`${m[1]}_${m[2]}`, f); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
