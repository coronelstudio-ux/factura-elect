/* App Facturador (principal): factura, recibe notas de pedido por QR y decide si facturarlas.
   Basada en facturador-prueba-local.html. Todo se guarda en este dispositivo. */
(function () {
  "use strict";
  const { fmt, esc, fmtDate, classify, opName, calcItem, calcItems, taxLabel, toast, sheet, confirmSheet, itemSheet,
    upsertClient, clientPicker, decodePedido, readQrFromFile, openScanner, parseRuc } = FE;
  const T = FE.T;
  // Empresa activa (multiempresa). La primera vez se crea la empresa de ejemplo con los datos que ya había.
  const company = T.ensureEmpresas();
  const store = T.storeFor(company.id);          // datos de esta empresa
  const deviceStore = FE.makeStore("fac_");     // PIN del dispositivo (modo sin usuarios)

  // ================= Facturas de ejemplo (ficticias), solo para la empresa de ejemplo =================
  const seedInvoices = [
    { id: 1, number: "001-001-0000012", date: "2026-11-04T16:22:48", client: "Juan Pérez", ruc: "4567890-1", total: 129000, status: "ok", cdc: "0180 0123 4500 0100 1000 0012 2202 6110 4141 7392 8510", operation: "B2B" },
    { id: 2, number: "001-001-0000011", date: "2026-11-03T09:05:00", client: "Consumidor final", ruc: "", total: 42000, status: "warn", cdc: "", operation: "B2C" },
    { id: 3, number: "001-001-0000010", date: "2026-11-02T16:40:00", client: "Librería Central S.A.", ruc: "80098765-9", total: 1250000, status: "bad", cdc: "", operation: "B2B", reason: "1103 Número de timbrado no vigente" },
    { id: 4, number: "001-001-0000009", date: "2026-11-02T11:12:00", client: "María Gómez", ruc: "3210987-3", total: 96800, status: "ok", cdc: "", operation: "B2B" }
  ];
  let invoices = store.get("invoices", null) || (company.demo ? seedInvoices : []);
  let inbox = store.get("pedidos", []);      // pedidos recibidos por QR
  let clients = store.get("clients", []);
  // Timbrados: todos quedan guardados; solo uno está activo y es el único que se usa para facturar (ver shared/tenant.js)
  let timbrados = T.timbradosOf(company);
  let products = store.get("products", []);   // productos frecuentes
  // Preferencias del cliente: valores por defecto, pie del KuDE, formato de impresión, correo automático
  const prefs = Object.assign({ condition: "contado", currency: "PYG", exchange: "", exchangeDate: "", footerText: "", printFormat: "a4", autoEmail: false,
    remSalida: "", remModo: "1", remMarca: "", remChapa: "", remChofer: "", remChoferDoc: "", afConstancia: "1" }, store.get("prefs", {}));
  const save = () => {
    T.saveEmpresa(company); store.set("invoices", invoices); store.set("pedidos", inbox); store.set("clients", clients);
    store.set("timbrados", timbrados); store.set("products", products); store.set("prefs", prefs);
  };
  save();
  const dmyToIso = T.dmyToIso, isoToDmy = T.isoToDmy, timbradoStatus = T.timbradoStatus, vigenciaText = T.vigenciaText;
  // Usuario con sesión (null = modo de un solo dispositivo sin usuarios: se permite todo)
  let user = null;
  const can = perm => T.can(user, perm);
  // Vista por rol: el administrador (o el modo un dispositivo) gestiona y corrige; el facturador emite y ve solo lo suyo
  const esAdm = () => can("documentos.corregir");
  const misDocs = () => can("documentos.todos") ? invoices : invoices.filter(i => user && i.by === user.id);
  const tt = key => T.term(key, user);
  const verBoletas = () => can("cliente.config"); // el aviso de la boleta lo ve quien administra la empresa
  const log = (action, detail) => T.audit(action, detail, company.id, user);
  // Módulo contratado por la empresa y permitido al usuario (si no, todo lo del módulo desaparece)
  const mod = key => T.userHas(user, company, key);
  const MOD_OF_TYPE = { "4": "autofactura", "7": "remision" };
  // Estado de cuenta del servicio: si está suspendido por falta de pago, no se emiten documentos nuevos (lo emitido se sigue viendo)
  let billing = T.cuenta(company);

  // ================= Estado =================
  const state = { screen: "home", filter: "all", detailId: null, lastResult: null, draft: store.get("draft", null) || newDraft(), preview: null, q: "",
    pedFilter: "pendiente", pedSeller: "", pedidoId: null };
  // Borrador de documento. type: código del tipo de documento (1 factura, 4 autofactura, 5 nota de crédito, 6 nota de débito, 7 remisión)
  function newDraft(type) {
    const code = String(type || "1");
    return { deType: code, pedidoId: null, mode: "con", ruc: "", name: "", doc: "", docType: "1", country: "", email: "", address: "", phone: "",
      condition: prefs.condition, installments: 1, currency: code === "4" ? "PYG" : prefs.currency,
      exchange: prefs.exchangeDate === FE.todayKey() ? prefs.exchange : "", items: [],
      assoc: null, motivo: code === "6" ? "8" : "2",
      seller: { kind: "1", name: "", docType: "1", doc: "", address: "", city: "" },
      constancia: { tipo: prefs.afConstancia || "1", numero: "" },
      rem: { motivo: "1", inicio: FE.todayKey(), fin: "", salida: prefs.remSalida || [company.address, company.city].filter(Boolean).join(", "), entrega: "",
        modo: prefs.remModo || "1", responsable: "propio", marca: prefs.remMarca, chapa: prefs.remChapa, chofer: prefs.remChofer, choferDoc: prefs.remChoferDoc,
        transportista: "", transportistaRuc: "" } };
  }
  // Borradores guardados antes de los tipos de documento: completar campos que faltan
  function fixDraft(d) { const base = newDraft(d.deType); Object.keys(base).forEach(k => { if (d[k] === undefined) d[k] = base[k]; }); return d; }
  state.draft = fixDraft(state.draft);
  const activeTimbrado = () => timbrados.find(x => T.normTimbrado(x).estado === "activo") || null;
  // Caja (punto de expedición) en uso: una de las asignadas al usuario que esté habilitada en el timbrado activo
  const ptoStoreKey = () => "punto_" + (user ? user.id : "dev");
  function myPuntos() { const t = activeTimbrado(), mine = T.puntosDeUsuario(user, company); return t ? mine.filter(k => t.habilita[k]) : mine; }
  function curPunto() { const list = myPuntos(), saved = store.get(ptoStoreKey(), ""); return list.includes(saved) ? saved : list[0] || ""; }
  const puntoName = key => (T.puntoInfo(company, key) || { nombre: key }).nombre;
  // Datos del emisor para el KuDE, el PDF y el XML: la dirección es la del establecimiento que emitió
  const emisorDe = inv => inv && inv.establecimiento ? Object.assign({}, company, { address: inv.establecimiento.address || company.address, city: inv.establecimiento.city || company.city }) : company;
  const timbradoOk = () => timbradoStatus(activeTimbrado()) === "vigente";
  // Si el tipo se puede emitir ahora: disponible en SIFEN, habilitado en el timbrado activo y timbrado vigente
  function docState(code) {
    const ty = T.deType(code), t = activeTimbrado();
    if (MOD_OF_TYPE[ty.code] && !mod(MOD_OF_TYPE[ty.code])) return { ok: false, state: "hidden", why: "Módulo no habilitado" };
    if (!ty.available) return { ok: false, state: "soon", why: ty.reason };
    if ((ty.code === "5" || ty.code === "6") && !esAdm()) return { ok: false, state: "hidden", why: "Exclusivo del administrador de la empresa" };
    if (billing.state === "suspendido") return { ok: false, state: "off", why: billing.text + ". Comunicate con el estudio. Tus documentos emitidos se siguen viendo y descargando." };
    if (!t || !timbradoOk()) return { ok: false, state: "off", why: timbradoProblem() || "No hay timbrado activo" };
    const key = curPunto();
    if (!key) return { ok: false, state: "off", why: "No tenés una caja habilitada en el timbrado activo. Pedile al admin que te asigne una." };
    if (!T.typeEnabled(t, ty.code, key)) return { ok: false, state: "off", why: "No está habilitado en el timbrado " + t.number + " para " + T.puntoLabel(company, key) + ". " +
      (can("timbrados.editar") ? "Si lo habilitaste en Marangatu, agregalo con «Ampliar» en Ajustes → Timbrados." : "Si está habilitado en Marangatu, pedile al admin que amplíe el timbrado.") };
    return { ok: true, state: "on", why: "" };
  }
  // Total en guaraníes del borrador (en dólares, con el tipo de cambio; 0 si todavía no lo cargó)
  const pygOf = (d, t) => { const v = FE.pygTotal(t.total, d.currency, d.exchange); return v == null ? 0 : v; };
  function timbradoProblem() {
    const t = activeTimbrado(), st = timbradoStatus(t);
    const where = can("timbrados.editar") ? "Cargalo o activalo en Ajustes → Timbrados." : "Pedile al estudio que lo cargue.";
    if (st === "none") return "No hay un timbrado activo. " + where;
    if (st === "futuro") return "El timbrado activo " + t.number + " empieza el " + isoToDmy(t.start) + ". Hasta esa fecha no se puede facturar con él.";
    if (st === "vencido") return "El timbrado activo " + t.number + " venció el " + isoToDmy(t.end) + ". " + where;
    return "";
  }
  const nextNumberStr = code => { const t = activeTimbrado(), key = curPunto(); return t && key ? key + "-" + String(T.nextNum(t, String(code || "1"), key)).padStart(7, "0") : "Sin timbrado activo"; };

  // ================= Utilidades de interfaz =================
  const statusChip = s => s === "ok" ? '<span class="chip ok">Aprobada</span>' : s === "bad" ? '<span class="chip bad">Rechazada</span>' : '<span class="chip warn">Pendiente</span>';
  const pedChip = s => s === "facturado" ? '<span class="chip ok">Facturado</span>' : s === "rechazado" ? '<span class="chip bad">Rechazado</span>' : '<span class="chip warn">Pendiente de facturar</span>';
  const pedClient = p => FE.receiverDisplayName(p.client);
  const pendingCount = () => inbox.filter(p => p.status === "pendiente").length;
  function companyLine() {
    const line = document.getElementById("companyLine"), multi = T.empresasOf(user).length > 1;
    const pk = typeof curPunto === "function" ? curPunto() : "";
    line.textContent = company.name + " · RUC " + company.ruc + "-" + company.dv + (pk ? " · " + puntoName(pk) : "") + (multi ? "  ▾ cambiar" : "") + (user ? " · " + user.name : "");
    line.style.cursor = multi ? "pointer" : "";
    document.getElementById("envChip").textContent = company.env === "test" ? "Prueba" : "Producción";
    const b = document.getElementById("pedBadge"), n = mod("pedidos") ? pendingCount() : 0;
    b.textContent = n; b.classList.toggle("hidden", !n);
  }

  // ================= Pantallas =================
  function screenHome() {
    const today = FE.todayKey(), mes = today.slice(0, 7), adm = can("negocio.resumen");
    const base = misDocs().filter(i => i.status === "ok" && !i.cancelled && String(i.deType || "1") === "1");
    const todays = base.filter(i => FE.localDayKey(i.date) === today), month = base.filter(i => FE.localDayKey(i.date).slice(0, 7) === mes);
    const sum = l => l.reduce((a, i) => a + (i.total || 0), 0);
    const pending = misDocs().filter(i => i.status === "warn").length, rejected = misDocs().filter(i => i.status === "bad" && !i.cancelled).length;
    const pp = mod("pedidos") ? pendingCount() : 0, st = docState("1");
    const groupBy = (l, f) => { const m = {}; l.forEach(i => { const k = f(i) || "Sin dato"; m[k] = m[k] || { n: 0, t: 0 }; m[k].n++; m[k].t += i.total || 0; }); return Object.entries(m).sort((a, b) => b[1].t - a[1].t); };
    const table = (title, rows) => rows.length > 1 ? `<div class="section"><div class="section-title">${title}</div><div class="card">${rows.map(([k, v]) =>
      `<div class="kv"><span>${esc(k)} <span class="small muted">· ${v.n} factura(s)</span></span><span class="amount">Gs ${fmt(v.t)}</span></div>`).join("")}</div></div>` : "";
    const pk = curPunto();
    return `
      <h2>${adm ? "Mi negocio" : "Mi caja"}</h2>
      <div class="hero">
        <div class="label">${adm ? "Facturado hoy" : "Facturado hoy por " + esc(user ? user.name : "esta caja")}</div>
        <div class="value">Gs ${fmt(sum(todays))}</div>
        <div class="meta">${todays.length} factura(s)${adm ? " · en el mes: Gs " + fmt(sum(month)) : pk ? " · " + esc(puntoName(pk)) : ""}</div>
      </div>
      <div class="quick">
        <button class="btn primary" data-go="new" ${st.ok ? "" : "disabled"}>Emitir</button>
        ${mod("pedidos") ? `<button class="btn soft" data-go="pedidos">Notas de pedido${pp ? " (" + pp + ")" : ""}</button>` : `<button class="btn soft" data-go="history">Documentos</button>`}
      </div>
      ${billing.state === "suspendido" ? `<div class="notice bad"><b>Emisión suspendida</b>${esc(billing.text)}. ${adm ? "Para regularizar, contacte al estudio." : "Contacte al administrador de la empresa."} Los documentos emitidos siguen disponibles.</div>`
        : billing.state === "vencido" && adm ? `<div class="notice warn"><b>Pago del servicio vencido</b>${esc(billing.text)}.</div>` : ""}
      ${adm ? timbradoNotice() : !st.ok && st.state !== "hidden" && billing.state !== "suspendido" ? `<div class="notice bad"><b>No es posible emitir</b>${esc(st.why)}</div>` : ""}
      ${adm && company.cert && T.certStatus(company.cert).state !== "ok" ? `<div class="notice warn"><b>Certificado de firma</b>${esc(T.certStatus(company.cert).text)}. Lo renueva el estudio.</div>` : ""}
      ${pp ? `<div class="notice warn"><b>${pp} nota(s) de pedido por facturar</b>Disponibles en Notas de pedido.</div>` : ""}
      ${rejected ? `<div class="notice bad"><b>${rejected} documento(s) rechazado(s)</b>${adm ? "El motivo figura en el detalle de cada documento." : "Para corregirlos, contacte al administrador de la empresa."}</div>` : ""}
      ${pending && adm ? `<div class="notice warn"><b>${pending} documento(s) pendiente(s) de envío</b>Se envían automáticamente.</div>` : ""}
      ${adm ? table("Hoy por caja", groupBy(todays, i => i.kude && i.kude.punto ? i.kude.punto.nombre : "")) + table("Hoy por usuario", groupBy(todays, i => i.byName || "Sin usuario")) : ""}
      <div class="section">
        <div class="section-title">Últimos documentos</div>
        <div class="card">${misDocs().slice(0, 4).map(rowInvoice).join("") || `<div class="muted small">Sin documentos emitidos.</div>`}</div>
      </div>`;
  }
  function timbradoNotice() {
    const t = activeTimbrado(), problem = timbradoProblem();
    if (problem) return `<div class="notice bad"><b>No se puede facturar</b>${esc(problem)}</div>`;
    const days = t.end ? Math.round((Date.parse(t.end) - Date.parse(FE.todayKey())) / 86400000) : null;
    if (days !== null && days <= 30) return `<div class="notice warn"><b>El timbrado ${esc(t.number)} vence en ${days} día(s)</b>Vigente hasta el ${isoToDmy(t.end)}. Cargá el nuevo en Ajustes → Timbrados.</div>`;
    const key = curPunto(), h = key ? t.habilita[key] : null;
    if (!h) return `<div class="notice bad"><b>No se puede facturar</b>No tenés una caja habilitada en el timbrado activo ${esc(t.number)}. Pedile al admin que te asigne una.</div>`;
    return `<div class="notice ok"><b>Timbrado activo ${esc(t.number)} · ${esc(T.puntoLabel(company, key))}</b>${esc(vigenciaText(t))} · habilita: ${esc(h.tipos.map(c => T.deType(c).short).join(", "))}${h.tipos.includes("1") ? " · próxima factura " + esc(nextNumberStr("1")) : ""}</div>`;
  }
  function rowInvoice(i) {
    const ty = T.deType(i.deType), tag = ty.code === "1" ? "" : `<span class="tag ${ty.key}">${esc(ty.abbr)}</span>`;
    return `<div class="row" data-open="${i.id}" role="button" tabindex="0">
      <div class="main"><div class="title">${esc(i.client)}</div><div class="sub">${tag}${esc(i.number)} · ${fmtDate(i.date)}</div></div>
      <div style="text-align:right"><div class="amount">${ty.key === "remision" ? esc(ty.short) : (ty.code === "5" ? "− " : "") + "Gs " + fmt(i.total)}</div><div style="margin-top:4px">${i.cancelled ? '<span class="chip neutral">Cancelada</span>' : statusChip(i.status)}</div></div>
    </div>`;
  }

  // ================= Nuevo documento =================
  const DOC_HINT = { "1": "Venta de bienes o servicios", "5": "Anula o reduce una factura aprobada", "6": "Aumenta el monto de una factura",
    "4": "Compra a una persona que no es contribuyente", "7": "Traslado de mercaderías" };
  const setPath = (o, path, v) => { const ks = path.split("."), last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v; };
  const getPath = (o, path) => path.split(".").reduce((a, k) => a == null ? a : a[k], o);
  const fid = path => "f_" + path.replace(/\./g, "_");
  const fld = (label, path, kb, extra) => `<label for="${fid(path)}">${label}</label><input id="${fid(path)}" data-field="${path}" ${kb ? `data-kb="${kb}"` : ""} value="${esc(getPath(state.draft, path) || "")}" ${extra || ""}>`;
  const sel = (label, path, opts) => `<label for="${fid(path)}">${label}</label><select id="${fid(path)}" data-field="${path}">${opts.map(([c, l]) =>
    `<option value="${esc(c)}" ${String(getPath(state.draft, path)) === String(c) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const segf = (path, opts) => `<div class="seg">${opts.map(([c, l]) => `<button data-setfield="${path}" data-value="${esc(c)}" class="${String(getPath(state.draft, path)) === String(c) ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
  const sectionT = (n, done, title, extra) => `<div class="section-title"><span class="num ${done ? "done" : ""}">${n}</span>${title}${extra || ""}</div>`;

  function docPickerHTML(d) {
    const ty = T.deType(d.deType);
    return `<button class="doc-picker" data-docpick aria-haspopup="dialog"><span><span class="lbl">Tipo de documento</span><span class="val">${esc(ty.label)}</span></span><span class="caret">▾</span></button>`;
  }
  // Desplegable con todos los tipos: los habilitados primero; los demás, en gris y con el motivo
  function docPickerSheet() {
    const order = { on: 0, off: 1, soon: 2 };
    const list = T.DE_TYPES.map(ty => Object.assign({ ty }, docState(ty.code))).filter(x => x.state !== "hidden").sort((a, b) => order[a.state] - order[b.state]);
    const chip = st => st === "on" ? '<span class="chip ok">Habilitado</span>' : st === "off" ? '<span class="chip bad">No habilitado</span>' : '<span class="chip neutral">Próximamente</span>';
    sheet(`<h3>Tipo de documento</h3>
      <p class="muted small" style="margin:2px 0 8px">Solo podés emitir los tipos habilitados en el timbrado activo.</p>
      ${list.map(x => `<button class="doc-opt ${x.ok ? "" : "off"} ${x.ty.code === state.draft.deType ? "on" : ""}" data-pickdoc="${x.ty.code}" ${x.ok ? "" : 'aria-disabled="true"'}>
        <span class="abbr">${esc(x.ty.abbr)}</span>
        <span><span class="t">${esc(x.ty.label)}</span><span class="w">${esc(x.ok ? DOC_HINT[x.ty.code] || "" : x.why)}</span></span>
        <span class="state">${chip(x.state)}</span></button>`).join("")}
      <button class="btn" data-x style="margin-top:12px">Cerrar</button>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.addEventListener("click", e => {
        const b = e.target.closest("[data-pickdoc]"); if (!b) return;
        const st = docState(b.dataset.pickdoc);
        if (!st.ok) { toast(st.why); return; }
        close(); switchDocType(b.dataset.pickdoc);
      });
    });
  }
  function switchDocType(code) {
    syncFields();
    const old = state.draft;
    if (old.deType === code) return;
    const d = newDraft(code);
    // Factura, autofactura y remisión conservan los productos; factura y remisión, también el cliente
    if (["1", "7"].includes(code) && ["1", "7"].includes(old.deType)) ["mode", "ruc", "name", "doc", "docType", "country", "email", "pedidoId"].forEach(k => d[k] = old[k]);
    if (["1", "4", "7"].includes(code) && ["1", "4", "7"].includes(old.deType)) d.items = old.items.map(i => Object.assign({}, i, code === "4" ? { tax: "E" } : {}));
    if (code === "7" && old.deType === "1" && old.assoc) d.assoc = old.assoc;
    d.step = stepsOf(d)[0] === "tipo" ? 1 : 0;
    state.draft = d; state.preview = null; state.wq = ""; state.wmanual = false; render();
  }

  // Facturas aprobadas que se pueden asociar a una nota, con su saldo (total menos notas de crédito ya emitidas)
  const isType = (i, code) => String(i.deType || "1") === code;
  const credited = fac => invoices.filter(n => isType(n, "5") && n.assocId === fac.id && n.status === "ok" && !n.cancelled).reduce((a, n) => a + (n.totalOp != null ? n.totalOp : n.total), 0);
  const facTotalOp = fac => fac.totalOp != null ? fac.totalOp : fac.total;
  const saldoOf = fac => Math.max(0, Math.round((facTotalOp(fac) - credited(fac)) * 100) / 100);
  function assocPicker(onlyType) {
    const facs = invoices.filter(i => isType(i, "1") && i.status === "ok" && !i.cancelled && i.kude);
    const rows = q => { const f = facs.filter(i => FE.matches(q, i.client, i.number, i.ruc));
      return f.length ? f.map(i => `<div class="row" data-assoc="${i.id}"><div class="main"><div class="title">${esc(i.number)} · ${esc(i.client)}</div>
        <div class="sub">${fmtDate(i.date)} · ${FE.money(facTotalOp(i), i.currency)}${state.draft.deType === "5" ? " · saldo " + FE.money(saldoOf(i), i.currency) : ""}</div></div><span class="link">Elegir</span></div>`).join("")
        : `<div class="muted small" style="padding:8px 0">${facs.length ? "Ninguna factura coincide." : "Todavía no hay facturas aprobadas para asociar."}</div>`; };
    sheet(`<h3>Factura asociada</h3>
      <input id="aSearch" type="search" data-kb="search" placeholder="Buscar por cliente, número o RUC" style="margin-top:8px">
      <div id="aList" style="margin-top:6px">${rows("")}</div>
      <button class="btn" data-x style="margin-top:12px">Cerrar</button>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("#aSearch").oninput = e => { el.querySelector("#aList").innerHTML = rows(e.target.value); };
      el.addEventListener("click", e => { const r = e.target.closest("[data-assoc]"); if (!r) return; close(); setAssoc(invoices.find(x => x.id === +r.dataset.assoc)); });
    });
  }
  function setAssoc(fac) {
    if (!fac) return;
    const d = state.draft, k = fac.kude;
    d.assoc = { id: fac.id, number: fac.number, cdc: fac.cdc, date: fac.date, currency: k.currency, client: fac.client };
    d.currency = k.currency; d.exchange = k.exchange || "";
    if (d.deType === "5") d.items = k.items.map(i => Object.assign({}, i)); // nota de crédito: se parte de los productos de la factura
    if (d.deType === "7") {                                                  // remisión: destinatario y mercaderías de la factura
      const r = k.receiver || {}; Object.assign(d, { mode: r.mode || "con", ruc: r.ruc || "", doc: r.doc || "", docType: r.docType || "1", country: r.country || "", name: r.name || "" });
      d.items = k.items.map(i => ({ desc: i.desc, qty: i.qty, price: 0, tax: "E", discount: 0, code: i.code }));
    }
    render();
  }

  function itemsHTML(d, opts) {
    opts = opts || {};
    return `<div class="card">
      ${!d.items.length ? `<div class="muted small" style="padding:4px 0 2px">${opts.empty || "Todavía no agregaste productos o servicios."}</div>` :
        d.items.map((it, idx) => { const c = calcItem(it, d.currency); return `<div class="item">
          <div class="desc">${esc(it.desc)}</div><div class="amount">${opts.noPrice ? FE.fmtQty(it.qty) + " UNI" : FE.money(c.total, d.currency)}</div>
          <div class="calc">${opts.noPrice ? (it.code ? esc(it.code) : "Sin precio: solo traslado") : FE.fmtQty(it.qty) + " × " + FE.money(it.price, d.currency) + (it.discount ? " − " + it.discount + "%" : "") + " · " + (opts.noTax ? "Sin IVA" : taxLabel(it.tax))}</div>
          <div class="item-actions">
            <span class="stepper"><button data-qtyminus="${idx}" aria-label="Uno menos" ${it.qty <= 1 ? "disabled" : ""}>−</button><b>${FE.fmtQty(it.qty)}</b><button data-qtyplus="${idx}" aria-label="Uno más">+</button></span>
            <span><button class="link" data-edititem="${idx}">Editar</button><button class="link danger" data-del="${idx}">Quitar</button></span>
          </div></div>`; }).join("")}
      <button class="add" data-add="1">+ ${opts.addLabel || "Agregar producto o servicio"}</button>
    </div>`;
  }
  const stickyHTML = (left, right, ok, label) => `<div class="sticky-total">
      <div class="line"><span class="muted">${left}</span><span class="big">${right}</span></div>
      <button class="btn primary" data-preview="1" ${ok ? "" : "disabled"}>${label}</button></div>`;
  const countText = n => n ? n + (n === 1 ? " producto" : " productos") : "Total";
  // Si se puede ir a la vista previa, y por qué no
  function draftCheck(d) {
    const ty = T.deType(d.deType), ds = docState(d.deType), t = calcItems(d.items, d.currency);
    if (!ds.ok) return { ok: false, why: ds.why, t };
    if (!d.items.length) return { ok: false, why: ty.key === "remision" ? "Agregá las mercaderías que se trasladan" : "Agregá al menos un producto", t };
    if (ty.assoc) {
      if (!d.assoc) return { ok: false, why: "Elegí la factura asociada", t };
      if (t.total <= 0) return { ok: false, why: "El total tiene que ser mayor a cero", t };
      const fac = invoices.find(x => x.id === d.assoc.id);
      if (ty.key === "nc" && fac && t.total > saldoOf(fac) + 0.001) return { ok: false, why: "La nota de crédito supera el saldo de la factura (" + FE.money(saldoOf(fac), fac.currency) + ")", t };
      return { ok: true, t };
    }
    if (ty.key === "autofactura") {
      const s = d.seller;
      if (!s.name.trim()) return { ok: false, why: "Escribí el nombre del vendedor", t };
      if (!s.doc.trim()) return { ok: false, why: "Escribí el documento del vendedor", t };
      if (!d.constancia.numero.trim()) return { ok: false, why: "Escribí el número de la constancia", t };
      return { ok: true, t };
    }
    const r = classify(d, ty.key === "remision" ? 0 : pygOf(d, t));
    if (!r.valid) return { ok: false, why: r.why, t };
    if (ty.key === "remision") {
      const m = d.rem;
      if (!m.inicio) return { ok: false, why: "Elegí la fecha de inicio del traslado", t };
      if (!m.entrega.trim()) return { ok: false, why: "Escribí el punto de entrega", t };
      if (m.modo === "1" && (!String(m.chapa || "").trim() || !String(m.chofer || "").trim())) return { ok: false, why: "Para transporte terrestre escribí la chapa del vehículo y el chofer", t };
      if (m.responsable === "tercero" && !FE.parseRuc(m.transportistaRuc)) return { ok: false, why: "Escribí el RUC del transportista", t };
    }
    return { ok: true, t };
  }

  // ================= Emisión por pasos (flujo como una transferencia de ueno) =================
  // Una pregunta por pantalla, "Continuar" abajo, revisión con edición por fila, confirmación con PIN y comprobante.
  const STEP_Q = {
    tipo: ["¿Qué vas a emitir?", "Elegí el documento. Los que no podés emitir aparecen en gris con el motivo."],
    cliente: ["¿A quién le facturás?", "Buscalo en tus clientes, escribí su RUC o elegí otra opción."],
    destinatario: ["¿A quién le enviás la mercadería?", "Buscalo en tus clientes o cargá sus datos."],
    productos: ["¿Qué le vendés?", "Tocá un producto frecuente o agregá uno nuevo."],
    pago: ["¿Cómo te paga?", "Condición de venta y moneda."],
    asociada: ["¿Sobre qué factura?", "Elegí la factura aprobada a la que corresponde."],
    motivo: ["¿Por qué la emitís?", "El motivo queda registrado en el documento."],
    vendedor: ["¿A quién le compraste?", "Persona que no es contribuyente o extranjero."],
    constancia: ["¿Qué constancia tiene?", "La constancia que respalda la compra."],
    traslado: ["¿De dónde a dónde?", "Motivo, fechas y lugares del traslado."],
    transporte: ["¿Cómo se traslada?", "Modalidad, vehículo y chofer."],
    mercaderias: ["¿Qué se traslada?", "Solo cantidades: la remisión no lleva precios."],
    revision: ["Revisá antes de emitir", "Tocá una fila para corregirla."]
  };
  const visibleTypes = () => T.DE_TYPES.map(ty => Object.assign({ ty }, docState(ty.code))).filter(x => x.state !== "hidden");
  function stepsOf(d) {
    const key = T.deType(d.deType).key;
    const base = { factura: ["cliente", "productos", "pago"], nc: ["asociada", "productos", "motivo"], nd: ["asociada", "productos", "motivo"],
      autofactura: ["vendedor", "constancia", "productos"], remision: ["destinatario", "traslado", "transporte", "mercaderias"] }[key] || ["cliente", "productos", "pago"];
    return (visibleTypes().length > 1 ? ["tipo"] : []).concat(base, ["revision"]);
  }
  const stepKey = d => { const st = stepsOf(d); d.step = Math.max(0, Math.min(d.step || 0, st.length - 1)); return st[d.step]; };
  const goStep = (d, key) => { const i = stepsOf(d).indexOf(key); if (i >= 0) d.step = i; };
  // Validación de cada paso: { ok, why }
  function stepCheck(d, key) {
    const t = calcItems(d.items, d.currency), ty = T.deType(d.deType);
    switch (key) {
      case "tipo": return docState(d.deType);
      case "cliente": case "destinatario": {
        if (d.mode === "con" && !String(d.ruc || "").trim()) return { ok: false, why: "" }; // todavía no eligió a nadie
        const r = classify(d, key === "cliente" ? pygOf(d, t) : 0); return { ok: r.valid, why: r.valid ? "" : r.why };
      }
      case "asociada": return d.assoc ? { ok: true } : { ok: false, why: "Elegí la factura" };
      case "vendedor": return !d.seller.name.trim() ? { ok: false, why: "Escribí el nombre del vendedor" } : !d.seller.doc.trim() ? { ok: false, why: "Escribí su documento" } : { ok: true };
      case "constancia": return d.constancia.numero.trim() ? { ok: true } : { ok: false, why: "Escribí el número de la constancia" };
      case "productos": case "mercaderias": {
        if (!d.items.length) return { ok: false, why: key === "mercaderias" ? "Agregá lo que se traslada" : "Agregá al menos un producto" };
        if (ty.assoc) { const c = draftCheck(d); if (!c.ok && /saldo|cero/.test(c.why)) return { ok: false, why: c.why }; }
        return { ok: true };
      }
      case "pago": return d.currency === "USD" && FE.pygTotal(t.total, "USD", d.exchange) == null ? { ok: false, why: "Escribí el tipo de cambio del día" } : { ok: true };
      case "motivo": return { ok: !!d.motivo };
      case "traslado": return !d.rem.inicio ? { ok: false, why: "Elegí la fecha de inicio" } : !d.rem.entrega.trim() ? { ok: false, why: "Escribí el punto de entrega" } : { ok: true };
      case "transporte": {
        const m = d.rem;
        if (m.modo === "1" && (!String(m.chapa || "").trim() || !String(m.chofer || "").trim())) return { ok: false, why: "Escribí la chapa y el chofer" };
        if (m.responsable === "tercero" && !FE.parseRuc(m.transportistaRuc)) return { ok: false, why: "Escribí el RUC del transportista" };
        return { ok: true };
      }
      case "revision": { const c = draftCheck(d); return { ok: c.ok, why: c.why }; }
    }
    return { ok: true };
  }
  const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";

  function screenNew() {
    // Si el tipo del borrador ya no está disponible (módulo quitado), se vuelve a factura
    if (docState(state.draft.deType).state === "hidden") { state.draft = newDraft("1"); toast("Ese tipo de documento ya no está habilitado"); }
    if (state.draft.goto) { goStep(state.draft, state.draft.goto); delete state.draft.goto; } // abrir en un paso (ej. factura del servicio)
    const d = state.draft, steps = stepsOf(d), key = stepKey(d), n = steps.length, chk = stepCheck(d, key);
    const [q, sub] = STEP_Q[key] || ["", ""];
    const qq = key === "productos" ? ({ nc: ["¿Qué se acredita?", "Quitá lo que no corresponde o bajá cantidades."], nd: ["¿Qué se debita?", "Intereses, recargos o ajustes."],
      autofactura: ["¿Qué compraste?", "Sin IVA: la autofactura no respalda crédito fiscal."] }[T.deType(d.deType).key] || [q, sub]) : [q, sub];
    const body = { tipo: flowTipo, cliente: flowCliente, destinatario: flowCliente, productos: flowProductos, mercaderias: flowProductos, pago: flowPago,
      asociada: flowAsociada, motivo: flowMotivo, vendedor: flowVendedor, constancia: flowConstancia, traslado: flowTraslado, transporte: flowTransporte, revision: flowRevision }[key](d);
    const last = key === "revision", ty = T.deType(d.deType);
    return `
      <div class="flow">
        <div class="flow-head">
          <button class="flow-ico" data-wback aria-label="Atrás">←</button>
          <div class="flow-prog" aria-hidden="true"><div style="width:${Math.round((d.step + 1) / n * 100)}%"></div></div>
          <button class="flow-ico" data-wexit aria-label="Salir">✕</button>
        </div>
        <div class="flow-step">${esc(ty.short)} · Paso ${d.step + 1} de ${n}</div>
        <h2 class="flow-q">${esc(qq[0])}</h2>
        <p class="flow-sub">${esc(qq[1])}</p>
        ${body}
        <div class="flow-foot">
          <div class="flow-why" id="flowWhy">${chk.ok ? "" : esc(chk.why || "")}</div>
          <button class="btn primary flow-btn" ${last ? "data-wemit" : "data-wnext"} ${chk.ok ? "" : "disabled"}>${last ? "Emitir " + esc(ty.short.toLowerCase()) : "Continuar"}</button>
        </div>
      </div>`;
  }

  function flowTipo(d) {
    const order = { on: 0, off: 1, soon: 2 };
    const chip = st => st === "on" ? '<span class="chip ok">Habilitado</span>' : st === "off" ? '<span class="chip bad">No habilitado</span>' : '<span class="chip neutral">Próximamente</span>';
    return `<div class="flow-list">${visibleTypes().sort((a, b) => order[a.state] - order[b.state]).map(x => `
      <button class="doc-opt ${x.ok ? "" : "off"} ${x.ty.code === d.deType ? "on" : ""}" data-pickdoc="${x.ty.code}" ${x.ok ? "" : 'aria-disabled="true"'}>
        <span class="abbr">${esc(x.ty.abbr)}</span>
        <span><span class="t">${esc(x.ty.label)}</span><span class="w">${esc(x.ok ? DOC_HINT[x.ty.code] || "" : x.why)}</span></span>
        <span class="state">${x.ty.code === d.deType && x.ok ? '<span class="chip ok">Elegido</span>' : chip(x.state)}</span></button>`).join("")}</div>`;
  }
  // Cliente: como elegir el destino de una transferencia (buscar, contactos frecuentes u otros datos)
  function flowCliente(d) {
    const t = calcItems(d.items, d.currency), r = classify(d, pygOf(d, t)), hasSel = r.valid && (d.mode !== "con" || d.ruc);
    const qv = state.wq || "", list = clients.filter(c => FE.matches(qv, c.name, c.ruc, c.doc)).slice(0, qv ? 12 : 8);
    const p = FE.parseRuc(qv), typedRuc = p && FE.dv11(p.base) === p.dv && !clients.some(c => c.ruc === p.full) ? p.full : "";
    const reg = typedRuc ? FE.classify({ mode: "con", ruc: typedRuc }, 0) : null;
    const contact = (c, i) => `<button class="contact" data-wclient="${esc(c.id)}"><span class="avatar">${esc(initials(c.name || c.ruc))}</span>
      <span class="ct"><b>${esc(c.name || "Sin nombre")}</b><span>${c.mode === "con" ? "RUC " : ""}${esc(FE.receiverIdText(c))}</span></span><span class="go">›</span></button>`;
    return `
      ${hasSel && !state.wmanual ? `<div class="picked"><span class="avatar">${esc(initials(d.name || r.name || d.ruc))}</span>
        <span class="ct"><b>${esc(d.name || r.name || (d.mode === "sin" ? "Consumidor final" : d.ruc))}</b><span>${esc(FE.receiverIdText(FE.receiverFromDraft(d, r)))}</span></span>
        <button class="link" data-wchange>Cambiar</button></div>` : ""}
      ${!hasSel || state.wmanual ? `
        <input id="wSearch" data-kb="search" type="search" class="flow-search" placeholder="Buscá por nombre, RUC o documento" value="${esc(qv)}">
        ${typedRuc ? `<button class="contact" data-wruc="${esc(typedRuc)}"><span class="avatar plus">+</span><span class="ct"><b>${esc(reg && reg.name || "Usar este RUC")}</b><span>RUC ${esc(typedRuc)}</span></span><span class="go">›</span></button>` : ""}
        ${list.length ? `<div class="flow-label">${qv ? "Resultados" : "Frecuentes"}</div><div class="contacts">${list.map(contact).join("")}</div>`
          : qv && !typedRuc ? `<div class="muted small" style="margin:10px 2px">Ningún cliente frecuente coincide.${/^\d/.test(qv) ? " Si es un RUC, escribilo con su dígito verificador." : ""}</div>` : ""}
        <div class="flow-label">Otras opciones</div>
        <div class="opt-grid">
          <button class="opt" data-wmode="con"><b>Cargar RUC</b><span>Contribuyente</span></button>
          <button class="opt" data-wmode="sin"><b>Sin RUC</b><span>Documento o consumidor final</span></button>
          <button class="opt" data-wmode="ext"><b>Extranjero</b><span>Cliente del exterior</span></button>
        </div>` : ""}
      ${state.wmanual ? `<div class="card" style="margin-top:12px">${FE.receiverBlock(d, r, t.total, { why: true })}
        ${d.deType === "1" ? `<label for="fEmail">Correo para enviar la factura (opcional)</label><input id="fEmail" type="email" placeholder="cliente@correo.com" value="${esc(d.email)}">` : ""}
        <details class="more-data" ${d.address || d.phone ? "open" : ""}><summary>Dirección y teléfono <span class="muted">(opcional)</span></summary>
          <label for="fAddr">Dirección</label><input id="fAddr" data-kb="address" placeholder="Calle, número y ciudad" value="${esc(d.address)}">
          <label for="fTel">Teléfono</label><input id="fTel" data-kb="tel" placeholder="0981 000 000" value="${esc(d.phone)}">
        </details></div>` : ""}`;
  }
  // IVA debajo del monto (factura y notas de crédito y débito; la autofactura y la remisión no llevan IVA)
  function ivaLine(code, t, cur, cls) {
    if (!["1", "5", "6"].includes(String(code))) return "";
    const txt = FE.ivaText(t, cur);
    return txt ? `<div class="${cls}">${txt.split(" · ").map(x => `<span class="nw">${esc(x)}</span>`).join(" · ")}</div>` : "";
  }
  function flowProductos(d) {
    const t = calcItems(d.items, d.currency), noPrice = d.deType === "7", ty = T.deType(d.deType);
    const prods = mod("productos") ? products : [];
    const fac = d.assoc ? invoices.find(x => x.id === d.assoc.id) : null;
    const units = d.items.reduce((a, i) => a + (Number(i.qty) || 0), 0);
    return `
      <div class="flow-amount">${noPrice ? FE.fmtQty(units) + " <small>unidades</small>" : esc(FE.money(t.total, d.currency))}</div>
      ${ivaLine(d.deType, t, d.currency, "flow-iva")}
      <div class="flow-amount-sub">${d.items.length} ${noPrice ? "ítem(s)" : "producto(s)"}${ty.key === "nc" && fac ? " · saldo de la factura " + esc(FE.money(saldoOf(fac), fac.currency)) : ""}</div>
      ${prods.length && !ty.assoc ? `<div class="flow-label">Productos frecuentes</div><div class="chips-grid">${prods.slice(0, 12).map((p, i) =>
        `<button class="pchip" data-wprod="${i}"><b>${esc(p.desc)}</b>${noPrice ? "" : `<span>${esc(FE.money(p.price, "PYG"))}</span>`}</button>`).join("")}</div>` : ""}
      ${itemsHTML(d, { noPrice, noTax: d.deType === "4", empty: noPrice ? "Agregá lo que se traslada." : "Todavía no agregaste productos.", addLabel: noPrice ? "Agregar mercadería" : ty.key === "nd" ? "Agregar concepto" : "Agregar producto o servicio" })}`;
  }
  function flowPago(d) {
    return `
      <div class="opt-big">
        <button class="${d.condition === "contado" ? "on" : ""}" data-cond="contado"><b>Contado</b><span>Paga ahora</span></button>
        <button class="${d.condition === "credito" ? "on" : ""}" data-cond="credito"><b>Crédito</b><span>Paga después o en cuotas</span></button>
      </div>
      ${d.condition === "credito" ? `<label for="fCuotas">Cantidad de cuotas</label><input id="fCuotas" value="${d.installments}">` : ""}
      ${mod("usd") ? `<label for="fCur">Moneda</label>
        <select id="fCur"><option value="PYG" ${d.currency === "PYG" ? "selected" : ""}>Guaraníes</option><option value="USD" ${d.currency === "USD" ? "selected" : ""}>Dólares</option></select>
        ${d.currency === "USD" ? `<label for="fTc">Tipo de cambio del día</label><input id="fTc" placeholder="Ej. 7.800" value="${esc(d.exchange)}">` : ""}` : ""}`;
  }
  function flowAsociada(d) {
    const qv = state.wq || "", facs = invoices.filter(i => isType(i, "1") && i.status === "ok" && !i.cancelled && i.kude && FE.matches(qv, i.client, i.number, i.ruc));
    return `
      <input id="wSearch" data-kb="search" type="search" class="flow-search" placeholder="Buscá por cliente, número o RUC" value="${esc(qv)}">
      <div class="contacts">${facs.slice(0, 30).map(i => `<button class="contact ${d.assoc && d.assoc.id === i.id ? "sel" : ""}" data-wassoc="${i.id}"><span class="avatar">${esc(initials(i.client))}</span>
        <span class="ct"><b>${esc(i.number)} · ${esc(i.client)}</b><span>${fmtDate(i.date)} · ${esc(FE.money(facTotalOp(i), i.currency))}${d.deType === "5" ? " · saldo " + esc(FE.money(saldoOf(i), i.currency)) : ""}</span></span><span class="go">›</span></button>`).join("")
        || `<div class="muted small" style="margin:10px 2px">${qv ? "Ninguna factura coincide." : "Todavía no hay facturas aprobadas."}</div>`}</div>`;
  }
  function flowMotivo(d) {
    const list = d.deType === "5" ? T.MOTIVOS_NC : T.MOTIVOS_ND;
    return `<div class="flow-list">${list.map(([c, l]) => `<button class="radio-row ${String(d.motivo) === c ? "on" : ""}" data-setfield="motivo" data-value="${c}"><span class="dot"></span>${esc(l)}</button>`).join("")}</div>`;
  }
  function flowVendedor(d) {
    const s = d.seller;
    return `${segf("seller.kind", [["1", "No contribuyente"], ["2", "Extranjero"]])}
      ${fld("Nombre y apellido", "seller.name", "name")}
      <div class="grid2">
        <div>${sel("Tipo de documento", "seller.docType", [["1", "Cédula paraguaya"], ["2", "Pasaporte"], ["3", "Cédula extranjera"], ["4", "Carnet de residencia"], ["9", "Otro"]])}</div>
        <div>${fld("Número", "seller.doc", s.docType === "1" ? "digits" : "code")}</div>
      </div>
      ${fld("Dirección (opcional)", "seller.address", "address")}
      ${fld("Ciudad (opcional)", "seller.city", "city")}`;
  }
  function flowConstancia(d) {
    return `${sel("Tipo de constancia", "constancia.tipo", T.CONSTANCIAS)}${fld("Número de la constancia", "constancia.numero", "code")}`;
  }
  function flowTraslado(d) {
    return `${sel("Motivo del traslado", "rem.motivo", T.MOTIVOS_REM)}
      <div class="grid2 stack-sm"><div>${fld("Inicio del traslado", "rem.inicio", "", 'type="date"')}</div><div>${fld("Fin estimado (opcional)", "rem.fin", "", 'type="date"')}</div></div>
      ${fld("Punto de salida", "rem.salida", "address")}
      ${fld("Punto de entrega", "rem.entrega", "address", 'placeholder="Dirección y ciudad de entrega"')}`;
  }
  function flowTransporte(d) {
    const m = d.rem;
    return `${sel("Modalidad", "rem.modo", T.MODOS_TRANSPORTE)}
      <label>Responsable del transporte</label>
      ${segf("rem.responsable", [["propio", "Propio"], ["tercero", "Transportista"]])}
      ${m.responsable === "tercero" ? `<div class="grid2 stack-sm"><div>${fld("RUC del transportista", "rem.transportistaRuc", "ruc")}</div><div>${fld("Nombre o razón social", "rem.transportista", "org")}</div></div>` : ""}
      <div class="grid2"><div>${fld("Marca del vehículo", "rem.marca", "name")}</div><div>${fld("Chapa", "rem.chapa", "code")}</div></div>
      <div class="grid2"><div>${fld("Chofer", "rem.chofer", "name")}</div><div>${fld("Cédula del chofer", "rem.choferDoc", "digits")}</div></div>`;
  }
  // Revisión: resumen grande + filas que llevan a su paso, y el KuDE desplegable
  function flowRevision(d) {
    const ty = T.deType(d.deType), chk = draftCheck(d);
    if (chk.ok) state.preview = buildDoc(d);
    const inv = state.preview, t = chk.t, r = classify(d, pygOf(d, t));
    const row = (step, label, value) => `<button class="rev-row" data-gostep="${step}"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span><span class="go">›</span></button>`;
    const who = d.name || r.name || (d.mode === "sin" ? "Consumidor final" : d.ruc);
    const rows = [];
    if (ty.key === "factura") rows.push(row("cliente", "Cliente", who + " · " + FE.receiverIdText(FE.receiverFromDraft(d, r))), row("productos", "Productos", d.items.length + " · " + FE.money(t.total, d.currency)),
      row("pago", "Condición", (d.condition === "credito" ? "Crédito" + (d.installments > 1 ? " · " + d.installments + " cuotas" : "") : "Contado") + " · " + (d.currency === "USD" ? "USD · TC " + d.exchange : "Guaraníes")));
    if (ty.assoc) rows.push(row("asociada", "Factura", d.assoc ? d.assoc.number + " · " + d.assoc.client : "-"), row("productos", ty.key === "nc" ? "Se acredita" : "Se debita", d.items.length + " · " + FE.money(t.total, d.currency)),
      row("motivo", "Motivo", T.labelOf(ty.key === "nc" ? T.MOTIVOS_NC : T.MOTIVOS_ND, d.motivo)));
    if (ty.key === "autofactura") rows.push(row("vendedor", "Vendedor", d.seller.name + " · " + (FE.DOC_SHORT[d.seller.docType] || "") + " " + d.seller.doc),
      row("constancia", "Constancia", T.labelOf(T.CONSTANCIAS, d.constancia.tipo) + " Nº " + d.constancia.numero), row("productos", "Productos", d.items.length + " · " + FE.money(t.total, "PYG")));
    if (ty.key === "remision") rows.push(row("destinatario", "Destinatario", who), row("traslado", "Traslado", T.labelOf(T.MOTIVOS_REM, d.rem.motivo) + " · " + d.rem.entrega),
      row("transporte", "Transporte", T.labelOf(T.MODOS_TRANSPORTE, d.rem.modo) + (d.rem.chapa ? " · " + String(d.rem.chapa).toUpperCase() : "") + (d.rem.chofer ? " · " + d.rem.chofer : "")),
      row("mercaderias", "Mercaderías", d.items.length + " ítem(s)"));
    if (visibleTypes().length > 1) rows.push(row("tipo", "Documento", ty.short + " Nº " + nextNumberStr(ty.code)));
    else rows.push(`<div class="rev-row static"><span class="k">Documento</span><span class="v">${esc(ty.short)} Nº ${esc(nextNumberStr(ty.code))}</span></div>`);
    return `
      <div class="rev-card">
        <div class="rev-total">${ty.key === "remision" ? esc(d.items.length + " ítem(s)") : esc(FE.money(t.total, d.currency))}</div>
        ${ivaLine(d.deType, t, d.currency, "flow-iva")}
        <div class="rev-total-sub">${esc(ty.label)}${d.currency === "USD" && t.total && FE.pygTotal(t.total, "USD", d.exchange) ? " · " + esc(FE.money(FE.pygTotal(t.total, "USD", d.exchange), "PYG")) : ""}</div>
        ${rows.join("")}
      </div>
      ${inv ? `<details class="rev-kude"><summary>Ver el documento (KuDE)</summary>${kudeHTML(inv)}
        <div class="btn-row" style="margin-top:10px"><button class="btn soft" data-pdf="1">Descargar PDF</button>${mod("ticket") ? `<button class="btn" data-pdfalt="1">PDF en ${prefs.printFormat === "ticket" ? "A4" : "ticket"}</button>` : ""}</div></details>` : ""}
      <div class="muted small" style="margin-top:12px;text-align:center">${company.env === "test" ? "Ambiente de prueba · " : ""}Vas a confirmar con tu PIN. La aprobación de SIFEN es simulada.</div>`;
  }
  // Actualiza el botón "Continuar" y el monto sin redibujar (mientras se escribe)
  function refreshFlow() {
    const d = state.draft, key = stepKey(d), chk = stepCheck(d, key), btn = document.querySelector("[data-wnext], [data-wemit]"), why = document.getElementById("flowWhy");
    if (btn) btn.disabled = !chk.ok;
    if (why) why.textContent = chk.ok ? "" : chk.why || "";
  }
  // Confirmación con PIN en un teclado propio, como en las apps de bancos
  function pinConfirm(onOk) {
    const back = document.createElement("div");
    back.className = "pinpad-back";
    back.innerHTML = `<div class="pinpad" role="dialog" aria-modal="true" aria-label="Confirmá con tu PIN">
      <button class="flow-ico pin-x" data-px aria-label="Cancelar">✕</button>
      <div class="pin-title">Confirmá con tu PIN</div>
      <div class="pin-sub">${user ? esc(user.name) : "PIN de este dispositivo"}</div>
      <div class="pin-dots" aria-live="polite"></div>
      <div class="pin-err" id="pinErr"></div>
      <div class="pin-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<button data-pk="${k}">${k}</button>`).join("")}
        <button data-pdel aria-label="Borrar">⌫</button><button data-pk="0">0</button><button data-pok aria-label="Confirmar" class="ok">✓</button></div>
    </div>`;
    document.body.appendChild(back);
    let pin = "";
    const dots = back.querySelector(".pin-dots"), err = back.querySelector("#pinErr");
    const draw = () => { dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? "on" : ""}"></span>`).join(""); back.querySelector("[data-pok]").disabled = pin.length < 4; };
    const submit = async () => {
      if (pin.length < 4) return;
      const good = user ? await T.verifyPin(user, pin) : await Lock.check(pin);
      if (good) { back.remove(); onOk(); }
      else { err.textContent = "PIN incorrecto"; pin = ""; draw(); back.querySelector(".pinpad").classList.add("shake"); setTimeout(() => back.querySelector(".pinpad") && back.querySelector(".pinpad").classList.remove("shake"), 400); FE.buzz(80); }
    };
    back.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.px !== undefined) { back.remove(); return; }
      if (b.dataset.pk !== undefined && pin.length < 6) { pin += b.dataset.pk; err.textContent = ""; draw(); if (pin.length === 6) submit(); return; }
      if (b.dataset.pdel !== undefined) { pin = pin.slice(0, -1); draw(); return; }
      if (b.dataset.pok !== undefined) submit();
    });
    back.addEventListener("keydown", e => { if (/^\d$/.test(e.key) && pin.length < 6) { pin += e.key; draw(); } else if (e.key === "Backspace") { pin = pin.slice(0, -1); draw(); } else if (e.key === "Enter") submit(); else if (e.key === "Escape") back.remove(); });
    draw(); back.tabIndex = -1; back.focus();
  }

  // ----- KuDE: mismo diseño que el PDF de prueba -----
  const consultUrl = () => "https://ekuatia.set.gov.py/consultas" + (company.env === "test" ? "-test" : "") + "/";
  // Imagen del QR de consulta: usa la URL de la sección 13.8 calculada al aprobar (inv.qrUrl).
  const qrCache = {};
  function qrImg(inv) {
    const key = inv.qrUrl || "";
    if (!key) return "";
    if (!(key in qrCache)) { const cv = FE.qrCanvas(key); qrCache[key] = cv ? cv.toDataURL("image/png") : ""; }
    return qrCache[key];
  }
  // Datos del encabezado del KuDE según el tipo (los usan la pantalla y el PDF)
  const condText = inv => inv.condition === "credito" ? "[ ] Contado   [X] Crédito" + (inv.installments > 1 ? " · " + inv.installments + " cuotas" : "") : "[X] Contado   [ ] Crédito";
  const curText = inv => inv.currency === "USD" ? "USD" + (inv.exchange ? " · TC " + inv.exchange : "") : "PYG";
  // Solo datos para el contribuyente: sin códigos de control y sin filas vacías
  function docInfoPairs(inv) { return docInfoPairsAll(inv).filter(([, v]) => v != null && String(v).trim() && String(v).trim() !== "-"); }
  function docInfoPairsAll(inv) {
    const code = String(inv.deType || "1"), p = [["Fecha y hora de emisión", inv.dateLabel]];
    if (code === "4") {
      const s = inv.seller || {}, docName = (FE.DOC_SHORT[s.docType] || "Doc.") + " " + (s.doc || "");
      p.push(["Vendedor", s.name || "-"], ["Documento del vendedor", docName], ["Naturaleza del vendedor", s.kind === "2" ? "Extranjero" : "No contribuyente"],
        ["Dirección del vendedor", [s.address, s.city].filter(Boolean).join(", ") || "-"],
        ["Constancia", T.labelOf(T.CONSTANCIAS, (inv.constancia || {}).tipo) + " Nº " + ((inv.constancia || {}).numero || "-")],
        ["Condición", condText({ condition: "contado" })], ["Moneda", "PYG"], ["Tipo de transacción", "Compra de productos y servicios"]);
      return p;
    }
    if (code === "7") {
      const m = inv.rem || {};
      p.push(["RUC / Documento del destinatario", inv.receiverId || "-"], ["Destinatario", inv.receiverName || "-"], ["Dirección del destinatario", (inv.receiver || {}).address], ["Teléfono", (inv.receiver || {}).phone],
        ["Motivo del traslado", T.labelOf(T.MOTIVOS_REM, m.motivo)], ["Inicio del traslado", T.isoToDmy(m.inicio) || "-"],
        ["Fin estimado", T.isoToDmy(m.fin) || "-"], ["Punto de salida", m.salida || "-"], ["Punto de entrega", m.entrega || "-"],
        ["Modalidad de transporte", T.labelOf(T.MODOS_TRANSPORTE, m.modo)], ["Vehículo", [m.marca, m.chapa ? "chapa " + m.chapa : ""].filter(Boolean).join(" · ") || "-"],
        ["Chofer", [m.chofer, m.choferDoc ? "CI " + m.choferDoc : ""].filter(Boolean).join(" · ") || "-"]);
      if (m.responsable === "tercero") p.push(["Transportista", (m.transportista || "") + " · RUC " + (m.transportistaRuc || "")]);
      if (inv.assoc) p.push(["Factura asociada", inv.assoc.number]);
      return p;
    }
    p.push(["RUC / Documento Nº", inv.receiverId || "Innominado"]);
    if (code === "1") p.push(["Condición de venta", condText(inv)]);
    p.push(["Nombre o razón social", inv.receiverName || "-"], ["Moneda", curText(inv)]);
    if (code === "5" || code === "6") {
      p.push(["Documento asociado", "Factura electrónica Nº " + (inv.assoc ? inv.assoc.number : "-")], ["CDC del documento asociado", inv.assoc && inv.assoc.cdc ? FE.formatCdc(inv.assoc.cdc) : "-"],
        ["Motivo de emisión", inv.motivoLabel || "-"]);
    } else {
      p.push(["Tipo de transacción", "Venta de mercadería"]);
    }
    const rc = inv.receiver || {};
    p.push(["Dirección", rc.address], ["Teléfono", rc.phone], ["Correo", code === "1" ? inv.receiverEmail : ""]);
    return p;
  }
  function kudeHTML(inv) {
    const T2 = inv.totals, fm = n => fmt(n, inv.currency), code = String(inv.deType || "1"), noPrice = code === "7";
    const cdcFmt = inv.cdc ? FE.formatCdc(inv.cdc) : "Pendiente de aprobación";
    const isUSD = inv.currency === "USD", test = company.env === "test";
    const label = inv.typeLabel || "Factura electrónica", title = inv.typeTitle || "FACTURA ELECTRÓNICA";
    const codeOf = it => esc(it.code || "");
    const table = noPrice ? `
        <table>
          <colgroup><col style="width:15%"><col style="width:55%"><col style="width:12%"><col style="width:18%"></colgroup>
          <thead><tr><th>Cod</th><th>Descripción</th><th>Unidad</th><th class="n">Cantidad</th></tr></thead>
          <tbody>${inv.items.map((it, i) => `<tr><td>${codeOf(it, i)}</td><td>${esc(it.desc)}</td><td>UNI</td><td class="n">${FE.fmtQty(it.qty)}</td></tr>`).join("")}</tbody>
        </table>
        <div class="klist">${inv.items.map((it, i) => `<div class="ki"><div class="ki-top"><span class="ki-cod">${codeOf(it, i)}</span><b>${esc(it.desc)}</b></div>
          <div class="ki-row"><span class="lbl">Cantidad</span><b>${FE.fmtQty(it.qty)} UNI</b></div></div>`).join("")}</div>` : `
        <table>
          <colgroup><col class="c-cod"><col class="c-desc"><col class="c-un"><col class="c-qty"><col class="c-pu"><col class="c-dc"><col class="c-ex"><col class="c-5"><col class="c-10"></colgroup>
          <thead><tr><th>Cod</th><th>Descripción</th><th>Unidad</th><th class="n">Cantidad</th><th class="n">Precio</th><th class="n">Desc.</th><th class="n">Exentas</th><th class="n">5%</th><th class="n">10%</th></tr></thead>
          <tbody>
            ${inv.items.map((it, i) => { const c = calcItem(it, inv.currency); return `<tr>
              <td>${codeOf(it, i)}</td><td>${esc(it.desc)}</td><td>UNI</td>
              <td class="n">${FE.fmtQty(it.qty)}</td><td class="n">${fm(it.price)}</td><td class="n">${it.discount ? it.discount + "%" : "0"}</td>
              <td class="n">${it.tax === "E" ? fm(c.total) : "0"}</td><td class="n">${it.tax === "5" ? fm(c.total) : "0"}</td><td class="n">${it.tax === "10" ? fm(c.total) : "0"}</td></tr>`; }).join("")}
            <tr class="tot-row"><td colspan="6">SUBTOTAL</td><td class="n">${fm(T2.exe)}</td><td class="n">${fm(T2.b5)}</td><td class="n">${fm(T2.b10)}</td></tr>
            <tr class="tot-row"><td colspan="8">TOTAL DE LA OPERACIÓN</td><td class="n">${fm(T2.total)}</td></tr>
            ${isUSD ? `<tr class="tot-row"><td colspan="8">TOTAL EN GUARANÍES</td><td class="n">${fmt(T2.totalPyg)}</td></tr>` : ""}
          </tbody>
        </table>
        <div class="klist">
          ${inv.items.map((it, i) => { const c = calcItem(it, inv.currency); return `<div class="ki">
            <div class="ki-top"><span class="ki-cod">${codeOf(it, i)}</span><b>${esc(it.desc)}</b></div>
            <div class="ki-row"><span>${FE.fmtQty(it.qty)} UNI × ${fm(it.price)}</span><span class="lbl">Desc. ${it.discount ? it.discount + "%" : "0"}</span></div>
            <div class="ki-row"><span class="lbl">${it.tax === "E" ? "Exentas" : it.tax === "5" ? "Gravadas 5%" : "Gravadas 10%"}</span><b>${fm(c.total)}</b></div>
          </div>`; }).join("")}
          <div class="kt"><span>Subtotal exentas</span><span>${fm(T2.exe)}</span></div>
          <div class="kt"><span>Subtotal 5%</span><span>${fm(T2.b5)}</span></div>
          <div class="kt"><span>Subtotal 10%</span><span>${fm(T2.b10)}</span></div>
          <div class="kt b"><span>TOTAL DE LA OPERACIÓN</span><span>${fm(T2.total)}</span></div>
          ${isUSD ? `<div class="kt b"><span>TOTAL EN GUARANÍES</span><span>${fmt(T2.totalPyg)}</span></div>` : ""}
        </div>`;
    const nom = FE.emisorNombres(company), em = emisorDe(inv);
    return `
    <div class="kude" id="kudeBody">
      ${test ? `<div class="band">AMBIENTE DE PRUEBA - SIN VALIDEZ TRIBUTARIA</div>
      <div class="band2">DOCUMENTO ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA</div>` : ""}
      <div class="ttl">KuDE de ${esc(label)}</div>
      <div class="box"><div class="hd">
        <div class="hd-em">
          <div class="hd-logo">${company.logo ? `<img class="logo-img" src="${company.logo}" alt="Logo del emisor">` : `<div class="logo">Logo del emisor</div>`}</div>
          <div class="em"><b>${esc(nom.main)}</b>${nom.sub ? `<span class="em-sub">${esc(nom.sub)}</span>` : ""}
            <div class="em-dat">${[em.address, [em.city, company.phone ? "Tel. " + company.phone : ""].filter(Boolean).join(" · "), company.mail, company.activity ? "Actividad: " + company.activity : ""].filter(Boolean).map(esc).join("<br>")}</div></div>
        </div>
        <div>
          <div style="font-weight:700;font-size:12px">RUC: ${esc(company.ruc)}-${esc(company.dv)}</div>
          <div style="margin-top:4px">${timbradoLines(inv).map(esc).join("<br>")}</div>
          <div class="fact" style="margin-top:12px">${esc(title)}</div>
          <div style="font-weight:700;font-size:11px">${esc(inv.number)}</div>
        </div>
      </div></div>
      <div class="box"><div class="grid">${docInfoPairs(inv).map(([k, v]) => `<div><span>${esc(k)}</span><br>${esc(v)}</div>`).join("")}</div></div>
      <div class="box" style="padding:0"><div class="tblwrap">${table}</div>
        ${noPrice ? "" : `<div class="liq" style="padding:6px 8px 8px;"><span>LIQUIDACIÓN IVA</span><span>(5%) ${fm(T2.iva5)}</span><span>(10%) ${fm(T2.iva10)}</span><span>TOTAL IVA ${fm(T2.iva)}</span></div>`}
        ${code === "4" ? `<div class="legal" style="padding:0 8px 8px">La autofactura no respalda crédito fiscal en el IVA.</div>` : ""}
      </div>
      <div class="box"><div class="foot">
        ${qrImg(inv) ? `<div class="qr has"><img src="${qrImg(inv)}" alt="QR de consulta"></div>` : `<div class="qr">QR al aprobarse</div>`}
        <div>
          <div style="font-size:10px">Consulte la validez de este documento electrónico con el número de CDC en:</div>
          <a class="link" href="#" onclick="return false">${esc(consultUrl())}</a>
          <div class="cdc">CDC: ${esc(cdcFmt)}</div>
          <div class="legal">ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML)</div>
          <div class="legal"><b>Información de interés del facturador electrónico emisor.</b><br>Si su documento electrónico presenta algún error, podrá solicitar la modificación dentro de las 72 horas siguientes a la emisión de este comprobante.</div>
        </div>
      </div></div>
      ${prefs.footerText ? `<div class="legal" style="white-space:pre-line;margin:2px 0 6px">${esc(prefs.footerText)}</div>` : ""}
    </div>`;
  }

  // Datos del timbrado para el KuDE (los de la factura; las facturas viejas usan los de la empresa)
  function timbradoOf(inv) {
    if (inv && inv.timbrado) return inv.timbrado;
    return { number: company.timbrado, start: dmyToIso(company.start), end: dmyToIso(company.end) };
  }
  function timbradoLines(inv) {
    const t = timbradoOf(inv);
    const out = ["Timbrado Nº: " + t.number, "Inicio de vigencia: " + isoToDmy(t.start)];
    if (t.end) out.push("Fin de vigencia: " + isoToDmy(t.end));
    return out;
  }
  // Arma el documento a partir del borrador (factura, notas, autofactura o remisión)
  function buildDoc(d) {
    const ty = T.deType(d.deType), now = new Date(), tim = activeTimbrado();
    const base = { deType: ty.code, typeLabel: ty.label, typeTitle: ty.title, number: nextNumberStr(ty.code),
      timbrado: { id: tim.id, number: tim.number, start: tim.start, end: tim.end }, issuedAt: FE.localIso(now),
      dateLabel: now.toLocaleDateString("es-PY") + " " + now.toTimeString().slice(0, 8), pedidoId: d.pedidoId || null, servicio: d.servicio || null };
    const pk = curPunto(), pinfo = T.puntoInfo(company, pk);
    if (pinfo) Object.assign(base, { punto: { key: pk, nombre: pinfo.nombre }, establecimiento: { code: pinfo.est, address: pinfo.address || company.address, city: pinfo.city || company.city } });
    const totalsOf = (t, cur, ex) => ({ exe: t.exe, b5: t.b5, b10: t.b10, iva5: t.iva5, iva10: t.iva10, iva: t.iva, total: t.total, totalPyg: FE.pygTotal(t.total, cur, ex) || 0 });
    const items = d.items.map(i => Object.assign({}, i));
    if (ty.assoc) {
      const src = invoices.find(x => x.id === d.assoc.id), k = src.kude, t = calcItems(items, k.currency);
      const motivos = ty.key === "nc" ? T.MOTIVOS_NC : T.MOTIVOS_ND;
      return Object.assign(base, { receiver: k.receiver, receiverId: k.receiverId, receiverName: k.receiverName, receiverEmail: k.receiverEmail, receiverMode: k.receiverMode,
        items, currency: k.currency, exchange: k.exchange, operation: k.operation, operationLabel: k.operationLabel,
        assoc: { id: src.id, number: src.number, cdc: src.cdc, date: src.date }, motivo: d.motivo, motivoLabel: T.labelOf(motivos, d.motivo),
        totals: totalsOf(t, k.currency, k.exchange), cdc: "" });
    }
    if (ty.key === "autofactura") {
      const its = items.map(i => Object.assign(i, { tax: "E" })), t = calcItems(its, "PYG");
      return Object.assign(base, { receiver: { mode: "con", ruc: company.ruc + "-" + company.dv, name: company.name }, receiverId: company.ruc + "-" + company.dv,
        receiverName: company.name, receiverMode: "con", seller: Object.assign({}, d.seller), constancia: Object.assign({}, d.constancia),
        items: its, currency: "PYG", exchange: "", condition: "contado", operation: "", totals: totalsOf(t, "PYG", ""), cdc: "" });
    }
    if (ty.key === "remision") {
      const r = classify(d, 0), receiver = FE.receiverFromDraft(d, r);
      return Object.assign(base, { receiver, receiverId: FE.receiverIdText(receiver), receiverName: receiver.name || (d.mode === "con" ? "" : "Consumidor final"),
        receiverEmail: d.email, receiverMode: d.mode, items: items.map(i => Object.assign(i, { price: 0, tax: "E", discount: 0 })), currency: "PYG", exchange: "",
        rem: Object.assign({}, d.rem, { chapa: String(d.rem.chapa || "").toUpperCase().replace(/\s+/g, " ").trim() }), assoc: d.assoc ? { id: d.assoc.id, number: d.assoc.number, cdc: d.assoc.cdc } : null,
        operation: r.operation, totals: totalsOf(calcItems([], "PYG"), "PYG", ""), cdc: "" });
    }
    const t = calcItems(items, d.currency), r = classify(d, pygOf(d, t)), receiver = FE.receiverFromDraft(d, r);
    return Object.assign(base, { receiver, receiverId: FE.receiverIdText(receiver), receiverName: receiver.name || (d.mode === "con" ? "" : "Consumidor final"),
      receiverEmail: d.email, receiverMode: d.mode, items, currency: d.currency, exchange: d.exchange, condition: d.condition, installments: d.installments,
      operation: r.operation, operationLabel: opName[r.operation] || "", totals: totalsOf(t, d.currency, d.exchange), cdc: "" });
  }

  const shortOf = doc => T.deType(doc && doc.deType).short;
  function screenPreview() {
    const inv = state.preview;
    if (!inv) return screenNew();
    const short = shortOf(inv).toLowerCase();
    return `
      <button class="link" data-back="new">← Editar</button>
      <h2>Vista previa</h2>
      <p class="lead">Revisá los datos. Una vez aprobada, la ${esc(short)} no se puede cambiar: solo cancelarla${inv.deType === "1" ? " o emitir una nota de crédito" : ""}.</p>
      ${kudeHTML(inv)}
      <div style="margin-top:14px" class="btn-row">
        <label class="btn soft" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Cargar logo<input type="file" id="logoFile" accept="image/*" hidden></label>
        <button class="btn" data-pdf="1">Descargar PDF</button>
      </div>
      <button class="link ${mod("ticket") ? "" : "hidden"}" data-pdfalt="1" style="display:block;margin:4px auto 0">Descargar en formato ${prefs.printFormat === "ticket" ? "A4" : "ticket"}</button>
      <button class="btn primary" data-emit="1" style="margin-top:10px">Emitir ${esc(short)}</button>
      <div class="muted small" style="margin-top:10px;text-align:center">${company.env === "test" ? "Se usa el ambiente de prueba. " : ""}La aprobación de SIFEN es simulada.</div>`;
  }

  // Comprobante: como el final de una transferencia
  function screenResult() {
    const r = state.lastResult;
    if (!r) return screenHome();
    const ok = r.status === "ok", ty = T.deType(r.deType), isRem = ty.key === "remision";
    const rows = [["Para", r.client], [ty.short, r.number], ["Fecha", fmtDate(r.date)]];
    if (r.assocNumber) rows.push(["Factura asociada", r.assocNumber]);
    if (r.emailedTo) rows.push(["Enviada a", r.emailedTo + " (simulado)"]);
    if (r.pedidoId) rows.push(["Pedido", r.pedidoId + (ok && ty.code === "1" ? " · facturado" : "")]);
    return `
      <div class="receipt ${ok ? "" : "fail"}">
        <div class="receipt-ico">${ok ? "✓" : "!"}</div>
        <div class="receipt-title">${ok ? "¡Listo!" : "No se pudo emitir"}</div>
        <div class="receipt-sub">${ok ? esc(ty.short) + " emitida y aprobada" : "SIFEN la rechazó"}</div>
        ${isRem ? "" : `<div class="receipt-amount">${r.currency === "USD" ? esc(FE.money(r.totalOp, "USD")) : "Gs " + fmt(r.total)}</div>
          ${r.kude ? ivaLine(ty.code, r.kude.totals, r.currency, "receipt-iva") : ""}
          ${r.currency === "USD" ? `<div class="receipt-amount-sub">Gs ${fmt(r.total)}</div>` : ""}`}
        <div class="receipt-card">
          ${rows.map(([k, v]) => `<div class="kv"><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}
          ${ok ? `<div class="kv" style="display:block"><span class="muted">CDC</span><div class="small cdc-text" style="margin-top:4px">${esc(FE.formatCdc(r.cdc))}</div></div>`
            : `<div class="notice bad" style="margin:8px 0 0"><b>Motivo</b>${esc(r.reason)}</div>`}
        </div>
      </div>
      ${ok ? `<div class="btn-row" style="margin-top:16px">
          <button class="btn primary" data-respdf="${r.id}">Compartir PDF</button>
          <button class="btn soft" data-open="${r.id}">Ver documento</button>
        </div>` : `<button class="btn primary" data-retry style="margin-top:16px">Revisar y volver a intentar</button>`}
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" data-go="home">Ir al inicio</button>
        <button class="btn soft" data-go="new">Nuevo documento</button>
      </div>`;
  }

  function screenHistory() {
    const byType = misDocs().filter(i => !state.typeFilter || String(i.deType || "1") === state.typeFilter);
    const list = byType.filter(i => (state.filter === "all" || i.status === state.filter) && FE.matches(state.q, i.client, i.number, i.ruc, i.pedidoId, shortOf(i)));
    const count = k => k === "all" ? byType.length : byType.filter(i => i.status === k).length;
    const seg = (k, label) => `<button data-filter="${k}" class="${state.filter === k ? "on" : ""}">${label} · ${count(k)}</button>`;
    const present = T.DE_TYPES.filter(ty => misDocs().some(i => String(i.deType || "1") === ty.code));
    return `
      <h2>${can("documentos.todos") ? "Documentos" : "Mis documentos"}</h2>
      ${present.length > 1 || state.typeFilter ? `<select id="hType" class="inline" style="margin-bottom:10px" aria-label="Tipo de documento"><option value="">Todos los documentos</option>
        ${present.map(ty => `<option value="${ty.code}" ${state.typeFilter === ty.code ? "selected" : ""}>${esc(ty.short)}</option>`).join("")}</select>` : ""}
      <div class="seg four">${seg("all", "Todos")}${seg("ok", "Aprobados")}${seg("warn", "Pendientes de envío")}${seg("bad", "Rechazados")}</div>
      ${FE.searchBox(state.q, "Buscar por cliente, número o RUC")}
      <div class="card" style="margin-top:12px">
        ${list.length ? list.map(rowInvoice).join("") : `<div class="muted small">${state.q ? "Ningún documento coincide con la búsqueda." : "Sin documentos en este filtro."}</div>`}
      </div>`;
  }

  // Plazo de cancelación según el tipo (48 h; la remisión, 168 h)
  const cancelMs = i => T.deType(i.deType).cancelH * 3600 * 1000;
  const canCancel = i => i.status === "ok" && !i.cancelled && Date.now() - Date.parse(i.date) < cancelMs(i);
  const isInnominada = i => isType(i, "1") && i.kude && i.kude.receiver && i.kude.receiver.mode === "sin" && !String(i.kude.receiver.doc || "").trim();
  function screenDetail() {
    const i = misDocs().find(x => x.id === state.detailId);
    if (!i) return screenHistory();
    const ty = T.deType(i.deType), isFac = ty.code === "1", ok = i.status === "ok" && !i.cancelled, k = i.kude || {};
    const related = isFac ? invoices.filter(n => n.assocId === i.id) : [];
    const assoc = i.assocId ? invoices.find(x => x.id === i.assocId) : null;
    const hours = ty.cancelH;
    const action = (code, label) => { const st = docState(code); return `<button class="btn soft" data-mkdoc="${code}" ${st.ok ? "" : "disabled"} title="${esc(st.why)}">${label}</button>`; };
    const off = isFac && ok ? ["5", "6", "7"].filter(c => !docState(c).ok && docState(c).state !== "hidden") : [];
    return `
      <button class="link" data-back="history">← Documentos</button>
      <h2>${esc(ty.short)} ${esc(i.number)}</h2>
      <div style="margin-bottom:14px">${statusChip(i.status)} ${i.cancelled ? '<span class="chip neutral">Cancelada</span>' : ""}</div>
      <div class="card">
        <div class="kv"><span class="muted">${ty.key === "autofactura" ? "Vendedor" : ty.key === "remision" ? "Destinatario" : "Cliente"}</span><span>${esc(ty.key === "autofactura" ? (k.seller || {}).name || i.client : i.client)}</span></div>
        ${ty.key === "autofactura" ? "" : `<div class="kv"><span class="muted">RUC / documento</span><span>${esc(i.ruc || "Sin identificar")}</span></div>`}
        <div class="kv"><span class="muted">Fecha</span><span>${fmtDate(i.date)}</span></div>
        ${assoc ? `<div class="kv"><span class="muted">Factura asociada</span><span><button class="link" data-open="${assoc.id}" style="min-height:0;padding:0">${esc(assoc.number)}</button></span></div>` : ""}
        ${k.motivoLabel ? `<div class="kv"><span class="muted">Motivo</span><span>${esc(k.motivoLabel)}</span></div>` : ""}
        ${ty.key === "remision" && k.rem ? `<div class="kv"><span class="muted">Traslado</span><span>${esc(T.labelOf(T.MOTIVOS_REM, k.rem.motivo))} · ${esc(k.rem.entrega)}</span></div>` : ""}
        ${i.pedidoId ? `<div class="kv"><span class="muted">Pedido</span><span><button class="link" data-openped="${esc(i.pedidoId)}" style="min-height:0;padding:0">${esc(i.pedidoId)}</button></span></div>` : ""}
        ${i.nominacion ? `<div class="kv"><span class="muted">Nominada</span><span>${esc(i.nominacion.name)} · ${esc((FE.DOC_SHORT[i.nominacion.docType] || "") + " " + i.nominacion.doc)} · ${fmtDate(i.nominacion.at)}</span></div>` : ""}
        ${ty.key === "remision" ? "" : `${i.currency === "USD" ? `<div class="kv"><span class="muted">Total en dólares</span><span class="amount">${FE.money(i.totalOp, "USD")}</span></div>` : ""}
          <div class="kv"><span class="muted">Total${i.currency === "USD" ? " en guaraníes" : ""}</span><span class="amount">Gs ${fmt(i.total)}</span></div>`}
        ${isFac && related.some(n => isType(n, "5") && n.status === "ok") ? `<div class="kv"><span class="muted">Saldo después de notas de crédito</span><span class="amount">${FE.money(saldoOf(i), i.currency)}</span></div>` : ""}
        ${i.cdc ? `<div style="padding:12px 0;border-top:1px solid var(--border)"><div class="muted small">CDC</div><div class="small cdc-text" style="margin-top:4px">${esc(FE.formatCdc(i.cdc))}</div></div>` : ""}
        ${i.reason ? `<div style="padding:12px 0;border-top:1px solid var(--border)"><div class="muted small">Motivo</div><div style="margin-top:4px;color:var(--bad)">${esc(i.reason)}</div></div>` : ""}
      </div>
      ${related.length ? `<div class="section"><div class="section-title">Documentos asociados</div><div class="card">${related.map(rowInvoice).join("")}</div></div>` : ""}
      ${isFac && ok && (esAdm() || docState("7").ok) ? `<div class="section"><div class="section-title">Emitir a partir de esta factura</div>
        <div class="btn-row ${docState("7").state === "hidden" || !esAdm() ? "" : "three"}">${esAdm() ? action("5", "Nota de crédito") + action("6", "Nota de débito") : ""}${docState("7").state === "hidden" ? "" : action("7", "Remisión")}</div>
        ${off.length ? `<div class="muted small" style="margin-top:6px">${off.map(c => esc(T.deType(c).short) + ": " + esc(docState(c).why)).join("<br>")}</div>` : ""}</div>` : ""}
      ${isInnominada(i) && ok && !i.nominacion && esAdm() ? `<button class="btn soft" data-nominar="${i.id}" style="margin-top:12px">Identificar al comprador</button>
        <div class="muted small" style="margin-top:6px">Se emitió sin identificar al comprador. Este dato se puede agregar una sola vez.</div>` : ""}
      ${i.kude ? `<div class="section"><div class="section-title">Documento</div>${kudeHTML(i.kude)}</div>` : ""}
      <div class="btn-row" style="margin-top:16px">
        <button class="btn soft" ${i.kude ? `data-pdf="${esc(i.number)}"` : `data-share="pdf"`} ${i.status === "ok" ? "" : "disabled"}>Descargar PDF${i.kude ? (prefs.printFormat === "ticket" ? " (ticket)" : " (A4)") : ""}</button>
        <button class="btn soft" data-share="mail" ${i.status === "ok" ? "" : "disabled"}>Enviar por correo</button>
      </div>
      ${esAdm() ? `<div class="btn-row" style="margin-top:10px">
        <button class="btn" data-cancel="${i.id}" ${canCancel(i) ? "" : "disabled"}>Cancelar ${esc(ty.short.toLowerCase())}</button>
        ${isFac && ok && !canCancel(i) && docState("5").ok ? `<button class="btn primary" data-mkdoc="5">Emitir nota de crédito</button>` : `<button class="btn primary" data-go="new">Emitir otro</button>`}
      </div>` : `<button class="btn primary" data-go="new" style="margin-top:10px">Emitir otro</button>`}
      ${i.kude && i.status === "ok" ? `<button class="link ${mod("ticket") ? "" : "hidden"}" data-pdfalt="1" style="display:block;margin:4px auto 0">Descargar en formato ${prefs.printFormat === "ticket" ? "A4" : "ticket"}</button>` : ""}
      ${i.kude && user && user.role === "maestro" && window.DEXml ? `<button class="link" data-xml="${esc(i.id)}" style="display:block;margin:4px auto 0">Descargar XML (sin firma)</button>
        <div class="muted small" style="text-align:center">Vista previa para verificar los datos. No es válido para SIFEN: la firma la agrega el servidor.</div>` : ""}
      ${i.emailedTo ? `<div class="muted small" style="margin-top:8px">Enviada por correo a ${esc(i.emailedTo)}.</div>` : ""}
      <div class="muted small" style="margin-top:12px">${!esAdm() ? (i.cancelled ? "Cancelado." : "Para cancelar o corregir este documento, contacte al administrador de la empresa.")
        : i.cancelled ? "Cancelado." : i.status === "ok"
        ? (canCancel(i) ? "Cancelación disponible hasta el " + fmtDate(new Date(Date.parse(i.date) + cancelMs(i)).toISOString()) + " (" + hours + " horas desde la aprobación)."
          : "Venció el plazo de " + hours + " horas para cancelar." + (isFac ? " La corrección se hace con una nota de crédito." : ""))
        : "La cancelación está disponible hasta " + hours + " horas después de la aprobación."}</div>`;
  }

  // ----- Pedidos recibidos -----
  function screenPedidos() {
    const sellers = [...new Set(inbox.map(p => p.seller).filter(Boolean))].sort();
    const bySeller = inbox.filter(p => !state.pedSeller || p.seller === state.pedSeller);
    const list = bySeller.filter(p => (state.pedFilter === "all" || p.status === state.pedFilter) && FE.matches(state.q, pedClient(p), p.id, p.seller, p.client.ruc, p.client.doc))
      .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    const count = k => k === "all" ? bySeller.length : bySeller.filter(p => p.status === k).length;
    const seg = (k, l) => `<button data-pedfilter="${k}" class="${state.pedFilter === k ? "on" : ""}">${l} · ${count(k)}</button>`;
    return `
      <h2>Notas de pedido</h2>
      <p class="lead">Leé el QR que te mandó el vendedor. La nota de pedido se carga entera y queda pendiente de facturar.</p>
      <button class="btn primary" data-scan>Escanear QR con la cámara</button>
      <div class="btn-row" style="margin-top:10px">
        <label class="btn soft" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Elegir imagen<input type="file" id="qrFile" accept="image/*" hidden></label>
        <button class="btn soft" data-paste>Pegar código</button>
      </div>
      <div class="section">
        <div class="seg four">${seg("pendiente", "Pendientes")}${seg("facturado", "Facturados")}${seg("rechazado", "Rechazados")}${seg("all", "Todos")}</div>
        ${inbox.length > 3 || state.q ? FE.searchBox(state.q, "Buscar por cliente, vendedor o número") : ""}
        ${sellers.length > 1 ? `<label for="pSeller">Vendedor</label><select id="pSeller" class="inline"><option value="">Todos los vendedores</option>
          ${sellers.map(s => `<option value="${esc(s)}" ${state.pedSeller === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
        <div class="card" style="margin-top:12px">
          ${list.length ? list.map(p => `<div class="row" data-openped="${esc(p.id)}" role="button" tabindex="0">
            <div class="main"><div class="title">${esc(pedClient(p))}</div><div class="sub">${esc(p.id)} · ${esc(p.seller)} · ${fmtDate(p.updatedAt || p.createdAt)}</div></div>
            <div style="text-align:right"><div class="amount">${FE.money(calcItems(p.items, p.currency).total, p.currency)}</div><div style="margin-top:4px">${pedChip(p.status)}</div></div>
          </div>`).join("") : `<div class="muted small">No hay notas de pedido en este filtro.</div>`}
        </div>
      </div>`;
  }

  function screenPedido() {
    const p = inbox.find(x => x.id === state.pedidoId);
    if (!p) return screenPedidos();
    const t = calcItems(p.items, p.currency), r = classify(p.client, pygOf(p, t));
    return `
      <button class="link" data-go="pedidos">← Pedidos</button>
      <h2>Nota de pedido ${esc(p.id)}</h2>
      <div style="margin-bottom:12px">${pedChip(p.status)} ${p.rev > 1 ? `<span class="chip neutral">Versión ${p.rev}</span>` : ""}</div>
      ${p.status === "rechazado" ? `<div class="notice bad" style="margin-top:0"><b>Motivo del rechazo</b>${esc(p.reason)}</div>` : ""}
      ${p.status === "facturado" ? `<div class="notice ok" style="margin-top:0"><b>Facturado</b>Factura ${esc(p.invoiceNumber)} · ${fmtDate(p.invoicedAt)}</div>` : ""}
      ${!r.valid ? `<div class="notice warn"><b>Revisá el cliente</b>${esc(r.why)}</div>` : ""}
      <div class="card">
        <div class="kv"><span class="muted">Cliente</span><span>${esc(pedClient(p))}</span></div>
        <div class="kv"><span class="muted">${FE.receiverIdLabel(p.client)}</span><span>${esc(FE.receiverIdText(p.client))}</span></div>
        ${p.client.email ? `<div class="kv"><span class="muted">Correo</span><span>${esc(p.client.email)}</span></div>` : ""}
        ${p.client.address ? `<div class="kv"><span class="muted">Dirección</span><span>${esc(p.client.address)}</span></div>` : ""}
        ${p.client.phone ? `<div class="kv"><span class="muted">Teléfono</span><span>${esc(p.client.phone)}</span></div>` : ""}
        <div class="kv"><span class="muted">Condición</span><span>${p.condition === "credito" ? "Crédito" + (p.installments > 1 ? " · " + p.installments + " cuotas" : "") : "Contado"}</span></div>
        <div class="kv"><span class="muted">Vendedor</span><span>${esc(p.seller)}</span></div>
        <div class="kv"><span class="muted">Cargado</span><span>${fmtDate(p.createdAt)}</span></div>
        <div class="kv"><span class="muted">Recibido</span><span>${fmtDate(p.receivedAt)}</span></div>
        ${p.note ? `<div class="kv"><span class="muted">Nota</span><span>${esc(p.note)}</span></div>` : ""}
      </div>
      <button class="btn soft" data-pedpdf="${esc(p.id)}" style="margin-top:10px">Descargar PDF de la nota</button>
      <div class="section"><div class="section-title">Productos</div>
        <div class="card">
          ${p.items.map(it => `<div class="kv"><span>${esc(it.desc)}<br><span class="small muted">${FE.fmtQty(it.qty)} × ${fmt(it.price, p.currency)}${it.discount ? " − " + it.discount + "%" : ""} · ${taxLabel(it.tax)}</span></span><span class="amount">${fmt(calcItem(it, p.currency).total, p.currency)}</span></div>`).join("")}
          <div class="kv"><span><b>Total</b></span><span class="amount">${FE.money(t.total, p.currency)}</span></div>
        </div></div>
      ${p.status === "pendiente" ? `
        <div class="btn-row" style="margin-top:16px">
          <button class="btn" data-rejectped="${esc(p.id)}" style="color:var(--bad)">Rechazar</button>
          <button class="btn primary" data-invoiceped="${esc(p.id)}">Facturar</button>
        </div>
        ${docState("7").state === "hidden" ? "" : `<button class="btn soft" data-remped="${esc(p.id)}" style="margin-top:10px" ${docState("7").ok ? "" : "disabled"}>Emitir nota de remisión${p.remisionNumber ? " (ya emitida: " + esc(p.remisionNumber) + ")" : ""}</button>
        ${docState("7").ok ? "" : `<div class="muted small" style="margin-top:4px">Nota de remisión: ${esc(docState("7").why)}</div>`}`}` : ""}
      ${p.status === "rechazado" ? `
        <div class="btn-row" style="margin-top:16px">
          <button class="btn" data-delped="${esc(p.id)}" style="color:var(--bad)">Eliminar</button>
          <button class="btn soft" data-reopenped="${esc(p.id)}">Volver a pendiente</button>
        </div>` : ""}
      ${p.status === "facturado" && p.invoiceId ? `<button class="btn soft" data-open="${p.invoiceId}" style="margin-top:16px">Ver factura</button>` : ""}`;
  }

  function screenSettings() {
    const cs = T.certStatus(company.cert), editCfg = can("cliente.config");
    const empUsers = T.usersFor(company.id).filter(u => !T.ROLES[u.role].estudio);
    const section = (title, body) => `<div class="section"><div class="section-title">${title}</div>${body}</div>`;
    const bol = verBoletas() ? T.boletaNueva(company.id) : null, bols = verBoletas() ? T.boletasDe(company.id) : [];
    return `
      <h2>${esAdm() ? "Gestión" : "Ajustes"}</h2>
      ${T.profileCardHTML(perfilInfo())}
      ${bol ? `<div class="boleta-alert" role="status">
          <div class="ba-t">Se generó tu boleta de pago</div>
          <div class="ba-m">${esc(T.periodLabel(bol.period))} · <b>${esc(FE.money(bol.monto, "PYG"))}</b>${bol.vence ? " · vence el " + esc(T.isoToDmy(bol.vence)) : ""}</div>
          <div class="btn-row" style="margin-top:10px"><button class="btn primary" data-boleta="${esc(bol.id)}">Ver detalle</button><button class="btn" data-boletaok="${esc(bol.id)}">Entendido</button></div>
        </div>` : ""}
      ${esAdm() && bols.length ? section("Cuenta del servicio", `<div class="card">${bols.slice(0, 6).map(b => `<div class="row" data-boleta="${esc(b.id)}" role="button" tabindex="0"><div class="main">
          <div class="title">${esc(T.periodLabel(b.period))}${b.vista ? "" : ' <span class="tag bad">Nueva</span>'}</div><div class="sub">Factura ${esc(b.numero || "")}${b.vence ? " · vence el " + esc(T.isoToDmy(b.vence)) : ""}</div></div>
          <div class="amt">${esc(FE.money(b.monto, "PYG"))}</div></div>`).join("")}</div>`) : ""}
      ${esAdm() && !bols.length ? section("Cuenta del servicio", `<div class="card"><div class="kv"><span class="muted">Estado</span><span>${esc(billing.text)}</span></div></div>`) : ""}
      ${esAdm() ? "" : section("Caja en uso", `<div class="card">
          <div class="kv"><span class="muted">Caja</span><span>${curPunto() ? esc(T.puntoLabel(company, curPunto())) : "Sin caja habilitada"}${myPuntos().length > 1 ? ` <button class="link" data-pickpunto style="min-height:0;padding:0;margin-left:6px">Cambiar</button>` : ""}</span></div>
          ${activeTimbrado() ? `<div class="kv"><span class="muted">Timbrado activo</span><span>${esc(activeTimbrado().number)}</span></div>` : ""}
          <div class="kv"><span class="muted">Próxima factura</span><span>${esc(nextNumberStr())}</span></div></div>`)}
      ${can("usuarios.empresa") && mod("usuarios") ? section("Equipo", `<div class="card">
          ${empUsers.length ? empUsers.map(u => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(u.name)}${u.active === false ? " (inactivo)" : ""}</div>
            <div class="sub">${esc(T.ROLES[u.role].label)}</div></div><button class="link" data-useredit="${esc(u.id)}">Editar</button></div>`).join("")
            : `<div class="muted small">Sin usuarios. Con usuarios cargados, cada persona ingresa con su propio PIN y ve solo lo que le corresponde.</div>`}
          <button class="add" data-useradd>+ Agregar persona</button>
        </div>`) : ""}
      ${!can("timbrados.editar") ? "" : section("Cajas y establecimientos", `<div class="card">${T.estPtoHTML(company, estCtx())}</div>`)}
      ${!esAdm() ? "" : section("Timbrados e inutilización", `<div class="card">${T.timbradoListHTML(timbrados, { editable: can("timbrados.editar"), emp: company })}<div class="section-title" style="margin-top:16px">Números inutilizados</div>${T.inutilListHTML(company, { edit: can("timbrados.editar") })}</div>`)}
      ${!esAdm() || !mod("productos") ? "" : section("Productos frecuentes", `<div class="card">
          ${products.length ? products.map(p => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(p.desc)}</div>
            <div class="sub">${p.code ? esc(p.code) + " · " : ""}Gs ${fmt(p.price)} · ${taxLabel(p.tax)}</div></div>
            ${editCfg ? `<span style="display:flex;gap:12px"><button class="link" data-prodedit="${esc(p.id)}">Editar</button><button class="link" data-proddel="${esc(p.id)}" style="color:var(--bad)">Quitar</button></span>` : ""}</div>`).join("")
            : `<div class="muted small">Cargá los productos que más vendés: al facturar los elegís de una lista.</div>`}
          ${editCfg ? `<button class="add" data-prodadd>+ Agregar producto</button>` : ""}
          ${products.length && mod("pedidos") ? `<button class="btn soft" data-catshare style="margin-top:10px">Compartir catálogo con la app Pedidos</button>` : ""}
        </div>`)}
      ${!esAdm() ? "" : section("Clientes frecuentes", `<div class="card">
          ${clients.length ? clients.slice(0, 50).map(c => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(c.name || "Sin nombre")}</div>
            <div class="sub">${c.mode === "con" ? "RUC " : ""}${esc(FE.receiverIdText(c))}</div></div>
            <button class="link" data-delclient="${esc(c.id)}" style="color:var(--bad)">Quitar</button></div>`).join("")
            : `<div class="muted small">Se guardan solos al emitir facturas aprobadas.</div>`}
        </div>`)}
      ${editCfg ? section("Preferencias del documento", `<div class="card">
          <label style="margin-top:0">Condición de venta por defecto</label>
          <div class="seg"><button data-prefcond="contado" class="${prefs.condition === "contado" ? "on" : ""}">Contado</button><button data-prefcond="credito" class="${prefs.condition === "credito" ? "on" : ""}">Crédito</button></div>
          <div class="grid2">
            <div><label for="prCur">Moneda por defecto</label><select id="prCur"><option value="PYG" ${prefs.currency === "PYG" ? "selected" : ""}>Guaraníes</option><option value="USD" ${prefs.currency === "USD" ? "selected" : ""}>Dólares</option></select></div>
            <div><label for="prExch">Tipo de cambio de hoy</label><input id="prExch" inputmode="numeric" placeholder="Ej. 7.800" value="${prefs.exchangeDate === FE.todayKey() ? esc(prefs.exchange) : ""}"></div>
          </div>
          <label for="prFooter">Texto fijo al pie del documento (cuentas, condiciones…)</label>
          <textarea id="prFooter" placeholder="Ej. Transferencias: Banco Ejemplo, cuenta 123456">${esc(prefs.footerText)}</textarea>
          ${mod("ticket") ? `<label>Formato de impresión</label>
          <div class="seg"><button data-prefformat="a4" class="${prefs.printFormat === "a4" ? "on" : ""}">Hoja A4</button><button data-prefformat="ticket" class="${prefs.printFormat === "ticket" ? "on" : ""}">Ticket 80 mm</button></div>` : ""}
          ${mod("correo") ? `${T.checkbox("prAutoEmail", prefs.autoEmail, "Enviar la factura por correo al cliente al aprobarse")}
          <div class="muted small" style="margin-top:4px">El envío real del correo lo hará el servidor; por ahora se simula.</div>` : ""}
          ${mod("remision") ? `<div class="section-title" style="margin-top:18px">Nota de remisión</div>
          <label for="prRemSalida" style="margin-top:0">Punto de salida por defecto</label><input id="prRemSalida" data-kb="address" value="${esc(prefs.remSalida)}" placeholder="${esc([company.address, company.city].filter(Boolean).join(", "))}">
          <label for="prRemModo">Modalidad de transporte</label><select id="prRemModo">${T.MODOS_TRANSPORTE.map(([c, l]) => `<option value="${c}" ${prefs.remModo === c ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          <div class="grid2"><div><label for="prRemMarca">Marca del vehículo</label><input id="prRemMarca" data-kb="name" value="${esc(prefs.remMarca)}"></div>
            <div><label for="prRemChapa">Chapa</label><input id="prRemChapa" data-kb="code" value="${esc(prefs.remChapa)}"></div></div>
          <div class="grid2"><div><label for="prRemChofer">Chofer</label><input id="prRemChofer" data-kb="name" value="${esc(prefs.remChofer)}"></div>
            <div><label for="prRemChoferDoc">Cédula del chofer</label><input id="prRemChoferDoc" data-kb="digits" value="${esc(prefs.remChoferDoc)}"></div></div>` : ""}
          ${mod("autofactura") ? `<div class="section-title" style="margin-top:18px">Autofactura</div>
          <label for="prAfConst" style="margin-top:0">Tipo de constancia más usado</label><select id="prAfConst">${T.CONSTANCIAS.map(([c, l]) => `<option value="${c}" ${prefs.afConstancia === c ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>` : ""}
          <button class="btn soft" data-saveprefs style="margin-top:12px">Guardar preferencias</button>
        </div>`) : ""}
      ${!can("actividad.empresa") ? "" : section("Actividad", `<div class="card">${actividadHTML()}</div>`)}
      ${!esAdm() ? "" : section("Empresa y caja en uso", `<div class="card">
          <div class="kv"><span class="muted">Razón social</span><span>${esc(company.name)}</span></div>
          <div class="kv"><span class="muted">RUC</span><span>${esc(company.ruc)}-${esc(company.dv)}</span></div>
          <div class="kv"><span class="muted">Caja en uso</span><span>${curPunto() ? esc(T.puntoLabel(company, curPunto())) : "Sin caja habilitada"}${myPuntos().length > 1 ? ` <button class="link" data-pickpunto style="min-height:0;padding:0;margin-left:6px">Cambiar</button>` : ""}</span></div>
          ${curPunto() ? `<div class="kv"><span class="muted">Dirección del establecimiento</span><span>${esc([(T.puntoInfo(company, curPunto()) || {}).address, (T.puntoInfo(company, curPunto()) || {}).city].filter(Boolean).join(", ") || "-")}</span></div>` : ""}
          <div class="kv"><span class="muted">Próxima factura</span><span>${esc(nextNumberStr())}</span></div>
          <div class="kv"><span class="muted">Logo</span><span style="display:flex;gap:10px;align-items:center">${company.logo ? `<img src="${company.logo}" alt="" style="height:28px;max-width:90px;object-fit:contain">` : `<span class="small muted">Sin logo</span>`}
            ${editCfg ? `<label class="link" style="cursor:pointer">Cargar<input type="file" id="logoFile" accept="image/*" hidden></label>${company.logo ? `<button class="link" data-remove-logo="1">Quitar</button>` : ""}` : ""}</span></div>
          <div class="muted small" style="margin-top:6px">Los datos de la empresa los registra el estudio, tal como figuran en el RUC.</div>
        </div>`)}
      ${!T.tecnico(user) ? "" : section("Certificado y ambiente", `<div class="card">
          <div class="kv"><span class="muted">Certificado</span><span>${esc(cs.text)}</span></div>
          ${company.cert ? `<div class="kv"><span class="muted">Prestador</span><span>${esc(company.cert.prestador || "-")}</span></div>` : ""}
          <div class="kv"><span class="muted">Código de seguridad</span><span>ID ${esc(company.csc)}</span></div>
          <div class="kv"><span class="muted">Ambiente</span><span>${company.env === "prod" ? "Producción" : "Prueba"}</span></div>
          ${can("empresa.ambiente") ? `<div class="seg" style="margin-top:8px"><button data-env="test" class="${company.env === "test" ? "on" : ""}">Prueba</button><button data-env="prod" class="${company.env === "prod" ? "on" : ""}">Producción</button></div>` : ""}
        </div>`)}
      ${!can("cliente.config") ? "" : section("Copia de seguridad", `<div class="card">
          <p class="small muted" style="margin-top:0">Facturas, pedidos, clientes, productos y timbrados de esta empresa se guardan en este dispositivo.</p>
          <div class="btn-row">
            <button class="btn soft" data-backup>Descargar copia</button>
            <label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Restaurar<input type="file" id="restoreFile" accept="application/json,.json" hidden></label>
          </div>
        </div>`)}      ${section("Apariencia", FE.themeHTML())}
      ${section("Instalar en este dispositivo", `<div class="card">${FE.installHTML("Facturador")}</div>`)}
`;
  }

  // Lee el formulario de preferencias (sin guardar), para no perder lo escrito al tocar un botón
  function readPrefsForm() {
    const g = id => document.getElementById(id);
    if (!g("prCur")) return;
    prefs.currency = g("prCur").value;
    const ex = g("prExch").value.trim();
    prefs.exchange = ex; prefs.exchangeDate = ex ? FE.todayKey() : "";
    prefs.footerText = g("prFooter").value.trim().slice(0, 400);
    if (g("prAutoEmail")) prefs.autoEmail = g("prAutoEmail").checked;
    [["prRemSalida", "remSalida"], ["prRemModo", "remModo"], ["prRemMarca", "remMarca"], ["prRemChapa", "remChapa"], ["prRemChofer", "remChofer"],
      ["prRemChoferDoc", "remChoferDoc"], ["prAfConst", "afConstancia"]].forEach(([id, k]) => { if (g(id)) prefs[k] = g(id).value.trim(); });
  }
  // Si el formulario de factura está vacío, toma los valores por defecto nuevos
  function refreshEmptyDraft() {
    const d = state.draft;
    if (!d.items.length && !d.ruc && !d.doc && !d.name && !d.pedidoId && !d.assoc) state.draft = newDraft(d.deType);
  }
  function savePrefs() {
    readPrefsForm(); save(); refreshEmptyDraft();
    log("Preferencias guardadas", ""); toast("Preferencias guardadas"); render();
  }
  // Catálogo de productos como QR / código, para cargarlo en la app Pedidos
  function shareCatalog() {
    const code = T.encodeCatalog(products, company.name);
    const cv = FE.qrCanvas(code, ["Catálogo de productos", company.name, products.length + " producto(s)"]);
    sheet(`<h3>Compartir catálogo</h3>
      <p class="muted small">En la app Pedidos: Ajustes → Productos → «Cargar catálogo», con esta imagen o el código.</p>
      <div class="qrbox" id="catQr">${cv ? "" : `<div class="notice bad" style="margin:0"><b>Demasiados productos para un QR</b>Usá «Copiar código».</div>`}</div>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" data-catimg ${cv ? "" : "disabled"}>Compartir imagen</button><button class="btn soft" data-catcopy>Copiar código</button></div>
      <button class="btn" data-x style="margin-top:10px">Cerrar</button>`, (el, close) => {
      if (cv) el.querySelector("#catQr").appendChild(cv);
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-catimg]").onclick = () => cv && FE.shareCanvas(cv, "catalogo-" + company.ruc + ".png", "Catálogo de " + company.name);
      el.querySelector("[data-catcopy]").onclick = () => FE.copyText("Catálogo " + company.name + "\n" + code);
    });
  }

  // ================= Render y eventos =================
  const titles = { home: "Inicio", new: "Nuevo documento", preview: "Vista previa", result: "Resultado", history: "Historial", detail: "Comprobante",
    settings: "Ajustes", pedidos: "Notas de pedido", pedido: "Nota de pedido" };
  function render() {
    billing = T.cuenta(company);
    const s = state.screen;
    if (s === "preview") { goStep(state.draft, "revision"); state.screen = "new"; }
    const map = { home: screenHome, new: screenNew, preview: screenNew, result: screenResult, history: screenHistory, detail: screenDetail,
      settings: screenSettings, pedidos: screenPedidos, pedido: screenPedido };
    document.getElementById("screen").innerHTML = (map[s] || screenHome)();
    FE.enhance(document.getElementById("screen"));
    document.getElementById("title").textContent = titles[s] || "Inicio";
    const setLbl = (go, txt) => { const b = document.querySelector('.tab[data-go="' + go + '"]'); const tn = b && Array.from(b.childNodes).find(x => x.nodeType === 3 && x.nodeValue.trim()); if (tn) tn.nodeValue = txt; };
    setLbl("new", "Emitir"); setLbl("history", can("documentos.todos") ? "Documentos" : "Mis documentos"); setLbl("pedidos", "Notas"); setLbl("settings", esAdm() ? "Gestión" : "Ajustes");
    const pedTab = document.querySelector('.tab[data-go="pedidos"]');
    if (pedTab) { pedTab.style.display = mod("pedidos") ? "" : "none"; document.querySelector(".tabbar").style.setProperty("--tabs", mod("pedidos") ? 5 : 4); }
    const setTab = document.querySelector('.tab[data-go="settings"]'), bol = verBoletas() ? T.boletaNueva(company.id) : null;
    if (setTab) { let dot = setTab.querySelector(".badge"); if (bol && !dot) { dot = document.createElement("span"); dot.className = "badge dot"; dot.setAttribute("aria-label", "Nueva boleta de pago"); setTab.appendChild(dot); } if (!bol && dot) dot.remove(); }
    document.querySelectorAll(".tab").forEach(t => {
      const k = t.dataset.go;
      t.classList.toggle("on", s === k || (k === "history" && s === "detail") || (k === "new" && s === "preview") || (k === "pedidos" && s === "pedido"));
    });
    document.body.classList.toggle("in-flow", s === "new");
    document.getElementById("screen").style.paddingBottom = s === "new" ? "150px" : "130px";
    store.set("draft", state.draft); // el borrador sobrevive si se cierra la app
    companyLine(); window.scrollTo(0, 0);
  }
  function go(s) {
    if ((s === "pedidos" || s === "pedido") && !mod("pedidos")) s = "home";
    if (s !== state.screen) state.q = ""; state.screen = s; render();
  }

  function syncFields() {
    const d = state.draft, g = id => document.getElementById(id);
    if (state.screen === "new") document.querySelectorAll("#screen [data-field]").forEach(el => setPath(d, el.dataset.field, el.value));
    FE.syncReceiver(d);
    if (g("fEmail")) d.email = g("fEmail").value;
    if (g("fAddr")) d.address = g("fAddr").value;
    if (g("fTel")) d.phone = g("fTel").value;
    if (g("fCuotas")) d.installments = Math.max(1, parseInt(g("fCuotas").value, 10) || 1);
    if (g("fCur")) d.currency = g("fCur").value;
    if (g("fTc")) d.exchange = g("fTc").value;
  }
  function refreshTotalOld() {
    const bar = document.querySelector(".sticky-total"); if (!bar) return;
    const d = state.draft, chk = draftCheck(d);
    if (d.deType !== "7") bar.querySelector(".big").textContent = FE.money(chk.t.total, d.currency);
    bar.querySelector("[data-preview]").disabled = !chk.ok;
  }

  // ----- Cargar / editar timbrado (hoja compartida en shared/tenant.js) -----
  // ----- Timbrados: cargar, corregir (solo sin activar), activar, ampliar y dar de baja -----
  const checkPin = pin => user ? T.verifyPin(T.getUser(user.id) || user, pin) : Lock.check(pin);
  function timbradoAction(kind, id) {
    if (!can("timbrados.editar")) { toast("Los timbrados los administran el admin maestro y el admin de la empresa"); return; }
    const by = user ? user.name : "Este dispositivo";
    const done = logText => (list, msg) => { timbrados = list; save(); log(logText, msg); toast(msg); render(); };
    const t = id ? timbrados.find(x => x.id === id) : null;
    if (kind === "add" || kind === "edit") { T.timbradoSheet({ list: timbrados, t, emp: company, onSave: done(t ? "Timbrado corregido" : "Timbrado cargado") }); return; }
    if (kind === "act") { T.activarSheet({ list: timbrados, id, by, checkPin, onSave: done("Timbrado activado") }); return; }
    if (kind === "baja") { T.bajaSheet({ list: timbrados, id, by, checkPin, onSave: done("Timbrado dado de baja") }); return; }
    if (kind === "amp") { T.ampliarSheet({ list: timbrados, id, emp: company, onSave: done("Timbrado ampliado") }); return; }
    if (kind === "del" && t && t.estado === "cargado") confirmSheet("¿Eliminar el timbrado " + t.number + "?", "Todavía no se activó: se borra sin dejar rastro en los documentos.", "Eliminar",
      () => { timbrados = timbrados.filter(x => x.id !== id); save(); log("Timbrado eliminado (sin activar)", t.number); render(); }, true);
  }

  // ----- Recepción de pedidos por QR -----
  function importPedidoText(text) {
    const res = decodePedido(text);
    if (!res.ok) { toast(res.error); return; }
    const p = res.pedido, now = new Date().toISOString();
    const existing = inbox.find(x => x.id === p.id);
    if (!existing) {
      inbox.push(Object.assign(p, { status: "pendiente", receivedAt: now }));
      save(); log("Pedido recibido", p.id + " · " + p.seller); FE.buzz(); state.pedidoId = p.id; go("pedido"); toast("Nota de pedido cargada: pendiente de facturar");
      return;
    }
    if (p.rev > (existing.rev || 1)) {
      if (existing.status === "facturado") {
        toast("Esa nota de pedido ya está facturada. La versión nueva no se aplicó.");
      } else {
        Object.assign(existing, p, { status: "pendiente", reason: "", receivedAt: now });
        save(); toast("Nota de pedido actualizada a la versión " + p.rev);
      }
    } else {
      toast("Esta nota de pedido ya estaba cargada");
    }
    state.pedidoId = existing.id; go("pedido");
  }
  function pasteSheet() {
    sheet(`<h3>Pegar código de la nota de pedido</h3><p class="muted small">Si el vendedor te mandó el código como texto, pegalo aquí.</p>
      <textarea id="pCode" placeholder="FEP1.…"></textarea>
      <div class="btn-row" style="margin-top:14px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Cargar nota</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => { const v = el.querySelector("#pCode").value; close(); importPedidoText(v); };
      setTimeout(() => el.querySelector("#pCode").focus(), 60);
    });
  }
  function rejectSheet(id) {
    sheet(`<h3>Rechazar nota de pedido</h3><p class="muted small">Escribí el motivo. Queda guardado en la nota.</p>
      <textarea id="rWhy" placeholder="Ej. Sin stock del producto"></textarea>
      <div class="btn-row" style="margin-top:14px"><button class="btn" data-x>Volver</button><button class="btn primary" data-ok style="background:var(--bad);border-color:var(--bad)">Rechazar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const why = el.querySelector("#rWhy").value.trim();
        if (!why) { toast("Escribí el motivo del rechazo"); return; }
        const p = inbox.find(x => x.id === id);
        if (p) { p.status = "rechazado"; p.reason = why; p.rejectedAt = new Date().toISOString(); save(); log("Pedido rechazado", id + " · " + why); }
        close(); render(); toast("Nota de pedido rechazada");
      };
      setTimeout(() => el.querySelector("#rWhy").focus(), 60);
    });
  }
  function draftFromPedido(p) {
    return { pedidoId: p.id, mode: p.client.mode, ruc: p.client.ruc || "", name: p.client.name || "", doc: p.client.doc || "", email: p.client.email || "",
      docType: p.client.docType || "", country: p.client.country || "", address: p.client.address || "", phone: p.client.phone || "",
      condition: p.condition, installments: p.installments || 1, currency: p.currency, exchange: p.exchange || "", items: p.items.map(i => Object.assign({}, i)) };
  }
  // Elige un cliente frecuente sin redibujar (lo hace quien llama)
  function draftFromDoc(k) {
    const d = newDraft(k.deType), r = k.receiver || {};
    Object.assign(d, { mode: r.mode || "con", ruc: r.ruc || "", name: r.name || "", doc: r.doc || "", docType: r.docType || "1", country: r.country || "", email: k.receiverEmail || "", address: r.address || "", phone: r.phone || "",
      items: k.items.map(i => Object.assign({}, i)), currency: k.currency || "PYG", exchange: k.exchange || "", condition: k.condition || "contado", installments: k.installments || 1,
      pedidoId: k.pedidoId || null, servicio: k.servicio || null });
    if (k.assoc) d.assoc = { id: k.assoc.id, number: k.assoc.number, cdc: k.assoc.cdc, date: k.assoc.date, currency: k.currency, client: k.receiverName };
    if (k.motivo) d.motivo = k.motivo; if (k.seller) d.seller = Object.assign({}, k.seller); if (k.constancia) d.constancia = Object.assign({}, k.constancia); if (k.rem) d.rem = Object.assign({}, d.rem, k.rem);
    return d;
  }
  function useClientQuiet(c) {
    const d = state.draft;
    Object.assign(d, { mode: c.mode, ruc: c.ruc || "", doc: c.doc || "", name: c.name || "", email: c.email || "", docType: c.docType || "", country: c.country || "", address: c.address || "", phone: c.phone || "" });
  }
  function useClient(c) {
    const d = state.draft;
    d.mode = c.mode; d.ruc = c.ruc || ""; d.doc = c.doc || ""; d.name = c.name || ""; d.email = c.email || "";
    d.docType = c.docType || ""; d.country = c.country || ""; d.address = c.address || ""; d.phone = c.phone || "";
    render();
  }

  let emitting = false;
  // Factura del servicio del estudio: deja la boleta de pago para que la vea la empresa cliente
  function avisarBoleta(inv, invoiceId) {
    const cli = T.getEmpresa(inv.servicio.empresaId); if (!cli) return;
    const mes = (T.cuenta(cli).meses || []).find(m => m.period === inv.servicio.period) || {};
    T.registrarBoleta({ empresaId: cli.id, period: inv.servicio.period, monto: inv.totals.total, vence: mes.vence || "", estudioId: company.id,
      invoiceId, numero: inv.number });
  }
  async function emit() {
    const inv = state.preview; if (!inv || emitting) return;
    const ty = T.deType(inv.deType), isFac = ty.code === "1";
    if (isFac && inv.pedidoId) {
      const p = inbox.find(x => x.id === inv.pedidoId);
      if (p && p.status === "facturado") { toast("Esa nota de pedido ya fue facturada (" + p.invoiceNumber + ")"); return; }
    }
    const tim = activeTimbrado(), st = docState(ty.code);
    if (!st.ok) { toast(st.why); return; }
    const pkey = curPunto();
    if (!tim || !pkey || (inv.timbrado && inv.timbrado.id !== tim.id) || inv.number !== nextNumberStr(ty.code)) { toast("Cambió el timbrado o la numeración. Volvé a abrir la vista previa."); state.preview = null; go("new"); return; }
    if (ty.key === "nc") {
      const fac = invoices.find(x => x.id === inv.assoc.id);
      if (!fac || inv.totals.total > saldoOf(fac) + 0.001) { toast("La nota de crédito supera el saldo de la factura"); return; }
    }
    emitting = true;
    try {
      const approved = Math.random() > 0.15; // simulación de la respuesta de SIFEN
      const id = invoices.reduce((m, i) => Math.max(m, i.id), 0) + 1;
      const now = new Date(), date = now.toISOString();
      const issued = Object.assign({}, inv, { issuedAt: FE.localIso(now), dateLabel: now.toLocaleDateString("es-PY") + " " + now.toTimeString().slice(0, 8) });
      const noAmounts = ty.key === "remision", noIva = noAmounts || ty.key === "autofactura";
      let cdc = "", qrUrl = "";
      if (approved) {
        cdc = FE.buildCdc({ deType: ty.code, ruc: company.ruc, dv: company.dv, establishment: pkey.split("-")[0], point: pkey.split("-")[1],
          number: T.nextNum(tim, ty.code, pkey), taxpayerType: company.taxpayerType, date: now, emissionType: "1" });
        const firma = await T.Firmador.firmar({ empresa: company, cdc, payload: { deType: ty.code, items: issued.items, totals: issued.totals, receiver: issued.receiver } });
        qrUrl = await FE.buildQrUrl({ env: company.env, cdc, date: issued.issuedAt, receiver: issued.receiver,
          total: noAmounts ? 0 : issued.totals.total, iva: noIva ? 0 : issued.totals.iva, items: issued.items.length, digest: firma.digestValue, csc: FE.CSC_TEST });
      }
      const kude = Object.assign(issued, { cdc, qrUrl });
      const client = ty.key === "autofactura" ? (inv.seller && inv.seller.name) || "Vendedor" : inv.receiverName || "Consumidor final";
      const result = {
        id, deType: ty.code, number: inv.number, date, client, by: user ? user.id : "", byName: user ? user.name : "", ruc: ty.key === "autofactura" ? (FE.DOC_SHORT[inv.seller.docType] || "") + " " + inv.seller.doc : inv.receiverId,
        total: inv.totals.totalPyg, currency: inv.currency, totalOp: inv.totals.total,
        operation: inv.operation, status: approved ? "ok" : "bad", cdc, assocId: inv.assoc ? inv.assoc.id : null, assocNumber: inv.assoc ? inv.assoc.number : "",
        reason: approved ? "" : "1103 Número de timbrado no vigente (simulación)", pedidoId: inv.pedidoId, kude
      };
      invoices.unshift(result);
      if (approved) {
        T.bumpNum(tim, ty.code, pkey);
        if (mod("correo") && prefs.autoEmail && inv.receiverEmail && ty.key !== "autofactura") result.emailedTo = inv.receiverEmail; // el envío real lo hará el servidor
        if (isFac || ty.key === "remision") clients = upsertClient(clients, inv.receiver);
        if (isFac && inv.pedidoId) {
          const p = inbox.find(x => x.id === inv.pedidoId);
          if (p) { p.status = "facturado"; p.invoiceNumber = inv.number; p.invoiceId = id; p.invoicedAt = date; }
        }
        if (isFac && inv.servicio) avisarBoleta(inv, id);
        if (ty.key === "remision" && inv.pedidoId) { const p = inbox.find(x => x.id === inv.pedidoId); if (p) { p.remisionNumber = inv.number; p.remisionId = id; } }
      }
      save();
      log(approved ? ty.short + " emitida" : ty.short + " rechazada (simulación)", inv.number + " · " + client + (noAmounts ? "" : " · " + FE.money(inv.totals.total, inv.currency)) + (inv.assoc ? " · factura " + inv.assoc.number : ""));
      if (approved) FE.buzz(40);
      if (result.emailedTo) toast(ty.short + " enviada por correo a " + result.emailedTo + " (simulado)");
      state.lastResult = result; state.draft = newDraft(); state.preview = null;
      go("result");
    } finally { emitting = false; }
  }

  const itemOpts = () => ({ noPrice: state.draft.deType === "7", noTax: state.draft.deType === "4" });
  // Inicia un documento a partir de una factura (notas o remisión) o de un pedido (remisión)
  function startFromInvoice(code, fac) {
    const st = docState(code); if (!st.ok) { toast(st.why); return; }
    state.draft = newDraft(code); state.preview = null; setAssoc(fac); goStep(state.draft, "productos"); go("new");
  }
  function startRemisionFromPedido(p) {
    const st = docState("7"); if (!st.ok) { toast(st.why); return; }
    const d = newDraft("7"), c = p.client;
    Object.assign(d, { pedidoId: p.id, mode: c.mode, ruc: c.ruc || "", name: c.name || "", doc: c.doc || "", docType: c.docType || "1", country: c.country || "", email: c.email || "" });
    d.items = p.items.map(i => ({ desc: i.desc, qty: i.qty, price: 0, tax: "E", discount: 0, code: i.code }));
    goStep(d, "traslado"); state.draft = d; state.preview = null; go("new");
  }
  // Nominación: identificar al comprador de una factura emitida sin identificar (una sola vez)
  function nominarSheet(inv) {
    sheet(`<h3>Nominar la factura ${esc(inv.number)}</h3>
      <p class="muted small">Registra al comprador de una factura emitida como innominada. Se puede hacer una sola vez.</p>
      <div class="grid2">
        <div><label for="nmType">Tipo de documento</label><select id="nmType">${["1", "2", "3", "4", "6", "9"].map(k => `<option value="${k}">${esc(FE.DOC_TYPES[k])}</option>`).join("")}</select></div>
        <div><label for="nmDoc">Número</label><input id="nmDoc" data-kb="code"></div>
      </div>
      <label for="nmName">Nombre del comprador</label><input id="nmName" data-kb="name">
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Nominar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const docType = el.querySelector("#nmType").value, doc = el.querySelector("#nmDoc").value.trim(), name = el.querySelector("#nmName").value.trim();
        if (!doc) { toast("Escribí el número de documento"); return; }
        if (docType === "1" && !/^\d+$/.test(doc)) { toast("La cédula paraguaya lleva solo números"); return; }
        if (!name) { toast("Escribí el nombre del comprador"); return; }
        inv.nominacion = { docType, doc, name, at: new Date().toISOString(), user: user ? user.name : "" };
        inv.client = name; inv.ruc = (FE.DOC_SHORT[docType] || "") + " " + doc;
        save(); log("Factura nominada", inv.number + " · " + name + " · " + inv.ruc); close(); render(); toast("Factura nominada");
      };
    });
  }

  const screenEl = document.getElementById("screen");
  screenEl.addEventListener("click", e => {
    const t = e.target.closest("button, [data-open], [data-openped], [data-boleta]");
    if (!t) return;
    const ds = t.dataset;
    if (ds.go) { go(ds.go); return; }
    if (ds.boleta) { boletaSheet(ds.boleta); return; }
    if (ds.pedpdf) { const p = inbox.find(x => x.id === ds.pedpdf); if (p && window.NotaPedidoPdf) { FE.downloadBlob(NotaPedidoPdf.build(p).output("blob"), NotaPedidoPdf.fileName(p)); toast("PDF descargado"); } return; }
    if (ds.boletaok) { T.marcarBoletaVista(ds.boletaok); render(); return; }
    if (ds.mode) { syncFields(); state.draft.mode = ds.mode; render(); return; }
    if (ds.cond) { syncFields(); state.draft.condition = ds.cond; render(); return; }
    if (ds.add) { syncFields(); itemSheet(it => { state.draft.items.push(it); render(); }, null, mod("productos") ? products : [], state.draft.currency, itemOpts()); return; }
    if (ds.edititem !== undefined) { syncFields(); const i = +ds.edititem; itemSheet(it => { state.draft.items[i] = it; render(); }, state.draft.items[i], mod("productos") ? products : [], state.draft.currency, itemOpts()); return; }
    if (ds.docpick !== undefined) { syncFields(); docPickerSheet(); return; }
    // ---- flujo por pasos ----
    if (ds.wnext !== undefined) {
      syncFields(); const d = state.draft, chk = stepCheck(d, stepKey(d));
      if (!chk.ok) { toast(chk.why); return; }
      d.step++; state.wq = ""; state.wmanual = false; render(); return;
    }
    if (ds.wback !== undefined) { syncFields(); state.wq = ""; state.wmanual = false; if (state.draft.step > 0) { state.draft.step--; render(); } else go("home"); return; }
    if (ds.wexit !== undefined) {
      syncFields(); const d = state.draft;
      if (!d.items.length && !d.ruc && !d.name && !d.assoc) { state.draft = newDraft(); go("home"); return; }
      confirmSheet("¿Salir sin emitir?", "El borrador queda guardado para seguir después.", "Salir", () => go("home"));
      return;
    }
    if (ds.gostep) { syncFields(); goStep(state.draft, ds.gostep); state.wmanual = state.draft.mode !== "con" && ["cliente", "destinatario"].includes(ds.gostep); render(); return; }
    if (ds.wemit !== undefined) {
      syncFields(); const c = draftCheck(state.draft);
      if (!c.ok) { toast(c.why); return; }
      state.preview = buildDoc(state.draft); pinConfirm(() => emit()); return;
    }
    if (ds.pickdoc) {
      const st = docState(ds.pickdoc);
      if (!st.ok) { toast(st.why); return; }
      if (ds.pickdoc === state.draft.deType) { syncFields(); state.draft.step = 1; render(); return; }
      switchDocType(ds.pickdoc); return;
    }
    if (ds.wclient) { const c = clients.find(x => x.id === ds.wclient); if (!c) return; useClientQuiet(c); state.draft.step++; state.wq = ""; render(); return; }
    if (ds.wruc) { const d = state.draft, r = FE.classify({ mode: "con", ruc: ds.wruc }, 0); Object.assign(d, { mode: "con", ruc: ds.wruc, name: r.name || "", doc: "", email: "" }); state.wq = ""; state.wmanual = !r.name; if (r.name) d.step++; render(); return; }
    if (ds.wchange !== undefined) { const d = state.draft; Object.assign(d, { ruc: "", name: "", doc: "", email: "", country: "" }); state.wmanual = false; render(); return; }
    if (ds.wmode) { const d = state.draft; Object.assign(d, { mode: ds.wmode, ruc: "", name: "", doc: "", docType: ds.wmode === "ext" ? "2" : "1", country: "" }); state.wmanual = true; render(); return; }
    if (ds.wassoc) { const fac = invoices.find(x => x.id === +ds.wassoc); if (fac) { setAssoc(fac); goStep(state.draft, "productos"); state.wq = ""; render(); } return; }
    if (ds.wprod !== undefined) {
      syncFields(); const p = products[+ds.wprod]; if (!p) return;
      const d = state.draft, same = d.items.find(i => (p.code && i.code === p.code) || i.desc === p.desc);
      if (same) same.qty = Math.round((same.qty + 1) * 1000) / 1000;
      else d.items.push(Object.assign({ desc: p.desc, qty: 1, discount: 0 }, d.deType === "7" ? { price: 0, tax: "E" } : { price: d.currency === "USD" ? 0 : p.price, tax: d.deType === "4" ? "E" : p.tax }, p.code ? { code: p.code } : {}));
      if (d.currency === "USD" && !same) { toast("Escribí el precio en dólares"); const idx = d.items.length - 1; render(); itemSheet(it => { d.items[idx] = it; render(); }, d.items[idx], [], d.currency, itemOpts()); return; }
      FE.buzz(15); render(); return;
    }
    if (ds.pickassoc !== undefined) { syncFields(); assocPicker(); return; }
    if (ds.setfield) { syncFields(); setPath(state.draft, ds.setfield, ds.value); render(); return; }
    if ((ds.nominar || ds.cancel || ds.mkdoc === "5" || ds.mkdoc === "6") && !esAdm()) { toast("Disponible para el administrador de la empresa"); return; }
    if (ds.mkdoc) { const fac = invoices.find(x => x.id === state.detailId); if (fac) startFromInvoice(ds.mkdoc, fac); return; }
    if (ds.nominar) { const inv = invoices.find(x => x.id === +ds.nominar); if (inv && !inv.nominacion) nominarSheet(inv); return; }
    if (ds.remped) { const p = inbox.find(x => x.id === ds.remped); if (p) startRemisionFromPedido(p); return; }
    if (ds.qtyminus !== undefined || ds.qtyplus !== undefined) {
      syncFields();
      const it = state.draft.items[+(ds.qtyplus !== undefined ? ds.qtyplus : ds.qtyminus)]; if (!it) return;
      const q = Math.round((it.qty + (ds.qtyplus !== undefined ? 1 : -1)) * 1000) / 1000;
      if (q <= 0) return;
      it.qty = q; render(); return;
    }
    if (ds.del !== undefined) { syncFields(); state.draft.items.splice(+ds.del, 1); render(); return; }
    if (ds.pickclient !== undefined) { syncFields(); clientPicker(clients, useClient); return; }
    if (ds.unlinkped !== undefined) { syncFields(); state.draft.pedidoId = null; render(); return; }
    if (ds.preview) {
      syncFields();
      const dd = state.draft, tt = calcItems(dd.items, dd.currency);
      if (dd.currency === "USD" && FE.pygTotal(tt.total, "USD", dd.exchange) == null) { toast("Escribí el tipo de cambio del día para facturar en dólares"); const x = document.getElementById("fTc"); if (x) x.focus(); return; }
      const chk = draftCheck(dd);
      if (!chk.ok) { toast(chk.why); return; }
      state.preview = buildDoc(dd); go("preview"); return;
    }
    if (ds.back) { go(ds.back); return; }
    if (ds.pdf !== undefined) { downloadKudePdf(prefs.printFormat); return; }
    if (ds.respdf) { downloadKudePdf(prefs.printFormat, +ds.respdf); return; }
    if (ds.retry !== undefined) { const r = state.lastResult; if (r && r.kude) { state.draft = fixDraft(draftFromDoc(r.kude)); goStep(state.draft, "revision"); } go("new"); return; }
    if (ds.xml !== undefined) { const d = invoices.find(x => String(x.id) === ds.xml); if (d && d.kude && user && user.role === "maestro") { DEXml.download(d.kude, emisorDe(d.kude)); log("XML descargado", d.number); toast("XML descargado"); } return; }
    if (ds.pdfalt !== undefined) { downloadKudePdf(prefs.printFormat === "ticket" ? "a4" : "ticket"); return; }
    if (ds.removeLogo !== undefined) { company.logo = null; save(); toast("Logo quitado"); render(); return; }
    if (ds.emit) { emit(); return; }
    if (ds.open) { state.detailId = +ds.open; go("detail"); return; }
    if (ds.filter) { state.filter = ds.filter; render(); return; }
    if (ds.share) { toast(ds.share === "pdf" ? "PDF listo (demo)" : "Factura enviada por correo (demo)"); return; }
    if (ds.cancel) {
      const inv = invoices.find(x => x.id === +ds.cancel);
      if (inv && !canCancel(inv)) { toast("Pasó el plazo de cancelación" + (isType(inv, "1") ? ": emití una nota de crédito" : "")); render(); return; }
      if (inv) { inv.cancelled = true; inv.reason = "Cancelada por el emisor (evento simulado)"; save(); log(shortOf(inv) + " cancelada", inv.number); toast("Cancelación registrada (simulada)"); }
      render(); return;
    }
    if (ds.env) {
      if (!can("empresa.ambiente")) { toast("El ambiente lo cambia el admin maestro"); return; }
      company.env = ds.env; save(); log("Ambiente cambiado", company.env === "test" ? "Prueba" : "Producción"); toast("Ambiente: " + (company.env === "test" ? "prueba" : "producción")); render(); return;
    }
    // Pedidos
    if (ds.scan !== undefined) { openScanner(importPedidoText); return; }
    if (ds.paste !== undefined) { pasteSheet(); return; }
    if (ds.pedfilter) { state.pedFilter = ds.pedfilter; render(); return; }
    if (ds.openped) { state.pedidoId = ds.openped; go("pedido"); return; }
    if (ds.rejectped) { rejectSheet(ds.rejectped); return; }
    if (ds.reopenped) { const p = inbox.find(x => x.id === ds.reopenped); if (p) { p.status = "pendiente"; p.reason = ""; save(); } render(); return; }
    if (ds.delped) {
      confirmSheet("¿Eliminar la nota de pedido?", "Se borra de este dispositivo.", "Eliminar", () => {
        inbox = inbox.filter(x => x.id !== ds.delped); save(); go("pedidos"); toast("Nota de pedido eliminada");
      }, true);
      return;
    }
    if (ds.invoiceped) {
      const p = inbox.find(x => x.id === ds.invoiceped); if (!p) return;
      if (!docState("1").ok) { toast(docState("1").why); return; }
      state.draft = fixDraft(draftFromPedido(p)); goStep(state.draft, "productos"); state.preview = null; go("new"); return;
    }
    // Ajustes
    if (ds.timadd !== undefined) { timbradoAction("add"); return; }
    if (ds.timedit) { timbradoAction("edit", ds.timedit); return; }
    if (ds.timact) { timbradoAction("act", ds.timact); return; }
    if (ds.timbaja) { timbradoAction("baja", ds.timbaja); return; }
    if (ds.timamp) { timbradoAction("amp", ds.timamp); return; }
    if (ds.timdel) { timbradoAction("del", ds.timdel); return; }
    if ((ds.addest !== undefined || ds.addpto !== undefined || ds.renpto || ds.bajapto || ds.editest) && can("timbrados.editar")) { T.estPtoAction(company, ds, estCtx()); return; }
    if (ds.inutil !== undefined && can("timbrados.editar")) { T.inutilSheet(company, estCtx()); return; }
    if (ds.pickpunto !== undefined) {
      const opts = myPuntos();
      sheet(`<h3>¿Con qué caja emitís?</h3><div class="flow-list">${opts.map(k => `<button class="doc-opt ${k === curPunto() ? "on" : ""}" data-pp="${esc(k)}"><span class="abbr">${esc(k.split("-")[1])}</span><span><span class="t">${esc(puntoName(k))}</span><span class="w">${esc(k)} · ${esc((T.puntoInfo(company, k) || {}).address || "")}</span></span></button>`).join("")}</div>
        <button class="btn" data-x style="margin-top:12px">Cancelar</button>`, (el, close) => {
        el.querySelector("[data-x]").onclick = close;
        el.querySelectorAll("[data-pp]").forEach(b => b.onclick = () => { store.set(ptoStoreKey(), b.dataset.pp); close(); state.preview = null; render(); toast("Emitís con " + puntoName(b.dataset.pp)); });
      });
      return;
    }
    if (ds.delclient) { clients = clients.filter(x => x.id !== ds.delclient); save(); render(); return; }
    if (ds.profile !== undefined) { perfilSheet(); return; }
    if (ds.changepin !== undefined) { user ? T.changeOwnPin(user) : Lock.change(); return; }
    if (ds.lock !== undefined) { Access.lockNow(); return; }
    if (ds.switchemp !== undefined) { switchEmpresa(); return; }
    // Productos frecuentes
    if (ds.prodadd !== undefined) { T.productSheet(null, p => { products.push(p); save(); log("Producto agregado", p.desc); render(); }); return; }
    if (ds.prodedit) { const p = products.find(x => x.id === ds.prodedit); if (p) T.productSheet(p, np => { Object.assign(p, np); save(); render(); }); return; }
    if (ds.proddel) { products = products.filter(x => x.id !== ds.proddel); save(); render(); return; }
    if (ds.catshare !== undefined) { shareCatalog(); return; }
    // Preferencias
    if (ds.prefcond) { readPrefsForm(); prefs.condition = ds.prefcond; save(); refreshEmptyDraft(); render(); return; }
    if (ds.prefformat) { readPrefsForm(); prefs.printFormat = ds.prefformat; save(); render(); return; }
    if (ds.saveprefs !== undefined) { savePrefs(); return; }
    // Usuarios de la empresa
    if (ds.useradd !== undefined || ds.useredit) {
      const u = ds.useredit ? T.getUser(ds.useredit) : null;
      T.userSheet({ user: u, roles: ["facturador", "cargador", "admincliente"], fixedEmpresa: company.id, empresas: [], modulesFor: company, puntosFor: company,
        onSave: (list, saved) => { log(u ? "Usuario editado" : "Usuario creado", saved.name + " · " + T.ROLES[saved.role].label); render(); } });
      return;
    }
    if (ds.themeSet) { FE.setTheme(ds.themeSet); render(); return; }
    if (ds.install !== undefined) { FE.promptInstall(); return; }
    if (ds.backup !== undefined) { FE.exportBackup(store, "facturador"); return; }
  });

  screenEl.addEventListener("input", e => {
    if (e.target.id === "wSearch") {
      state.wq = e.target.value; const pos = e.target.selectionStart;
      render(); const el = document.getElementById("wSearch");
      if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} }
      return;
    }
    if (e.target.id === "hSearch") {
      state.q = e.target.value; const pos = e.target.selectionStart;
      render(); const el = document.getElementById("hSearch");
      if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} }
      return;
    }
    if (state.screen !== "new") return;
    syncFields();
    const id = e.target.id, pos = e.target.selectionStart;
    if (FE.receiverLiveIds(state.draft.mode).includes(id)) {
      const filled = FE.autofillClient(clients, state.draft);
      if (filled) toast("Cliente frecuente: " + (filled.name || "datos completados"));
      render();
      const el = document.getElementById(id);
      if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} }
    } else refreshFlow();
  });
  screenEl.addEventListener("change", e => {
    const id = e.target.id;
    if (id === "logoFile") { if (!can("cliente.config")) return; loadLogo(e.target.files && e.target.files[0]); return; }
    if (id === "qrFile") {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      toast("Leyendo el QR…");
      readQrFromFile(f).then(importPedidoText).catch(err => toast(err.message));
      return;
    }
    if (id === "restoreFile") { const f = e.target.files && e.target.files[0]; if (f) FE.importBackup(store, "facturador", f, () => location.reload()); return; }
    if (id === "pSeller") { state.pedSeller = e.target.value; render(); return; }
    if (id === "hType") { state.typeFilter = e.target.value; render(); return; }
    if (id === "prAutoEmail") { prefs.autoEmail = e.target.checked; save(); return; }
    if (state.screen === "new") { syncFields(); if (e.target.id === "fCur" && state.draft.items.length) toast("Cambiaste la moneda: revisá los precios de los productos"); if (e.target.tagName === "SELECT") render(); }
  });

  function loadLogo(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|svg\+xml|webp)$/.test(file.type)) { toast("Elegí una imagen PNG, JPG o SVG"); return; }
    if (file.size > 2 * 1024 * 1024) { toast("La imagen supera 2 MB. Usá una más liviana"); return; }
    const reader = new FileReader();
    reader.onload = () => { company.logo = reader.result; save(); log("Logo cargado", ""); toast("Logo cargado"); render(); };
    reader.onerror = () => toast("No se pudo leer la imagen");
    reader.readAsDataURL(file);
  }

  // PDF del KuDE con texto real (seleccionable y buscable), dibujado con jsPDF a partir de los datos.
  // Contexto para cajas, establecimientos e inutilización (funciones compartidas en tenant.js)
  const estCtx = () => ({ edit: can("timbrados.editar"), by: user ? user.name : "Este dispositivo", checkPin: pin => user ? T.verifyPin(T.getUser(user.id) || user, pin) : Lock.check(pin),
    log: (what, detail) => log(what, detail), onChange: () => { timbrados = T.timbradosOf(company); invoices = store.get("invoices", invoices); render(); } });
  // Actividad de la empresa (auditoría) para el administrador
  function actividadHTML() {
    const l = T.auditList().filter(a => a.empresaId === company.id).slice(0, 30);
    return l.length ? l.map(a => `<div class="kv"><span><b>${esc(a.action)}</b><br><span class="small muted">${esc(a.detail || "")}</span></span><span class="small muted" style="text-align:right">${fmtDate(a.ts)}<br>${esc(a.user || "")}</span></div>`).join("")
      : `<div class="muted small">Sin actividad registrada.</div>`;
  }
  // ---- Mi perfil ----
  function perfilInfo() {
    if (!user) return { name: "Este dispositivo", sub: "Sin usuarios · " + company.name };
    return { name: user.name, sub: T.ROLES[user.role].label + " · " + company.name };
  }
  function perfilSheet() {
    const info = perfilInfo(), emps = T.empresasOf(user), actions = [];
    actions.push({ id: "pin", label: user ? "Cambiar mi PIN" : "Cambiar el PIN del dispositivo" });
    if (emps.length > 1) actions.push({ id: "empresa", label: "Cambiar de empresa" });
    if (can("admin.app") && user) actions.push({ id: "admin", label: "Abrir la app Admin" });
    const u = user ? T.getUser(user.id) || user : null;
    T.profileSheet(Object.assign({}, info, {
      rows: user ? [["Rol", T.ROLES[user.role].label], ["Empresa", company.name], ["Empresas asignadas", T.ROLES[user.role].estudio && user.role === "maestro" ? "Todas" : String(emps.length)],
        ["Último ingreso", u && u.lastLoginAt ? fmtDate(u.lastLoginAt) : ""]] : [["Empresa", company.name], ["Acceso", "PIN del dispositivo"]],
      actions,
      exit: user ? { label: "Cerrar sesión", confirm: "¿Cerrar sesión?", text: "Para volver a entrar vas a necesitar tu PIN." } : { label: "Bloquear ahora" },
      onAction: (id, close) => {
        close();
        if (id === "pin") { user ? T.changeOwnPin(user) : Lock.change(); return; }
        if (id === "empresa") { switchEmpresa(); return; }
        if (id === "admin") { location.href = "../admin/"; return; }
        if (id === "exit") Access.lockNow();
      }
    }));
  }
  // Detalle de la boleta de pago: conceptos del mes, total, vencimiento, estado y PDF de la factura del servicio
  function boletaSheet(id) {
    const b = T.boletasDe(company.id).find(x => x.id === id); if (!b) return;
    const mes = (T.cuenta(company).meses || []).find(m => m.period === b.period), c = mes || T.cargoDe(company, b.period);
    const est = T.getEmpresa(b.estudioId), fac = est ? (T.storeFor(est.id).get("invoices", []).find(x => x.id === b.invoiceId) || null) : null;
    const estado = mes ? ({ pagado: "Pagado", pendiente: "Pendiente de pago", vencido: "Vencido", suspendido: "Vencido · emisión suspendida" })[mes.state] || "" : "";
    sheet(`<h3>Boleta de pago · ${esc(T.periodLabel(b.period))}</h3>
      <div class="card" style="margin-top:8px">
        ${(c.lines || []).filter(l => l[1] !== 0 || (l[2] && l[2].incluido)).map(l => `<div class="kv"><span>${esc(l[0])}</span><span>${l[2] && l[2].incluido ? "Incluido" : esc(FE.money(l[1], "PYG"))}</span></div>`).join("")}
        <div class="kv" style="font-weight:800;border-top:1px solid var(--border);padding-top:8px;margin-top:4px"><span>Total del mes</span><span>${esc(FE.money(c.total, "PYG"))}</span></div>
        ${b.vence ? `<div class="kv"><span class="muted">Vence</span><span>${esc(T.isoToDmy(b.vence))}</span></div>` : ""}
        ${estado ? `<div class="kv"><span class="muted">Estado</span><span>${esc(estado)}${mes && mes.pagado > 0 && mes.saldo > 0 ? " · saldo " + esc(FE.money(mes.saldo, "PYG")) : ""}</span></div>` : ""}
        <div class="kv"><span class="muted">Factura</span><span>${esc(b.numero || "-")}${est ? " · " + esc(FE.emisorNombres(est).main) : ""}</span></div>
      </div>
      ${b.monto !== c.total ? `<div class="muted small" style="margin-top:6px">La factura se emitió por ${esc(FE.money(b.monto, "PYG"))}.</div>` : ""}
      <div class="muted small" style="margin-top:8px">Para pagar o consultar, comunicate con el estudio.</div>
      <div class="btn-row" style="margin-top:14px"><button class="btn" data-x>Cerrar</button><button class="btn primary" data-bpdf ${fac && fac.kude ? "" : "disabled"}>Descargar PDF</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = () => { T.marcarBoletaVista(b.id); close(); render(); };
      el.querySelector("[data-bpdf]").onclick = async () => {
        if (!fac || !fac.kude || !window.KudePdf) { toast("No se encontró la factura del servicio"); return; }
        try {
          toast("Generando PDF…");
          await KudePdf.save(fac.kude, est, { consultUrl: "https://ekuatia.set.gov.py/consultas" + (est.env === "test" ? "-test" : "") + "/", qrText: fac.kude.qrUrl || "",
            timbradoLines: timbradoLines(fac.kude), pairs: docInfoPairs(fac.kude), format: "a4" });
          T.marcarBoletaVista(b.id); toast("PDF descargado");
        } catch (err) { console.error(err); toast("No se pudo generar el PDF"); }
      };
    });
  }
  async function downloadKudePdf(format, docId) {
    const inv = docId ? (invoices.find(x => x.id === docId) || {}).kude : state.screen === "new" || state.screen === "preview" ? state.preview : ((invoices.find(x => x.id === state.detailId) || {}).kude);
    if (!inv) { toast("No hay datos para generar el PDF"); return; }
    if (!window.KudePdf || !window.jspdf) { toast("No se pudo cargar el generador de PDF. Se abre la impresión"); window.print(); return; }
    try {
      toast("Generando PDF…");
      await KudePdf.save(inv, emisorDe(inv), { consultUrl: consultUrl(), qrText: inv.qrUrl || "", timbradoLines: timbradoLines(inv), pairs: docInfoPairs(inv),
        footerText: prefs.footerText, format: mod("ticket") ? format || prefs.printFormat : "a4" });
      toast("PDF descargado");
    } catch (err) {
      console.error(err);
      toast("No se pudo generar el PDF. Se abre la impresión: elegí Guardar como PDF");
      window.print();
    }
  }

  document.querySelector(".tabbar").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });
  // Tecla Escape o atrás del navegador dentro del flujo: un paso atrás
  document.addEventListener("keydown", e => { if (e.key === "Escape" && state.screen === "new" && !document.querySelector(".sheet-back, .pinpad-back, .lock")) { const b = document.querySelector("[data-wback]"); if (b) b.click(); } });
  screenEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.dataset && (e.target.dataset.open || e.target.dataset.openped || e.target.dataset.boleta)) { e.preventDefault(); e.target.click(); }
  });

  // ================= PIN de acceso =================
  const Lock = (function () {
    async function hash(pin) {
      const text = "factura-elect:" + pin;
      if (window.crypto && crypto.subtle && window.isSecureContext) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return "s256:" + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
      }
      return "fnv:" + FE.fnv32(text) + FE.fnv32(text.split("").reverse().join(""));
    }
    async function check(pin) {
      const saved = deviceStore.get("pin", null); if (!saved) return false;
      const alg = saved.split(":")[0];
      if (alg === "s256" && !(window.crypto && crypto.subtle && window.isSecureContext)) return false;
      return (await hash(pin)) === saved;
    }
    const unlocked = () => { try { return sessionStorage.getItem("fac_unlocked") === "1"; } catch (_) { return false; } };
    const setUnlocked = v => { try { v ? sessionStorage.setItem("fac_unlocked", "1") : sessionStorage.removeItem("fac_unlocked"); } catch (_) {} };

    function overlay(create) {
      if (document.querySelector(".lock")) return;
      const el = document.createElement("div");
      el.className = "lock";
      el.innerHTML = `<div class="box">
        <div style="font-size:40px;line-height:1">&#128274;</div>
        <h2>${create ? "Creá tu PIN" : "Facturador bloqueado"}</h2>
        <p class="lead">${create ? "Elegí un PIN de 4 a 6 números. Lo vas a pedir cada vez que abras el Facturador." : "Ingresá tu PIN para continuar."}</p>
        <input id="pin1" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••">
        ${create ? `<input id="pin2" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="Repetí el PIN" style="margin-top:10px">` : ""}
        <button class="btn primary" id="pinOk" style="margin-top:14px">${create ? "Guardar PIN" : "Entrar"}</button>
        ${create ? "" : `<button class="link" id="pinForgot" style="margin-top:8px">Olvidé mi PIN</button>`}
      </div>`;
      document.body.appendChild(el);
      const p1 = el.querySelector("#pin1"), p2 = el.querySelector("#pin2");
      const submit = async () => {
        const a = p1.value.trim();
        if (!/^\d{4,6}$/.test(a)) { toast("El PIN tiene que tener de 4 a 6 números"); return; }
        if (create) {
          if (a !== p2.value.trim()) { toast("Los PIN no coinciden"); return; }
          deviceStore.set("pin", await hash(a)); setUnlocked(true); el.remove(); toast("PIN guardado");
        } else if (await check(a)) { setUnlocked(true); el.remove(); }
        else { p1.value = ""; toast("PIN incorrecto"); }
      };
      el.querySelector("#pinOk").onclick = submit;
      el.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
      const forgot = el.querySelector("#pinForgot");
      if (forgot) forgot.onclick = () => confirmSheet("¿Olvidaste el PIN?",
        "Para crear uno nuevo hay que borrar los datos del Facturador en este dispositivo (facturas, pedidos y clientes). Si tenés un respaldo, lo podés restaurar después.",
        "Borrar y empezar de nuevo", () => { store.keys().forEach(k => store.remove(k)); deviceStore.remove("pin"); setUnlocked(false); location.reload(); }, true);
      setTimeout(() => p1.focus(), 60);
    }
    function init() {
      if (!deviceStore.get("pin", null)) { overlay(true); return; }
      if (!unlocked()) overlay(false);
    }
    function lockNow() { setUnlocked(false); document.querySelectorAll(".sheet-back, .scanner").forEach(n => n.remove()); overlay(false); }
    function change() {
      sheet(`<h3>Cambiar PIN</h3>
        <label for="cOld">PIN actual</label><input id="cOld" type="password" inputmode="numeric" maxlength="6">
        <label for="cNew">PIN nuevo (4 a 6 números)</label><input id="cNew" type="password" inputmode="numeric" maxlength="6">
        <label for="cNew2">Repetí el PIN nuevo</label><input id="cNew2" type="password" inputmode="numeric" maxlength="6">
        <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
        el.querySelector("[data-x]").onclick = close;
        el.querySelector("[data-ok]").onclick = async () => {
          const o = el.querySelector("#cOld").value.trim(), n = el.querySelector("#cNew").value.trim(), n2 = el.querySelector("#cNew2").value.trim();
          if (!(await check(o))) { toast("El PIN actual no es correcto"); return; }
          if (!/^\d{4,6}$/.test(n)) { toast("El PIN nuevo tiene que tener de 4 a 6 números"); return; }
          if (n !== n2) { toast("Los PIN nuevos no coinciden"); return; }
          deviceStore.set("pin", await hash(n)); close(); toast("PIN cambiado");
        };
      });
    }
    return { init, lockNow, change, check };
  })();

  // ================= Acceso: usuarios con PIN o PIN del dispositivo =================
  // Si hay usuarios con acceso a esta empresa, cada uno entra con su PIN y sus permisos.
  // Si no hay ninguno, se usa el PIN del dispositivo como antes (todo permitido).
  const LOGIN_ROLES = ["maestro", "admincliente", "facturador"]; // el operador (soporte) usa Administración; el vendedor, Notas de pedido
  const Access = {
    usersMode: () => T.usersFor(company.id, LOGIN_ROLES).length > 0,
    init() {
      if (!this.usersMode()) { Lock.init(); }
      else {
        const u = T.sessionUser("fac");
        if (u && u.active !== false && LOGIN_ROLES.includes(u.role) && T.accessTo(u, company.id)) user = u;
        else this.login();
      }
      let hiddenAt = 0;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) hiddenAt = Date.now();
        else if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) this.lockNow();
      });
    },
    login() {
      T.loginOverlay({ title: "Facturador · " + company.name, users: T.usersFor(company.id, LOGIN_ROLES), onSuccess: u => {
        user = u; T.setSession("fac", u); log("Ingreso al Facturador", ""); toast("Hola, " + u.name); render();
      } });
    },
    lockNow() {
      document.querySelectorAll(".sheet-back, .scanner").forEach(n => n.remove());
      if (!this.usersMode()) { Lock.lockNow(); return; }
      if (user) log("Sesión cerrada", "");
      user = null; T.setSession("fac", null); render(); this.login();
    }
  };
  function switchEmpresa() {
    const list = T.empresasOf(user);
    if (list.length < 2) return;
    T.empresaPicker(list, company.id, id => { if (id !== company.id) { T.setActive(id); log("Cambio de empresa", T.getEmpresa(id).name); location.reload(); } });
  }
  document.getElementById("companyLine").addEventListener("click", switchEmpresa);

  render();
  FE.onInstallChange(() => { if (state.screen === "settings") render(); });
  Access.init();
  render();
  FE.registerSW();
})();
