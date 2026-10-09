(function () {
  var keep = [
    { href: "/miskhub/", match: /(^\/miskhub$)|index\.html/, label: "Граф" },
    { href: "/miskhub/sborka.html", match: /sborka/, label: "Сборка актов" },
    { href: "/miskhub/sverka-vesov.html", match: /sverka/, label: "Сверка весов" }
  ];
  var drop = /ustranenie|akty\.html|(^|\/)akty$|fotofiks|фотофикс|устранен|акты об/i;
  function abs(href) {
    try { return new URL(href, location.origin).pathname.replace(/\/+$/, "") || "/"; }
    catch (e) { return href || ""; }
  }
  function clean() {
    var header = document.querySelector("header");
    if (!header) return false;
    var nav = header.querySelector("nav") || header;
    var links = nav.querySelectorAll("a");
    if (!links.length) return false;
    links.forEach(function (a) {
      var h = abs(a.getAttribute("href") || "");
      var text = (a.textContent || "").trim();
      if (drop.test(h) || drop.test(text)) a.remove();
    });
    var sample = nav.querySelector("a");
    if (!sample) return false;
    keep.forEach(function (it) {
      var exists = false;
      nav.querySelectorAll("a").forEach(function (a) {
        var h = abs(a.getAttribute("href") || "");
        if (it.match.test(h) || (a.textContent || "").trim() === it.label) exists = true;
      });
      if (exists) return;
      var a = document.createElement("a");
      a.href = it.href;
      a.textContent = it.label;
      a.className = sample.className;
      nav.appendChild(a);
    });
    return true;
  }
  var n = 0;
  var t = setInterval(function () {
    clean();
    if (++n > 150) clearInterval(t);
  }, 100);
  if (window.MutationObserver) {
    var obs = new MutationObserver(clean);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 20000);
  }
})();
