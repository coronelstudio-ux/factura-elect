/* Núcleo compartido entre la app Facturador y la app Pedidos.
   Todo se guarda en el dispositivo (localStorage). Nada se envía a un servidor. */
(function (global) {
  "use strict";

  // ================= Formato y escape =================
  const fmt = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = iso => {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" }) + " · " +
      d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
  };
  const todayKey = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const localDayKey = iso => { const d = new Date(iso); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  // ================= RUC y tipo de operación =================
  const INNOMINATE_LIMIT = 7000000;

  // Búsqueda simulada en el registro de contribuyentes (en producción: consulta RUC de la DNIT, manual 9.6)
  const registry = {
    "4567890-1": { name: "Juan Pérez", type: "Persona física", regime: "Simple", oee: false },
    "3210987-3": { name: "María Gómez", type: "Persona física", regime: "Unipersonal", oee: false },
    "80098765-9": { name: "Librería Central S.A.", type: "Persona jurídica", regime: "Sociedad", oee: false },
    "80011111-7": { name: "Municipalidad de Ejemplo", type: "Persona jurídica", regime: "Organismo del Estado", oee: true }
  };

  // Dígito verificador: módulo 11 (NT 014), pesos 2 a 9 desde la derecha.
  function dv11(digits) {
    let total = 0, w = 2;
    for (let i = digits.length - 1; i >= 0; i--) { total += Number(digits[i]) * w; w = w === 9 ? 2 : w + 1; }
    const dv = 11 - (total % 11);
    return dv >= 10 ? 0 : dv;
  }
  function parseRuc(text) {
    const clean = String(text || "").replace(/\s/g, "").toUpperCase();
    const m = clean.match(/^(\d{4,8})-?(\d)$/);
    if (!m) return null;
    return { base: m[1], dv: Number(m[2]), full: m[1] + "-" + m[2] };
  }
  // receiver: { mode: "con"|"sin", ruc, doc }. Devuelve { mode, operation, label, why, valid, name }
  function classify(receiver, total) {
    if (receiver.mode === "sin") {
      const needsDoc = total >= INNOMINATE_LIMIT;
      return {
        mode: "sin", operation: "B2C", label: "Consumidor final", valid: !needsDoc || !!receiver.doc,
        why: needsDoc
          ? "Desde Gs 7.000.000 hay que identificar al comprador con su documento."
          : "Sin RUC: se factura como venta a consumidor."
      };
    }
    const parsed = parseRuc(receiver.ruc);
    if (!parsed) return { mode: "con", valid: false, label: "", why: "Escribí el RUC con su dígito verificador, por ejemplo 4567890-1." };
    if (dv11(parsed.base) !== parsed.dv) return { mode: "con", valid: false, label: "", why: "El dígito verificador no corresponde a ese RUC. Revisá el número." };
    const info = registry[parsed.full];
    if (!info) {
      return { mode: "con", valid: true, operation: "B2B", label: "Contribuyente", name: "",
        why: "RUC válido. No aparece en la búsqueda de prueba: se factura como empresa a empresa." };
    }
    if (info.oee) {
      return { mode: "con", valid: true, operation: "B2G", label: info.regime, name: info.name,
        why: "Organismo del Estado: se factura como venta al Estado y necesita el código DNCP." };
    }
    return { mode: "con", valid: true, operation: "B2B", label: `${info.type} · ${info.regime}`, name: info.name,
      why: "Contribuyente con RUC: se factura como empresa a empresa. No tenés que elegirlo." };
  }
  const opName = { B2B: "Empresa a empresa", B2C: "Empresa a consumidor", B2G: "Empresa a Estado", B2F: "Empresa a extranjero" };

  // ================= Cálculos =================
  function calcItem(it) {
    const gross = Math.round(it.qty * it.price);
    const disc = Math.round(gross * (it.discount || 0) / 100);
    const total = gross - disc;
    const iva10 = it.tax === "10" ? Math.floor(total / 11) : 0;
    const iva5 = it.tax === "5" ? Math.floor(total / 21) : 0;
    return { total, iva10, iva5, iva: iva10 + iva5, exe: it.tax === "E" ? total : 0, b5: it.tax === "5" ? total : 0, b10: it.tax === "10" ? total : 0 };
  }
  function calcItems(items) {
    const t = { exe: 0, b5: 0, b10: 0, iva5: 0, iva10: 0, iva: 0, total: 0, count: items.length };
    items.forEach(it => { const c = calcItem(it); t.total += c.total; t.exe += c.exe; t.b5 += c.b5; t.b10 += c.b10; t.iva5 += c.iva5; t.iva10 += c.iva10; });
    t.iva = t.iva5 + t.iva10; return t;
  }
  const taxLabel = t => t === "10" ? "IVA 10%" : t === "5" ? "IVA 5%" : "Exento";

  // ================= Almacenamiento local =================
  function makeStore(prefix) {
    return {
      get(key, def) {
        try { const v = localStorage.getItem(prefix + key); return v == null ? def : JSON.parse(v); }
        catch (_) { return def; }
      },
      set(key, value) {
        try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; }
        catch (_) { toast("No se pudo guardar en este dispositivo"); return false; }
      },
      remove(key) { try { localStorage.removeItem(prefix + key); } catch (_) {} },
      keys() {
        const out = [];
        try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(prefix)) out.push(k.slice(prefix.length)); } } catch (_) {}
        return out;
      }
    };
  }
  function randomId(n) {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "";
    const buf = new Uint8Array(n);
    (global.crypto && crypto.getRandomValues) ? crypto.getRandomValues(buf) : buf.forEach((_, i) => buf[i] = Math.random() * 256);
    buf.forEach(b => s += abc[b % abc.length]);
    return s;
  }

  // ================= Interfaz común =================
  function toast(msg) {
    const t = document.getElementById("toast"); if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }
  // Hoja inferior. build(el, close) recibe el contenedor para enlazar eventos.
  function sheet(html, build) {
    const back = document.createElement("div");
    back.className = "sheet-back";
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", e => { if (e.target === back) close(); });
    if (build) build(back.querySelector(".sheet"), close);
    return close;
  }
  function confirmSheet(title, text, okLabel, onOk, danger) {
    sheet(`<h3>${esc(title)}</h3><p class="muted small">${esc(text)}</p>
      <div class="btn-row" style="margin-top:14px"><button class="btn" data-x>Volver</button>
      <button class="btn primary" data-ok ${danger ? 'style="background:var(--bad);border-color:var(--bad)"' : ""}>${esc(okLabel)}</button></div>`,
      (el, close) => { el.querySelector("[data-x]").onclick = close; el.querySelector("[data-ok]").onclick = () => { close(); onOk(); }; });
  }

  // Hoja para agregar un producto (misma que el facturador original)
  function itemSheet(onSave, initial) {
    const it = initial || { desc: "", qty: 1, price: "", tax: "10", discount: 0 };
    sheet(`
      <h3>${initial ? "Editar producto" : "Nuevo producto"}</h3>
      <label for="iDesc">Descripción</label><input id="iDesc" placeholder="Ej. Resma A4 500 hojas" value="${esc(it.desc)}">
      <div class="grid2">
        <div><label for="iQty">Cantidad</label><input id="iQty" inputmode="decimal" value="${esc(it.qty)}"></div>
        <div><label for="iPrice">Precio unitario</label><input id="iPrice" inputmode="numeric" placeholder="0" value="${esc(it.price === "" ? "" : fmt(it.price))}"></div>
      </div>
      <div class="grid2">
        <div><label for="iTax">Impuesto</label><select id="iTax">
          <option value="10" ${it.tax === "10" ? "selected" : ""}>IVA 10%</option>
          <option value="5" ${it.tax === "5" ? "selected" : ""}>IVA 5%</option>
          <option value="E" ${it.tax === "E" ? "selected" : ""}>Exento</option></select></div>
        <div><label for="iDisc">Descuento (%)</label><input id="iDisc" inputmode="numeric" value="${esc(it.discount || 0)}"></div>
      </div>
      <div class="btn-row" style="margin-top:18px">
        <button class="btn" id="iCancel">Cancelar</button>
        <button class="btn primary" id="iSave">${initial ? "Guardar" : "Agregar"}</button>
      </div>`, (el, close) => {
      el.querySelector("#iCancel").onclick = close;
      el.querySelector("#iSave").onclick = () => {
        const desc = el.querySelector("#iDesc").value.trim();
        const qty = parseFloat(el.querySelector("#iQty").value.replace(",", ".")) || 0;
        const price = Math.round(parseFloat(el.querySelector("#iPrice").value.replace(/\./g, "").replace(",", ".")) || 0);
        const discount = Math.min(100, Math.max(0, parseFloat(el.querySelector("#iDisc").value) || 0));
        const tax = el.querySelector("#iTax").value;
        if (!desc) { toast("Escribí el nombre del producto"); return; }
        if (qty <= 0 || price <= 0) { toast("La cantidad y el precio tienen que ser mayores a cero"); return; }
        close(); onSave({ desc, qty, price, tax, discount });
      };
      setTimeout(() => el.querySelector("#iDesc").focus(), 60);
    });
  }

  // ================= Clientes frecuentes =================
  // client: { id, mode: "con"|"sin", ruc, doc, name, email }
  function clientKey(c) { return c.mode === "con" ? "R:" + (parseRuc(c.ruc) || { full: c.ruc }).full : "D:" + (c.doc || c.name || "").trim().toLowerCase(); }
  function upsertClient(list, c) {
    if (c.mode === "con" && !parseRuc(c.ruc)) return list;
    if (c.mode === "sin" && !c.doc && !c.name) return list;
    const key = clientKey(c);
    const clean = { mode: c.mode, ruc: c.mode === "con" ? (parseRuc(c.ruc) || {}).full || c.ruc : "", doc: c.mode === "sin" ? (c.doc || "") : "",
      name: c.name || "", email: c.email || "", used: Date.now() };
    const i = list.findIndex(x => clientKey(x) === key);
    if (i >= 0) list[i] = Object.assign({}, list[i], clean, { name: clean.name || list[i].name, email: clean.email || list[i].email });
    else list.push(Object.assign({ id: randomId(8) }, clean));
    list.sort((a, b) => (b.used || 0) - (a.used || 0));
    return list;
  }
  function clientPicker(list, onPick) {
    const rows = q => {
      const s = q.trim().toLowerCase();
      const f = list.filter(c => !s || (c.name || "").toLowerCase().includes(s) || (c.ruc || "").includes(s) || (c.doc || "").includes(s));
      return f.length ? f.map(c => `<div class="row" data-pick="${esc(c.id)}"><div class="main"><div class="title">${esc(c.name || "Sin nombre")}</div>
        <div class="sub">${c.mode === "con" ? "RUC " + esc(c.ruc) : "Doc. " + esc(c.doc || "-")}${c.email ? " · " + esc(c.email) : ""}</div></div><span class="link">Elegir</span></div>`).join("")
        : `<div class="muted small" style="padding:8px 0">${list.length ? "Ningún cliente coincide." : "Todavía no hay clientes guardados. Se guardan solos al usarlos."}</div>`;
    };
    sheet(`<h3>Clientes frecuentes</h3>
      <input id="cSearch" placeholder="Buscar por nombre, RUC o documento" style="margin-top:8px">
      <div id="cList" style="margin-top:6px">${rows("")}</div>
      <button class="btn" data-x style="margin-top:12px">Cerrar</button>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("#cSearch").oninput = e => { el.querySelector("#cList").innerHTML = rows(e.target.value); };
      el.addEventListener("click", e => { const r = e.target.closest("[data-pick]"); if (!r) return; const c = list.find(x => x.id === r.dataset.pick); close(); if (c) onPick(c); });
    });
  }

  // ================= Pedido <-> texto del QR =================
  // Formato: FEP1.<suma de control>.<JSON comprimido en base64>
  const QR_PREFIX = "FEP1";
  function fnv32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function pedidoToCompact(p) {
    const c = p.client || {};
    return { v: 1, i: p.id, r: p.rev || 1, s: p.seller, f: p.createdAt, u: p.updatedAt || p.createdAt,
      c: [c.mode === "sin" ? 0 : 1, c.ruc || "", c.name || "", c.doc || "", c.email || ""],
      k: p.condition === "credito" ? 1 : 0, q: p.installments || 1, m: p.currency || "PYG", x: p.exchange || "",
      it: (p.items || []).map(it => [it.desc, it.qty, it.price, it.tax, it.discount || 0]), o: p.note || "" };
  }
  function compactToPedido(o) {
    if (!o || o.v !== 1 || !o.i || !Array.isArray(o.it)) throw new Error("formato");
    const c = o.c || [];
    return { id: String(o.i), rev: Number(o.r) || 1, seller: String(o.s || ""), createdAt: o.f, updatedAt: o.u || o.f,
      client: { mode: c[0] === 0 ? "sin" : "con", ruc: c[1] || "", name: c[2] || "", doc: c[3] || "", email: c[4] || "" },
      condition: o.k === 1 ? "credito" : "contado", installments: Number(o.q) || 1, currency: o.m === "USD" ? "USD" : "PYG", exchange: o.x || "",
      items: o.it.map(a => ({ desc: String(a[0] || ""), qty: Number(a[1]) || 0, price: Number(a[2]) || 0, tax: ["10", "5", "E"].includes(a[3]) ? a[3] : "10", discount: Number(a[4]) || 0 })),
      note: String(o.o || "") };
  }
  function encodePedido(p) {
    const json = JSON.stringify(pedidoToCompact(p));
    const data = global.LZString.compressToBase64(json);
    return QR_PREFIX + "." + fnv32(data) + "." + data;
  }
  // Acepta el texto del QR o un mensaje que lo contenga.
  function decodePedido(text) {
    const m = String(text || "").replace(/\s+/g, "").match(/FEP1\.([0-9a-f]{8})\.([A-Za-z0-9+/=]+)/);
    if (!m) return { ok: false, error: "No es un QR de pedido de esta app." };
    if (fnv32(m[2]) !== m[1]) return { ok: false, error: "El código está incompleto o fue modificado. Pedí que te lo vuelvan a enviar." };
    try {
      const json = global.LZString.decompressFromBase64(m[2]);
      return { ok: true, pedido: compactToPedido(JSON.parse(json)) };
    } catch (_) { return { ok: false, error: "No se pudo leer el contenido del pedido." }; }
  }

  // ================= Generar QR =================
  function qrMatrix(text) {
    for (const level of ["M", "L"]) {
      try { const qr = global.qrcode(0, level); qr.addData(text, "Byte"); qr.make(); return qr; }
      catch (_) { /* demasiado grande para este nivel */ }
    }
    return null;
  }
  // Dibuja una imagen con encabezado legible y el QR, lista para compartir por WhatsApp.
  function qrCanvas(text, headerLines) {
    const qr = qrMatrix(text);
    if (!qr) return null;
    const n = qr.getModuleCount();
    const cell = Math.max(6, Math.ceil(900 / n));
    const quiet = cell * 4;
    const size = n * cell + quiet * 2;
    const lines = headerLines || [];
    const headH = lines.length ? 30 + lines.length * 34 : 0;
    const cv = document.createElement("canvas");
    cv.width = size; cv.height = size + headH;
    const g = cv.getContext("2d");
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#111111"; g.textAlign = "center";
    lines.forEach((l, i) => { g.font = (i === 0 ? "bold 30px " : "26px ") + "Helvetica, Arial, sans-serif"; g.fillText(String(l).slice(0, 60), size / 2, 44 + i * 34); });
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(quiet + c * cell, headH + quiet + r * cell, cell, cell);
    cv.dataset.modules = n;
    return cv;
  }

  // ================= Leer QR =================
  function decodeImageData(img) {
    const d = global.jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    return d ? d.data : null;
  }
  // Lee el QR desde una imagen (por ejemplo, la que llegó por WhatsApp y se guardó en la galería).
  function readQrFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error("Sin archivo")); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const cv = document.createElement("canvas"), g = cv.getContext("2d", { willReadFrequently: true });
        for (const max of [1600, 1100, 2200, 800]) {
          const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
          g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
          g.drawImage(img, 0, 0, cv.width, cv.height);
          const text = decodeImageData(g.getImageData(0, 0, cv.width, cv.height));
          if (text) { resolve(text); return; }
        }
        reject(new Error("No se encontró un QR en la imagen. Probá con una captura más nítida."));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo abrir la imagen.")); };
      img.src = url;
    });
  }
  // Escáner con la cámara trasera. Llama onText(texto) al encontrar un QR.
  function openScanner(onText) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Este navegador no permite usar la cámara aquí. Usá «Elegir imagen».");
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "scanner";
    wrap.innerHTML = `<video playsinline muted></video><div class="frame"></div>
      <div class="bar"><div style="margin-bottom:10px">Apuntá al código QR del pedido</div><button class="btn" data-x>Cerrar</button></div>`;
    document.body.appendChild(wrap);
    const video = wrap.querySelector("video");
    const cv = document.createElement("canvas"), g = cv.getContext("2d", { willReadFrequently: true });
    let stream = null, stop = false, detector = null;
    if ("BarcodeDetector" in global) { try { detector = new global.BarcodeDetector({ formats: ["qr_code"] }); } catch (_) { detector = null; } }
    const close = () => { stop = true; if (stream) stream.getTracks().forEach(t => t.stop()); wrap.remove(); };
    wrap.querySelector("[data-x]").onclick = close;
    const found = text => { close(); onText(text); };
    async function tick() {
      if (stop) return;
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes && codes.length) { found(codes[0].rawValue); return; }
          } else {
            const k = Math.min(1, 900 / Math.max(video.videoWidth, video.videoHeight));
            cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
            g.drawImage(video, 0, 0, cv.width, cv.height);
            const text = decodeImageData(g.getImageData(0, 0, cv.width, cv.height));
            if (text) { found(text); return; }
          }
        } catch (_) { detector = null; }
      }
      setTimeout(() => requestAnimationFrame(tick), 120);
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then(s => { stream = s; if (stop) { close(); return; } video.srcObject = s; video.play().catch(() => {}); tick(); })
      .catch(() => { close(); toast("No se pudo abrir la cámara. Revisá el permiso o usá «Elegir imagen»."); });
  }

  // ================= Compartir y descargar =================
  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // Comparte la imagen del QR (WhatsApp aparece en la lista del celular). Si no se puede, la descarga.
  function shareCanvas(canvas, filename, text) {
    return new Promise(resolve => {
      canvas.toBlob(async blob => {
        if (!blob) { toast("No se pudo crear la imagen"); resolve(false); return; }
        const file = new File([blob], filename, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: filename, text }); resolve(true); return; }
          catch (err) { if (err && err.name === "AbortError") { resolve(false); return; } }
        }
        downloadBlob(blob, filename);
        toast("Imagen descargada. Enviala por WhatsApp desde la galería.");
        resolve(true);
      }, "image/png");
    });
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Código copiado"); return true; }
    catch (_) {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove(); toast(ok ? "Código copiado" : "No se pudo copiar"); return ok;
    }
  }

  // ================= Respaldo =================
  function exportBackup(store, appName) {
    const data = { app: appName, exportedAt: new Date().toISOString(), data: {} };
    store.keys().forEach(k => { if (k !== "pin") data.data[k] = store.get(k, null); });
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `respaldo-${appName}-${todayKey()}.json`);
    toast("Respaldo descargado");
  }
  function importBackup(store, appName, file, done) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        if (obj.app !== appName || !obj.data) { toast("Ese respaldo no es de esta app"); return; }
        Object.keys(obj.data).forEach(k => { if (k !== "pin") store.set(k, obj.data[k]); });
        toast("Respaldo restaurado"); done && done();
      } catch (_) { toast("El archivo de respaldo no es válido"); }
    };
    r.readAsText(file);
  }

  // ================= Service worker (para instalar y usar sin internet) =================
  function registerSW() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      global.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
    }
  }

  global.FE = {
    fmt, esc, fmtDate, todayKey, localDayKey, INNOMINATE_LIMIT, registry, dv11, parseRuc, classify, opName,
    calcItem, calcItems, taxLabel, makeStore, randomId, toast, sheet, confirmSheet, itemSheet,
    upsertClient, clientPicker, encodePedido, decodePedido, qrCanvas, readQrFromFile, openScanner,
    shareCanvas, copyText, downloadBlob, exportBackup, importBackup, registerSW, fnv32
  };
})(window);
