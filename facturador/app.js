/* App Facturador (principal): factura, recibe pedidos por QR y decide si facturarlos.
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
  let timbrados = store.get("timbrados", []);
  let products = store.get("products", []);   // productos frecuentes
  // Preferencias del cliente: valores por defecto, pie del KuDE, formato de impresión, correo automático
  const prefs = Object.assign({ condition: "contado", currency: "PYG", exchange: "", exchangeDate: "", footerText: "", printFormat: "a4", autoEmail: false }, store.get("prefs", {}));
  const save = () => {
    T.saveEmpresa(company); store.set("invoices", invoices); store.set("pedidos", inbox); store.set("clients", clients);
    store.set("timbrados", timbrados); store.set("products", products); store.set("prefs", prefs);
  };
  save();
  const dmyToIso = T.dmyToIso, isoToDmy = T.isoToDmy, timbradoStatus = T.timbradoStatus, vigenciaText = T.vigenciaText;
  // Usuario con sesión (null = modo de un solo dispositivo sin usuarios: se permite todo)
  let user = null;
  const can = perm => T.can(user, perm);
  const log = (action, detail) => T.audit(action, detail, company.id, user);

  // ================= Estado =================
  const state = { screen: "home", filter: "all", detailId: null, lastResult: null, draft: store.get("draft", null) || newDraft(), preview: null, q: "",
    pedFilter: "pendiente", pedSeller: "", pedidoId: null };
  function newDraft() {
    return { pedidoId: null, mode: "con", ruc: "", name: "", doc: "", docType: "1", country: "", email: "", condition: prefs.condition, installments: 1,
      currency: prefs.currency, exchange: prefs.exchangeDate === FE.todayKey() ? prefs.exchange : "", items: [] };
  }
  const activeTimbrado = () => timbrados.find(t => t.active) || null;
  const timbradoOk = () => timbradoStatus(activeTimbrado()) === "vigente";
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
  const nextNumberStr = () => { const t = activeTimbrado(); return t ? company.establishment + "-" + company.point + "-" + String(t.nextNumber).padStart(7, "0") : "Sin timbrado activo"; };

  // ================= Utilidades de interfaz =================
  const statusChip = s => s === "ok" ? '<span class="chip ok">Aprobada</span>' : s === "bad" ? '<span class="chip bad">Rechazada</span>' : '<span class="chip warn">Pendiente</span>';
  const pedChip = s => s === "facturado" ? '<span class="chip ok">Facturado</span>' : s === "rechazado" ? '<span class="chip bad">Rechazado</span>' : '<span class="chip warn">Pendiente de facturar</span>';
  const pedClient = p => FE.receiverDisplayName(p.client);
  const pendingCount = () => inbox.filter(p => p.status === "pendiente").length;
  function companyLine() {
    const line = document.getElementById("companyLine"), multi = T.empresasOf(user).length > 1;
    line.textContent = company.name + " · RUC " + company.ruc + "-" + company.dv + (multi ? "  ▾ cambiar" : "") + (user ? " · " + user.name : "");
    line.style.cursor = multi ? "pointer" : "";
    document.getElementById("envChip").textContent = company.env === "test" ? "Prueba" : "Producción";
    const b = document.getElementById("pedBadge"), n = pendingCount();
    b.textContent = n; b.classList.toggle("hidden", !n);
  }

  // ================= Pantallas =================
  function screenHome() {
    const today = FE.todayKey();
    const todays = invoices.filter(i => i.status === "ok" && FE.localDayKey(i.date) === today);
    const pending = invoices.filter(i => i.status === "warn").length;
    const rejected = invoices.filter(i => i.status === "bad").length;
    const pp = pendingCount();
    return `
      <div class="hero">
        <div class="label">Facturado hoy</div>
        <div class="value">Gs ${fmt(todays.reduce((a, i) => a + i.total, 0))}</div>
        <div class="meta">${todays.length} aprobada(s) · ${pending} pendiente(s)</div>
      </div>
      <div class="quick">
        <button class="btn primary" data-go="new">Nueva factura</button>
        <button class="btn soft" data-go="pedidos">Pedidos${pp ? " (" + pp + ")" : ""}</button>
      </div>
      ${timbradoNotice()}
      ${pp ? `<div class="notice warn"><b>Tenés ${pp} pedido(s) pendiente(s) de facturar</b>Abrí Pedidos para revisarlos y decidir.</div>` : ""}
      ${rejected ? `<div class="notice bad"><b>Hay ${rejected} factura(s) rechazada(s)</b>Abrila en el historial para ver el motivo y corregirla.</div>` : ""}
      <div class="section">
        <div class="section-title">Últimos comprobantes</div>
        <div class="card">${invoices.slice(0, 4).map(rowInvoice).join("") || `<div class="muted small">Sin comprobantes.</div>`}</div>
      </div>`;
  }
  function timbradoNotice() {
    const t = activeTimbrado(), problem = timbradoProblem();
    if (problem) return `<div class="notice bad"><b>No se puede facturar</b>${esc(problem)}</div>`;
    const days = t.end ? Math.round((Date.parse(t.end) - Date.parse(FE.todayKey())) / 86400000) : null;
    if (days !== null && days <= 30) return `<div class="notice warn"><b>El timbrado ${esc(t.number)} vence en ${days} día(s)</b>Vigente hasta el ${isoToDmy(t.end)}. Cargá el nuevo en Ajustes → Timbrados.</div>`;
    return `<div class="notice ok"><b>Timbrado activo ${esc(t.number)}</b>${esc(vigenciaText(t))} · próxima factura ${esc(nextNumberStr())}</div>`;
  }
  function rowInvoice(i) {
    return `<div class="row" data-open="${i.id}" role="button" tabindex="0">
      <div class="main"><div class="title">${esc(i.client)}</div><div class="sub">${esc(i.number)} · ${fmtDate(i.date)}</div></div>
      <div style="text-align:right"><div class="amount">Gs ${fmt(i.total)}</div><div style="margin-top:4px">${statusChip(i.status)}</div></div>
    </div>`;
  }

  function screenNew() {
    const d = state.draft, t = calcItems(d.items, d.currency), r = classify(d, pygOf(d, t));
    const hasItems = d.items.length > 0;
    const canPreview = r.valid && hasItems && timbradoOk();
    const ped = d.pedidoId ? inbox.find(p => p.id === d.pedidoId) : null;
    return `
      ${ped ? `<div class="notice ok" style="margin-top:0"><b>Facturando el pedido ${esc(ped.id)}</b>Cargado por ${esc(ped.seller)}. Revisá los datos y emití.
        <button class="link" data-unlinkped style="display:block;padding:4px 0 0;min-height:0">Quitar vínculo con el pedido</button></div>` : ""}
      ${timbradoOk() ? "" : `<div class="notice bad" style="margin-top:0"><b>No se puede facturar</b>${esc(timbradoProblem())}
        <button class="link" data-go="settings" style="display:block;padding:4px 0 0;min-height:0">Ir a Timbrados</button></div>`}
      <div class="lead">Elegí el tipo de cliente. El tipo de operación se detecta solo.</div>
      <div class="section">
        <div class="section-title"><span class="num ${r.valid ? "done" : ""}">1</span>Cliente
          <button class="link" data-pickclient style="margin-left:auto;font-size:14px">Clientes frecuentes</button></div>
        ${FE.receiverBlock(d, r, t.total, { why: true })}
        <label for="fEmail">Correo para enviar la factura (opcional)</label>
        <input id="fEmail" type="email" placeholder="cliente@correo.com" value="${esc(d.email)}">
      </div>

      <div class="section">
        <div class="section-title"><span class="num ${hasItems ? "done" : ""}">2</span>Productos</div>
        <div class="card">
          ${!hasItems ? `<div class="muted small" style="padding:4px 0 2px">Todavía no agregaste productos o servicios.</div>` :
            d.items.map((it, idx) => { const c = calcItem(it, d.currency); return `<div class="item">
              <div class="desc">${esc(it.desc)}</div><div class="amount">${FE.money(c.total, d.currency)}</div>
              <div class="calc">${FE.fmtQty(it.qty)} × ${FE.money(it.price, d.currency)}${it.discount ? " − " + it.discount + "%" : ""} · ${taxLabel(it.tax)}
</div>
              <div class="item-actions">
                <span class="stepper"><button data-qtyminus="${idx}" aria-label="Uno menos" ${it.qty <= 1 ? "disabled" : ""}>−</button><b>${FE.fmtQty(it.qty)}</b><button data-qtyplus="${idx}" aria-label="Uno más">+</button></span>
                <span><button class="link" data-edititem="${idx}">Editar</button><button class="link danger" data-del="${idx}">Quitar</button></span>
              </div></div>`; }).join("")}
          <button class="add" data-add="1">+ Agregar producto o servicio</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title"><span class="num">3</span>Condición de venta</div>
        <div class="seg">
          <button data-cond="contado" class="${d.condition === "contado" ? "on" : ""}">Contado</button>
          <button data-cond="credito" class="${d.condition === "credito" ? "on" : ""}">Crédito</button>
        </div>
        <div class="grid2" style="margin-top:4px">
          ${d.condition === "credito" ? `<div><label for="fCuotas">Cuotas</label><input id="fCuotas" inputmode="numeric" value="${d.installments}"></div>` : `<div></div>`}
          <div><label for="fCur">Moneda</label>
            <select id="fCur"><option value="PYG" ${d.currency === "PYG" ? "selected" : ""}>Guaraníes</option><option value="USD" ${d.currency === "USD" ? "selected" : ""}>Dólares</option></select></div>
        </div>
        ${d.currency === "USD" ? `<label for="fTc">Tipo de cambio</label><input id="fTc" inputmode="numeric" placeholder="Ej. 7.800" value="${esc(d.exchange)}">` : ""}
      </div>

      <div class="sticky-total">
        <div class="line"><span class="muted">${t.count ? t.count + (t.count === 1 ? " producto" : " productos") : "Total"}</span>
          <span class="big">${FE.money(t.total, d.currency)}</span></div>
        <button class="btn primary" data-preview="1" ${canPreview ? "" : "disabled"}>Ver factura</button>
      </div>`;
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
  function kudeHTML(inv) {
    const T = inv.totals, fm = n => fmt(n, inv.currency);
    const cdcFmt = inv.cdc ? FE.formatCdc(inv.cdc) : "Pendiente de aprobación";
    const isUSD = inv.currency === "USD";
    const test = company.env === "test";
    return `
    <div class="kude" id="kudeBody">
      ${test ? `<div class="band">AMBIENTE DE PRUEBA - SIN VALIDEZ TRIBUTARIA</div>
      <div class="band2">DOCUMENTO ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA</div>` : ""}
      <div class="ttl">KuDE de Factura Electrónica</div>
      <div class="box"><div class="hd">
        <div>
          ${company.logo ? `<img class="logo-img" src="${company.logo}" alt="Logo del emisor">` : `<div class="logo">Logo del emisor<br>(lo carga el cliente)</div>`}
          <div class="em"><b>${esc(company.name)}</b><br>${esc(company.fantasy)}<br>${esc(company.address)}<br>${esc(company.city)} · Tel. ${esc(company.phone)}<br>${esc(company.mail)}<br>Actividad: ${esc(company.activity)}</div>
        </div>
        <div>
          <div style="font-weight:700;font-size:12px">RUC: ${esc(company.ruc)}-${esc(company.dv)}</div>
          <div style="margin-top:4px">${timbradoLines(inv).map(esc).join("<br>")}</div>
          <div class="fact" style="margin-top:12px">FACTURA ELECTRÓNICA</div>
          <div style="font-weight:700;font-size:11px">${esc(inv.number)}</div>
        </div>
      </div></div>
      <div class="box"><div class="grid">
        <div><span>Fecha y hora de emisión</span><br>${esc(inv.dateLabel)}</div>
        <div><span>RUC / Documento Nº</span><br>${esc(inv.receiverId || "Innominado")}</div>
        <div><span>Condición de venta</span><br>${inv.condition === "credito" ? "[ ] Contado   [X] Crédito" + (inv.installments > 1 ? " · " + inv.installments + " cuotas" : "") : "[X] Contado   [ ] Crédito"}</div>
        <div><span>Nombre o razón social</span><br>${esc(inv.receiverName)}</div>
        <div><span>Moneda</span><br>${isUSD ? "USD" + (inv.exchange ? " · TC " + esc(inv.exchange) : "") : "PYG"}</div>
        <div><span>Dirección / Correo</span><br>${esc(inv.receiverEmail || "-")}</div>
        <div><span>Tipo de transacción</span><br>Venta de mercadería</div>
        ${inv.pedidoId ? `<div><span>Pedido</span><br>${esc(inv.pedidoId)}</div>` : ""}
      </div></div>
      <div class="box" style="padding:0"><div class="tblwrap">
        <table>
          <colgroup><col class="c-cod"><col class="c-desc"><col class="c-un"><col class="c-qty"><col class="c-pu"><col class="c-dc"><col class="c-ex"><col class="c-5"><col class="c-10"></colgroup>
          <thead><tr><th>Cod</th><th>Descripción</th><th>Unidad</th><th class="n">Cantidad</th><th class="n">Precio</th><th class="n">Desc.</th><th class="n">Exentas</th><th class="n">5%</th><th class="n">10%</th></tr></thead>
          <tbody>
            ${inv.items.map((it, i) => { const c = calcItem(it, inv.currency); return `<tr>
              <td>${esc(it.code || "INF" + String(i + 1).padStart(3, "0"))}</td><td>${esc(it.desc)}</td><td>UNI</td>
              <td class="n">${FE.fmtQty(it.qty)}</td><td class="n">${fm(it.price)}</td><td class="n">${it.discount ? it.discount + "%" : "0"}</td>
              <td class="n">${it.tax === "E" ? fm(c.total) : "0"}</td><td class="n">${it.tax === "5" ? fm(c.total) : "0"}</td><td class="n">${it.tax === "10" ? fm(c.total) : "0"}</td></tr>`; }).join("")}
            <tr class="tot-row"><td colspan="6">SUBTOTAL</td><td class="n">${fm(T.exe)}</td><td class="n">${fm(T.b5)}</td><td class="n">${fm(T.b10)}</td></tr>
            <tr class="tot-row"><td colspan="8">TOTAL DE LA OPERACIÓN</td><td class="n">${fm(T.total)}</td></tr>
            <tr class="tot-row"><td colspan="8">TOTAL EN GUARANÍES</td><td class="n">${fmt(isUSD ? T.totalPyg : T.total)}</td></tr>
          </tbody>
        </table>
        <div class="klist">
          ${inv.items.map((it, i) => { const c = calcItem(it, inv.currency); return `<div class="ki">
            <div class="ki-top"><span class="ki-cod">${esc(it.code || "INF" + String(i + 1).padStart(3, "0"))}</span><b>${esc(it.desc)}</b></div>
            <div class="ki-row"><span>${FE.fmtQty(it.qty)} UNI × ${fm(it.price)}</span><span class="lbl">Desc. ${it.discount ? it.discount + "%" : "0"}</span></div>
            <div class="ki-row"><span class="lbl">${it.tax === "E" ? "Exentas" : it.tax === "5" ? "Gravadas 5%" : "Gravadas 10%"}</span><b>${fm(c.total)}</b></div>
          </div>`; }).join("")}
          <div class="kt"><span>Subtotal exentas</span><span>${fm(T.exe)}</span></div>
          <div class="kt"><span>Subtotal 5%</span><span>${fm(T.b5)}</span></div>
          <div class="kt"><span>Subtotal 10%</span><span>${fm(T.b10)}</span></div>
          <div class="kt b"><span>TOTAL DE LA OPERACIÓN</span><span>${fm(T.total)}</span></div>
          <div class="kt b"><span>TOTAL EN GUARANÍES</span><span>${fmt(isUSD ? T.totalPyg : T.total)}</span></div>
        </div>
        </div><div class="liq" style="padding:6px 8px 8px;"><span>LIQUIDACIÓN IVA</span><span>(5%) ${fm(T.iva5)}</span><span>(10%) ${fm(T.iva10)}</span><span>TOTAL IVA ${fm(T.iva)}</span></div>
      </div>
      <div class="box"><div class="foot">
        ${qrImg(inv) ? `<div class="qr has"><img src="${qrImg(inv)}" alt="QR de consulta"></div>` : `<div class="qr">QR al aprobarse</div>`}
        <div>
          <div style="font-size:10px">Consulte la validez de esta factura electrónica con el número de CDC en:</div>
          <a class="link" href="#" onclick="return false">${esc(consultUrl())}</a>
          <div class="cdc">CDC: ${esc(cdcFmt)}</div>
          <div class="legal">ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML)</div>
          <div class="legal"><b>Información de interés del facturador electrónico emisor.</b><br>Si su documento electrónico presenta algún error, podrá solicitar la modificación dentro de las 72 horas siguientes a la emisión de este comprobante.</div>
        </div>
      </div></div>
      ${prefs.footerText ? `<div class="legal" style="white-space:pre-line;margin:2px 0 6px">${esc(prefs.footerText)}</div>` : ""}
      ${test ? `<div class="note">Prueba: IdCSC ${esc(company.csc)} con CSC de prueba del manual · Datos ficticios, no es un documento tributario.</div>` : ""}
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
  function buildInvoice(d) {
    const t = calcItems(d.items, d.currency), r = classify(d, pygOf(d, t)), now = new Date();
    const receiver = FE.receiverFromDraft(d, r);
    return {
      number: nextNumberStr(),
      timbrado: (t => ({ id: t.id, number: t.number, start: t.start, end: t.end }))(activeTimbrado()),
      issuedAt: FE.localIso(now),
      dateLabel: now.toLocaleDateString("es-PY") + " " + now.toTimeString().slice(0, 8),
      receiver,
      receiverId: FE.receiverIdText(receiver),
      receiverName: receiver.name || (d.mode === "con" ? "" : "Consumidor final"),
      receiverEmail: d.email, receiverMode: d.mode,
      items: d.items.map(i => Object.assign({}, i)), currency: d.currency, exchange: d.exchange,
      condition: d.condition, installments: d.installments,
      operation: r.operation, operationLabel: opName[r.operation] || "", pedidoId: d.pedidoId || null,
      totals: { exe: t.exe, b5: t.b5, b10: t.b10, iva5: t.iva5, iva10: t.iva10, iva: t.iva, total: t.total,
        totalPyg: FE.pygTotal(t.total, d.currency, d.exchange) || 0 },
      cdc: ""
    };
  }

  function screenPreview() {
    const inv = state.preview;
    if (!inv) return screenNew();
    return `
      <button class="link" data-back="new">← Editar factura</button>
      <h2>Vista previa</h2>
      <p class="lead">Revisá los datos. Una vez aprobada, la factura no se puede cambiar: solo cancelarla o emitir una nota de crédito.</p>
      ${kudeHTML(inv)}
      <div style="margin-top:14px" class="btn-row">
        <label class="btn soft" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Cargar logo<input type="file" id="logoFile" accept="image/*" hidden></label>
        <button class="btn" data-pdf="1">Descargar PDF</button>
      </div>
      <button class="link" data-pdfalt="1" style="display:block;margin:4px auto 0">Descargar en formato ${prefs.printFormat === "ticket" ? "A4" : "ticket"}</button>
      <button class="btn primary" data-emit="1" style="margin-top:10px">Emitir factura</button>
      <div class="muted small" style="margin-top:10px;text-align:center">${company.env === "test" ? "Se usa el ambiente de prueba. " : ""}La aprobación de SIFEN es simulada.</div>`;
  }

  function screenResult() {
    const r = state.lastResult;
    if (!r) return screenHome();
    const ok = r.status === "ok";
    return `
      <div class="card" style="margin-top:6px;text-align:left;padding:18px">
        <div>${ok ? '<span class="chip ok">Aprobada</span>' : '<span class="chip bad">Rechazada</span>'}</div>
        <h2 style="margin-top:10px">${ok ? "Factura emitida" : "No se pudo aprobar"}</h2>
        <div class="small muted">${esc(r.number)} · ${esc(r.client)}</div>
        <div class="amount" style="font-size:22px;margin-top:6px">${r.currency === "USD" ? FE.money(r.totalOp, "USD") + " · " : ""}Gs ${fmt(r.total)}</div>
        ${r.emailedTo ? `<div class="small" style="margin-top:6px">Enviada por correo a ${esc(r.emailedTo)} (simulado)</div>` : ""}
        ${r.pedidoId ? `<div class="small" style="margin-top:6px">Pedido ${esc(r.pedidoId)}: ${ok ? "marcado como facturado" : "sigue pendiente de facturar"}</div>` : ""}
        ${ok ? `<div class="small" style="margin-top:12px">CDC</div><div class="small cdc-text" style="margin-top:2px">${esc(FE.formatCdc(r.cdc))}</div>`
          : `<div class="notice bad" style="margin-top:12px"><b>Motivo</b>${esc(r.reason)}<br>Corregí el dato y volvé a emitir.</div>`}
      </div>
      ${ok ? `
        <div class="section"><div class="section-title">Enviar al cliente</div>
          <div class="btn-row">
            <button class="btn soft" data-open="${r.id}">Ver y descargar PDF</button>
            <button class="btn primary" data-share="mail">Enviar por correo</button>
          </div>
          <div class="muted small" style="margin-top:8px">WhatsApp llega en una próxima versión.</div>
        </div>` : ""}
      <div class="btn-row" style="margin-top:18px">
        <button class="btn" data-go="${r.pedidoId ? "pedidos" : "history"}">${r.pedidoId ? "Ver pedidos" : "Ver historial"}</button>
        <button class="btn primary" data-go="new">Nueva factura</button>
      </div>`;
  }

  function screenHistory() {
    const list = invoices.filter(i => (state.filter === "all" || i.status === state.filter) && FE.matches(state.q, i.client, i.number, i.ruc, i.pedidoId));
    const count = k => k === "all" ? invoices.length : invoices.filter(i => i.status === k).length;
    const seg = (k, label) => `<button data-filter="${k}" class="${state.filter === k ? "on" : ""}">${label} · ${count(k)}</button>`;
    return `
      <h2>Historial</h2>
      <div class="seg four">${seg("all", "Todas")}${seg("ok", "Aprobadas")}${seg("warn", "Pendientes")}${seg("bad", "Rechazadas")}</div>
      ${FE.searchBox(state.q, "Buscar por cliente, número o RUC")}
      <div class="card" style="margin-top:12px">
        ${list.length ? list.map(rowInvoice).join("") : `<div class="muted small">${state.q ? "Ninguna factura coincide con la búsqueda." : "No hay comprobantes en este filtro."}</div>`}
      </div>`;
  }

  const CANCEL_MS = 48 * 3600 * 1000;
  const canCancel = i => i.status === "ok" && Date.now() - Date.parse(i.date) < CANCEL_MS;
  function screenDetail() {
    const i = invoices.find(x => x.id === state.detailId);
    if (!i) return screenHistory();
    return `
      <button class="link" data-back="history">← Historial</button>
      <h2>${esc(i.number)}</h2>
      <div style="margin-bottom:14px">${statusChip(i.status)}</div>
      <div class="card">
        <div class="kv"><span class="muted">Cliente</span><span>${esc(i.client)}</span></div>
        <div class="kv"><span class="muted">RUC / documento</span><span>${esc(i.ruc || "Sin identificar")}</span></div>
        <div class="kv"><span class="muted">Operación</span><span>${esc(opName[i.operation] || "")} (${esc(i.operation)})</span></div>
        <div class="kv"><span class="muted">Fecha</span><span>${fmtDate(i.date)}</span></div>
        ${i.pedidoId ? `<div class="kv"><span class="muted">Pedido</span><span><button class="link" data-openped="${esc(i.pedidoId)}" style="min-height:0;padding:0">${esc(i.pedidoId)}</button></span></div>` : ""}
        ${i.currency === "USD" ? `<div class="kv"><span class="muted">Total en dólares</span><span class="amount">${FE.money(i.totalOp, "USD")}</span></div>` : ""}
        <div class="kv"><span class="muted">Total${i.currency === "USD" ? " en guaraníes" : ""}</span><span class="amount">Gs ${fmt(i.total)}</span></div>
        ${i.cdc ? `<div style="padding:12px 0;border-top:1px solid var(--border)"><div class="muted small">CDC</div><div class="small cdc-text" style="margin-top:4px">${esc(FE.formatCdc(i.cdc))}</div></div>` : ""}
        ${i.reason ? `<div style="padding:12px 0;border-top:1px solid var(--border)"><div class="muted small">Motivo</div><div style="margin-top:4px;color:var(--bad)">${esc(i.reason)}</div></div>` : ""}
      </div>
      ${i.kude ? `<div class="section"><div class="section-title">KuDE</div>${kudeHTML(i.kude)}</div>` : ""}
      <div class="btn-row" style="margin-top:16px">
        <button class="btn soft" ${i.kude ? `data-pdf="${esc(i.number)}"` : `data-share="pdf"`} ${i.status === "ok" ? "" : "disabled"}>Descargar PDF${i.kude ? (prefs.printFormat === "ticket" ? " (ticket)" : " (A4)") : ""}</button>
        <button class="btn soft" data-share="mail" ${i.status === "ok" ? "" : "disabled"}>Enviar por correo</button>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" data-cancel="${i.id}" ${canCancel(i) ? "" : "disabled"}>Cancelar factura</button>
        <button class="btn primary" data-go="new">Nueva factura</button>
      </div>
      ${i.kude && i.status === "ok" ? `<button class="link" data-pdfalt="1" style="display:block;margin:4px auto 0">Descargar en formato ${prefs.printFormat === "ticket" ? "A4" : "ticket"}</button>` : ""}
      ${i.emailedTo ? `<div class="muted small" style="margin-top:8px">Enviada por correo a ${esc(i.emailedTo)} (simulado).</div>` : ""}
      <div class="muted small" style="margin-top:12px">${i.status === "ok"
        ? (canCancel(i) ? "Podés cancelarla hasta el " + fmtDate(new Date(Date.parse(i.date) + CANCEL_MS).toISOString()) + " (48 horas desde la aprobación)."
          : "Pasaron las 48 horas para cancelarla. Para corregirla, emití una nota de crédito.")
        : "Podés cancelar hasta 48 horas después de la aprobación. Después, emití una nota de crédito."}</div>`;
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
      <h2>Pedidos</h2>
      <p class="lead">Leé el QR que te mandó el vendedor. El pedido se carga entero y queda pendiente de facturar.</p>
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
          </div>`).join("") : `<div class="muted small">No hay pedidos en este filtro.</div>`}
        </div>
      </div>`;
  }

  function screenPedido() {
    const p = inbox.find(x => x.id === state.pedidoId);
    if (!p) return screenPedidos();
    const t = calcItems(p.items, p.currency), r = classify(p.client, pygOf(p, t));
    return `
      <button class="link" data-go="pedidos">← Pedidos</button>
      <h2>Pedido ${esc(p.id)}</h2>
      <div style="margin-bottom:12px">${pedChip(p.status)} ${p.rev > 1 ? `<span class="chip neutral">Versión ${p.rev}</span>` : ""}</div>
      ${p.status === "rechazado" ? `<div class="notice bad" style="margin-top:0"><b>Motivo del rechazo</b>${esc(p.reason)}</div>` : ""}
      ${p.status === "facturado" ? `<div class="notice ok" style="margin-top:0"><b>Facturado</b>Factura ${esc(p.invoiceNumber)} · ${fmtDate(p.invoicedAt)}</div>` : ""}
      ${!r.valid ? `<div class="notice warn"><b>Revisá el cliente</b>${esc(r.why)}</div>` : ""}
      <div class="card">
        <div class="kv"><span class="muted">Cliente</span><span>${esc(pedClient(p))}</span></div>
        <div class="kv"><span class="muted">${FE.receiverIdLabel(p.client)}</span><span>${esc(FE.receiverIdText(p.client))}</span></div>
        ${r.valid ? `<div class="kv"><span class="muted">Operación</span><span>${esc(opName[r.operation])} (${r.operation})</span></div>` : ""}
        ${p.client.email ? `<div class="kv"><span class="muted">Correo</span><span>${esc(p.client.email)}</span></div>` : ""}
        <div class="kv"><span class="muted">Condición</span><span>${p.condition === "credito" ? "Crédito" + (p.installments > 1 ? " · " + p.installments + " cuotas" : "") : "Contado"}</span></div>
        <div class="kv"><span class="muted">Vendedor</span><span>${esc(p.seller)}</span></div>
        <div class="kv"><span class="muted">Cargado</span><span>${fmtDate(p.createdAt)}</span></div>
        <div class="kv"><span class="muted">Recibido</span><span>${fmtDate(p.receivedAt)}</span></div>
        ${p.note ? `<div class="kv"><span class="muted">Nota</span><span>${esc(p.note)}</span></div>` : ""}
      </div>
      <div class="section"><div class="section-title">Productos</div>
        <div class="card">
          ${p.items.map(it => `<div class="kv"><span>${esc(it.desc)}<br><span class="small muted">${FE.fmtQty(it.qty)} × ${fmt(it.price, p.currency)}${it.discount ? " − " + it.discount + "%" : ""} · ${taxLabel(it.tax)}</span></span><span class="amount">${fmt(calcItem(it, p.currency).total, p.currency)}</span></div>`).join("")}
          <div class="kv"><span><b>Total</b></span><span class="amount">${FE.money(t.total, p.currency)}</span></div>
        </div></div>
      ${p.status === "pendiente" ? `
        <div class="btn-row" style="margin-top:16px">
          <button class="btn" data-rejectped="${esc(p.id)}" style="color:var(--bad)">Rechazar</button>
          <button class="btn primary" data-invoiceped="${esc(p.id)}">Facturar</button>
        </div>` : ""}
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
    return `
      <h2>Ajustes</h2>
      ${section("Sesión", `<div class="card">
          <div class="kv"><span class="muted">Usuario</span><span>${user ? esc(user.name) + " · " + esc(T.ROLES[user.role].label) : "Este dispositivo (sin usuarios)"}</span></div>
          ${T.empresasOf(user).length > 1 ? `<div class="kv"><span class="muted">Empresa</span><span><button class="link" data-switchemp style="min-height:0;padding:0">${esc(company.name)} ▾</button></span></div>` : ""}
          <div class="btn-row" style="margin-top:10px"><button class="btn soft" data-changepin>Cambiar ${user ? "mi " : ""}PIN</button><button class="btn" data-lock>${user ? "Cerrar sesión" : "Bloquear ahora"}</button></div>
          ${can("admin.app") ? `<a class="btn" href="../admin/" style="display:flex;align-items:center;justify-content:center;margin-top:10px;text-decoration:none">Abrir la app Admin</a>` : ""}
        </div>`)}
      ${section("Apariencia", FE.themeHTML())}
      ${section("Empresa", `<div class="card">
          <div class="kv"><span class="muted">Razón social</span><span>${esc(company.name)}</span></div>
          <div class="kv"><span class="muted">RUC</span><span>${esc(company.ruc)}-${esc(company.dv)}</span></div>
          <div class="kv"><span class="muted">Establecimiento y punto</span><span>${esc(company.establishment)}-${esc(company.point)}</span></div>
          <div class="kv"><span class="muted">Próxima factura</span><span>${esc(nextNumberStr())}</span></div>
          <div class="kv"><span class="muted">Logo</span><span style="display:flex;gap:10px;align-items:center">${company.logo ? `<img src="${company.logo}" alt="" style="height:28px;max-width:90px;object-fit:contain">` : `<span class="small muted">Sin logo</span>`}
            ${editCfg ? `<label class="link" style="cursor:pointer">Cargar<input type="file" id="logoFile" accept="image/*" hidden></label>${company.logo ? `<button class="link" data-remove-logo="1">Quitar</button>` : ""}` : ""}</span></div>
          <div class="muted small" style="margin-top:6px">Los datos de la empresa, el certificado y el ambiente los configura el estudio en la app Admin.</div>
        </div>`)}
      ${section("Timbrados", `<div class="card">${T.timbradoListHTML(timbrados, { editable: can("timbrados.editar") })}</div>`)}
      ${section("Productos frecuentes", `<div class="card">
          ${products.length ? products.map(p => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(p.desc)}</div>
            <div class="sub">${p.code ? esc(p.code) + " · " : ""}Gs ${fmt(p.price)} · ${taxLabel(p.tax)}</div></div>
            ${editCfg ? `<span style="display:flex;gap:12px"><button class="link" data-prodedit="${esc(p.id)}">Editar</button><button class="link" data-proddel="${esc(p.id)}" style="color:var(--bad)">Quitar</button></span>` : ""}</div>`).join("")
            : `<div class="muted small">Cargá los productos que más vendés: al facturar los elegís de una lista.</div>`}
          ${editCfg ? `<button class="add" data-prodadd>+ Agregar producto</button>` : ""}
          ${products.length ? `<button class="btn soft" data-catshare style="margin-top:10px">Compartir catálogo con la app Pedidos</button>` : ""}
        </div>`)}
      ${editCfg ? section("Preferencias", `<div class="card">
          <label style="margin-top:0">Condición de venta por defecto</label>
          <div class="seg"><button data-prefcond="contado" class="${prefs.condition === "contado" ? "on" : ""}">Contado</button><button data-prefcond="credito" class="${prefs.condition === "credito" ? "on" : ""}">Crédito</button></div>
          <div class="grid2">
            <div><label for="prCur">Moneda por defecto</label><select id="prCur"><option value="PYG" ${prefs.currency === "PYG" ? "selected" : ""}>Guaraníes</option><option value="USD" ${prefs.currency === "USD" ? "selected" : ""}>Dólares</option></select></div>
            <div><label for="prExch">Tipo de cambio de hoy</label><input id="prExch" inputmode="numeric" placeholder="Ej. 7.800" value="${prefs.exchangeDate === FE.todayKey() ? esc(prefs.exchange) : ""}"></div>
          </div>
          <label for="prFooter">Texto fijo al pie del KuDE (cuentas, condiciones…)</label>
          <textarea id="prFooter" placeholder="Ej. Transferencias: Banco Ejemplo, cuenta 123456">${esc(prefs.footerText)}</textarea>
          <label>Formato de impresión</label>
          <div class="seg"><button data-prefformat="a4" class="${prefs.printFormat === "a4" ? "on" : ""}">Hoja A4</button><button data-prefformat="ticket" class="${prefs.printFormat === "ticket" ? "on" : ""}">Ticket 80 mm</button></div>
          ${T.checkbox("prAutoEmail", prefs.autoEmail, "Enviar la factura por correo al cliente al aprobarse")}
          <div class="muted small" style="margin-top:4px">El envío real del correo lo hará el servidor; por ahora se simula.</div>
          <button class="btn soft" data-saveprefs style="margin-top:12px">Guardar preferencias</button>
        </div>`) : ""}
      ${can("usuarios.empresa") ? section("Usuarios de la empresa", `<div class="card">
          ${empUsers.length ? empUsers.map(u => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(u.name)}${u.active === false ? " (inactivo)" : ""}</div>
            <div class="sub">${esc(T.ROLES[u.role].label)}</div></div><button class="link" data-useredit="${esc(u.id)}">Editar</button></div>`).join("")
            : `<div class="muted small">Sin usuarios. Si agregás uno, cada persona entra con su propio PIN.</div>`}
          <button class="add" data-useradd>+ Agregar usuario</button>
        </div>`) : ""}
      ${section("Certificado y ambiente", `<div class="card">
          <div class="kv"><span class="muted">Certificado</span><span>${esc(cs.text)}</span></div>
          ${company.cert ? `<div class="kv"><span class="muted">Prestador</span><span>${esc(company.cert.prestador || "-")}</span></div>` : ""}
          <div class="kv"><span class="muted">Código de seguridad</span><span>ID ${esc(company.csc)}</span></div>
          <div class="kv"><span class="muted">Ambiente</span><span>${company.env === "prod" ? "Producción" : "Prueba"}</span></div>
          ${can("empresa.ambiente") ? `<div class="seg" style="margin-top:8px"><button data-env="test" class="${company.env === "test" ? "on" : ""}">Prueba</button><button data-env="prod" class="${company.env === "prod" ? "on" : ""}">Producción</button></div>` : ""}
        </div>`)}
      ${section("Clientes frecuentes", `<div class="card">
          ${clients.length ? clients.slice(0, 50).map(c => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(c.name || "Sin nombre")}</div>
            <div class="sub">${c.mode === "con" ? "RUC " : ""}${esc(FE.receiverIdText(c))}</div></div>
            <button class="link" data-delclient="${esc(c.id)}" style="color:var(--bad)">Quitar</button></div>`).join("")
            : `<div class="muted small">Se guardan solos al emitir facturas aprobadas.</div>`}
        </div>`)}
      ${section("Instalar en este dispositivo", `<div class="card">${FE.installHTML("Facturador")}</div>`)}
      ${section("Respaldo", `<div class="card">
          <p class="small muted" style="margin-top:0">Facturas, pedidos, clientes, productos y timbrados de esta empresa se guardan en este dispositivo.</p>
          <div class="btn-row">
            <button class="btn soft" data-backup>Descargar respaldo</button>
            <label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Restaurar<input type="file" id="restoreFile" accept="application/json,.json" hidden></label>
          </div>
        </div>`)}`;
  }

  // Lee el formulario de preferencias (sin guardar), para no perder lo escrito al tocar un botón
  function readPrefsForm() {
    const g = id => document.getElementById(id);
    if (!g("prCur")) return;
    prefs.currency = g("prCur").value;
    const ex = g("prExch").value.trim();
    prefs.exchange = ex; prefs.exchangeDate = ex ? FE.todayKey() : "";
    prefs.footerText = g("prFooter").value.trim().slice(0, 400);
    prefs.autoEmail = g("prAutoEmail").checked;
  }
  // Si el formulario de factura está vacío, toma los valores por defecto nuevos
  function refreshEmptyDraft() {
    const d = state.draft;
    if (!d.items.length && !d.ruc && !d.doc && !d.name && !d.pedidoId) state.draft = newDraft();
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
  const titles = { home: "Inicio", new: "Nueva factura", preview: "Vista previa", result: "Resultado", history: "Historial", detail: "Comprobante",
    settings: "Ajustes", pedidos: "Pedidos", pedido: "Pedido" };
  function render() {
    const s = state.screen;
    const map = { home: screenHome, new: screenNew, preview: screenPreview, result: screenResult, history: screenHistory, detail: screenDetail,
      settings: screenSettings, pedidos: screenPedidos, pedido: screenPedido };
    document.getElementById("screen").innerHTML = (map[s] || screenHome)();
    FE.enhance(document.getElementById("screen"));
    document.getElementById("title").textContent = titles[s] || "Inicio";
    document.querySelectorAll(".tab").forEach(t => {
      const k = t.dataset.go;
      t.classList.toggle("on", s === k || (k === "history" && s === "detail") || (k === "new" && s === "preview") || (k === "pedidos" && s === "pedido"));
    });
    document.getElementById("screen").style.paddingBottom = s === "new" ? "170px" : "130px";
    store.set("draft", state.draft); // el borrador sobrevive si se cierra la app
    companyLine(); window.scrollTo(0, 0);
  }
  function go(s) { if (s !== state.screen) state.q = ""; state.screen = s; render(); }

  function syncFields() {
    const d = state.draft, g = id => document.getElementById(id);
    FE.syncReceiver(d);
    if (g("fEmail")) d.email = g("fEmail").value;
    if (g("fCuotas")) d.installments = Math.max(1, parseInt(g("fCuotas").value, 10) || 1);
    if (g("fCur")) d.currency = g("fCur").value;
    if (g("fTc")) d.exchange = g("fTc").value;
  }
  function refreshTotal() {
    const bar = document.querySelector(".sticky-total"); if (!bar) return;
    const d = state.draft, t = calcItems(d.items, d.currency), r = classify(d, pygOf(d, t));
    bar.querySelector(".big").textContent = FE.money(t.total, d.currency);
    bar.querySelector("[data-preview]").disabled = !(r.valid && d.items.length > 0 && timbradoOk());
  }

  // ----- Cargar / editar timbrado (hoja compartida en shared/tenant.js) -----
  function timbradoSheet(t) {
    if (!can("timbrados.editar")) { toast("Los timbrados los administra el estudio"); return; }
    const used = !!t && (t.used || invoices.some(i => i.kude && i.kude.timbrado && i.kude.timbrado.id === t.id));
    T.timbradoSheet({ list: timbrados, t, used, onSave: (list, msg) => {
      timbrados = list; save(); log(t ? "Timbrado editado" : "Timbrado cargado", msg); toast(msg); render();
    } });
  }

  // ----- Recepción de pedidos por QR -----
  function importPedidoText(text) {
    const res = decodePedido(text);
    if (!res.ok) { toast(res.error); return; }
    const p = res.pedido, now = new Date().toISOString();
    const existing = inbox.find(x => x.id === p.id);
    if (!existing) {
      inbox.push(Object.assign(p, { status: "pendiente", receivedAt: now }));
      save(); log("Pedido recibido", p.id + " · " + p.seller); FE.buzz(); state.pedidoId = p.id; go("pedido"); toast("Pedido cargado: pendiente de facturar");
      return;
    }
    if (p.rev > (existing.rev || 1)) {
      if (existing.status === "facturado") {
        toast("Ese pedido ya está facturado. La versión nueva no se aplicó.");
      } else {
        Object.assign(existing, p, { status: "pendiente", reason: "", receivedAt: now });
        save(); toast("Pedido actualizado a la versión " + p.rev);
      }
    } else {
      toast("Este pedido ya estaba cargado");
    }
    state.pedidoId = existing.id; go("pedido");
  }
  function pasteSheet() {
    sheet(`<h3>Pegar código del pedido</h3><p class="muted small">Si el vendedor te mandó el código como texto, pegalo aquí.</p>
      <textarea id="pCode" placeholder="FEP1.…"></textarea>
      <div class="btn-row" style="margin-top:14px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Cargar pedido</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => { const v = el.querySelector("#pCode").value; close(); importPedidoText(v); };
      setTimeout(() => el.querySelector("#pCode").focus(), 60);
    });
  }
  function rejectSheet(id) {
    sheet(`<h3>Rechazar pedido</h3><p class="muted small">Escribí el motivo. Queda guardado en el pedido.</p>
      <textarea id="rWhy" placeholder="Ej. Sin stock del producto"></textarea>
      <div class="btn-row" style="margin-top:14px"><button class="btn" data-x>Volver</button><button class="btn primary" data-ok style="background:var(--bad);border-color:var(--bad)">Rechazar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const why = el.querySelector("#rWhy").value.trim();
        if (!why) { toast("Escribí el motivo del rechazo"); return; }
        const p = inbox.find(x => x.id === id);
        if (p) { p.status = "rechazado"; p.reason = why; p.rejectedAt = new Date().toISOString(); save(); log("Pedido rechazado", id + " · " + why); }
        close(); render(); toast("Pedido rechazado");
      };
      setTimeout(() => el.querySelector("#rWhy").focus(), 60);
    });
  }
  function draftFromPedido(p) {
    return { pedidoId: p.id, mode: p.client.mode, ruc: p.client.ruc || "", name: p.client.name || "", doc: p.client.doc || "", email: p.client.email || "",
      docType: p.client.docType || "", country: p.client.country || "",
      condition: p.condition, installments: p.installments || 1, currency: p.currency, exchange: p.exchange || "", items: p.items.map(i => Object.assign({}, i)) };
  }
  function useClient(c) {
    const d = state.draft;
    d.mode = c.mode; d.ruc = c.ruc || ""; d.doc = c.doc || ""; d.name = c.name || ""; d.email = c.email || "";
    d.docType = c.docType || ""; d.country = c.country || "";
    render();
  }

  let emitting = false;
  async function emit() {
    const inv = state.preview; if (!inv || emitting) return;
    if (inv.pedidoId) {
      const p = inbox.find(x => x.id === inv.pedidoId);
      if (p && p.status === "facturado") { toast("Ese pedido ya fue facturado (" + p.invoiceNumber + ")"); return; }
    }
    const tim = activeTimbrado();
    if (!timbradoOk() || !tim || (inv.timbrado && inv.timbrado.id !== tim.id)) {
      toast(timbradoProblem() || "Cambió el timbrado activo. Volvé a abrir la vista previa."); return;
    }
    emitting = true;
    try {
      const approved = Math.random() > 0.15; // simulación de la respuesta de SIFEN
      const id = invoices.reduce((m, i) => Math.max(m, i.id), 0) + 1;
      const now = new Date(), date = now.toISOString();
      const issued = Object.assign({}, inv, { issuedAt: FE.localIso(now), dateLabel: now.toLocaleDateString("es-PY") + " " + now.toTimeString().slice(0, 8) });
      let cdc = "", qrUrl = "";
      if (approved) {
        cdc = FE.buildCdc({ deType: "1", ruc: company.ruc, dv: company.dv, establishment: company.establishment, point: company.point,
          number: tim.nextNumber, taxpayerType: company.taxpayerType, date: now, emissionType: "1" });
        const firma = await T.Firmador.firmar({ empresa: company, cdc, payload: { items: issued.items, totals: issued.totals, receiver: issued.receiver } });
        const digest = firma.digestValue;
        qrUrl = await FE.buildQrUrl({ env: company.env, cdc, date: issued.issuedAt, receiver: issued.receiver,
          total: issued.totals.total, iva: issued.totals.iva, items: issued.items.length, digest, csc: FE.CSC_TEST });
      }
      const kude = Object.assign(issued, { cdc, qrUrl });
      const result = {
        id, number: inv.number, date, client: inv.receiverName || "Consumidor final", ruc: inv.receiverId, total: inv.totals.totalPyg,
        currency: inv.currency, totalOp: inv.totals.total,
        operation: inv.operation, status: approved ? "ok" : "bad", cdc,
        reason: approved ? "" : "1103 Número de timbrado no vigente (simulación)", pedidoId: inv.pedidoId, kude
      };
      invoices.unshift(result);
      if (approved) {
        tim.nextNumber += 1; tim.used = true;
        if (prefs.autoEmail && inv.receiverEmail) result.emailedTo = inv.receiverEmail; // el envío real lo hará el servidor
        clients = upsertClient(clients, inv.receiver);
        if (inv.pedidoId) {
          const p = inbox.find(x => x.id === inv.pedidoId);
          if (p) { p.status = "facturado"; p.invoiceNumber = inv.number; p.invoiceId = id; p.invoicedAt = date; }
        }
      }
      save();
      log(approved ? "Factura emitida" : "Factura rechazada (simulación)", inv.number + " · " + (inv.receiverName || "") + " · " + FE.money(inv.totals.total, inv.currency));
      if (approved) FE.buzz(40);
      if (result.emailedTo) toast("Factura enviada por correo a " + result.emailedTo + " (simulado)");
      state.lastResult = result; state.draft = newDraft(); state.preview = null;
      go("result");
    } finally { emitting = false; }
  }

  const screenEl = document.getElementById("screen");
  screenEl.addEventListener("click", e => {
    const t = e.target.closest("button, [data-open], [data-openped]");
    if (!t) return;
    const ds = t.dataset;
    if (ds.go) { go(ds.go); return; }
    if (ds.mode) { syncFields(); state.draft.mode = ds.mode; render(); return; }
    if (ds.cond) { syncFields(); state.draft.condition = ds.cond; render(); return; }
    if (ds.add) { syncFields(); itemSheet(it => { state.draft.items.push(it); render(); }, null, products, state.draft.currency); return; }
    if (ds.edititem !== undefined) { syncFields(); const i = +ds.edititem; itemSheet(it => { state.draft.items[i] = it; render(); }, state.draft.items[i], products, state.draft.currency); return; }
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
      const r = classify(dd, pygOf(dd, tt));
      if (!r.valid) { toast(r.why); return; }
      if (!timbradoOk()) { toast(timbradoProblem()); return; }
      state.preview = buildInvoice(state.draft); go("preview"); return;
    }
    if (ds.back) { go(ds.back); return; }
    if (ds.pdf !== undefined) { downloadKudePdf(prefs.printFormat); return; }
    if (ds.pdfalt !== undefined) { downloadKudePdf(prefs.printFormat === "ticket" ? "a4" : "ticket"); return; }
    if (ds.removeLogo !== undefined) { company.logo = null; save(); toast("Logo quitado"); render(); return; }
    if (ds.emit) { emit(); return; }
    if (ds.open) { state.detailId = +ds.open; go("detail"); return; }
    if (ds.filter) { state.filter = ds.filter; render(); return; }
    if (ds.share) { toast(ds.share === "pdf" ? "PDF listo (demo)" : "Factura enviada por correo (demo)"); return; }
    if (ds.cancel) {
      const inv = invoices.find(x => x.id === +ds.cancel);
      if (inv && !canCancel(inv)) { toast("Pasaron las 48 horas: emití una nota de crédito"); render(); return; }
      if (inv) { inv.status = "bad"; inv.cancelled = true; inv.reason = "Cancelada por el emisor (demo)"; save(); log("Factura cancelada", inv.number); toast("Cancelación registrada (demo)"); }
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
      confirmSheet("¿Eliminar el pedido?", "Se borra de este dispositivo.", "Eliminar", () => {
        inbox = inbox.filter(x => x.id !== ds.delped); save(); go("pedidos"); toast("Pedido eliminado");
      }, true);
      return;
    }
    if (ds.invoiceped) {
      const p = inbox.find(x => x.id === ds.invoiceped); if (!p) return;
      state.draft = draftFromPedido(p); state.preview = null; go("new"); return;
    }
    // Ajustes
    if (ds.timadd !== undefined) { timbradoSheet(null); return; }
    if (ds.timedit) { timbradoSheet(timbrados.find(t => t.id === ds.timedit)); return; }
    if (ds.timact) {
      const t = timbrados.find(x => x.id === ds.timact); if (!t) return;
      if (timbradoStatus(t) === "vencido") { toast("Ese timbrado está vencido"); return; }
      if (!can("timbrados.editar")) { toast("Los timbrados los administra el estudio"); return; }
      confirmSheet("¿Activar el timbrado " + t.number + "?", "Desde ahora las facturas se emiten con este timbrado. El que estaba activo queda guardado como inactivo.", "Activar", () => {
        T.activateTimbrado(timbrados, t.id); save(); log("Timbrado activado", t.number); render(); toast("Timbrado " + t.number + " activo");
      });
      return;
    }
    if (ds.delclient) { clients = clients.filter(x => x.id !== ds.delclient); save(); render(); return; }
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
      T.userSheet({ user: u, roles: ["facturador", "cargador", "admincliente"], fixedEmpresa: company.id, empresas: [],
        onSave: (list, saved) => { log(u ? "Usuario editado" : "Usuario creado", saved.name + " · " + T.ROLES[saved.role].label); render(); } });
      return;
    }
    if (ds.themeSet) { FE.setTheme(ds.themeSet); render(); return; }
    if (ds.install !== undefined) { FE.promptInstall(); return; }
    if (ds.backup !== undefined) { FE.exportBackup(store, "facturador"); return; }
  });

  screenEl.addEventListener("input", e => {
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
    } else refreshTotal();
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
  async function downloadKudePdf(format) {
    const inv = state.screen === "preview" ? state.preview : ((invoices.find(x => x.id === state.detailId) || {}).kude);
    if (!inv) { toast("No hay datos para generar el PDF"); return; }
    if (!window.KudePdf || !window.jspdf) { toast("No se pudo cargar el generador de PDF. Se abre la impresión"); window.print(); return; }
    try {
      toast("Generando PDF…");
      await KudePdf.save(inv, company, { consultUrl: consultUrl(), qrText: inv.qrUrl || "", timbradoLines: timbradoLines(inv),
        footerText: prefs.footerText, format: format || prefs.printFormat });
      toast("PDF descargado");
    } catch (err) {
      console.error(err);
      toast("No se pudo generar el PDF. Se abre la impresión: elegí Guardar como PDF");
      window.print();
    }
  }

  document.querySelector(".tabbar").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });
  screenEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.dataset && (e.target.dataset.open || e.target.dataset.openped)) { e.preventDefault(); e.target.click(); }
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
    return { init, lockNow, change };
  })();

  // ================= Acceso: usuarios con PIN o PIN del dispositivo =================
  // Si hay usuarios con acceso a esta empresa, cada uno entra con su PIN y sus permisos.
  // Si no hay ninguno, se usa el PIN del dispositivo como antes (todo permitido).
  const LOGIN_ROLES = ["maestro", "operador", "admincliente", "facturador"];
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
