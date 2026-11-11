(function () {
  function clean() {
    var nav = document.querySelector("nav.tools, .tools");
    if (!nav) return;
    if (nav.dataset.tools) return;
    nav.dataset.tools = "1";
    var path = location.pathname;
    var page = document.body && document.body.dataset.page;
    var byPage = { sborka: "sborka.html", sverka: "sverka-vesov.html", ttr: "ttr.html" };
    function on(file) {
      if (page && byPage[page]) return byPage[page] === file;
      if (file === "index.html") return /\/$/.test(path) || /\/index\.html$/.test(path) || /\/miskhub$/.test(path);
      return path.indexOf("/" + file) !== -1;
    }
    var isIndex = /\/index\.html$|\/$/.test(location.pathname);
    var items = isIndex ? [["sborka.html", "Замечания"], ["sverka-vesov.html", "Сверка весов"], ["ttr.html", "Фиксация ТТР"], ["pdf-master.html", "PDF Master"]] : [];
    nav.innerHTML = items.map(function (it) {
      return '<a href="./' + it[0] + '"' + (on(it[0]) ? ' class="on"' : "") + ">" + it[1] + "</a>";
    }).join("");
  }
  var n = 0;
  var t = setInterval(function () { clean(); if (++n > 150) clearInterval(t); }, 80);
  if (window.MutationObserver) {
    var obs = new MutationObserver(clean);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 20000);
  }
})();

(function() {
  var header = document.querySelector("header.top, header");
  if (!header) return;
  var ver = document.createElement("span");
  ver.textContent = "версия 2.0";
  ver.style.cssText = "margin-left:auto;font-size:12px;opacity:0.7;color:#8ea0c0";
  header.appendChild(ver);
})();

(function () {
  function ensure() {
    var nav = document.querySelector("header nav");
    if (!nav) return;
    if (nav.querySelector('a[href*="pdf-master"]')) return;
    var a = document.createElement("a");
    a.href = "./pdf-master.html";
    a.textContent = "PDF Master";
    a.style.cssText = "flex:none;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;color:#9ec4ff;text-decoration:none;white-space:nowrap";
    if (location.pathname.indexOf("pdf-master") !== -1) a.style.color = "#fff";
    nav.appendChild(a);
  }
  var n = 0;
  var t = setInterval(function () {
    ensure();
    if (++n > 40) clearInterval(t);
  }, 100);
})();
