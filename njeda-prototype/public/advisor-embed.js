(function () {
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "style") {
          Object.assign(node.style, attrs.style);
        } else if (k === "text") {
          node.textContent = attrs.text;
        } else {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    return node;
  }

  function ensure() {
    if (document.getElementById("njeda-program-advisor-root")) return;

    var root = el("div", { id: "njeda-program-advisor-root" });
    root.style.position = "fixed";
    root.style.right = "28px";
    root.style.bottom = "64px";
    root.style.left = "auto";
    root.style.top = "auto";
    root.style.zIndex = "2147483647";
    root.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
    root.style.display = "inline-flex";
    root.style.alignItems = "center";
    root.style.gap = "6px";
    document.body.appendChild(root);

    var handle = el("div", {
      "aria-label": "Drag Program Advisor",
      title: "Drag",
    });
    Object.assign(handle.style, {
      width: "22px",
      minHeight: "44px",
      borderRadius: "12px",
      background: "rgba(15,124,140,0.35)",
      cursor: "grab",
      flexShrink: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "-2px",
      userSelect: "none",
      WebkitUserSelect: "none",
      boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
    });
    handle.textContent = "⋮⋮";

    var button = el("button", {
      type: "button",
      "aria-label": "Open Program Advisor",
    });
    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "10px",
      padding: "10px 14px",
      borderRadius: "999px",
      border: "0",
      background: "#0F7C8C",
      color: "#fff",
      cursor: "pointer",
      boxShadow: "0 10px 25px rgba(0,0,0,0.18)",
      fontWeight: "700",
      fontSize: "14px",
      lineHeight: "20px",
    });

    button.style.setProperty("position", "relative", "important");
    button.style.setProperty("z-index", "2147483647", "important");
    button.style.setProperty("opacity", "1", "important");
    button.style.setProperty("visibility", "visible", "important");
    button.style.setProperty("display", "inline-flex", "important");

    var iconWrap = el("span");
    Object.assign(iconWrap.style, {
      width: "36px",
      height: "36px",
      borderRadius: "999px",
      background: "rgba(255,255,255,0.18)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "16px",
    });
    iconWrap.textContent = "💬";

    var label = el("span", { text: "Program Advisor" });
    button.appendChild(iconWrap);
    button.appendChild(label);
    root.appendChild(handle);
    root.appendChild(button);

    (function enableDrag() {
      var dragging = false;
      var startX = 0;
      var startY = 0;
      var origLeft = 0;
      var origTop = 0;
      function clamp(n, a, b) {
        return Math.max(a, Math.min(b, n));
      }
      function placeFromRect() {
        var r = root.getBoundingClientRect();
        root.style.right = "auto";
        root.style.bottom = "auto";
        root.style.left = clamp(r.left, 0, window.innerWidth - r.width) + "px";
        root.style.top = clamp(r.top, 0, window.innerHeight - r.height) + "px";
      }
      function onMove(e) {
        if (!dragging) return;
        e.preventDefault();
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;
        var l = root.offsetLeft + dx;
        var t = root.offsetTop + dy;
        l = clamp(l, 0, window.innerWidth - root.offsetWidth);
        t = clamp(t, 0, window.innerHeight - root.offsetHeight);
        root.style.left = l + "px";
        root.style.top = t + "px";
        root.style.right = "auto";
        root.style.bottom = "auto";
      }
      function onUp() {
        dragging = false;
        handle.style.cursor = "grab";
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
      }
      handle.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        placeFromRect();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        handle.style.cursor = "grabbing";
        try {
          handle.setPointerCapture(e.pointerId);
        } catch (err) {}
        document.addEventListener("pointermove", onMove, { passive: false });
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
      });
      window.addEventListener("resize", function () {
        if (root.style.left && root.style.left !== "auto") {
          var l = parseFloat(root.style.left) || 0;
          var t = parseFloat(root.style.top) || 0;
          l = clamp(l, 0, window.innerWidth - root.offsetWidth);
          t = clamp(t, 0, window.innerHeight - root.offsetHeight);
          root.style.left = l + "px";
          root.style.top = t + "px";
        }
      });
    })();

    var modal = el("div", { id: "njeda-program-advisor-modal" });
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "none",
      background: "rgba(0,0,0,0.40)",
      padding: "16px",
      boxSizing: "border-box",
      alignItems: "flex-end",
      justifyContent: "center",
    });

    var panel = el("div");
    Object.assign(panel.style, {
      width: "min(1100px, 100%)",
      height: "min(760px, 92vh)",
      background: "#fff",
      borderRadius: "18px",
      overflow: "hidden",
      boxShadow: "0 25px 60px rgba(0,0,0,0.30)",
      position: "relative",
    });

    var close = el("button", { type: "button", "aria-label": "Close Program Advisor" });
    Object.assign(close.style, {
      position: "absolute",
      top: "10px",
      right: "10px",
      width: "38px",
      height: "38px",
      borderRadius: "10px",
      border: "1px solid rgba(0,0,0,0.10)",
      background: "#fff",
      cursor: "pointer",
      fontSize: "18px",
      lineHeight: "1",
    });
    close.textContent = "×";

    var origin = (window.location && window.location.origin) ? window.location.origin : "";
    var iframe = el("iframe", {
      src: origin + "/advisor",
      title: "NJEDA Program Advisor",
      frameborder: "0",
      allow: "clipboard-write",
    });
    Object.assign(iframe.style, {
      width: "100%",
      height: "100%",
      border: "0",
      display: "block",
    });

    panel.appendChild(iframe);
    panel.appendChild(close);
    modal.appendChild(panel);
    document.body.appendChild(modal);

    function open() {
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";
    }

    function closeModal() {
      modal.style.display = "none";
      document.body.style.overflow = "";
    }

    button.addEventListener("click", open);
    close.addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.style.display !== "none") closeModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensure);
  } else {
    ensure();
  }
})();

