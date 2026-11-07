/* App Facturador (principal): factura, recibe pedidos por QR y decide si facturarlos.
   Basada en facturador-prueba-local.html. Todo se guarda en este dispositivo. */
(function () {
  "use strict";
  const { fmt, esc, fmtDate, classify, opName, calcItem, calcItems, taxLabel, toast, sheet, confirmSheet, itemSheet,
    upsertClient, clientPicker, decodePedido, readQrFromFile, openScanner, parseRuc } = FE;
  const store = FE.makeStore("fac_");

  // ================= Datos de ejemplo (ficticios) la primera vez =================
  const defaultCompany = {
    name: "Comercial Ejemplo S.A.", fantasy: "Ejemplo Store", ruc: "80012345", dv: "0",
    activity: "Venta al por menor de artículos de librería", address: "Av. Principal Nº 1234",
    city: "Asunción", phone: "021 000 000", mail: "facturacion@ejemplo.com.py",
    timbrado: "00000000", start: "01/11/2026", end: "31/10/2027",
    establishment: "001", point: "001", leftToUse: 320, env: "test", certExpires: "15/03/2027", csc: "0001", logo: null,
    nextNumber: 13, taxpayerType: "2" // 1 persona física, 2 persona jurídica (posición 25 del CDC)
  };
  const seedInvoices = [
    { id: 1, number: "001-001-0000012", date: "2026-11-04T16:22:48", client: "Juan Pérez", ruc: "4567890-1", total: 129000, status: "ok", cdc: "0180 0123 4500 0100 1000 0012 2202 6110 4141 7392 8510", operation: "B2B" },
    { id: 2, number: "001-001-0000011", date: "2026-11-03T09:05:00", client: "Consumidor final", ruc: "", total: 42000, status: "warn", cdc: "", operation: "B2C" },
    { id: 3, number: "001-001-0000010", date: "2026-11-02T16:40:00", client: "Librería Central S.A.", ruc: "80098765-9", total: 1250000, status: "bad", cdc: "", operation: "B2B", reason: "1103 Número de timbrado no vigente" },
    { id: 4, number: "001-001-0000009", date: "2026-11-02T11:12:00", client: "María Gómez", ruc: "3210987-3", total: 96800, status: "ok", cdc: "", operation: "B2B" }
  ];
  const company = Object.assign({}, defaultCompany, store.get("company", {}));
  let invoices = store.get("invoices", null) || seedInvoices;
  let inbox = store.get("pedidos", []);      // pedidos recibidos por QR
  let clients = store.get("clients", []);
  const save = () => { store.set("company", company); store.set("invoices", invoices); store.set("pedidos", inbox); store.set("clients", clients); };
  save();

  // ================= Estado =================
  const state = { screen: "home", filter: "all", detailId: null, lastResult: null, draft: newDraft(), preview: null,
    pedFilter: "pendiente", pedSeller: "", pedidoId: null };
  function newDraft() {
    return { pedidoId: null, mode: "con", ruc: "", name: "", doc: "", docType: "1", country: "", email: "", condition: "contado", installments: 1,
      currency: "PYG", exchange: "", items: [] };
  }
  const nextNumberStr = () => company.establishment + "-" + company.point + "-" + String(company.nextNumber).padStart(7, "0");

  // ================= Utilidades de interfaz =================
  const statusChip = s => s === "ok" ? '<span class="chip ok">Aprobada</span>' : s === "bad" ? '<span class="chip bad">Rechazada</span>' : '<span class="chip warn">Pendiente</span>';
  const pedChip = s => s === "facturado" ? '<span class="chip ok">Facturado</span>' : s === "rechazado" ? '<span class="chip bad">Rechazado</span>' : '<span class="chip warn">Pendiente de facturar</span>';
  const pedClient = p => FE.receiverDisplayName(p.client);
  const pendingCount = () => inbox.filter(p => p.status === "pendiente").length;
  function companyLine() {
    document.getElementById("companyLine").textContent = company.name + " · RUC " + company.ruc + "-" + company.dv;
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
      ${pp ? `<div class="notice warn"><b>Tenés ${pp} pedido(s) pendiente(s) de facturar</b>Abrí Pedidos para revisarlos y decidir.</div>` : ""}
      ${rejected ? `<div class="notice bad"><b>Hay ${rejected} factura(s) rechazada(s)</b>Abrila en el historial para ver el motivo y corregirla.</div>` : ""}
      <div class="notice ok"><b>Te quedan ${company.leftToUse} números</b>Todavía tenés numeración disponible en el timbrado ${esc(company.timbrado)}.</div>
      <div class="section">
        <div class="section-title">Últimos comprobantes</div>
        <div class="card">${invoices.slice(0, 4).map(rowInvoice).join("") || `<div class="muted small">Sin comprobantes.</div>`}</div>
      </div>`;
  }
  function rowInvoice(i) {
    return `<div class="row" data-open="${i.id}" role="button" tabindex="0">
      <div class="main"><div class="title">${esc(i.client)}</div><div class="sub">${esc(i.number)} · ${fmtDate(i.date)}</div></div>
      <div style="text-align:right"><div class="amount">Gs ${fmt(i.total)}</div><div style="margin-top:4px">${statusChip(i.status)}</div></div>
    </div>`;
  }

  function screenNew() {
    const d = state.draft, t = calcItems(d.items), r = classify(d, t.total);
    const hasItems = d.items.length > 0;
    const canPreview = r.valid && hasItems;
    const ped = d.pedidoId ? inbox.find(p => p.id === d.pedidoId) : null;
    return `
      ${ped ? `<div class="notice ok" style="margin-top:0"><b>Facturando el pedido ${esc(ped.id)}</b>Cargado por ${esc(ped.seller)}. Revisá los datos y emití.
        <button class="link" data-unlinkped style="display:block;padding:4px 0 0;min-height:0">Quitar vínculo con el pedido</button></div>` : ""}
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
            d.items.map((it, idx) => { const c = calcItem(it); return `<div class="item">
              <div class="desc">${esc(it.desc)}</div><div class="amount">Gs ${fmt(c.total)}</div>
              <div class="calc">${it.qty} × Gs ${fmt(it.price)}${it.discount ? " − " + it.discount + "%" : ""} · ${taxLabel(it.tax)}
                · <button class="link" data-edititem="${idx}" style="min-height:0;padding:0;font-size:13px">Editar</button></div>
              <button class="del" data-del="${idx}">Quitar</button></div>`; }).join("")}
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
          <span class="big">${d.currency === "USD" ? "USD " : "Gs "}${fmt(t.total)}</span></div>
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
    const T = inv.totals;
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
          <div style="margin-top:4px">Timbrado Nº: ${esc(company.timbrado)}<br>Inicio de vigencia: ${esc(company.start)}<br>Fin de vigencia: ${esc(company.end)}</div>
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
            ${inv.items.map((it, i) => { const c = calcItem(it); return `<tr>
              <td>INF${String(i + 1).padStart(3, "0")}</td><td>${esc(it.desc)}</td><td>UNI</td>
              <td class="n">${it.qty}</td><td class="n">${fmt(it.price)}</td><td class="n">${it.discount ? it.discount + "%" : "0"}</td>
              <td class="n">${it.tax === "E" ? fmt(c.total) : "0"}</td><td class="n">${it.tax === "5" ? fmt(c.total) : "0"}</td><td class="n">${it.tax === "10" ? fmt(c.total) : "0"}</td></tr>`; }).join("")}
            <tr class="tot-row"><td colspan="6">SUBTOTAL</td><td class="n">${fmt(T.exe)}</td><td class="n">${fmt(T.b5)}</td><td class="n">${fmt(T.b10)}</td></tr>
            <tr class="tot-row"><td colspan="8">TOTAL DE LA OPERACIÓN</td><td class="n">${fmt(T.total)}</td></tr>
            <tr class="tot-row"><td colspan="8">TOTAL EN GUARANÍES</td><td class="n">${fmt(isUSD ? T.totalPyg : T.total)}</td></tr>
          </tbody>
        </table>
        <div class="klist">
          ${inv.items.map((it, i) => { const c = calcItem(it); return `<div class="ki">
            <div class="ki-top"><span class="ki-cod">INF${String(i + 1).padStart(3, "0")}</span><b>${esc(it.desc)}</b></div>
            <div class="ki-row"><span>${it.qty} UNI × ${fmt(it.price)}</span><span class="lbl">Desc. ${it.discount ? it.discount + "%" : "0"}</span></div>
            <div class="ki-row"><span class="lbl">${it.tax === "E" ? "Exentas" : it.tax === "5" ? "Gravadas 5%" : "Gravadas 10%"}</span><b>${fmt(c.total)}</b></div>
          </div>`; }).join("")}
          <div class="kt"><span>Subtotal exentas</span><span>${fmt(T.exe)}</span></div>
          <div class="kt"><span>Subtotal 5%</span><span>${fmt(T.b5)}</span></div>
          <div class="kt"><span>Subtotal 10%</span><span>${fmt(T.b10)}</span></div>
          <div class="kt b"><span>TOTAL DE LA OPERACIÓN</span><span>${fmt(T.total)}</span></div>
          <div class="kt b"><span>TOTAL EN GUARANÍES</span><span>${fmt(isUSD ? T.totalPyg : T.total)}</span></div>
        </div>
        </div><div class="liq" style="padding:6px 8px 8px;"><span>LIQUIDACIÓN IVA</span><span>(5%) ${fmt(T.iva5)}</span><span>(10%) ${fmt(T.iva10)}</span><span>TOTAL IVA ${fmt(T.iva)}</span></div>
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
      ${test ? `<div class="note">Prueba: IdCSC ${esc(company.csc)} con CSC de prueba del manual · Datos ficticios, no es un documento tributario.</div>` : ""}
    </div>`;
  }

  function buildInvoice(d) {
    const t = calcItems(d.items), r = classify(d, t.total), now = new Date();
    const receiver = FE.receiverFromDraft(d, r);
    return {
      number: nextNumberStr(),
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
        totalPyg: d.currency === "USD" && d.exchange ? Math.round(t.total * (parseFloat(String(d.exchange).replace(/\./g, "").replace(",", ".")) || 0)) : t.total },
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
        <div class="amount" style="font-size:22px;margin-top:6px">Gs ${fmt(r.total)}</div>
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
    const list = invoices.filter(i => state.filter === "all" || i.status === state.filter);
    const count = k => k === "all" ? invoices.length : invoices.filter(i => i.status === k).length;
    const seg = (k, label) => `<button data-filter="${k}" class="${state.filter === k ? "on" : ""}">${label} · ${count(k)}</button>`;
    return `
      <h2>Historial</h2>
      <div class="seg">${seg("all", "Todas")}${seg("ok", "Aprobadas")}${seg("warn", "Pendientes")}${seg("bad", "Rechazadas")}</div>
      <div class="card" style="margin-top:12px">
        ${list.length ? list.map(rowInvoice).join("") : `<div class="muted small">No hay comprobantes en este filtro.</div>`}
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
        <div class="kv"><span class="muted">Total</span><span class="amount">Gs ${fmt(i.total)}</span></div>
        ${i.cdc ? `<div style="padding:12px 0;border-top:1px solid var(--border)"><div class="muted small">CDC</div><div class="small cdc-text" style="margin-top:4px">${esc(FE.formatCdc(i.cdc))}</div></div>` : ""}
        ${i.reason ? `<div style="padding:12px 0;border-top:1px solid var(--border)"><div class="muted small">Motivo</div><div style="margin-top:4px;color:var(--bad)">${esc(i.reason)}</div></div>` : ""}
      </div>
      ${i.kude ? `<div class="section"><div class="section-title">KuDE</div>${kudeHTML(i.kude)}</div>` : ""}
      <div class="btn-row" style="margin-top:16px">
        <button class="btn soft" ${i.kude ? `data-pdf="${esc(i.number)}"` : `data-share="pdf"`} ${i.status === "ok" ? "" : "disabled"}>Descargar PDF</button>
        <button class="btn soft" data-share="mail" ${i.status === "ok" ? "" : "disabled"}>Enviar por correo</button>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" data-cancel="${i.id}" ${canCancel(i) ? "" : "disabled"}>Cancelar factura</button>
        <button class="btn primary" data-go="new">Nueva factura</button>
      </div>
      <div class="muted small" style="margin-top:12px">${i.status === "ok"
        ? (canCancel(i) ? "Podés cancelarla hasta el " + fmtDate(new Date(Date.parse(i.date) + CANCEL_MS).toISOString()) + " (48 horas desde la aprobación)."
          : "Pasaron las 48 horas para cancelarla. Para corregirla, emití una nota de crédito.")
        : "Podés cancelar hasta 48 horas después de la aprobación. Después, emití una nota de crédito."}</div>`;
  }

  // ----- Pedidos recibidos -----
  function screenPedidos() {
    const sellers = [...new Set(inbox.map(p => p.seller).filter(Boolean))].sort();
    const bySeller = inbox.filter(p => !state.pedSeller || p.seller === state.pedSeller);
    const list = bySeller.filter(p => state.pedFilter === "all" || p.status === state.pedFilter)
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
        <div class="seg">${seg("pendiente", "Pendientes")}${seg("facturado", "Facturados")}${seg("rechazado", "Rechazados")}${seg("all", "Todos")}</div>
        ${sellers.length > 1 ? `<label for="pSeller">Vendedor</label><select id="pSeller" class="inline"><option value="">Todos los vendedores</option>
          ${sellers.map(s => `<option value="${esc(s)}" ${state.pedSeller === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
        <div class="card" style="margin-top:12px">
          ${list.length ? list.map(p => `<div class="row" data-openped="${esc(p.id)}" role="button" tabindex="0">
            <div class="main"><div class="title">${esc(pedClient(p))}</div><div class="sub">${esc(p.id)} · ${esc(p.seller)} · ${fmtDate(p.updatedAt || p.createdAt)}</div></div>
            <div style="text-align:right"><div class="amount">${p.currency === "USD" ? "USD" : "Gs"} ${fmt(calcItems(p.items).total)}</div><div style="margin-top:4px">${pedChip(p.status)}</div></div>
          </div>`).join("") : `<div class="muted small">No hay pedidos en este filtro.</div>`}
        </div>
      </div>`;
  }

  function screenPedido() {
    const p = inbox.find(x => x.id === state.pedidoId);
    if (!p) return screenPedidos();
    const t = calcItems(p.items), r = classify(p.client, t.total);
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
          ${p.items.map(it => `<div class="kv"><span>${esc(it.desc)}<br><span class="small muted">${it.qty} × ${fmt(it.price)}${it.discount ? " − " + it.discount + "%" : ""} · ${taxLabel(it.tax)}</span></span><span class="amount">${fmt(calcItem(it).total)}</span></div>`).join("")}
          <div class="kv"><span><b>Total</b></span><span class="amount">${p.currency === "USD" ? "USD" : "Gs"} ${fmt(t.total)}</span></div>
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
    return `
      <h2>Ajustes</h2>
      <div class="section"><div class="section-title">Apariencia</div>${FE.themeHTML()}</div>
      <div class="section"><div class="section-title">Empresa</div>
        <div class="card">
          <div class="kv"><span class="muted">Razón social</span><span>${esc(company.name)}</span></div>
          <div class="kv"><span class="muted">RUC</span><span>${esc(company.ruc)}-${esc(company.dv)}</span></div>
          <div class="kv"><span class="muted">Establecimiento y punto</span><span>${esc(company.establishment)}-${esc(company.point)}</span></div>
          <div class="kv"><span class="muted">Próxima factura</span><span>${esc(nextNumberStr())}</span></div>
          <div class="kv"><span class="muted">Logo</span><span style="display:flex;gap:10px;align-items:center">${company.logo ? `<img src="${company.logo}" alt="" style="height:28px;max-width:90px;object-fit:contain">` : `<span class="small muted">Sin logo</span>`}<label class="link" style="cursor:pointer">Cargar<input type="file" id="logoFile" accept="image/*" hidden></label>${company.logo ? `<button class="link" data-remove-logo="1">Quitar</button>` : ""}</span></div>
        </div></div>
      <div class="section"><div class="section-title">Timbrado y certificado</div>
        <div class="card">
          <div class="kv"><span class="muted">Timbrado Nº</span><span>${esc(company.timbrado)}</span></div>
          <div class="kv"><span class="muted">Números disponibles</span><span>${company.leftToUse}</span></div>
          <div class="kv"><span class="muted">Certificado vence</span><span>${esc(company.certExpires)}</span></div>
          <div class="kv"><span class="muted">Código de seguridad</span><span>Activo · ID ${esc(company.csc)}</span></div>
        </div></div>
      <div class="section"><div class="section-title">Clientes frecuentes</div>
        <div class="card">
          ${clients.length ? clients.slice(0, 50).map(c => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(c.name || "Sin nombre")}</div>
            <div class="sub">${c.mode === "con" ? "RUC " + esc(c.ruc) : "Doc. " + esc(c.doc || "-")}</div></div>
            <button class="link" data-delclient="${esc(c.id)}" style="color:var(--bad)">Quitar</button></div>`).join("")
            : `<div class="muted small">Se guardan solos al emitir facturas aprobadas.</div>`}
        </div></div>
      <div class="section"><div class="section-title">Instalar en este dispositivo</div>
        <div class="card">${FE.installHTML("Facturador")}</div></div>
      <div class="section"><div class="section-title">Seguridad</div>
        <div class="btn-row"><button class="btn soft" data-changepin>Cambiar PIN</button><button class="btn" data-lock>Bloquear ahora</button></div>
      </div>
      <div class="section"><div class="section-title">Respaldo</div>
        <div class="card">
          <p class="small muted" style="margin-top:0">Facturas, pedidos y clientes se guardan solo en este dispositivo.</p>
          <div class="btn-row">
            <button class="btn soft" data-backup>Descargar respaldo</button>
            <label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Restaurar<input type="file" id="restoreFile" accept="application/json,.json" hidden></label>
          </div>
        </div></div>
      <div class="section"><div class="section-title">Ambiente</div>
        <div class="seg"><button data-env="test" class="${company.env === "test" ? "on" : ""}">Prueba</button><button data-env="prod" class="${company.env === "prod" ? "on" : ""}">Producción</button></div>
        <div class="muted small" style="margin-top:8px">Usá prueba hasta completar las pruebas de la DNIT.</div>
      </div>`;
  }

  // ================= Render y eventos =================
  const titles = { home: "Inicio", new: "Nueva factura", preview: "Vista previa", result: "Resultado", history: "Historial", detail: "Comprobante",
    settings: "Ajustes", pedidos: "Pedidos", pedido: "Pedido" };
  function render() {
    const s = state.screen;
    const map = { home: screenHome, new: screenNew, preview: screenPreview, result: screenResult, history: screenHistory, detail: screenDetail,
      settings: screenSettings, pedidos: screenPedidos, pedido: screenPedido };
    document.getElementById("screen").innerHTML = (map[s] || screenHome)();
    document.getElementById("title").textContent = titles[s] || "Inicio";
    document.querySelectorAll(".tab").forEach(t => {
      const k = t.dataset.go;
      t.classList.toggle("on", s === k || (k === "history" && s === "detail") || (k === "new" && s === "preview") || (k === "pedidos" && s === "pedido"));
    });
    document.getElementById("screen").style.paddingBottom = s === "new" ? "170px" : "130px";
    companyLine(); window.scrollTo(0, 0);
  }
  function go(s) { state.screen = s; render(); }

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
    const d = state.draft, t = calcItems(d.items), r = classify(d, t.total);
    bar.querySelector(".big").textContent = (d.currency === "USD" ? "USD " : "Gs ") + fmt(t.total);
    bar.querySelector("[data-preview]").disabled = !(r.valid && d.items.length > 0);
  }

  // ----- Recepción de pedidos por QR -----
  function importPedidoText(text) {
    const res = decodePedido(text);
    if (!res.ok) { toast(res.error); return; }
    const p = res.pedido, now = new Date().toISOString();
    const existing = inbox.find(x => x.id === p.id);
    if (!existing) {
      inbox.push(Object.assign(p, { status: "pendiente", receivedAt: now }));
      save(); state.pedidoId = p.id; go("pedido"); toast("Pedido cargado: pendiente de facturar");
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
        if (p) { p.status = "rechazado"; p.reason = why; p.rejectedAt = new Date().toISOString(); save(); }
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
    emitting = true;
    try {
      const approved = Math.random() > 0.15; // simulación de la respuesta de SIFEN
      const id = invoices.reduce((m, i) => Math.max(m, i.id), 0) + 1;
      const now = new Date(), date = now.toISOString();
      const issued = Object.assign({}, inv, { issuedAt: FE.localIso(now), dateLabel: now.toLocaleDateString("es-PY") + " " + now.toTimeString().slice(0, 8) });
      let cdc = "", qrUrl = "";
      if (approved) {
        cdc = FE.buildCdc({ deType: "1", ruc: company.ruc, dv: company.dv, establishment: company.establishment, point: company.point,
          number: company.nextNumber, taxpayerType: company.taxpayerType, date: now, emissionType: "1" });
        const digest = await FE.simulatedDigest({ cdc, items: issued.items, totals: issued.totals, receiver: issued.receiver });
        qrUrl = await FE.buildQrUrl({ env: company.env, cdc, date: issued.issuedAt, receiver: issued.receiver,
          total: issued.totals.total, iva: issued.totals.iva, items: issued.items.length, digest, csc: FE.CSC_TEST });
      }
      const kude = Object.assign(issued, { cdc, qrUrl });
      const result = {
        id, number: inv.number, date, client: inv.receiverName || "Consumidor final", ruc: inv.receiverId, total: inv.totals.total,
        operation: inv.operation, status: approved ? "ok" : "bad", cdc,
        reason: approved ? "" : "1103 Número de timbrado no vigente (simulación)", pedidoId: inv.pedidoId, kude
      };
      invoices.unshift(result);
      if (approved) {
        company.nextNumber += 1; company.leftToUse = Math.max(0, company.leftToUse - 1);
        clients = upsertClient(clients, inv.receiver);
        if (inv.pedidoId) {
          const p = inbox.find(x => x.id === inv.pedidoId);
          if (p) { p.status = "facturado"; p.invoiceNumber = inv.number; p.invoiceId = id; p.invoicedAt = date; }
        }
      }
      save();
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
    if (ds.add) { syncFields(); itemSheet(it => { state.draft.items.push(it); render(); }); return; }
    if (ds.edititem !== undefined) { syncFields(); const i = +ds.edititem; itemSheet(it => { state.draft.items[i] = it; render(); }, state.draft.items[i]); return; }
    if (ds.del !== undefined) { syncFields(); state.draft.items.splice(+ds.del, 1); render(); return; }
    if (ds.pickclient !== undefined) { syncFields(); clientPicker(clients, useClient); return; }
    if (ds.unlinkped !== undefined) { syncFields(); state.draft.pedidoId = null; render(); return; }
    if (ds.preview) {
      syncFields();
      const r = classify(state.draft, calcItems(state.draft.items).total);
      if (!r.valid) { toast(r.why); return; }
      state.preview = buildInvoice(state.draft); go("preview"); return;
    }
    if (ds.back) { go(ds.back); return; }
    if (ds.pdf !== undefined) { downloadKudePdf(); return; }
    if (ds.removeLogo !== undefined) { company.logo = null; save(); toast("Logo quitado"); render(); return; }
    if (ds.emit) { emit(); return; }
    if (ds.open) { state.detailId = +ds.open; go("detail"); return; }
    if (ds.filter) { state.filter = ds.filter; render(); return; }
    if (ds.share) { toast(ds.share === "pdf" ? "PDF listo (demo)" : "Factura enviada por correo (demo)"); return; }
    if (ds.cancel) {
      const inv = invoices.find(x => x.id === +ds.cancel);
      if (inv && !canCancel(inv)) { toast("Pasaron las 48 horas: emití una nota de crédito"); render(); return; }
      if (inv) { inv.status = "bad"; inv.reason = "Cancelada por el emisor (demo)"; save(); toast("Cancelación registrada (demo)"); }
      render(); return;
    }
    if (ds.env) { company.env = ds.env; save(); toast("Ambiente: " + (company.env === "test" ? "prueba" : "producción")); render(); return; }
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
    if (ds.delclient) { clients = clients.filter(x => x.id !== ds.delclient); save(); render(); return; }
    if (ds.changepin !== undefined) { Lock.change(); return; }
    if (ds.lock !== undefined) { Lock.lockNow(); return; }
    if (ds.themeSet) { FE.setTheme(ds.themeSet); render(); return; }
    if (ds.install !== undefined) { FE.promptInstall(); return; }
    if (ds.backup !== undefined) { FE.exportBackup(store, "facturador"); return; }
  });

  screenEl.addEventListener("input", e => {
    if (state.screen !== "new") return;
    syncFields();
    const id = e.target.id, pos = e.target.selectionStart;
    if (FE.receiverLiveIds(state.draft.mode).includes(id)) {
      render();
      const el = document.getElementById(id);
      if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} }
    } else refreshTotal();
  });
  screenEl.addEventListener("change", e => {
    const id = e.target.id;
    if (id === "logoFile") { loadLogo(e.target.files && e.target.files[0]); return; }
    if (id === "qrFile") {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      toast("Leyendo el QR…");
      readQrFromFile(f).then(importPedidoText).catch(err => toast(err.message));
      return;
    }
    if (id === "restoreFile") { const f = e.target.files && e.target.files[0]; if (f) FE.importBackup(store, "facturador", f, () => location.reload()); return; }
    if (id === "pSeller") { state.pedSeller = e.target.value; render(); return; }
    if (state.screen === "new") { syncFields(); if (e.target.tagName === "SELECT") render(); }
  });

  function loadLogo(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|svg\+xml|webp)$/.test(file.type)) { toast("Elegí una imagen PNG, JPG o SVG"); return; }
    if (file.size > 2 * 1024 * 1024) { toast("La imagen supera 2 MB. Usá una más liviana"); return; }
    const reader = new FileReader();
    reader.onload = () => { company.logo = reader.result; save(); toast("Logo cargado"); render(); };
    reader.onerror = () => toast("No se pudo leer la imagen");
    reader.readAsDataURL(file);
  }

  // PDF del KuDE con texto real (seleccionable y buscable), dibujado con jsPDF a partir de los datos.
  async function downloadKudePdf() {
    const inv = state.screen === "preview" ? state.preview : ((invoices.find(x => x.id === state.detailId) || {}).kude);
    if (!inv) { toast("No hay datos para generar el PDF"); return; }
    if (!window.KudePdf || !window.jspdf) { toast("No se pudo cargar el generador de PDF. Se abre la impresión"); window.print(); return; }
    try {
      toast("Generando PDF…");
      await KudePdf.save(inv, company, { consultUrl: consultUrl(), qrText: inv.qrUrl || "" });
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
    const LOCK_AFTER_MS = 5 * 60 * 1000;
    async function hash(pin) {
      const text = "factura-elect:" + pin;
      if (window.crypto && crypto.subtle && window.isSecureContext) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return "s256:" + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
      }
      return "fnv:" + FE.fnv32(text) + FE.fnv32(text.split("").reverse().join(""));
    }
    async function check(pin) {
      const saved = store.get("pin", null); if (!saved) return false;
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
          store.set("pin", await hash(a)); setUnlocked(true); el.remove(); toast("PIN guardado");
        } else if (await check(a)) { setUnlocked(true); el.remove(); }
        else { p1.value = ""; toast("PIN incorrecto"); }
      };
      el.querySelector("#pinOk").onclick = submit;
      el.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
      const forgot = el.querySelector("#pinForgot");
      if (forgot) forgot.onclick = () => confirmSheet("¿Olvidaste el PIN?",
        "Para crear uno nuevo hay que borrar los datos del Facturador en este dispositivo (facturas, pedidos y clientes). Si tenés un respaldo, lo podés restaurar después.",
        "Borrar y empezar de nuevo", () => { store.keys().forEach(k => store.remove(k)); setUnlocked(false); location.reload(); }, true);
      setTimeout(() => p1.focus(), 60);
    }
    function init() {
      if (!store.get("pin", null)) { overlay(true); return; }
      if (!unlocked()) overlay(false);
      let hiddenAt = 0;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) hiddenAt = Date.now();
        else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) lockNow();
      });
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
          store.set("pin", await hash(n)); close(); toast("PIN cambiado");
        };
      });
    }
    return { init, lockNow, change };
  })();

  render();
  FE.onInstallChange(() => { if (state.screen === "settings") render(); });
  Lock.init();
  FE.registerSW();
})();
