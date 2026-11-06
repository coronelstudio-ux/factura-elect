/* App Pedidos: el cargador crea pedidos y los comparte como QR. No ve ni genera facturas. */
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
  const save = () => { store.set("pedidos", pedidos); store.set("clients", clients); store.set("settings", settings); };

  const state = { screen: "new", detailId: null, filter: "all", draft: store.get("draft", null) || newDraft() };
  function newDraft() {
    return { editId: null, mode: "con", ruc: "", name: "", doc: "", email: "", condition: "contado", installments: 1,
      currency: "PYG", exchange: "", note: "", items: [] };
  }
  const saveDraft = () => store.set("draft", state.draft);

  // ================= Pantallas =================
  function screenNew() {
    const d = state.draft, t = calcItems(d.items), r = classify(d, t.total);
    const hasItems = d.items.length > 0;
    const canSave = r.valid && hasItems;
    return `
      ${d.editId ? `<div class="notice warn" style="margin-top:0"><b>Editando el pedido ${esc(d.editId)}</b>Al guardar, volvé a compartir el QR nuevo.</div>` : ""}
      <div class="lead">Cargá el pedido. Al guardarlo se genera un QR para enviar por WhatsApp.</div>
      <div class="section">
        <div class="section-title"><span class="num ${r.valid ? "done" : ""}">1</span>Cliente
          <button class="link" data-pickclient style="margin-left:auto;font-size:14px">Clientes frecuentes</button></div>
        <div class="seg">
          <button data-mode="con" class="${d.mode === "con" ? "on" : ""}">Con RUC</button>
          <button data-mode="sin" class="${d.mode === "sin" ? "on" : ""}">Sin RUC</button>
        </div>
        ${d.mode === "con" ? `
          <div class="grid2">
            <div><label for="fRuc">RUC</label><input id="fRuc" placeholder="4567890-1" value="${esc(d.ruc)}"></div>
            <div><label for="fName">Nombre o razón social</label><input id="fName" placeholder="${esc(r.name || "Nombre")}" value="${esc(d.name)}"></div>
          </div>` : `
          <label for="fDoc">Documento de identidad ${t.total >= FE.INNOMINATE_LIMIT ? "(obligatorio)" : "(opcional)"}</label>
          <input id="fDoc" inputmode="numeric" placeholder="Número de documento" value="${esc(d.doc)}">
          <label for="fName2">Nombre (opcional)</label>
          <input id="fName2" placeholder="Consumidor final" value="${esc(d.name)}">`}
        ${d.mode === "con" && d.ruc.trim() ? `
          <div class="${r.valid ? "detect" : "notice bad"}">
            ${r.valid ? `<div class="kind">${esc(r.label)} · ${opName[r.operation]}</div>
              ${r.name ? `<div class="small" style="margin-top:2px">${esc(r.name)}</div>` : ""}` : `<div>${esc(r.why)}</div>`}
          </div>` : ""}
        ${d.mode === "sin" && !r.valid ? `<div class="notice bad">${esc(r.why)}</div>` : ""}
        <label for="fEmail">Correo del cliente (opcional)</label>
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
        <div class="section-title"><span class="num">3</span>Condición y nota</div>
        <div class="seg">
          <button data-cond="contado" class="${d.condition === "contado" ? "on" : ""}">Contado</button>
          <button data-cond="credito" class="${d.condition === "credito" ? "on" : ""}">Crédito</button>
        </div>
        <div class="grid2" style="margin-top:4px">
          ${d.condition === "credito" ? `<div><label for="fCuotas">Cuotas</label><input id="fCuotas" inputmode="numeric" value="${d.installments}"></div>` : `<div></div>`}
          <div><label for="fCur">Moneda</label><select id="fCur">
            <option value="PYG" ${d.currency === "PYG" ? "selected" : ""}>Guaraníes</option>
            <option value="USD" ${d.currency === "USD" ? "selected" : ""}>Dólares</option></select></div>
        </div>
        ${d.currency === "USD" ? `<label for="fTc">Tipo de cambio</label><input id="fTc" inputmode="numeric" placeholder="Ej. 7.800" value="${esc(d.exchange)}">` : ""}
        <label for="fNote">Nota para el facturador (opcional)</label>
        <textarea id="fNote" placeholder="Ej. Entregar el lunes">${esc(d.note)}</textarea>
        ${d.editId || hasItems ? `<button class="link" data-clear style="margin-top:6px">${d.editId ? "Cancelar edición" : "Vaciar formulario"}</button>` : ""}
      </div>

      <div class="sticky-total">
        <div class="line"><span class="muted">${t.count ? t.count + (t.count === 1 ? " producto" : " productos") : "Total"}</span>
          <span class="big">${d.currency === "USD" ? "USD " : "Gs "}${fmt(t.total)}</span></div>
        <button class="btn primary" data-savepedido ${canSave ? "" : "disabled"}>${d.editId ? "Guardar cambios y generar QR" : "Guardar pedido y generar QR"}</button>
      </div>`;
  }

  const pedidoTotal = p => calcItems(p.items).total;
  const clientName = p => p.client.name || (p.client.mode === "sin" ? "Consumidor final" : p.client.ruc);
  const shareChip = p => p.sharedAt ? '<span class="chip ok">Compartido</span>' : '<span class="chip warn">Sin compartir</span>';

  function screenList() {
    const list = pedidos.filter(p => state.filter === "all" || (state.filter === "shared" ? !!p.sharedAt : !p.sharedAt));
    const count = k => k === "all" ? pedidos.length : pedidos.filter(p => k === "shared" ? !!p.sharedAt : !p.sharedAt).length;
    const seg = (k, l) => `<button data-filter="${k}" class="${state.filter === k ? "on" : ""}">${l} · ${count(k)}</button>`;
    return `
      <h2>Mis pedidos</h2>
      <div class="seg">${seg("all", "Todos")}${seg("pending", "Sin compartir")}${seg("shared", "Compartidos")}</div>
      <div class="card" style="margin-top:12px">
        ${list.length ? list.map(p => `<div class="row" data-open="${esc(p.id)}" role="button" tabindex="0">
          <div class="main"><div class="title">${esc(clientName(p))}</div><div class="sub">${esc(p.id)} · ${fmtDate(p.updatedAt || p.createdAt)}</div></div>
          <div style="text-align:right"><div class="amount">${p.currency === "USD" ? "USD" : "Gs"} ${fmt(pedidoTotal(p))}</div><div style="margin-top:4px">${shareChip(p)}</div></div>
        </div>`).join("") : `<div class="muted small">No hay pedidos en este filtro.</div>`}
      </div>
      <button class="btn primary" data-go="new" style="margin-top:14px">Nuevo pedido</button>`;
  }

  function screenDetail() {
    const p = pedidos.find(x => x.id === state.detailId);
    if (!p) return screenList();
    const t = calcItems(p.items);
    return `
      <button class="link" data-go="list">← Mis pedidos</button>
      <h2>Pedido ${esc(p.id)}</h2>
      <div style="margin-bottom:12px">${shareChip(p)} ${p.rev > 1 ? `<span class="chip neutral">Versión ${p.rev}</span>` : ""}</div>
      <div class="qrbox" id="qrHolder"></div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn primary" data-share="${esc(p.id)}">Compartir por WhatsApp</button>
        <button class="btn soft" data-copy="${esc(p.id)}">Copiar código</button>
      </div>
      <div class="muted small" style="margin-top:8px">El facturador lee este QR desde su app y el pedido se carga completo.</div>
      <div class="section"><div class="section-title">Detalle</div>
        <div class="card">
          <div class="kv"><span class="muted">Cliente</span><span>${esc(clientName(p))}</span></div>
          <div class="kv"><span class="muted">${p.client.mode === "con" ? "RUC" : "Documento"}</span><span>${esc(p.client.mode === "con" ? p.client.ruc : (p.client.doc || "Sin identificar"))}</span></div>
          <div class="kv"><span class="muted">Condición</span><span>${p.condition === "credito" ? "Crédito" + (p.installments > 1 ? " · " + p.installments + " cuotas" : "") : "Contado"}</span></div>
          <div class="kv"><span class="muted">Vendedor</span><span>${esc(p.seller)}</span></div>
          ${p.note ? `<div class="kv"><span class="muted">Nota</span><span>${esc(p.note)}</span></div>` : ""}
          ${p.items.map(it => `<div class="kv"><span>${esc(it.desc)}<br><span class="small muted">${it.qty} × ${fmt(it.price)}${it.discount ? " − " + it.discount + "%" : ""} · ${taxLabel(it.tax)}</span></span><span class="amount">${fmt(calcItem(it).total)}</span></div>`).join("")}
          <div class="kv"><span><b>Total</b></span><span class="amount">${p.currency === "USD" ? "USD" : "Gs"} ${fmt(t.total)}</span></div>
        </div></div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn" data-edit="${esc(p.id)}">Editar</button>
        <button class="btn" data-delete="${esc(p.id)}" style="color:var(--bad)">Eliminar</button>
      </div>
      <div class="muted small" style="margin-top:10px">Eliminá solo pedidos que todavía no se facturaron. El control de «facturado» llegará con la base de datos.</div>`;
  }

  function screenClients() {
    return `
      <h2>Clientes frecuentes</h2>
      <p class="lead">Se guardan solos al crear un pedido. También podés agregarlos aquí.</p>
      <div class="card">
        ${clients.length ? clients.map(c => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(c.name || "Sin nombre")}</div>
          <div class="sub">${c.mode === "con" ? "RUC " + esc(c.ruc) : "Doc. " + esc(c.doc || "-")}${c.email ? " · " + esc(c.email) : ""}</div></div>
          <span style="display:flex;gap:12px"><button class="link" data-useclient="${esc(c.id)}">Usar</button><button class="link" data-delclient="${esc(c.id)}" style="color:var(--bad)">Quitar</button></span></div>`).join("")
          : `<div class="muted small">Todavía no hay clientes guardados.</div>`}
        <button class="add" data-addclient>+ Agregar cliente</button>
      </div>`;
  }

  function screenSettings() {
    return `
      <h2>Ajustes</h2>
      <div class="section"><div class="section-title">Vendedor</div>
        <div class="card">
          <label for="sSeller" style="margin-top:0">Tu nombre (aparece en cada pedido)</label>
          <input id="sSeller" value="${esc(settings.seller)}" placeholder="Ej. Ana Benítez">
          <button class="btn soft" data-saveseller style="margin-top:10px">Guardar nombre</button>
          <div class="kv" style="margin-top:8px"><span class="muted">Código de este dispositivo</span><span>${esc(settings.deviceId)}</span></div>
        </div></div>
      <div class="section"><div class="section-title">Instalar en este dispositivo</div>
        <div class="card">${FE.installHTML("Pedidos")}</div></div>
      <div class="section"><div class="section-title">Respaldo</div>
        <div class="card">
          <p class="small muted" style="margin-top:0">Los pedidos se guardan solo en este dispositivo. Descargá un respaldo de vez en cuando.</p>
          <div class="btn-row">
            <button class="btn soft" data-backup>Descargar respaldo</button>
            <label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Restaurar<input type="file" id="restoreFile" accept="application/json,.json" hidden></label>
          </div>
        </div></div>
      <div class="muted small" style="margin-top:16px">Esta app solo carga pedidos. Las facturas las emite el principal desde la app Facturador.</div>`;
  }

  // ================= Render =================
  const titles = { new: "Nuevo pedido", list: "Mis pedidos", detail: "Pedido", clients: "Clientes", settings: "Ajustes" };
  function render() {
    const s = state.screen;
    const map = { new: screenNew, list: screenList, detail: screenDetail, clients: screenClients, settings: screenSettings };
    document.getElementById("screen").innerHTML = (map[s] || screenNew)();
    document.getElementById("title").textContent = titles[s] || "Pedidos";
    document.getElementById("companyLine").textContent = settings.seller ? "Vendedor: " + settings.seller : "Configurá tu nombre en Ajustes";
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.go === s || (t.dataset.go === "list" && s === "detail")));
    document.getElementById("screen").style.paddingBottom = s === "new" ? "170px" : "130px";
    if (s === "detail") drawQr();
    window.scrollTo(0, 0);
  }
  function go(s) { state.screen = s; render(); }

  function qrFor(p) {
    const t = calcItems(p.items);
    return qrCanvas(encodePedido(p), ["Pedido " + p.id, clientName(p) + " · " + (p.currency === "USD" ? "USD " : "Gs ") + fmt(t.total), "Vendedor: " + p.seller]);
  }
  function drawQr() {
    const p = pedidos.find(x => x.id === state.detailId), holder = document.getElementById("qrHolder");
    if (!p || !holder) return;
    const cv = qrFor(p);
    if (!cv) { holder.innerHTML = `<div class="notice bad" style="margin:0"><b>El pedido es demasiado grande para un QR</b>Dividilo en dos pedidos más chicos.</div>`; return; }
    holder.appendChild(cv);
  }

  function syncFields() {
    const d = state.draft, g = id => document.getElementById(id);
    if (g("fRuc")) d.ruc = g("fRuc").value;
    if (g("fName")) d.name = g("fName").value;
    if (g("fName2")) d.name = g("fName2").value;
    if (g("fDoc")) d.doc = g("fDoc").value;
    if (g("fEmail")) d.email = g("fEmail").value;
    if (g("fCuotas")) d.installments = Math.max(1, parseInt(g("fCuotas").value, 10) || 1);
    if (g("fCur")) d.currency = g("fCur").value;
    if (g("fTc")) d.exchange = g("fTc").value;
    if (g("fNote")) d.note = g("fNote").value;
    saveDraft();
  }
  function refreshTotal() {
    const bar = document.querySelector(".sticky-total"); if (!bar) return;
    const d = state.draft, t = calcItems(d.items), r = classify(d, t.total);
    bar.querySelector(".big").textContent = (d.currency === "USD" ? "USD " : "Gs ") + fmt(t.total);
    bar.querySelector("[data-savepedido]").disabled = !(r.valid && d.items.length > 0);
  }

  function askSeller(then) {
    sheet(`<h3>¿Cómo te llamás?</h3><p class="muted small">Tu nombre va en cada pedido para que el facturador sepa quién lo cargó.</p>
      <input id="aSeller" placeholder="Ej. Ana Benítez" value="${esc(settings.seller)}">
      <button class="btn primary" id="aOk" style="margin-top:14px">Continuar</button>`, (el, close) => {
      el.querySelector("#aOk").onclick = () => {
        const v = el.querySelector("#aSeller").value.trim();
        if (!v) { toast("Escribí tu nombre"); return; }
        settings.seller = v; save(); close(); render(); then && then();
      };
      setTimeout(() => el.querySelector("#aSeller").focus(), 60);
    });
  }

  function savePedido() {
    syncFields();
    const d = state.draft, t = calcItems(d.items), r = classify(d, t.total);
    if (!r.valid) { toast(r.why); return; }
    if (!d.items.length) { toast("Agregá al menos un producto"); return; }
    if (!settings.seller) { askSeller(savePedido); return; }
    const now = new Date().toISOString();
    const client = { mode: d.mode, ruc: d.mode === "con" ? (parseRuc(d.ruc) || {}).full || d.ruc : "", doc: d.mode === "sin" ? d.doc : "",
      name: d.name || (d.mode === "con" ? r.name || "" : ""), email: d.email };
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
    if (!qrFor(p)) toast("El pedido es demasiado grande para un QR. Quitá productos.");
    clients = upsertClient(clients, client);
    save(); state.draft = newDraft(); saveDraft();
    state.detailId = p.id; go("detail");
    toast("Pedido guardado");
  }

  function clientSheet() {
    sheet(`<h3>Nuevo cliente</h3>
      <div class="seg" style="margin-top:8px"><button data-m="con" class="on">Con RUC</button><button data-m="sin">Sin RUC</button></div>
      <label for="nId" id="nIdLbl">RUC</label><input id="nId" placeholder="4567890-1">
      <label for="nName">Nombre o razón social</label><input id="nName">
      <label for="nMail">Correo (opcional)</label><input id="nMail" type="email">
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      let mode = "con";
      el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => {
        mode = b.dataset.m; el.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b));
        el.querySelector("#nIdLbl").textContent = mode === "con" ? "RUC" : "Documento (opcional)";
        el.querySelector("#nId").placeholder = mode === "con" ? "4567890-1" : "Número de documento";
      });
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const id = el.querySelector("#nId").value.trim(), name = el.querySelector("#nName").value.trim(), email = el.querySelector("#nMail").value.trim();
        if (mode === "con") {
          const r = classify({ mode: "con", ruc: id }, 0);
          if (!r.valid) { toast(r.why); return; }
          clients = upsertClient(clients, { mode, ruc: id, name: name || r.name || "", email });
        } else {
          if (!id && !name) { toast("Escribí al menos el nombre o el documento"); return; }
          clients = upsertClient(clients, { mode, doc: id, name, email });
        }
        save(); close(); render(); toast("Cliente guardado");
      };
    });
  }
  function useClient(c) {
    const d = state.draft;
    d.mode = c.mode; d.ruc = c.ruc || ""; d.doc = c.doc || ""; d.name = c.name || ""; d.email = c.email || "";
    saveDraft(); go("new");
  }

  // ================= Eventos =================
  const screenEl = document.getElementById("screen");
  screenEl.addEventListener("click", e => {
    const t = e.target.closest("button, [data-open]"); if (!t) return;
    const ds = t.dataset;
    if (ds.go) { go(ds.go); return; }
    if (ds.mode) { syncFields(); state.draft.mode = ds.mode; saveDraft(); render(); return; }
    if (ds.cond) { syncFields(); state.draft.condition = ds.cond; saveDraft(); render(); return; }
    if (ds.add) { syncFields(); itemSheet(it => { state.draft.items.push(it); saveDraft(); render(); }); return; }
    if (ds.edititem !== undefined) { syncFields(); const i = +ds.edititem; itemSheet(it => { state.draft.items[i] = it; saveDraft(); render(); }, state.draft.items[i]); return; }
    if (ds.del !== undefined) { syncFields(); state.draft.items.splice(+ds.del, 1); saveDraft(); render(); return; }
    if (ds.pickclient !== undefined) { syncFields(); clientPicker(clients, useClient); return; }
    if (ds.clear !== undefined) { state.draft = newDraft(); saveDraft(); render(); return; }
    if (ds.savepedido !== undefined) { savePedido(); return; }
    if (ds.open) { state.detailId = ds.open; go("detail"); return; }
    if (ds.filter) { state.filter = ds.filter; render(); return; }
    if (ds.share) {
      const p = pedidos.find(x => x.id === ds.share), cv = p && qrFor(p);
      if (!cv) { toast("No se pudo generar el QR"); return; }
      shareCanvas(cv, "pedido-" + p.id + ".png", "Pedido " + p.id + " · " + clientName(p)).then(ok => {
        if (ok) { p.sharedAt = new Date().toISOString(); save(); render(); }
      });
      return;
    }
    if (ds.copy) {
      const p = pedidos.find(x => x.id === ds.copy); if (!p) return;
      copyText("Pedido " + p.id + " · " + clientName(p) + "\n" + encodePedido(p)).then(ok => { if (ok && !p.sharedAt) { p.sharedAt = new Date().toISOString(); save(); render(); } });
      return;
    }
    if (ds.edit) {
      const p = pedidos.find(x => x.id === ds.edit); if (!p) return;
      state.draft = { editId: p.id, mode: p.client.mode, ruc: p.client.ruc, name: p.client.name, doc: p.client.doc, email: p.client.email,
        condition: p.condition, installments: p.installments, currency: p.currency, exchange: p.exchange, note: p.note, items: p.items.map(i => Object.assign({}, i)) };
      saveDraft(); go("new"); return;
    }
    if (ds.delete) {
      confirmSheet("¿Eliminar este pedido?", "Hacelo solo si todavía no se facturó. Esta acción no se puede deshacer.", "Eliminar", () => {
        pedidos = pedidos.filter(x => x.id !== ds.delete); save(); go("list"); toast("Pedido eliminado");
      }, true);
      return;
    }
    if (ds.addclient !== undefined) { clientSheet(); return; }
    if (ds.useclient) { const c = clients.find(x => x.id === ds.useclient); if (c) useClient(c); return; }
    if (ds.delclient) { clients = clients.filter(x => x.id !== ds.delclient); save(); render(); return; }
    if (ds.saveseller !== undefined) {
      const v = document.getElementById("sSeller").value.trim();
      if (!v) { toast("Escribí tu nombre"); return; }
      settings.seller = v; save(); render(); toast("Nombre guardado"); return;
    }
    if (ds.install !== undefined) { FE.promptInstall(); return; }
    if (ds.backup !== undefined) { FE.exportBackup(store, "pedidos"); return; }
  });
  screenEl.addEventListener("input", e => {
    if (state.screen !== "new") return;
    syncFields();
    const id = e.target.id, pos = e.target.selectionStart;
    if (id === "fRuc" || id === "fDoc") {
      render();
      const el = document.getElementById(id);
      if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} }
    } else refreshTotal();
  });
  screenEl.addEventListener("change", e => {
    if (e.target.id === "restoreFile") {
      const f = e.target.files && e.target.files[0];
      if (f) FE.importBackup(store, "pedidos", f, () => location.reload());
      return;
    }
    if (state.screen === "new") { syncFields(); if (e.target.tagName === "SELECT") render(); }
  });
  screenEl.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.open) { e.preventDefault(); e.target.click(); } });
  document.querySelector(".tabbar").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });

  render();
  FE.onInstallChange(() => { if (state.screen === "settings") render(); });
  if (!settings.seller) askSeller();
  FE.registerSW();
})();
