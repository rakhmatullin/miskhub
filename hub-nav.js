(function () {
  var items = [
    { href: "/miskhub/", match: /(index\.html)?$/, label: "Граф" },
    { href: "/miskhub/sborka.html", match: /sborka/, label: "Сборка актов" },
    { href: "/miskhub/sverka-vesov.html", match: /sverka/, label: "Сверка весов" },
  ];
  function abs(href) {
    try { return new URL(href, location.origin).pathname.replace(/\/+$/, "") || "/"; }
    catch (e) { return href; }
  }
  function patch() {
    var header = document.querySelector("header");
    if (!header) return false;
    var nav = header.querySelector("nav") || header;
    var links = nav.querySelectorAll("a");
    if (!links.length) return false;
    var sample = links[links.length - 1];
    items.forEach(function (it) {
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
    if (patch() || ++n > 80) clearInterval(t);
  }, 80);
})();
