/* Núcleo compartido entre la app Facturador y la app Pedidos.
   Todo se guarda en el dispositivo (localStorage). Nada se envía a un servidor. */
(function (global) {
  "use strict";

  // ================= Formato y escape =================
  // Guaraníes sin decimales; dólares con 2 decimales (coma decimal y punto de miles, como en Paraguay)
  const decimalsFor = cur => cur === "USD" || cur === 2 ? 2 : 0;
  const roundTo = (n, dec) => dec ? Math.round((Number(n) || 0) * 100) / 100 : Math.round(Number(n) || 0);
  function fmt(n, cur) {
    const dec = decimalsFor(cur), v = roundTo(n, dec), neg = v < 0, a = Math.abs(v);
    const int = String(Math.trunc(a)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (neg ? "-" : "") + (dec ? int + "," + String(Math.round((a - Math.trunc(a)) * 100)).padStart(2, "0") : int);
  }
  const money = (n, cur) => (cur === "USD" ? "USD " : "Gs ") + fmt(n, cur);
  const fmtQty = q => String(q).replace(".", ",");
  // Lee un monto escrito por el usuario. Guaraníes: solo dígitos ("45.000" = 45000).
  // Dólares: acepta "12,50", "12.50", "1.250,50" y "1,250.50".
  function parseAmount(v, cur) {
    let s = String(v == null ? "" : v).trim().replace(/\s/g, "");
    if (!s) return 0;
    if (!decimalsFor(cur)) return parseInt(s.replace(/\D/g, ""), 10) || 0;
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) { const dsep = lc > ld ? "," : "."; s = s.split(dsep === "," ? "." : ",").join("").replace(dsep, "."); }
    else if (lc >= 0) { const i = s.lastIndexOf(","); s = s.slice(0, i).replace(/,/g, "") + "." + s.slice(i + 1); }
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    const n = parseFloat(s.replace(/[^\d.]/g, ""));
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }
  // Total en guaraníes (para el límite de innominado y el total del KuDE). null si falta el tipo de cambio.
  function pygTotal(total, cur, exchange) {
    if (cur !== "USD") return total;
    const rate = parseAmount(exchange, "USD");
    return rate > 0 ? Math.round(total * rate) : null;
  }
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
  // Tipos de documento del receptor no contribuyente (NT 023 y 027). El 5 (innominado) se asigna solo, sin documento.
  const DOC_TYPES = { "1": "Cédula paraguaya", "2": "Pasaporte", "3": "Cédula extranjera", "4": "Carnet de residencia", "6": "Tarjeta diplomática", "9": "Otro" };
  const DOC_SHORT = { "1": "CI", "2": "Pasaporte", "3": "CI extranjera", "4": "Carnet de residencia", "5": "Innominado", "6": "Tarjeta diplomática", "9": "Documento" };
  const EXT_DOC_TYPES = ["2", "3", "4", "6", "9"];
  // receiver: { mode: "con"|"sin"|"ext", ruc, doc, docType, name }. Devuelve { mode, operation, label, why, valid, name, docType }
  function classify(receiver, total) {
    if (receiver.mode === "sin") {
      const hasDoc = !!String(receiver.doc || "").trim();
      const needsDoc = total >= INNOMINATE_LIMIT;
      return {
        mode: "sin", operation: "B2C", docType: hasDoc ? (receiver.docType || "1") : "5",
        label: hasDoc ? "No contribuyente · " + (DOC_SHORT[receiver.docType || "1"]) : "Consumidor final (innominado)",
        valid: !needsDoc || hasDoc,
        why: needsDoc && !hasDoc
          ? "Desde Gs 7.000.000 no se permite innominado: identificá al comprador con su documento."
          : hasDoc ? "Sin RUC: se factura como venta a consumidor, identificado por su documento." : "Sin RUC ni documento: se factura como venta a consumidor innominado."
      };
    }
    if (receiver.mode === "ext") {
      const ok = !!String(receiver.name || "").trim() && !!String(receiver.doc || "").trim();
      const dt = EXT_DOC_TYPES.includes(receiver.docType) ? receiver.docType : "2";
      return { mode: "ext", operation: "B2F", label: "Extranjero · " + DOC_SHORT[dt], docType: dt, valid: ok,
        why: ok ? "Cliente del exterior: se factura como venta a extranjero." : "Para un cliente extranjero escribí el nombre y el número de documento." };
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

  // Texto de identificación del receptor para pantallas y KuDE: "80098765-9", "CI 1234567", "Pasaporte X1 · Brasil", "Innominado"
  function receiverIdText(c) {
    c = c || {};
    if (c.mode === "con") return (parseRuc(c.ruc) || { full: c.ruc || "" }).full;
    const doc = String(c.doc || "").trim();
    if (c.mode === "ext") return (DOC_SHORT[EXT_DOC_TYPES.includes(c.docType) ? c.docType : "2"]) + " " + doc + (c.country ? " · " + c.country : "");
    return doc ? DOC_SHORT[c.docType || "1"] + " " + doc : "Innominado";
  }
  const receiverIdLabel = c => (c && c.mode === "con" ? "RUC" : "Documento");
  const receiverDisplayName = c => (c && c.name) || (c && c.mode === "con" ? (parseRuc(c.ruc) || {}).full || c.ruc : "Consumidor final");

  // Paso "Cliente" compartido por el Facturador y Pedidos. d: borrador; r: resultado de classify.
  function receiverBlock(d, r, total, opts) {
    opts = opts || {};
    const docOpts = (types, sel) => types.map(k => `<option value="${k}" ${sel === k ? "selected" : ""}>${esc(DOC_TYPES[k])}</option>`).join("");
    const seg = `<div class="seg">
        <button data-mode="con" class="${d.mode === "con" ? "on" : ""}">Con RUC</button>
        <button data-mode="sin" class="${d.mode === "sin" ? "on" : ""}">Sin RUC</button>
        <button data-mode="ext" class="${d.mode === "ext" ? "on" : ""}">Extranjero</button>
      </div>`;
    let fields = "";
    if (d.mode === "con") {
      fields = `<div class="grid2 stack-sm">
          <div><label for="fRuc">RUC</label><input id="fRuc" placeholder="4567890-1" value="${esc(d.ruc)}"></div>
          <div><label for="fName">Nombre o razón social</label><input id="fName" placeholder="${esc(r.name || "Se completa solo")}" value="${esc(d.name)}"></div>
        </div>`;
    } else if (d.mode === "sin") {
      fields = `<div class="grid2">
          <div><label for="fDocType">Tipo de documento</label><select id="fDocType">${docOpts(["1", "2", "3", "4", "6", "9"], d.docType || "1")}</select></div>
          <div><label for="fDoc">Número ${total >= INNOMINATE_LIMIT ? "(obligatorio)" : "(opcional)"}</label><input id="fDoc" placeholder="Nº de documento" value="${esc(d.doc)}"></div>
        </div>
        <label for="fName2">Nombre (opcional)</label><input id="fName2" placeholder="Consumidor final" value="${esc(d.name)}">`;
    } else {
      fields = `<label for="fName2">Nombre o razón social (obligatorio)</label><input id="fName2" placeholder="Nombre del cliente del exterior" value="${esc(d.name)}">
        <div class="grid2">
          <div><label for="fDocType">Tipo de documento</label><select id="fDocType">${docOpts(EXT_DOC_TYPES, EXT_DOC_TYPES.includes(d.docType) ? d.docType : "2")}</select></div>
          <div><label for="fDoc">Número (obligatorio)</label><input id="fDoc" value="${esc(d.doc)}"></div>
        </div>
        <label for="fCountry">País</label><input id="fCountry" placeholder="Ej. Brasil" value="${esc(d.country || "")}">`;
    }
    let detect = "";
    if (d.mode === "con" && String(d.ruc || "").trim()) {
      detect = r.valid ? `<div class="detect"><div class="kind">${esc(r.label)} · ${opName[r.operation]} (${r.operation})</div>
          ${r.name ? `<div class="small" style="margin-top:2px">${esc(r.name)}</div>` : ""}${opts.why ? `<div class="why">${esc(r.why)}</div>` : ""}</div>`
        : `<div class="notice bad">${esc(r.why)}</div>`;
    } else if (d.mode !== "con") {
      detect = `<div class="${r.valid ? "detect" : "notice bad"}"><div class="kind">${esc(r.label)} · ${opName[r.operation]} (${r.operation})</div><div class="why">${esc(r.why)}</div></div>`;
    }
    return seg + fields + detect;
  }
  // Lee los campos del paso "Cliente" sin volver a dibujar.
  function syncReceiver(d) {
    const g = id => document.getElementById(id);
    if (g("fRuc")) d.ruc = g("fRuc").value;
    if (g("fName")) d.name = g("fName").value;
    if (g("fName2")) d.name = g("fName2").value;
    if (g("fDoc")) d.doc = g("fDoc").value;
    if (g("fDocType")) d.docType = g("fDocType").value;
    if (g("fCountry")) d.country = g("fCountry").value;
  }
  // Campos que cambian la validación del cliente y por eso redibujan mientras se escribe
  const receiverLiveIds = mode => mode === "ext" ? ["fDoc", "fName2"] : ["fRuc", "fDoc"];
  // Cliente normalizado para guardar (pedido, factura o cliente frecuente)
  function receiverFromDraft(d, r) {
    return { mode: d.mode, ruc: d.mode === "con" ? ((parseRuc(d.ruc) || {}).full || d.ruc) : "",
      doc: d.mode === "con" ? "" : String(d.doc || "").trim(), docType: d.mode === "con" ? "" : (r && r.docType) || d.docType || "1",
      country: d.mode === "ext" ? String(d.country || "").trim() : "",
      name: d.name || (d.mode === "con" && r ? r.name || "" : ""), email: d.email || "" };
  }

  // ================= Cálculos =================
  // cur: moneda ("PYG" por defecto, sin decimales; "USD" con 2 decimales)
  function calcItem(it, cur) {
    const dec = decimalsFor(cur), r = n => roundTo(n, dec);
    const gross = r(it.qty * it.price);
    const disc = r(gross * (it.discount || 0) / 100);
    const total = r(gross - disc);
    // IVA incluido en el precio: 10 % = total/11, 5 % = total/21 (en guaraníes se trunca, como hasta ahora)
    const ivaOf = div => dec ? r(total / div) : Math.floor(total / div);
    const iva10 = it.tax === "10" ? ivaOf(11) : 0;
    const iva5 = it.tax === "5" ? ivaOf(21) : 0;
    return { total, iva10, iva5, iva: r(iva10 + iva5), exe: it.tax === "E" ? total : 0, b5: it.tax === "5" ? total : 0, b10: it.tax === "10" ? total : 0 };
  }
  function calcItems(items, cur) {
    const dec = decimalsFor(cur), r = n => roundTo(n, dec);
    const t = { exe: 0, b5: 0, b10: 0, iva5: 0, iva10: 0, iva: 0, total: 0, count: items.length };
    items.forEach(it => { const c = calcItem(it, cur); t.total += c.total; t.exe += c.exe; t.b5 += c.b5; t.b10 += c.b10; t.iva5 += c.iva5; t.iva10 += c.iva10; });
    ["total", "exe", "b5", "b10", "iva5", "iva10"].forEach(k => t[k] = r(t[k]));
    t.iva = r(t.iva5 + t.iva10); return t;
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
  // ================= Teclados y comportamiento de los campos =================
  // Cada campo abre el teclado que corresponde: numérico donde solo van números, completo donde va texto.
  // Se asigna por id (o por data-kb en el HTML) y se aplica solo, también a hojas y pantallas nuevas.
  const KB_BY_ID = {
    digits: ["tNum", "tNext", "fCuotas", "eEst", "ePoint", "sTest", "sProd", "aEst", "aPoint", "aCsc", "aCscProd", "tNum4", "tNext4"],
    ruc: ["fRuc", "aRuc", "cRuc"],
    money: ["iPrice", "pPrice"],
    money2: ["fTc", "prExch"],
    decimal: ["iQty", "iDisc"],
    pin: ["pin1", "lgPin", "cOld"],
    newpin: ["pin2", "cNew", "cNew2", "uPin", "fmPin", "fmPin2"],
    email: ["fEmail", "nMail", "eMail", "aMail"],
    tel: ["ePhone", "aPhone"],
    name: ["fName2", "uName", "sSeller", "aSeller", "fmName", "cTit"],
    org: ["fName", "eName", "aName", "eFan", "aFantasy"],
    sentence: ["iDesc", "pDesc", "eAct", "aActivity", "fNote", "prFooter", "rWhy"],
    address: ["eAdr", "aAddress"],
    city: ["eCity", "aCity"],
    country: ["fCountry"],
    code: ["pCode", "cSerie", "catCode"],
    search: ["cSearch", "hSearch"],
    doc: ["fDoc"]
  };
  const KB_ID = {};
  Object.keys(KB_BY_ID).forEach(k => KB_BY_ID[k].forEach(id => KB_ID[id] = k));
  const KB_ATTRS = {
    digits: { inputmode: "numeric", pattern: "[0-9]*", autocomplete: "off" },
    ruc: { inputmode: "numeric", autocomplete: "off", spellcheck: "false" },
    money: { inputmode: "numeric", pattern: "[0-9.]*", autocomplete: "off" },
    money2: { inputmode: "decimal", autocomplete: "off" },
    decimal: { inputmode: "decimal", autocomplete: "off" },
    pin: { type: "password", inputmode: "numeric", pattern: "[0-9]*", autocomplete: "current-password", maxlength: "6" },
    newpin: { type: "password", inputmode: "numeric", pattern: "[0-9]*", autocomplete: "new-password", maxlength: "6" },
    email: { type: "email", inputmode: "email", autocomplete: "email", autocapitalize: "off", spellcheck: "false" },
    tel: { type: "tel", inputmode: "tel", autocomplete: "tel" },
    name: { autocapitalize: "words", autocomplete: "name", spellcheck: "false" },
    org: { autocapitalize: "words", autocomplete: "organization", spellcheck: "false" },
    sentence: { autocapitalize: "sentences" },
    address: { autocapitalize: "sentences", autocomplete: "street-address" },
    city: { autocapitalize: "words", autocomplete: "address-level2" },
    country: { autocapitalize: "words", autocomplete: "country-name" },
    code: { autocapitalize: "characters", autocomplete: "off", autocorrect: "off", spellcheck: "false" },
    search: { type: "search", autocomplete: "off", enterkeyhint: "search" },
    docnum: { inputmode: "numeric", pattern: "[0-9]*", autocomplete: "off" },
    doctext: { inputmode: "text", autocapitalize: "characters", autocomplete: "off", spellcheck: "false" }
  };
  // Caracteres permitidos por tipo (lo demás se descarta al escribir o pegar)
  const KB_FILTER = { digits: /[^0-9]/g, docnum: /[^0-9]/g, pin: /[^0-9]/g, newpin: /[^0-9]/g, ruc: /[^0-9-]/g, money: /[^0-9]/g, money2: /[^0-9.,]/g, decimal: /[^0-9.,]/g };
  const FIELD_SEL = "input:not([type=hidden]):not([type=checkbox]):not([type=file]):not([type=radio]), select, textarea";
  const visibleField = el => !el.disabled && el.offsetParent !== null && el.type !== "hidden";
  function kindOf(el) {
    let k = el.dataset.kb || KB_ID[el.id];
    if (k === "doc") {
      const box = el.closest(".sheet, .lock, #screen") || document, dt = box.querySelector("#fDocType");
      k = !dt || dt.value === "1" ? "docnum" : "doctext"; // cédula paraguaya: solo números
    }
    return k;
  }
  function enhance(root) {
    (root || document).querySelectorAll(FIELD_SEL).forEach(el => {
      const k = kindOf(el);
      if (k && KB_ATTRS[k]) Object.entries(KB_ATTRS[k]).forEach(([a, v]) => { if (a !== "type" || el.tagName === "INPUT") el.setAttribute(a, v); });
      if (k) el.dataset.kind = k;
      if (el.tagName !== "TEXTAREA" && !el.hasAttribute("enterkeyhint")) {
        const box = el.closest(".sheet, .lock, #screen");
        const fields = box ? Array.from(box.querySelectorAll(FIELD_SEL)).filter(visibleField) : [];
        const last = fields.indexOf(el) === fields.length - 1;
        el.setAttribute("enterkeyhint", last ? (box && box.classList.contains("lock") ? "go" : "done") : "next");
      }
    });
  }
  // Filtra caracteres, da formato de miles a los montos en guaraníes y respeta el cursor
  if (global.document) document.addEventListener("input", e => {
    const el = e.target, k = el.dataset && el.dataset.kind;
    if (!k || !KB_FILTER[k] && k !== "money") return;
    const before = el.value, caretFromEnd = before.length - (el.selectionEnd == null ? before.length : el.selectionEnd);
    let v = before.replace(KB_FILTER[k] || /$^/, "");
    if (k === "ruc") v = v.replace(/-(?=.*-)/g, ""); // un solo guion
    if (k === "money") v = v ? fmt(parseInt(v, 10) || 0) : "";
    if (v !== before) {
      el.value = v;
      const pos = Math.max(0, v.length - caretFromEnd);
      try { el.setSelectionRange(pos, pos); } catch (_) {}
    }
  }, true);
  // Enter: pasa al campo siguiente; en el último, confirma la hoja (o cierra el teclado)
  if (global.document) document.addEventListener("keydown", e => {
    const el = e.target;
    if (e.key !== "Enter" || e.isComposing || !el.matches || !el.matches("input, select") || el.type === "checkbox") return;
    const box = el.closest(".sheet, .lock, #screen"); if (!box) return;
    const fields = Array.from(box.querySelectorAll(FIELD_SEL)).filter(visibleField);
    const next = fields[fields.indexOf(el) + 1];
    if (el.type === "search") { e.preventDefault(); el.blur(); return; }
    if (next) { e.preventDefault(); e.stopPropagation(); next.focus(); if (next.select && next.tagName === "INPUT") try { next.select(); } catch (_) {} return; }
    if (box.classList.contains("sheet")) {
      const ok = box.querySelector("[data-ok]:not([disabled])");
      if (ok) { e.preventDefault(); ok.click(); }
      return;
    }
    if (!box.classList.contains("lock")) { e.preventDefault(); el.blur(); }
  }, true);
  if (global.MutationObserver && global.document && document.body) {
    new MutationObserver(muts => { if (muts.some(m => m.addedNodes.length)) enhance(document.body); }).observe(document.body, { childList: true, subtree: true });
  }
  // Pequeña vibración de confirmación (si el celular lo permite)
  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms || 30); } catch (_) {} };

  // Hoja inferior. build(el, close) recibe el contenedor para enlazar eventos.
  function sheet(html, build) {
    const back = document.createElement("div");
    back.className = "sheet-back";
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", e => { if (e.target === back) close(); });
    enhance(back);
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
  // products (opcional): productos frecuentes para elegir y completar los campos
  // cur: moneda del documento. En dólares, los productos frecuentes (en guaraníes) no completan el precio.
  function itemSheet(onSave, initial, products, cur) {
    const it = initial || { desc: "", qty: 1, price: "", tax: "10", discount: 0, code: "" };
    const prods = products || [], usd = cur === "USD", sym = usd ? "USD" : "Gs";
    sheet(`
      <h3>${initial ? "Editar producto" : "Nuevo producto"}</h3>
      ${prods.length ? `<label for="iProd">Producto frecuente</label><select id="iProd"><option value="">Elegí uno o escribilo abajo</option>
        ${prods.map((p, i) => `<option value="${i}">${esc((p.code ? p.code + " · " : "") + p.desc)} · Gs ${fmt(p.price)}</option>`).join("")}</select>
        ${usd ? `<div class="muted small" style="margin-top:4px">Factura en dólares: el producto completa la descripción y el IVA; el precio escribilo en USD.</div>` : ""}` : ""}
      <label for="iDesc">Descripción</label><input id="iDesc" data-kb="sentence" placeholder="Ej. Resma A4 500 hojas" value="${esc(it.desc)}">
      <input type="hidden" id="iCode" value="${esc(it.code || "")}">
      <div class="grid2">
        <div><label for="iQty">Cantidad</label><input id="iQty" data-kb="decimal" value="${esc(fmtQty(it.qty))}"></div>
        <div><label for="iPrice">Precio unitario (${sym})</label><input id="iPrice" data-kb="${usd ? "money2" : "money"}" placeholder="0" value="${esc(it.price === "" ? "" : fmt(it.price, cur))}"></div>
      </div>
      <div class="grid2">
        <div><label for="iTax">Impuesto</label><select id="iTax">
          <option value="10" ${it.tax === "10" ? "selected" : ""}>IVA 10%</option>
          <option value="5" ${it.tax === "5" ? "selected" : ""}>IVA 5%</option>
          <option value="E" ${it.tax === "E" ? "selected" : ""}>Exento</option></select></div>
        <div><label for="iDisc">Descuento (%)</label><input id="iDisc" data-kb="decimal" value="${esc(fmtQty(it.discount || 0))}"></div>
      </div>
      <div class="item-preview" id="iPreview"></div>
      <div class="btn-row ${initial ? "" : "three"}" style="margin-top:14px">
        <button class="btn" id="iCancel">${initial ? "Cancelar" : "Listo"}</button>
        ${initial ? "" : `<button class="btn soft" id="iMore">Agregar y otro</button>`}
        <button class="btn primary" id="iSave" data-ok>${initial ? "Guardar" : "Agregar"}</button>
      </div>`, (el, close) => {
      const q = id => el.querySelector(id), pick = q("#iProd");
      const read = () => ({
        desc: q("#iDesc").value.trim(), qty: parseFloat(q("#iQty").value.replace(/\./g, "").replace(",", ".")) || 0,
        price: parseAmount(q("#iPrice").value, cur), tax: q("#iTax").value,
        discount: Math.min(100, Math.max(0, parseFloat(q("#iDisc").value.replace(",", ".")) || 0)), code: q("#iCode").value
      });
      // Total de la línea mientras se escribe
      const preview = () => { const v = read(); q("#iPreview").textContent = v.qty > 0 && v.price > 0 ? "Total de la línea: " + money(calcItem(v, cur).total, cur) : ""; };
      el.addEventListener("input", preview); el.addEventListener("change", preview); preview();
      q("#iCancel").onclick = close;
      if (pick) pick.onchange = () => {
        const p = prods[+pick.value]; if (!p) return;
        q("#iDesc").value = p.desc; if (!usd) q("#iPrice").value = fmt(p.price);
        q("#iTax").value = p.tax; q("#iCode").value = p.code || "";
        const next = usd ? q("#iPrice") : q("#iQty"); next.focus(); next.select(); preview();
      };
      q("#iDesc").addEventListener("input", () => { q("#iCode").value = ""; });
      const submit = more => {
        const v = read();
        if (!v.desc) { toast("Escribí el nombre del producto"); q("#iDesc").focus(); return; }
        if (v.qty <= 0) { toast("La cantidad tiene que ser mayor a cero"); q("#iQty").focus(); return; }
        if (v.price <= 0) { toast("El precio tiene que ser mayor a cero"); q("#iPrice").focus(); return; }
        const item = { desc: v.desc, qty: v.qty, price: v.price, tax: v.tax, discount: v.discount };
        if (v.code) item.code = v.code;
        onSave(item);
        if (!more) { close(); return; }
        // Deja el formulario listo para el siguiente producto
        toast("Agregado: " + v.desc);
        q("#iDesc").value = ""; q("#iCode").value = ""; q("#iQty").value = "1"; q("#iPrice").value = ""; q("#iDisc").value = "0"; q("#iTax").value = "10";
        if (pick) pick.value = "";
        preview(); (pick || q("#iDesc")).focus();
      };
      q("#iSave").onclick = () => submit(false);
      if (q("#iMore")) q("#iMore").onclick = () => submit(true);
      setTimeout(() => (pick && !initial ? pick : q("#iDesc")).focus(), 60);
    });
  }

  // ================= Clientes frecuentes =================
  // client: { id, mode: "con"|"sin"|"ext", ruc, doc, docType, country, name, email }
  function clientKey(c) {
    if (c.mode === "con") return "R:" + (parseRuc(c.ruc) || { full: c.ruc }).full;
    return (c.mode === "ext" ? "X:" : "D:") + (c.doc || c.name || "").trim().toLowerCase();
  }
  function upsertClient(list, c) {
    if (c.mode === "con" && !parseRuc(c.ruc)) return list;
    if (c.mode === "sin" && !c.doc && !c.name) return list;
    if (c.mode === "ext" && !(c.doc && c.name)) return list;
    const key = clientKey(c);
    const clean = { mode: c.mode, ruc: c.mode === "con" ? (parseRuc(c.ruc) || {}).full || c.ruc : "", doc: c.mode === "con" ? "" : (c.doc || ""),
      docType: c.mode === "con" ? "" : (c.docType || (c.mode === "ext" ? "2" : "1")), country: c.mode === "ext" ? (c.country || "") : "",
      name: c.name || "", email: c.email || "", used: Date.now() };
    const i = list.findIndex(x => clientKey(x) === key);
    if (i >= 0) list[i] = Object.assign({}, list[i], clean, { name: clean.name || list[i].name, email: clean.email || list[i].email });
    else list.push(Object.assign({ id: randomId(8) }, clean));
    list.sort((a, b) => (b.used || 0) - (a.used || 0));
    return list;
  }
  // Cliente frecuente que coincide con el RUC o el documento escrito
  function matchClient(list, d) {
    if (d.mode === "con") { const p = parseRuc(d.ruc); return p ? list.find(c => c.mode === "con" && c.ruc === p.full) || null : null; }
    const doc = String(d.doc || "").trim().toLowerCase();
    return doc.length >= 3 ? list.find(c => c.mode === d.mode && String(c.doc || "").trim().toLowerCase() === doc) || null : null;
  }
  // Completa nombre, correo y país desde el cliente frecuente si todavía están vacíos. Devuelve el cliente si completó algo.
  function autofillClient(list, d) {
    const c = matchClient(list, d); if (!c) return null;
    let changed = false;
    if (!d.name && c.name) { d.name = c.name; changed = true; }
    if (!d.email && c.email) { d.email = c.email; changed = true; }
    if (d.mode === "ext" && !d.country && c.country) { d.country = c.country; changed = true; }
    return changed ? c : null;
  }
  // Búsqueda sin distinguir mayúsculas ni tildes
  const norm = v => String(v == null ? "" : v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const matches = (q, ...fields) => { const n = norm(q).trim(); return !n || fields.some(f => norm(f).includes(n)); };
  const searchBox = (value, placeholder) => `<input id="hSearch" type="search" placeholder="${esc(placeholder)}" value="${esc(value || "")}" style="margin-top:12px">`;

  function clientPicker(list, onPick) {
    const rows = q => {
      const s = q.trim().toLowerCase();
      const f = list.filter(c => !s || (c.name || "").toLowerCase().includes(s) || (c.ruc || "").includes(s) || (c.doc || "").includes(s));
      return f.length ? f.map(c => `<div class="row" data-pick="${esc(c.id)}"><div class="main"><div class="title">${esc(c.name || "Sin nombre")}</div>
        <div class="sub">${c.mode === "con" ? "RUC " : ""}${esc(receiverIdText(c))}${c.email ? " · " + esc(c.email) : ""}</div></div><span class="link">Elegir</span></div>`).join("")
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
      c: [c.mode === "sin" ? 0 : c.mode === "ext" ? 2 : 1, c.ruc || "", c.name || "", c.doc || "", c.email || "", c.docType || "", c.country || ""],
      k: p.condition === "credito" ? 1 : 0, q: p.installments || 1, m: p.currency || "PYG", x: p.exchange || "",
      it: (p.items || []).map(it => it.code ? [it.desc, it.qty, it.price, it.tax, it.discount || 0, it.code] : [it.desc, it.qty, it.price, it.tax, it.discount || 0]), o: p.note || "" };
  }
  function compactToPedido(o) {
    if (!o || o.v !== 1 || !o.i || !Array.isArray(o.it)) throw new Error("formato");
    const c = o.c || [];
    return { id: String(o.i), rev: Number(o.r) || 1, seller: String(o.s || ""), createdAt: o.f, updatedAt: o.u || o.f,
      client: { mode: c[0] === 0 ? "sin" : c[0] === 2 ? "ext" : "con", ruc: c[1] || "", name: c[2] || "", doc: c[3] || "", email: c[4] || "",
        docType: String(c[5] || ""), country: String(c[6] || "") },
      condition: o.k === 1 ? "credito" : "contado", installments: Number(o.q) || 1, currency: o.m === "USD" ? "USD" : "PYG", exchange: o.x || "",
      items: o.it.map(a => Object.assign({ desc: String(a[0] || ""), qty: Number(a[1]) || 0, price: Number(a[2]) || 0, tax: ["10", "5", "E"].includes(a[3]) ? a[3] : "10", discount: Number(a[4]) || 0 },
        a[5] ? { code: String(a[5]) } : {})),
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

  // ================= CDC (Manual Técnico v150) =================
  // o: { deType (1 = factura electrónica), ruc, dv, establishment, point, number, taxpayerType, date, emissionType, securityCode }
  // 44 dígitos: tipo doc (2) · RUC emisor (8) · DV (1) · establecimiento (3) · punto (3) · número (7) ·
  // tipo de contribuyente (1) · fecha AAAAMMDD (8) · tipo de emisión (1) · código de seguridad (9) · DV del CDC (1, módulo 11)
  function randomDigits(n) {
    const buf = new Uint8Array(n * 2); let s = "";
    if (global.crypto && crypto.getRandomValues) crypto.getRandomValues(buf); else buf.forEach((_, i) => buf[i] = Math.random() * 256);
    for (let i = 0; s.length < n && i < buf.length; i++) if (buf[i] < 250) s += String(buf[i] % 10);
    while (s.length < n) s += String(Math.floor(Math.random() * 10));
    return s;
  }
  const pad = (v, n) => String(v == null ? "" : v).replace(/\D/g, "").padStart(n, "0").slice(-n);
  const ymd = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  function buildCdc(o) {
    const sec = o.securityCode ? pad(o.securityCode, 9) : randomDigits(9);
    const base = pad(o.deType || "1", 2) + pad(o.ruc, 8) + pad(o.dv, 1) + pad(o.establishment, 3) + pad(o.point, 3) + pad(o.number, 7) +
      pad(o.taxpayerType || "2", 1) + ymd(o.date || new Date()) + pad(o.emissionType || "1", 1) + sec;
    return base + dv11(base);
  }
  function isValidCdc(cdc) {
    const d = String(cdc || "").replace(/\s/g, "");
    return /^\d{44}$/.test(d) && dv11(d.slice(0, 43)) === Number(d[43]);
  }
  const formatCdc = cdc => String(cdc || "").replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");

  // ================= QR del KuDE (sección 13.8) =================
  // CSC de prueba del manual (IdCSC 0001). En producción cada contribuyente usa el suyo.
  const CSC_TEST = { id: "0001", value: "ABCD0000000000000000000000000000" };
  const toHex = str => Array.from(new TextEncoder().encode(String(str)), b => b.toString(16).padStart(2, "0")).join("");
  const hasSubtle = () => !!(global.crypto && crypto.subtle);
  async function sha256Bytes(str) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)))); }
  async function sha256Hex(str) { return Array.from(await sha256Bytes(str), b => b.toString(16).padStart(2, "0")).join(""); }
  const bytesToB64 = bytes => { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s); };
  // Sin XML firmado no hay DigestValue real: se simula con el SHA-256 (en base64) de los datos de la factura.
  async function simulatedDigest(data) { return bytesToB64(await sha256Bytes(JSON.stringify(data))); }
  const localIso = d => ymd(d).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") + "T" + d.toTimeString().slice(0, 8);
  // o: { env, cdc, date, receiver, total, iva, items, digest, csc: {id, value} }
  async function buildQrUrl(o) {
    const base = "https://ekuatia.set.gov.py/consultas" + (o.env === "prod" ? "" : "-test") + "/qr?";
    const rec = o.receiver || {};
    const recParam = rec.mode === "con"
      ? "dRucRec=" + ((parseRuc(rec.ruc) || { base: String(rec.ruc || "").split("-")[0] }).base)
      : "dNumIDRec=" + (String(rec.doc || "").trim() || "0");
    const params = "nVersion=150&Id=" + String(o.cdc).replace(/\s/g, "") + "&dFeEmiDE=" + toHex(typeof o.date === "string" ? o.date : localIso(o.date)) +
      "&" + recParam + "&dTotGralOpe=" + o.total + "&dTotIVA=" + (o.iva || 0) + "&cItems=" + o.items +
      "&DigestValue=" + toHex(o.digest || "") + "&IdCSC=" + o.csc.id;
    if (!hasSubtle()) return base + params; // sin HTTPS no se puede calcular el hash
    return base + params + "&cHashQR=" + await sha256Hex(params + o.csc.value);
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

  // ================= Tema claro / oscuro =================
  // "auto" sigue al sistema; "light" o "dark" lo fijan. Se guarda en este dispositivo.
  const THEME_KEY = "fe_theme";
  function getTheme() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (_) { return "auto"; } }
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  function setTheme(t) {
    try { t === "auto" ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, t); } catch (_) {}
    applyTheme(t);
  }
  const themeHTML = () => { const t = getTheme(), b = (k, l) => `<button data-theme-set="${k}" class="${t === k ? "on" : ""}">${l}</button>`;
    return `<div class="seg">${b("auto", "Automático")}${b("light", "☀ Claro")}${b("dark", "☾ Oscuro")}</div>`; };
  if (global.document) applyTheme(getTheme());

  // ================= Instalar como app =================
  // Chrome/Edge en Android y computadora avisan con beforeinstallprompt; iPhone se instala desde Compartir.
  let installEvt = null; const installSubs = [];
  global.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; installSubs.forEach(f => f()); });
  global.addEventListener("appinstalled", () => { installEvt = null; toast("App instalada"); installSubs.forEach(f => f()); });
  const isStandalone = () => (global.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function installHTML(appName) {
    if (isStandalone()) return `<div class="small"><span class="install-ok">✓ Ya estás usando la app instalada.</span></div>`;
    if (installEvt) return `<button class="btn primary" data-install>Instalar ${esc(appName)}</button>`;
    if (isIOS()) return `<div class="small">En iPhone: tocá <b>Compartir</b> y luego <b>Agregar a inicio</b>.</div>`;
    return `<div class="small">Abrí el menú del navegador (⋮) y elegí <b>Instalar app</b> o <b>Agregar a pantalla principal</b>.
      <div class="muted" style="margin-top:6px">Si dice que ya está instalada, desinstalá la versión anterior (mantené presionado el ícono → Desinstalar) y volvé a abrir esta página.</div></div>`;
  }
  async function promptInstall() {
    if (!installEvt) return false;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (_) {}
    installEvt = null; installSubs.forEach(f => f());
    return true;
  }
  const onInstallChange = f => installSubs.push(f);

  global.FE = {
    getTheme, setTheme, themeHTML,
    installHTML, promptInstall, onInstallChange, isStandalone,
    decimalsFor, money, fmtQty, parseAmount, pygTotal, enhance, buzz, matchClient, autofillClient, matches, searchBox,
    fmt, esc, fmtDate, todayKey, localDayKey, INNOMINATE_LIMIT, registry, dv11, parseRuc, classify, opName,
    calcItem, calcItems, taxLabel, DOC_TYPES, DOC_SHORT, EXT_DOC_TYPES, receiverIdText, receiverIdLabel, receiverDisplayName,
    receiverBlock, syncReceiver, receiverLiveIds, receiverFromDraft,
    buildCdc, isValidCdc, formatCdc, CSC_TEST, toHex, sha256Hex, simulatedDigest, buildQrUrl, localIso, makeStore, randomId, toast, sheet, confirmSheet, itemSheet,
    upsertClient, clientPicker, encodePedido, decodePedido, qrCanvas, readQrFromFile, openScanner,
    shareCanvas, copyText, downloadBlob, exportBackup, importBackup, registerSW, fnv32
  };
})(window);
