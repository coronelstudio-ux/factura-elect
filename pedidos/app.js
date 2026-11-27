/* App Pedidos: el vendedor crea notas de pedido por pasos, le envía el PDF al cliente y las comparte por QR con el facturador.
   No ve ni genera facturas. */
(function () {
  "use strict";
  const { fmt, esc, fmtDate, classify, opName, calcItem, calcItems, taxLabel, toast, sheet, confirmSheet, itemSheet,
    upsertClient, clientPicker, encodePedido, qrCanvas, shareCanvas, copyText, parseRuc } = FE;
  const store = FE.makeStore("ped_");

  // ================= Estado persistente =================
  const settings = Object.assign({ seller: "", deviceId: FE.randomId(4), seq: 0 }, store.get("settings", {}));
  store.set("settings", settings);
  let pedidos = store.get("pedidos", []);
  let clients = store.get("clients", []);
  // Catálogo de productos que comparte el facturador (por QR o código)
  let catalog = store.get("catalog", { empresa: "", products: [], loadedAt: "" });
  const save = () => { store.set("pedidos", pedidos); store.set("clients", clients); store.set("settings", settings); store.set("catalog", catalog); };

  const state = { screen: "list", detailId: null, filter: "all", wq: "", wmanual: false, draft: Object.assign(newDraft(), store.get("draft", null) || {}) };
  // Total en guaraníes para el límite de innominado (en dólares, con el tipo de cambio si lo cargó)
  const pygOf = (d, t) => { const v = FE.pygTotal(t.total, d.currency, d.exchange); return v == null ? 0 : v; };
  function newDraft() {
    return { editId: null, step: 0, mode: "con", ruc: "", name: "", doc: "", docType: "1", country: "", email: "", address: "", phone: "",
      condition: "contado", installments: 1, currency: "PYG", exchange: "", note: "", items: [] };
  }
  const saveDraft = () => store.set("draft", state.draft);

  // ================= Pantallas =================
  // Nota de pedido por pasos, como la emisión del Facturador: cliente → productos → condición y nota → revisión
  const STEPS = ["cliente", "productos", "pago", "revision"];
  const STEP_Q = {
    cliente: ["Cliente", "Clientes frecuentes, búsqueda por RUC u otras opciones."],
    productos: ["Productos", "Productos del catálogo o carga de uno nuevo."],
    pago: ["Condición de venta", "Condición, moneda y una nota para el facturador."],
    revision: ["Revisión", "Cada línea abre su paso para corregirlo. Al guardar, el PDF queda listo para enviar al cliente."]
  };
  const stepKey = d => STEPS[Math.min(Math.max(d.step || 0, 0), STEPS.length - 1)];
  const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
  function stepCheck(d, key) {
    const t = calcItems(d.items, d.currency), r = classify(d, pygOf(d, t));
    const cli = r.valid && (d.mode !== "con" || String(d.ruc || "").trim()) ? { ok: true } : { ok: false, why: d.mode === "con" && !String(d.ruc || "").trim() ? "Falta el cliente" : r.why };
    if (key === "cliente") return cli;
    const prod = d.items.length ? { ok: true } : { ok: false, why: "Falta agregar al menos un producto" };
    if (key === "productos") return prod;
    const pago = d.currency === "USD" && FE.pygTotal(t.total, "USD", d.exchange) == null ? { ok: false, why: "Falta el tipo de cambio" } : { ok: true };
    if (key === "pago") return pago;
    return !cli.ok ? cli : !prod.ok ? prod : pago;
  }
  function screenNew() {
    const d = state.draft, key = stepKey(d), n = STEPS.length, chk = stepCheck(d, key), last = key === "revision";
    const body = { cliente: flowCliente, productos: flowProductos, pago: flowPago, revision: flowRevision }[key](d);
    return `
      <div class="flow">
        <div class="flow-head">
          <button class="flow-ico" data-wback aria-label="Atrás">←</button>
          <div class="flow-prog" aria-hidden="true"><div style="width:${Math.round((d.step + 1) / n * 100)}%"></div></div>
          <button class="flow-ico" data-wexit aria-label="Salir">✕</button>
        </div>
        <div class="flow-step">${d.editId ? "Editando " + esc(d.editId) : "Nota de pedido"} · Paso ${d.step + 1} de ${n}</div>
        <h2 class="flow-q">${esc(STEP_Q[key][0])}</h2>
        <p class="flow-sub">${esc(STEP_Q[key][1])}</p>
        ${body}
        <div class="flow-foot">
          <div class="flow-why" id="flowWhy">${chk.ok ? "" : esc(chk.why || "")}</div>
          <button class="btn primary flow-btn" ${last ? "data-savepedido" : "data-wnext"} ${chk.ok ? "" : "disabled"}>${last ? (d.editId ? "Guardar cambios" : "Guardar nota de pedido") : "Continuar"}</button>
        </div>
      </div>`;
  }
  function flowCliente(d) {
    const t = calcItems(d.items, d.currency), r = classify(d, pygOf(d, t)), hasSel = r.valid && (d.mode !== "con" || d.ruc);
    const qv = state.wq || "", list = clients.filter(c => FE.matches(qv, c.name, c.ruc, c.doc)).slice(0, qv ? 12 : 8);
    const p = parseRuc(qv), typedRuc = p && FE.dv11(p.base) === p.dv && !clients.some(c => c.ruc === p.full) ? p.full : "";
    const reg = typedRuc ? classify({ mode: "con", ruc: typedRuc }, 0) : null;
    const contact = c => `<button class="contact" data-wclient="${esc(c.id)}"><span class="avatar">${esc(initials(c.name || c.ruc))}</span>
      <span class="ct"><b>${esc(c.name || "Sin nombre")}</b><span>${c.mode === "con" ? "RUC " : ""}${esc(FE.receiverIdText(c))}</span></span><span class="go">›</span></button>`;
    return `
      ${hasSel && !state.wmanual ? `<div class="picked"><span class="avatar">${esc(initials(d.name || r.name || d.ruc))}</span>
        <span class="ct"><b>${esc(d.name || r.name || (d.mode === "sin" ? "Consumidor final" : d.ruc))}</b><span>${esc(FE.receiverIdText(FE.receiverFromDraft(d, r)))}</span></span>
        <button class="link" data-wedit>Editar</button><button class="link" data-wchange>Cambiar</button></div>` : ""}
      ${!hasSel || state.wmanual ? `
        ${state.wmanual ? "" : `<input id="wSearch" data-kb="search" type="search" class="flow-search" placeholder="Buscá por nombre, RUC o documento" value="${esc(qv)}">
        ${typedRuc ? `<button class="contact" data-wruc="${esc(typedRuc)}"><span class="avatar plus">+</span><span class="ct"><b>${esc(reg && reg.name || "Usar este RUC")}</b><span>RUC ${esc(typedRuc)}</span></span><span class="go">›</span></button>` : ""}
        ${list.length ? `<div class="flow-label">${qv ? "Resultados" : "Frecuentes"}</div><div class="contacts">${list.map(contact).join("")}</div>`
          : qv && !typedRuc ? `<div class="muted small" style="margin:10px 2px">Ningún cliente frecuente coincide.${/^\d/.test(qv) ? " Si es un RUC, escribilo con su dígito verificador." : ""}</div>` : ""}`}
        <div class="flow-label">Otras opciones</div>
        <div class="opt-grid">
          <button class="opt ${state.wmanual && d.mode === "con" ? "on" : ""}" data-wmode="con"><b>Cargar RUC</b><span>Contribuyente</span></button>
          <button class="opt ${state.wmanual && d.mode === "sin" ? "on" : ""}" data-wmode="sin"><b>Sin RUC</b><span>Documento o consumidor final</span></button>
          <button class="opt ${state.wmanual && d.mode === "ext" ? "on" : ""}" data-wmode="ext"><b>Extranjero</b><span>Cliente del exterior</span></button>
        </div>` : ""}
      ${state.wmanual ? `<div class="card" style="margin-top:12px">${FE.receiverBlock(d, r, t.total, { why: true })}
        <label for="fEmail">Correo del cliente (opcional)</label><input id="fEmail" type="email" placeholder="cliente@correo.com" value="${esc(d.email)}">
        <details class="more-data" ${d.address || d.phone ? "open" : ""}><summary>Dirección y teléfono <span class="muted">(opcional)</span></summary>
          <label for="fAddr">Dirección</label><input id="fAddr" data-kb="address" placeholder="Calle, número y ciudad" value="${esc(d.address)}">
          <label for="fTel">Teléfono</label><input id="fTel" data-kb="tel" placeholder="0981 000 000" value="${esc(d.phone)}">
        </details></div>` : ""}`;
  }
  function flowProductos(d) {
    const t = calcItems(d.items, d.currency), prods = catalog.products || [];
    return `
      <div class="flow-amount">${esc(FE.money(t.total, d.currency))}</div>
      <div class="flow-amount-sub">${d.items.length} producto(s)</div>
      ${prods.length ? `<div class="flow-label">Catálogo${catalog.empresa ? " · " + esc(catalog.empresa) : ""}</div><div class="chips-grid">${prods.slice(0, 12).map((p, i) =>
        `<button class="pchip" data-wprod="${i}"><b>${esc(p.desc)}</b><span>${esc(FE.money(p.price, "PYG"))}</span></button>`).join("")}</div>` : ""}
      <div class="card">
        ${!d.items.length ? `<div class="muted small" style="padding:4px 0 2px">Todavía no agregaste productos.</div>` :
          d.items.map((it, idx) => { const c = calcItem(it, d.currency); return `<div class="item">
            <div class="desc">${esc(it.desc)}</div><div class="amount">${FE.money(c.total, d.currency)}</div>
            <div class="calc">${FE.fmtQty(it.qty)} × ${FE.money(it.price, d.currency)}${it.discount ? " − " + it.discount + "%" : ""} · ${taxLabel(it.tax)}</div>
            <div class="item-actions">
              <span class="stepper"><button data-qtyminus="${idx}" aria-label="Uno menos" ${it.qty <= 1 ? "disabled" : ""}>−</button><b>${FE.fmtQty(it.qty)}</b><button data-qtyplus="${idx}" aria-label="Uno más">+</button></span>
              <span><button class="link" data-edititem="${idx}">Editar</button><button class="link danger" data-del="${idx}">Quitar</button></span>
            </div></div>`; }).join("")}
        <button class="add" data-add="1">+ Agregar producto o servicio</button>
      </div>`;
  }
  function flowPago(d) {
    return `
      <div class="opt-big">
        <button class="${d.condition === "contado" ? "on" : ""}" data-cond="contado"><b>Contado</b><span>Paga al recibir</span></button>
        <button class="${d.condition === "credito" ? "on" : ""}" data-cond="credito"><b>Crédito</b><span>Paga después o en cuotas</span></button>
      </div>
      ${d.condition === "credito" ? `<label for="fCuotas">Cantidad de cuotas</label><input id="fCuotas" inputmode="numeric" value="${d.installments}">` : ""}
      <label for="fCur">Moneda</label>
      <select id="fCur"><option value="PYG" ${d.currency === "PYG" ? "selected" : ""}>Guaraníes</option><option value="USD" ${d.currency === "USD" ? "selected" : ""}>Dólares</option></select>
      ${d.currency === "USD" ? `<label for="fTc">Tipo de cambio</label><input id="fTc" inputmode="numeric" placeholder="Ej. 7.800" value="${esc(d.exchange)}">` : ""}
      <label for="fNote">Nota (opcional)</label>
      <textarea id="fNote" placeholder="Ej. Entregar el lunes">${esc(d.note)}</textarea>`;
  }
  function flowRevision(d) {
    const t = calcItems(d.items, d.currency), r = classify(d, pygOf(d, t));
    const row = (step, label, value) => `<button class="rev-row" data-gostep="${step}"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span><span class="go">›</span></button>`;
    const who = d.name || r.name || (d.mode === "sin" ? "Consumidor final" : d.ruc);
    return `
      <div class="rev-card">
        <div class="rev-total">${esc(FE.money(t.total, d.currency))}</div>
        <div class="rev-total-sub">Nota de pedido${d.currency === "USD" && FE.pygTotal(t.total, "USD", d.exchange) ? " · " + esc(FE.money(FE.pygTotal(t.total, "USD", d.exchange), "PYG")) : ""}</div>
        ${row("cliente", "Cliente", who + " · " + FE.receiverIdText(FE.receiverFromDraft(d, r)))}
        ${row("productos", "Productos", d.items.length + " · " + FE.money(t.total, d.currency))}
        ${row("pago", "Condición", (d.condition === "credito" ? "Crédito" + (d.installments > 1 ? " · " + d.installments + " cuotas" : "") : "Contado") + " · " + (d.currency === "USD" ? "USD · TC " + d.exchange : "Guaraníes"))}
        ${d.note ? row("pago", "Nota", d.note) : ""}
        <div class="rev-row static"><span class="k">Vendedor</span><span class="v">${esc(settings.seller || "Sin nombre")}</span></div>
      </div>
      <div class="muted small" style="margin-top:12px;text-align:center">No es un comprobante fiscal: la factura la emite el facturador.</div>`;
  }
  function refreshFlow() {
    const d = state.draft, chk = stepCheck(d, stepKey(d)), btn = document.querySelector("[data-wnext], [data-savepedido]"), why = document.getElementById("flowWhy");
    if (btn) btn.disabled = !chk.ok;
    if (why) why.textContent = chk.ok ? "" : chk.why || "";
  }

  const pedidoTotal = p => calcItems(p.items, p.currency).total;
  const clientName = p => FE.receiverDisplayName(p.client);
  const shareChip = p => p.sharedAt ? '<span class="chip ok">Enviada</span>' : '<span class="chip warn">No enviada</span>';

  function screenList() {
    const list = pedidos.filter(p => (state.filter === "all" || (state.filter === "shared" ? !!p.sharedAt : !p.sharedAt)) && FE.matches(state.q, clientName(p), p.id, p.client.ruc, p.client.doc));
    const count = k => k === "all" ? pedidos.length : pedidos.filter(p => k === "shared" ? !!p.sharedAt : !p.sharedAt).length;
    const seg = (k, l) => `<button data-filter="${k}" class="${state.filter === k ? "on" : ""}">${l} · ${count(k)}</button>`;
    return `
      <h2>Mis notas de pedido</h2>
      <div class="seg">${seg("all", "Todas")}${seg("pending", "No enviadas")}${seg("shared", "Enviadas")}</div>
      ${pedidos.length > 3 || state.q ? FE.searchBox(state.q, "Buscar por cliente, número o RUC") : ""}
      <div class="card" style="margin-top:12px">
        ${list.length ? list.map(p => `<div class="row" data-open="${esc(p.id)}" role="button" tabindex="0">
          <div class="main"><div class="title">${esc(clientName(p))}</div><div class="sub">${esc(p.id)} · ${fmtDate(p.updatedAt || p.createdAt)}</div></div>
          <div style="text-align:right"><div class="amount">${FE.money(pedidoTotal(p), p.currency)}</div><div style="margin-top:4px">${shareChip(p)}</div></div>
        </div>`).join("") : `<div class="muted small">No hay notas de pedido en este filtro.</div>`}
      </div>
      <button class="btn primary" data-go="new" style="margin-top:14px">Nueva nota de pedido</button>`;
  }

  function screenDetail() {
    const p = pedidos.find(x => x.id === state.detailId);
    if (!p) return screenList();
    const t = calcItems(p.items, p.currency), c = p.client || {};
    return `
      <button class="link" data-go="list">← Mis notas de pedido</button>
      <h2>Nota de pedido ${esc(p.id)}</h2>
      <div style="margin-bottom:12px">${shareChip(p)} ${p.pdfAt ? '<span class="chip ok">PDF enviado</span>' : ""} ${p.rev > 1 ? `<span class="chip neutral">Versión ${p.rev}</span>` : ""}</div>
      <div class="section"><div class="section-title">Para el cliente</div>
        <div class="card">
          <p class="small muted" style="margin-top:0">El PDF de la nota de pedido es el comprobante del vendedor. No es una factura.</p>
          <button class="btn primary" data-pdfshare="${esc(p.id)}">Enviar PDF por WhatsApp</button>
          <button class="link" data-pdfdown="${esc(p.id)}" style="display:block;margin:6px auto 0">Descargar PDF</button>
        </div></div>
      <div class="section"><div class="section-title">Para el facturador</div>
        <div class="qrbox" id="qrHolder"></div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn soft" data-share="${esc(p.id)}">Compartir QR</button>
          <button class="btn soft" data-copy="${esc(p.id)}">Copiar código</button>
        </div>
        <div class="muted small" style="margin-top:8px">El facturador lee este QR desde su app y la nota se carga completa.</div></div>
      <div class="section"><div class="section-title">Detalle</div>
        <div class="card">
          <div class="kv"><span class="muted">Cliente</span><span>${esc(clientName(p))}</span></div>
          <div class="kv"><span class="muted">${FE.receiverIdLabel(c)}</span><span>${esc(FE.receiverIdText(c))}</span></div>
          ${c.address ? `<div class="kv"><span class="muted">Dirección</span><span>${esc(c.address)}</span></div>` : ""}
          ${c.phone ? `<div class="kv"><span class="muted">Teléfono</span><span>${esc(c.phone)}</span></div>` : ""}
          <div class="kv"><span class="muted">Condición</span><span>${p.condition === "credito" ? "Crédito" + (p.installments > 1 ? " · " + p.installments + " cuotas" : "") : "Contado"}</span></div>
          <div class="kv"><span class="muted">Vendedor</span><span>${esc(p.seller)}</span></div>
          ${p.note ? `<div class="kv"><span class="muted">Nota</span><span>${esc(p.note)}</span></div>` : ""}
          ${p.items.map(it => `<div class="kv"><span>${esc(it.desc)}<br><span class="small muted">${FE.fmtQty(it.qty)} × ${fmt(it.price, p.currency)}${it.discount ? " − " + it.discount + "%" : ""} · ${taxLabel(it.tax)}</span></span><span class="amount">${fmt(calcItem(it, p.currency).total, p.currency)}</span></div>`).join("")}
          <div class="kv"><span><b>Total</b></span><span class="amount">${FE.money(t.total, p.currency)}</span></div>
        </div></div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn" data-edit="${esc(p.id)}">Editar</button>
        <button class="btn" data-delete="${esc(p.id)}" style="color:var(--bad)">Eliminar</button>
      </div>
      <div class="muted small" style="margin-top:10px">Eliminá solo notas que todavía no se facturaron. El control de «facturado» llegará con la base de datos.</div>`;
  }

  function screenClients() {
    return `
      <h2>Clientes frecuentes</h2>
      <p class="lead">Se guardan solos al crear una nota de pedido. También se agregan desde aquí.</p>
      <div class="card">
        ${clients.length ? clients.map(c => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(c.name || "Sin nombre")}</div>
          <div class="sub">${c.mode === "con" ? "RUC " : ""}${esc(FE.receiverIdText(c))}${c.email ? " · " + esc(c.email) : ""}</div></div>
          <span style="display:flex;gap:12px"><button class="link" data-useclient="${esc(c.id)}">Usar</button><button class="link" data-delclient="${esc(c.id)}" style="color:var(--bad)">Quitar</button></span></div>`).join("")
          : `<div class="muted small">Todavía no hay clientes guardados.</div>`}
        <button class="add" data-addclient>+ Agregar cliente</button>
      </div>`;
  }

  function screenSettings() {
    return `
      <h2>Ajustes</h2>
      ${FE.T.profileCardHTML({ name: settings.seller || "Sin nombre", sub: "Vendedor · dispositivo " + settings.deviceId })}
      <div class="section"><div class="section-title">Apariencia</div>${FE.themeHTML()}</div>
      <div class="section"><div class="section-title">Productos</div>
        <div class="card">
          ${catalog.products.length ? `<div class="kv"><span class="muted">Catálogo</span><span>${esc(catalog.empresa || "Sin nombre")} · ${catalog.products.length} producto(s)</span></div>
            <div class="kv"><span class="muted">Cargado</span><span>${fmtDate(catalog.loadedAt)}</span></div>`
            : `<p class="small muted" style="margin-top:0">El catálogo lo comparte la empresa desde Facturación (Gestión → Productos frecuentes → Compartir). Después los productos se eligen de una lista.</p>`}
          <div class="btn-row" style="margin-top:10px">
            <label class="btn soft" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Cargar desde imagen<input type="file" id="catFile" accept="image/*" hidden></label>
            <button class="btn" data-catpaste>Pegar código</button>
          </div>
          ${catalog.products.length ? `<button class="link" data-catclear style="color:var(--bad)">Quitar catálogo</button>` : ""}
        </div></div>
      <div class="section"><div class="section-title">Instalar en este dispositivo</div>
        <div class="card">${FE.installHTML("Pedidos")}</div></div>
      <div class="section"><div class="section-title">Copia de seguridad</div>
        <div class="card">
          <p class="small muted" style="margin-top:0">Las notas de pedido se guardan solo en este dispositivo. Se recomienda descargar una copia de seguridad cada tanto.</p>
          <div class="btn-row">
            <button class="btn soft" data-backup>Descargar copia</button>
            <label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Restaurar<input type="file" id="restoreFile" accept="application/json,.json" hidden></label>
          </div>
        </div></div>
      <div class="muted small" style="margin-top:16px">Esta app solo carga notas de pedido. Las facturas las emite el principal desde la app Facturador.</div>`;
  }

  // ================= Render =================
  const titles = { new: "Nueva nota de pedido", list: "Notas de pedido", detail: "Nota de pedido", clients: "Clientes", settings: "Ajustes" };
  function render() {
    const s = state.screen;
    const map = { new: screenNew, list: screenList, detail: screenDetail, clients: screenClients, settings: screenSettings };
    document.getElementById("screen").innerHTML = (map[s] || screenNew)();
    FE.enhance(document.getElementById("screen"));
    document.getElementById("title").textContent = titles[s] || "Pedidos";
    document.getElementById("companyLine").textContent = settings.seller ? "Vendedor: " + settings.seller : "Configurá tu nombre en Ajustes";
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.go === s || (t.dataset.go === "list" && s === "detail")));
    document.body.classList.toggle("in-flow", s === "new");
    document.getElementById("screen").style.paddingBottom = s === "new" ? "150px" : "130px";
    if (s === "detail") drawQr();
    window.scrollTo(0, 0);
  }
  function go(s) { if (s !== state.screen) state.q = ""; state.screen = s; render(); }

  function qrFor(p) {
    const t = calcItems(p.items, p.currency);
    return qrCanvas(encodePedido(p), ["Nota de pedido " + p.id, clientName(p) + " · " + FE.money(t.total, p.currency), "Vendedor: " + p.seller]);
  }
  function drawQr() {
    const p = pedidos.find(x => x.id === state.detailId), holder = document.getElementById("qrHolder");
    if (!p || !holder) return;
    const cv = qrFor(p);
    if (!cv) { holder.innerHTML = `<div class="notice bad" style="margin:0"><b>El pedido es demasiado grande para un QR</b>Conviene dividirla en dos notas más chicas.</div>`; return; }
    holder.appendChild(cv);
  }

  function syncFields() {
    const d = state.draft, g = id => document.getElementById(id);
    if (state.screen === "new") FE.syncReceiver(d);
    if (g("fEmail")) d.email = g("fEmail").value;
    if (g("fAddr")) d.address = g("fAddr").value;
    if (g("fTel")) d.phone = g("fTel").value;
    if (g("fCuotas")) d.installments = Math.max(1, parseInt(g("fCuotas").value, 10) || 1);
    if (g("fCur")) d.currency = g("fCur").value;
    if (g("fTc")) d.exchange = g("fTc").value;
    if (g("fNote")) d.note = g("fNote").value;
    saveDraft();
  }
  function askSeller(then) {
    sheet(`<h3>Nombre del vendedor</h3><p class="muted small">Tu nombre va en cada nota de pedido: lo ven el cliente y el facturador.</p>
      <input id="aSeller" placeholder="Ej. Ana Benítez" value="${esc(settings.seller)}">
      <button class="btn primary" id="aOk" style="margin-top:14px">Continuar</button>`, (el, close) => {
      el.querySelector("#aOk").onclick = () => {
        const v = el.querySelector("#aSeller").value.trim();
        if (!v) { toast("Falta el nombre"); return; }
        settings.seller = v; save(); close(); render(); then && then();
      };
      setTimeout(() => el.querySelector("#aSeller").focus(), 60);
    });
  }

  function savePedido() {
    syncFields();
    const d = state.draft, t = calcItems(d.items, d.currency), r = classify(d, pygOf(d, t));
    const chk = stepCheck(d, "revision");
    if (!chk.ok) { toast(chk.why); return; }
    if (!settings.seller) { askSeller(savePedido); return; }
    const now = new Date().toISOString();
    const client = FE.receiverFromDraft(d, r);
    let p;
    if (d.editId && (p = pedidos.find(x => x.id === d.editId))) {
      Object.assign(p, { client, condition: d.condition, installments: d.installments, currency: d.currency, exchange: d.exchange,
        note: d.note.trim(), items: d.items.slice(), rev: (p.rev || 1) + 1, updatedAt: now, sharedAt: null, seller: settings.seller });
    } else {
      settings.seq += 1;
      p = { id: settings.deviceId + "-" + String(settings.seq).padStart(4, "0"), rev: 1, seller: settings.seller, createdAt: now, updatedAt: now,
        client, condition: d.condition, installments: d.installments, currency: d.currency, exchange: d.exchange,
        note: d.note.trim(), items: d.items.slice(), sharedAt: null };
      pedidos.unshift(p);
    }
    if (!qrFor(p)) toast("La nota es demasiado grande para un QR. Quitá productos.");
    clients = upsertClient(clients, client);
    save(); state.draft = newDraft(); saveDraft();
    state.wq = ""; state.wmanual = false; state.detailId = p.id; go("detail");
    toast("Nota de pedido guardada");
  }

  function importCatalog(text) {
    const r = FE.T.decodeCatalog(text);
    if (!r.ok) { toast(r.error); return; }
    catalog = { empresa: r.empresa, products: r.products, loadedAt: new Date().toISOString() };
    save(); render(); FE.buzz(); toast("Catálogo cargado: " + r.products.length + " producto(s)");
  }
  function catalogPasteSheet() {
    sheet(`<h3>Pegar código del catálogo</h3><textarea id="catCode" placeholder="FEC1.…"></textarea>
      <div class="btn-row" style="margin-top:14px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Cargar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => { const v = el.querySelector("#catCode").value; close(); importCatalog(v); };
      setTimeout(() => el.querySelector("#catCode").focus(), 60);
    });
  }
  function clientSheet() {
    const c = { mode: "con", ruc: "", name: "", doc: "", docType: "1", country: "", email: "" };
    sheet(`<h3>Nuevo cliente</h3><div id="ncBody" style="margin-top:8px"></div>
      <label for="nMail">Correo (opcional)</label><input id="nMail" type="email">
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      const body = el.querySelector("#ncBody");
      const draw = () => { body.innerHTML = FE.receiverBlock(c, classify(c, 0), 0); };
      draw();
      body.addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) { FE.syncReceiver(c); c.mode = b.dataset.mode; draw(); } });
      body.addEventListener("change", e => { if (e.target.tagName === "SELECT") { FE.syncReceiver(c); draw(); } });
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        FE.syncReceiver(c); c.email = el.querySelector("#nMail").value.trim();
        const r = classify(c, 0);
        if (!r.valid) { toast(r.why); return; }
        if (c.mode === "sin" && !c.doc.trim() && !c.name.trim()) { toast("Falta el nombre o el documento"); return; }
        clients = upsertClient(clients, FE.receiverFromDraft(c, r));
        save(); close(); render(); toast("Cliente guardado");
      };
    });
  }
  function useClient(c) {
    const d = state.draft;
    d.mode = c.mode; d.ruc = c.ruc || ""; d.doc = c.doc || ""; d.name = c.name || ""; d.email = c.email || "";
    d.docType = c.docType || ""; d.country = c.country || ""; d.address = c.address || ""; d.phone = c.phone || "";
    if (stepKey(d) === "cliente") d.step = 1;
    state.wmanual = false; saveDraft(); go("new");
  }

  // ================= Eventos =================
  const screenEl = document.getElementById("screen");
  screenEl.addEventListener("click", e => {
    const t = e.target.closest("button, [data-open]"); if (!t) return;
    const ds = t.dataset;
    if (ds.go) { go(ds.go); return; }
    // ---- flujo por pasos ----
    if (ds.wnext !== undefined) {
      syncFields(); const d = state.draft, chk = stepCheck(d, stepKey(d));
      if (!chk.ok) { toast(chk.why); return; }
      d.step++; state.wq = ""; state.wmanual = false; saveDraft(); render(); return;
    }
    if (ds.wback !== undefined) { syncFields(); state.wq = ""; state.wmanual = false; if (state.draft.step > 0) { state.draft.step--; saveDraft(); render(); } else go("list"); return; }
    if (ds.wexit !== undefined) {
      syncFields(); const d = state.draft;
      if (!d.items.length && !d.ruc && !d.name && !d.doc && !d.editId) { state.draft = newDraft(); saveDraft(); go("list"); return; }
      confirmSheet("¿Salir de la nota de pedido?", "El borrador queda guardado para seguir después.", "Salir", () => go("list"));
      return;
    }
    if (ds.gostep) { syncFields(); state.draft.step = Math.max(0, STEPS.indexOf(ds.gostep)); state.wq = ""; state.wmanual = false; saveDraft(); render(); return; }
    if (ds.wclient) { const c = clients.find(x => x.id === ds.wclient); if (c) useClient(c); return; }
    if (ds.wruc) { const d = state.draft, r = classify({ mode: "con", ruc: ds.wruc }, 0); Object.assign(d, { mode: "con", ruc: ds.wruc, name: r.name || "", doc: "", email: "", address: "", phone: "" }); state.wq = ""; state.wmanual = true; saveDraft(); render(); return; }
    if (ds.wchange !== undefined) { Object.assign(state.draft, { ruc: "", name: "", doc: "", email: "", country: "", address: "", phone: "" }); state.wmanual = false; saveDraft(); render(); return; }
    if (ds.wedit !== undefined) { state.wmanual = true; render(); return; }
    if (ds.wmode) { Object.assign(state.draft, { mode: ds.wmode, ruc: "", name: "", doc: "", docType: ds.wmode === "ext" ? "2" : "1", country: "", address: "", phone: "", email: "" }); state.wmanual = true; saveDraft(); render(); return; }
    if (ds.wprod !== undefined) {
      syncFields(); const pr = catalog.products[+ds.wprod]; if (!pr) return;
      const d = state.draft, ex = d.items.find(i => i.desc === pr.desc && (i.code || "") === (pr.code || ""));
      if (ex) ex.qty = Math.round((ex.qty + 1) * 1000) / 1000;
      else d.items.push({ desc: pr.desc, code: pr.code || "", qty: 1, price: pr.price, tax: pr.tax || "10", discount: 0 });
      saveDraft(); render(); FE.buzz(15); return;
    }
    if (ds.pdfshare || ds.pdfdown) {
      const p = pedidos.find(x => x.id === (ds.pdfshare || ds.pdfdown)); if (!p) return;
      if (!window.NotaPedidoPdf || !window.jspdf) { toast("No se pudo cargar el generador de PDF"); return; }
      if (ds.pdfdown) { FE.downloadBlob(NotaPedidoPdf.build(p).output("blob"), NotaPedidoPdf.fileName(p)); toast("PDF descargado"); return; }
      NotaPedidoPdf.share(p).then(r => {
        if (r === "cancelled") return;
        if (r === "downloaded") toast("PDF descargado. Se puede enviar por WhatsApp desde los archivos del teléfono.");
        p.pdfAt = new Date().toISOString(); save(); render();
      }).catch(err => { console.error(err); toast("No se pudo generar el PDF"); });
      return;
    }
    if (ds.mode) { syncFields(); state.draft.mode = ds.mode; saveDraft(); render(); return; }
    if (ds.cond) { syncFields(); state.draft.condition = ds.cond; saveDraft(); render(); return; }
    if (ds.add) { syncFields(); itemSheet(it => { state.draft.items.push(it); saveDraft(); render(); }, null, catalog.products, state.draft.currency); return; }
    if (ds.edititem !== undefined) { syncFields(); const i = +ds.edititem; itemSheet(it => { state.draft.items[i] = it; saveDraft(); render(); }, state.draft.items[i], catalog.products, state.draft.currency); return; }
    if (ds.catpaste !== undefined) { catalogPasteSheet(); return; }
    if (ds.catclear !== undefined) { confirmSheet("¿Quitar el catálogo?", "Los pedidos ya cargados no cambian.", "Quitar", () => { catalog = { empresa: "", products: [], loadedAt: "" }; save(); render(); toast("Catálogo quitado"); }, true); return; }
    if (ds.qtyminus !== undefined || ds.qtyplus !== undefined) {
      syncFields();
      const it = state.draft.items[+(ds.qtyplus !== undefined ? ds.qtyplus : ds.qtyminus)]; if (!it) return;
      const q = Math.round((it.qty + (ds.qtyplus !== undefined ? 1 : -1)) * 1000) / 1000;
      if (q <= 0) return;
      it.qty = q; saveDraft(); render(); return;
    }
    if (ds.del !== undefined) { syncFields(); state.draft.items.splice(+ds.del, 1); saveDraft(); render(); return; }
    if (ds.pickclient !== undefined) { syncFields(); clientPicker(clients, useClient); return; }
    if (ds.savepedido !== undefined) { savePedido(); return; }
    if (ds.open) { state.detailId = ds.open; go("detail"); return; }
    if (ds.filter) { state.filter = ds.filter; render(); return; }
    if (ds.share) {
      const p = pedidos.find(x => x.id === ds.share), cv = p && qrFor(p);
      if (!cv) { toast("No se pudo generar el QR"); return; }
      shareCanvas(cv, "nota-pedido-" + p.id + ".png", "Nota de pedido " + p.id + " · " + clientName(p)).then(ok => {
        if (ok) { p.sharedAt = new Date().toISOString(); save(); render(); }
      });
      return;
    }
    if (ds.copy) {
      const p = pedidos.find(x => x.id === ds.copy); if (!p) return;
      copyText("Nota de pedido " + p.id + " · " + clientName(p) + "\n" + encodePedido(p)).then(ok => { if (ok && !p.sharedAt) { p.sharedAt = new Date().toISOString(); save(); render(); } });
      return;
    }
    if (ds.edit) {
      const p = pedidos.find(x => x.id === ds.edit); if (!p) return;
      state.draft = { editId: p.id, step: STEPS.indexOf("revision"), mode: p.client.mode, ruc: p.client.ruc, name: p.client.name, doc: p.client.doc, email: p.client.email,
        docType: p.client.docType || "", country: p.client.country || "", address: p.client.address || "", phone: p.client.phone || "",
        condition: p.condition, installments: p.installments, currency: p.currency, exchange: p.exchange, note: p.note, items: p.items.map(i => Object.assign({}, i)) };
      state.wq = ""; state.wmanual = false; saveDraft(); go("new"); return;
    }
    if (ds.delete) {
      confirmSheet("¿Eliminar esta nota de pedido?", "Solo si todavía no se facturó. Esta acción no se puede deshacer.", "Eliminar", () => {
        pedidos = pedidos.filter(x => x.id !== ds.delete); save(); go("list"); toast("Nota de pedido eliminada");
      }, true);
      return;
    }
    if (ds.addclient !== undefined) { clientSheet(); return; }
    if (ds.useclient) { const c = clients.find(x => x.id === ds.useclient); if (c) useClient(c); return; }
    if (ds.delclient) { clients = clients.filter(x => x.id !== ds.delclient); save(); render(); return; }
    if (ds.profile !== undefined) {
      FE.T.profileSheet({ name: settings.seller || "Sin nombre", sub: "Vendedor · dispositivo " + settings.deviceId,
        rows: [["Nombre en las notas", settings.seller || "Sin configurar"], ["Código del dispositivo", settings.deviceId],
          ["Catálogo", catalog.products.length ? (catalog.empresa || "Sin nombre") + " · " + catalog.products.length + " producto(s)" : ""], ["Notas de pedido", String(pedidos.length)]],
        actions: [{ id: "name", label: "Cambiar mi nombre" }],
        onAction: (id, close) => { close(); if (id === "name") askSeller(); } });
      return;
    }
    if (ds.saveseller !== undefined) {
      const v = document.getElementById("sSeller").value.trim();
      if (!v) { toast("Falta el nombre"); return; }
      settings.seller = v; save(); render(); toast("Nombre guardado"); return;
    }
    if (ds.themeSet) { FE.setTheme(ds.themeSet); render(); return; }
    if (ds.install !== undefined) { FE.promptInstall(); return; }
    if (ds.backup !== undefined) { FE.exportBackup(store, "pedidos"); return; }
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
    if (e.target.id === "catFile") {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      toast("Leyendo el QR…");
      FE.readQrFromFile(f).then(importCatalog).catch(err => toast(err.message));
      return;
    }
    if (e.target.id === "restoreFile") {
      const f = e.target.files && e.target.files[0];
      if (f) FE.importBackup(store, "pedidos", f, () => location.reload());
      return;
    }
    if (state.screen === "new") { syncFields(); if (e.target.id === "fCur" && state.draft.items.length) toast("Cambiaste la moneda: revisá los precios de los productos"); if (e.target.tagName === "SELECT") render(); else refreshFlow(); }
  });
  screenEl.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.open) { e.preventDefault(); e.target.click(); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && state.screen === "new" && !document.querySelector(".sheet-back")) { const b = document.querySelector("[data-wback]"); if (b) b.click(); } });
  document.querySelector(".tabbar").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });

  render();
  FE.onInstallChange(() => { if (state.screen === "settings") render(); });
  if (!settings.seller) askSeller();
  FE.registerSW();
})();
