(function () {
  var LOGO = "/miskhub/assets/logo.svg";
  function styleBrand(a) {
    if (!a || a.dataset.branded) return;
    a.dataset.branded = "1";
    a.style.display = "inline-flex";
    a.style.alignItems = "center";
    a.style.gap = "10px";
    a.style.letterSpacing = "0.32em";
    a.style.textTransform = "uppercase";
    a.style.fontWeight = "500";
    a.style.fontSize = "13px";
    a.style.textDecoration = "none";
    if (!a.querySelector("img")) {
      var img = document.createElement("img");
      img.src = LOGO;
      img.alt = "";
      img.width = 30;
      img.height = 30;
      img.style.width = "30px";
      img.style.height = "30px";
      img.style.display = "block";
      a.insertBefore(img, a.firstChild);
    }
    if (!a.querySelector("span") && a.childNodes.length) {
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
  var t = setInterval(function () {
    clean();
    if (++n > 120) clearInterval(t);
  }, 100);
  if (window.MutationObserver) {
    var obs = new MutationObserver(clean);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 15000);
  }
})();
