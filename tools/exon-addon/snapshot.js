/* Builds an inert HTML copy of the rendered DOM for the next development step. */
const ExonSnapshot = (() => {
  const origin = "https://exon.exonproject.ru";
  const excluded = new Set([
    "script", "style", "link", "meta", "base", "noscript", "template", "iframe", "frame",
    "object", "embed", "svg", "math", "video", "audio", "source", "track", "canvas"
  ]);
  const semantic = new Set([
    "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br",
    "button", "caption", "code", "col", "colgroup", "dd", "del", "details", "dfn", "div",
    "dl", "dt", "em", "fieldset", "figcaption", "figure", "footer", "h1", "h2", "h3",
    "h4", "h5", "h6", "header", "hr", "i", "img", "input", "kbd", "label", "legend",
    "li", "main", "mark", "menu", "nav", "ol", "optgroup", "option", "p", "pre", "q",
    "s", "samp", "section", "select", "small", "span", "strong", "sub", "summary",
    "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "tr",
    "u", "ul", "var", "wbr"
  ]);
  const attributes = [
    "id", "class", "name", "role", "title", "lang", "dir", "alt", "placeholder", "for",
    "colspan", "rowspan", "scope", "open", "data-testid", "data-test", "data-cy",
    "aria-label", "aria-labelledby", "aria-describedby", "aria-controls", "aria-checked",
    "aria-current", "aria-expanded", "aria-selected", "aria-sort"
  ];
  const style = `
    html { font: 15px/1.55 system-ui, sans-serif; color: #172737; background: #fff; }
    body { margin: 24px; overflow-wrap: anywhere; }
    nav, main, section, article, aside, footer, fieldset { margin-block: 8px; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid #cdd8e1; padding: 5px 9px; vertical-align: top; }
    th { text-align: left; background: #edf3f7; }
    button, input, textarea, select { font: inherit; }
    img { display: none; }
    a[data-exon-path] { color: #124e7a; text-decoration: underline; }
    .exon-copy-info { background: #edf3f7; padding: 8px 12px; margin-bottom: 18px; }
  `;

  function workingPage(url) {
    return url.origin === origin && !/^\/(?:auth|callback)(?:\/|$)/i.test(url.pathname);
  }

  function canCapture(doc) {
    return workingPage(new URL(doc.URL)) && Boolean(doc.body?.innerText.trim()) &&
      !doc.querySelector("#keycloakRoot, form input[name='password'][type='password']");
  }

  function copyNode(node, target, view, panel) {
    if (node.nodeType === Node.TEXT_NODE) return target.createTextNode(node.data);
    if (node.nodeType !== Node.ELEMENT_NODE || node === panel || node.namespaceURI !== "http://www.w3.org/1999/xhtml") return null;
    const tag = node.localName;
    if (excluded.has(tag) || node.hidden || node.matches("input[type=hidden], input[type=password]")) return null;
    const style = view.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return null;
    const element = target.createElement(semantic.has(tag) ? tag : style.display.startsWith("inline") ? "span" : "div");
    for (const attribute of attributes) {
      if (node.hasAttribute(attribute)) element.setAttribute(attribute, node.getAttribute(attribute));
    }
    if (tag === "form") element.setAttribute("data-exon-form", "");
    if (tag === "a" && node.hasAttribute("href")) {
      try {
        const link = new URL(node.getAttribute("href"), node.ownerDocument.baseURI);
        if (workingPage(link)) element.setAttribute("data-exon-path", link.pathname);
      } catch {
        // Malformed routes are represented by their visible label.
      }
    }
    if (tag === "button") element.type = "button";
    if (["input", "textarea", "select", "button"].includes(tag)) element.disabled = true;
    if (tag === "input") element.type = ["checkbox", "radio"].includes(node.type) ? node.type : "text";
    if (tag === "textarea" || node.isContentEditable) return element;
    for (const child of node.childNodes) {
      const copied = copyNode(child, target, view, panel);
      if (copied) element.append(copied);
    }
    return element;
  }

  function capture(doc, panel = null) {
    if (!canCapture(doc)) throw new Error("Откройте рабочую страницу Экзона после входа.");
    const copy = doc.implementation.createHTMLDocument(doc.title || "Страница Экзона");
    copy.documentElement.lang = doc.documentElement.lang || "ru";
    const charset = copy.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    const csp = copy.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
    const css = copy.createElement("style");
    css.textContent = style;
    copy.head.prepend(charset, csp);
    copy.head.append(css);
    const info = copy.createElement("header");
    info.className = "exon-copy-info";
    info.textContent = "Копия страницы Экзона · " + new URL(doc.URL).pathname;
    copy.body.append(info);
    for (const child of doc.body.childNodes) {
      const copied = copyNode(child, copy, doc.defaultView, panel);
      if (copied) copy.body.append(copied);
    }
    return "<!doctype html>\n" + copy.documentElement.outerHTML;
  }

  return {canCapture, capture};
})();
