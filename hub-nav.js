(function () {
  var LOGO = "data:image/png;base64,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";
  function styleBrand(a) {
    if (!a || a.dataset.branded) return;
    a.dataset.branded = "1";
    a.style.display = "inline-flex";
    a.style.alignItems = "center";
    a.style.gap = "8px";
    a.style.letterSpacing = "0.32em";
    a.style.textTransform = "uppercase";
    a.style.fontWeight = "500";
    a.style.fontSize = "13px";
    a.style.textDecoration = "none";
    var img = a.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      a.insertBefore(img, a.firstChild);
    }
    img.src = LOGO;
    img.alt = "";
    img.width = 15;
    img.height = 15;
    img.style.width = "15px";
    img.style.height = "15px";
    img.style.display = "block";
    if (!a.querySelector("span")) {
      var text = "";
      a.childNodes.forEach(function (n) {
        if (n.nodeType === 3) text += n.textContent;
      });
      text = text.trim();
      if (text) {
        a.childNodes.forEach(function (n) {
          if (n.nodeType === 3) n.textContent = "";
        });
        var span = document.createElement("span");
        span.textContent = text;
        a.appendChild(span);
      }
    }
  }
  function clean() {
    var header = document.querySelector("header");
    if (!header) return false;
    var nav = header.querySelector("nav");
    if (nav) nav.remove();
    var brand = header.querySelector("a");
    if (brand) styleBrand(brand);
    return !!brand;
  }
  var n = 0;
  var t = setInterval(function () { clean(); if (++n > 150) clearInterval(t); }, 80);
  if (window.MutationObserver) {
    var obs = new MutationObserver(clean);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 20000);
  }
})();
