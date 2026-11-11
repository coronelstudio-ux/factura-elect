/* Núcleo multiempresa compartido por las apps Admin, Facturador y Pedidos.
   Mientras no exista el servidor, todo se guarda en este dispositivo (localStorage):
     fe_empresas      lista de empresas clientes (datos técnicos y de presentación)
     fe_users         usuarios con su rol y las empresas a las que acceden
     fe_audit         registro de auditoría
     fac_<id>_...     datos de cada empresa (facturas, timbrados, pedidos, clientes, productos, preferencias)
   Cuando exista la base de datos, estas funciones pasan a leer y escribir en el servidor;
   las pantallas no tienen que cambiar. Ver docs/arquitectura-multiempresa.md. */
(function (global) {
  "use strict";
  const FE = global.FE;
  const { esc, toast, sheet, makeStore, randomId } = FE;
  const G = makeStore("fe_");

  // ================= Roles y permisos =================
  const ROLES = {
    maestro: { label: "Admin maestro", estudio: true, desc: "Todo el estudio: empresas, certificados, usuarios y producción." },
    operador: { label: "Operador del estudio", estudio: true, desc: "Configura las empresas que tiene asignadas. Sin acceso a certificados ni usuarios del estudio." },
    admincliente: { label: "Admin del cliente", estudio: false, desc: "Logo, productos, preferencias y usuarios de su empresa. Factura." },
    facturador: { label: "Facturador", estudio: false, desc: "Emite facturas, recibe pedidos y cancela dentro de las 48 h." },
    cargador: { label: "Cargador", estudio: false, desc: "Solo carga pedidos en la app Pedidos." }
  };
  const PERMS = {
    "admin.app": ["maestro", "operador"],
    "empresas.alta": ["maestro"],
    "empresa.tecnico": ["maestro", "operador"],
    "empresa.certificado": ["maestro"],
    "empresa.ambiente": ["maestro"],
    "timbrados.editar": ["maestro", "operador"],
    "usuarios.estudio": ["maestro"],
    "usuarios.empresa": ["maestro", "operador", "admincliente"],
    "cliente.config": ["maestro", "operador", "admincliente"],
    "facturar": ["maestro", "operador", "admincliente", "facturador"],
    "auditoria": ["maestro", "operador"]
  };
  // Sin usuario (modo de un solo dispositivo, sin usuarios cargados) se permite todo, como antes.
  const can = (user, perm) => !user || (PERMS[perm] || []).includes(user.role);

  // ================= Fechas =================
  const isoToDmy = v => v ? String(v).slice(8, 10) + "/" + String(v).slice(5, 7) + "/" + String(v).slice(0, 4) : "";
  const dmyToIso = v => { const m = String(v || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? m[3] + "-" + m[2] + "-" + m[1] : ""; };
  const daysUntil = iso => Math.round((Date.parse(iso) - Date.parse(FE.todayKey())) / 86400000);

  // ================= Empresas =================
  // Empresa de ejemplo (datos ficticios) para el primer uso
  const DEMO = {
    name: "Comercial Ejemplo S.A.", fantasy: "Ejemplo Store", ruc: "80012345", dv: "0",
    activity: "Venta al por menor de artículos de librería", address: "Av. Principal Nº 1234",
    city: "Asunción", phone: "021 000 000", mail: "facturacion@ejemplo.com.py",
    timbrado: "00000000", start: "01/11/2026", end: "31/10/2027",
    establishment: "001", point: "001", env: "test", certExpires: "15/03/2027", csc: "0001", logo: null,
    nextNumber: 13, taxpayerType: "2"
  };
  const listEmpresas = () => G.get("empresas", []);
  const getEmpresa = id => listEmpresas().find(e => e.id === id) || null;
  function saveEmpresa(e) {
    const l = listEmpresas(), i = l.findIndex(x => x.id === e.id);
    e.updatedAt = new Date().toISOString();
    if (i >= 0) l[i] = e; else l.push(e);
    G.set("empresas", l);
    return e;
  }
  const activeId = () => G.get("activeEmpresa", null);
  const setActive = id => G.set("activeEmpresa", id);
  const storeFor = id => makeStore("fac_" + id + "_");
  function newEmpresa(data) {
    return Object.assign({ id: randomId(6), createdAt: new Date().toISOString(), env: "test", establishment: "001", point: "001",
      taxpayerType: "2", csc: "0001", cscProd: "", cert: null, logo: null, status: "alta",
      onboarding: { step: 1, checks: {}, habilitado: false } }, data || {});
  }
  // Primer uso: crea la empresa de ejemplo y mueve los datos que ya tenía el Facturador (versión de una sola empresa).
  function ensureEmpresas() {
    let list = listEmpresas();
    if (!list.length) {
      const legacy = makeStore("fac_");
      const old = legacy.get("company", null);
      const emp = newEmpresa(Object.assign({}, DEMO, old || {}, { demo: true, status: "prueba" }));
      emp.cert = { titular: emp.name, ruc: emp.ruc + "-" + emp.dv, prestador: "Ejemplo (ficticio)", tipo: "F1", serie: "", desde: "2026-03-15",
        vence: dmyToIso(emp.certExpires) || "2027-03-15", archivo: false };
      emp.onboarding = { step: 5, checks: {}, habilitado: false };
      saveEmpresa(emp);
      const st = storeFor(emp.id);
      ["invoices", "pedidos", "clients", "timbrados"].forEach(k => { const v = legacy.get(k, null); if (v != null) st.set(k, v); });
      if (!st.get("timbrados", null)) st.set("timbrados", [{ id: randomId(6), number: emp.timbrado, start: dmyToIso(emp.start), end: dmyToIso(emp.end),
        nextNumber: emp.nextNumber || 1, active: true, createdAt: new Date().toISOString() }]);
      setActive(emp.id);
      list = listEmpresas();
    }
    if (!getEmpresa(activeId())) setActive(list[0].id);
    return getEmpresa(activeId());
  }

  // ================= Usuarios =================
  // { id, name, role, empresas: [ids] (no aplica a maestro), pin (hash), active, createdAt }
  const users = () => G.get("users", []);
  const saveUsers = l => G.set("users", l);
  const getUser = id => users().find(u => u.id === id) || null;
  const accessTo = (u, empId) => u.role === "maestro" || (u.empresas || []).includes(empId);
  const usersFor = (empId, roles) => users().filter(u => u.active !== false && (!roles || roles.includes(u.role)) && accessTo(u, empId));
  const empresasOf = u => !u ? listEmpresas() : listEmpresas().filter(e => accessTo(u, e.id));
  async function hashPin(pin, userId) {
    const text = "factura-elect:" + (userId || "") + ":" + pin;
    if (global.crypto && crypto.subtle && global.isSecureContext !== false) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return "s256:" + Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
    }
    return "fnv:" + FE.fnv32(text) + FE.fnv32(text.split("").reverse().join(""));
  }
  async function verifyPin(u, pin) {
    if (!u || !u.pin) return false;
    if (u.pin.startsWith("s256:") && !(global.crypto && crypto.subtle)) return false;
    return (await hashPin(pin, u.id)) === u.pin;
  }
  // Sesión por app (se cierra al cerrar el navegador)
  const sessionKey = app => "fe_session_" + app;
  function sessionUser(app) { try { return getUser(sessionStorage.getItem(sessionKey(app))); } catch (_) { return null; } }
  function setSession(app, u) { try { u ? sessionStorage.setItem(sessionKey(app), u.id) : sessionStorage.removeItem(sessionKey(app)); } catch (_) {} }

  // ================= Auditoría =================
  function audit(action, detail, empresaId, user) {
    const l = G.get("audit", []);
    l.unshift({ ts: new Date().toISOString(), action, detail: String(detail || ""), empresaId: empresaId || null,
      user: user ? user.name : "Este dispositivo", role: user ? user.role : "" });
    G.set("audit", l.slice(0, 2000));
  }
  const auditList = () => G.get("audit", []);

  // ================= Timbrados =================
  function timbradoStatus(t) {
    const today = FE.todayKey();
    if (!t) return "none";
    if (t.start && today < t.start) return "futuro";
    if (t.end && today > t.end) return "vencido";
    return "vigente";
  }
  const vigenciaText = t => t.end ? isoToDmy(t.start) + " al " + isoToDmy(t.end) : "Desde " + isoToDmy(t.start) + " · sin fecha de fin";
  function timbradoListHTML(list, opts) {
    opts = opts || {};
    const rows = list.slice().sort((a, b) => (b.active - a.active) || String(b.start).localeCompare(String(a.start))).map(t => {
      const st = timbradoStatus(t);
      const chip = t.active ? (st === "vigente" ? '<span class="chip ok">Activo</span>' : '<span class="chip bad">Activo · ' + st + '</span>')
        : st === "vencido" ? '<span class="chip neutral">Vencido</span>' : st === "futuro" ? '<span class="chip warn">Todavía no vigente</span>' : '<span class="chip neutral">Inactivo</span>';
      return `<div class="row" style="cursor:default;align-items:flex-start"><div class="main">
        <div class="title">Nº ${esc(t.number)}</div>
        <div class="sub">${esc(vigenciaText(t))}</div>
        <div class="sub">Próximo número: ${String(t.nextNumber).padStart(7, "0")}</div>
        <div style="margin-top:6px">${chip}</div></div>
        ${opts.editable ? `<span style="display:flex;flex-direction:column;align-items:flex-end">
          ${t.active ? "" : `<button class="link" data-timact="${esc(t.id)}" ${st === "vencido" ? "disabled" : ""}>Activar</button>`}
          <button class="link" data-timedit="${esc(t.id)}">Editar</button></span>` : ""}</div>`;
    }).join("");
    return (rows || `<div class="muted small">Todavía no hay timbrados cargados.</div>`) +
      (opts.editable ? `<button class="add" data-timadd>+ Cargar timbrado</button>` : "") +
      `<div class="muted small" style="margin-top:8px">${opts.editable ? "Todos los timbrados quedan guardados. Solo se factura con el activo, y solo mientras esté vigente."
        : "Los timbrados los administra el estudio."}</div>`;
  }
  const checkbox = (id, checked, text) => `<label style="display:flex;gap:10px;align-items:center;font-weight:600;color:var(--text);margin-top:12px">
    <input type="checkbox" id="${id}" ${checked ? "checked" : ""} style="width:22px;min-height:22px;height:22px;flex:none;appearance:auto"> ${text}</label>`;
  // Hoja para cargar o editar un timbrado. o: { list, t, used, onSave(list, message) }
  function timbradoSheet(o) {
    const list = o.list, t = o.t, editing = !!t, used = editing && !!o.used;
    const v = t || { number: "", start: FE.todayKey(), end: "", nextNumber: 1 };
    sheet(`<h3>${editing ? "Editar timbrado" : "Cargar timbrado"}</h3>
      ${used ? `<p class="muted small">Ya se emitieron facturas con este timbrado: el número y la fecha de inicio no se pueden cambiar.</p>` : ""}
      <label for="tNum">Número de timbrado (8 dígitos)</label>
      <input id="tNum" inputmode="numeric" maxlength="8" placeholder="12345678" value="${esc(v.number)}" ${used ? "disabled" : ""}>
      <div class="grid2">
        <div><label for="tStart">Fecha de inicio</label><input id="tStart" type="date" value="${esc(v.start)}" ${used ? "disabled" : ""}></div>
        <div><label for="tEnd">Fecha de fin</label><input id="tEnd" type="date" value="${esc(v.end)}" ${v.end ? "" : "disabled"}></div>
      </div>
      ${checkbox("tNoEnd", !v.end, "Sin fecha de fin")}
      <label for="tNext">${used ? "Próximo número de factura" : "Número de la primera factura"}</label>
      <input id="tNext" inputmode="numeric" value="${esc(v.nextNumber)}">
      ${editing ? "" : checkbox("tAct", true, "Activarlo ahora (el actual queda inactivo)")}
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      const noEnd = el.querySelector("#tNoEnd"), endEl = el.querySelector("#tEnd");
      noEnd.onchange = () => { endEl.disabled = noEnd.checked; if (noEnd.checked) endEl.value = ""; };
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const number = el.querySelector("#tNum").value.replace(/\D/g, ""), start = el.querySelector("#tStart").value;
        const end = noEnd.checked ? "" : endEl.value, next = parseInt(el.querySelector("#tNext").value.replace(/\D/g, ""), 10);
        if (!/^\d{8}$/.test(number)) { toast("El timbrado tiene que tener 8 dígitos"); return; }
        if (!start) { toast("Elegí la fecha de inicio"); return; }
        if (!noEnd.checked && !end) { toast("Elegí la fecha de fin o marcá «Sin fecha de fin»"); return; }
        if (end && end < start) { toast("La fecha de fin no puede ser anterior a la de inicio"); return; }
        if (!(next >= 1 && next <= 9999999)) { toast("El número de factura tiene que estar entre 1 y 9.999.999"); return; }
        if (list.some(x => x.number === number && x !== t)) { toast("Ese timbrado ya está cargado"); return; }
        let msg;
        if (editing) {
          if (used && next < t.nextNumber) { toast("El próximo número no puede ser menor a " + t.nextNumber + ": ya se usaron los anteriores"); return; }
          Object.assign(t, used ? { end, nextNumber: next } : { number, start, end, nextNumber: next });
          msg = t.active && timbradoStatus(t) === "vencido" ? "Atención: con esa fecha de fin el timbrado activo queda vencido" : "Timbrado " + t.number + " guardado";
        } else {
          const nt = { id: randomId(6), number, start, end, nextNumber: next, active: false, createdAt: new Date().toISOString() };
          const activate = el.querySelector("#tAct").checked;
          if (activate && timbradoStatus(nt) === "vencido") { toast("Ese timbrado ya está vencido: no se puede activar"); return; }
          if (activate) list.forEach(x => x.active = false);
          nt.active = activate; list.push(nt);
          msg = activate ? "Timbrado " + number + " cargado y activo" : "Timbrado " + number + " guardado";
        }
        close(); o.onSave(list, msg);
      };
    });
  }
  function activateTimbrado(list, id) {
    const t = list.find(x => x.id === id);
    if (!t || timbradoStatus(t) === "vencido") return null;
    list.forEach(x => x.active = x.id === id);
    return t;
  }

  // ================= Certificado =================
  // cert: { titular, ruc, prestador, tipo, serie, desde, vence, archivo } — el archivo .p12 y su contraseña NUNCA se guardan aquí.
  function certStatus(cert) {
    if (!cert || !cert.vence) return { state: "none", days: null, text: "Sin certificado cargado" };
    const days = daysUntil(cert.vence);
    if (days < 0) return { state: "expired", days, text: "Venció el " + isoToDmy(cert.vence) };
    if (days <= 30) return { state: "warn", days, text: "Vence en " + days + " día(s), el " + isoToDmy(cert.vence) };
    return { state: "ok", days, text: "Vigente hasta el " + isoToDmy(cert.vence) };
  }
  const PRESTADORES = ["Confirma", "ITTI", "SOS Tecnología", "Otro prestador habilitado"];

  // ================= Alertas y cola de envío =================
  const SEND_LIMIT_H = 72;
  function queueFor(emp) {
    return storeFor(emp.id).get("invoices", []).filter(i => i.status === "warn").map(i => {
      const hours = (Date.now() - Date.parse(i.date)) / 3600000;
      return { invoice: i, hours, late: hours > SEND_LIMIT_H, left: Math.max(0, SEND_LIMIT_H - hours) };
    });
  }
  function alertsFor(emp) {
    const st = storeFor(emp.id), out = [];
    const tims = st.get("timbrados", []), act = tims.find(t => t.active), ts = timbradoStatus(act);
    if (ts === "none") out.push({ level: "bad", kind: "timbrado", text: "Sin timbrado activo: no puede facturar" });
    else if (ts === "vencido") out.push({ level: "bad", kind: "timbrado", text: "Timbrado " + act.number + " vencido el " + isoToDmy(act.end) });
    else if (ts === "futuro") out.push({ level: "warn", kind: "timbrado", text: "Timbrado " + act.number + " empieza el " + isoToDmy(act.start) });
    else if (act.end && daysUntil(act.end) <= 30) out.push({ level: "warn", kind: "timbrado", text: "Timbrado " + act.number + " vence en " + daysUntil(act.end) + " día(s)" });
    const cs = certStatus(emp.cert);
    if (cs.state === "none") out.push({ level: "warn", kind: "certificado", text: "Certificado sin cargar" });
    else if (cs.state === "expired") out.push({ level: "bad", kind: "certificado", text: "Certificado vencido (" + isoToDmy(emp.cert.vence) + ")" });
    else if (cs.state === "warn") out.push({ level: "warn", kind: "certificado", text: "Certificado vence en " + cs.days + " día(s)" });
    if (emp.env !== "prod") out.push({ level: "info", kind: "ambiente", text: "En ambiente de prueba" });
    const inv = st.get("invoices", []);
    const rejected = inv.filter(i => i.status === "bad" && !i.cancelled).length;
    if (rejected) out.push({ level: "bad", kind: "rechazadas", text: rejected + " factura(s) rechazada(s) por corregir" });
    const q = queueFor(emp), late = q.filter(x => x.late).length;
    if (late) out.push({ level: "bad", kind: "envio", text: late + " factura(s) sin enviar hace más de 72 h" });
    if (q.length - late) out.push({ level: "warn", kind: "envio", text: (q.length - late) + " factura(s) pendiente(s) de envío" });
    return out;
  }

  // ================= Catálogo de productos por QR =================
  // product: { id, code, desc, price, tax, unit }
  function encodeCatalog(products, empresaName) {
    const json = JSON.stringify({ v: 1, e: empresaName || "", p: products.map(p => [p.code || "", p.desc, p.price, p.tax]) });
    const data = global.LZString.compressToBase64(json);
    return "FEC1." + FE.fnv32(data) + "." + data;
  }
  function decodeCatalog(text) {
    const m = String(text || "").replace(/\s+/g, "").match(/FEC1\.([0-9a-f]{8})\.([A-Za-z0-9+/=]+)/);
    if (!m) return { ok: false, error: "No es un código de catálogo de productos." };
    if (FE.fnv32(m[2]) !== m[1]) return { ok: false, error: "El código del catálogo está incompleto o fue modificado." };
    try {
      const o = JSON.parse(global.LZString.decompressFromBase64(m[2]));
      if (!o || o.v !== 1 || !Array.isArray(o.p)) throw new Error("formato");
      return { ok: true, empresa: String(o.e || ""), products: o.p.map(a => ({ id: randomId(6), code: String(a[0] || ""), desc: String(a[1] || ""),
        price: Number(a[2]) || 0, tax: ["10", "5", "E"].includes(a[3]) ? a[3] : "10" })).filter(p => p.desc) };
    } catch (_) { return { ok: false, error: "No se pudo leer el catálogo." }; }
  }
  function productSheet(p, onSave) {
    const v = p || { code: "", desc: "", price: "", tax: "10" };
    sheet(`<h3>${p ? "Editar producto" : "Nuevo producto frecuente"}</h3>
      <div class="grid2">
        <div><label for="pCode">Código (opcional)</label><input id="pCode" value="${esc(v.code)}" placeholder="Ej. RES-A4"></div>
        <div><label for="pTax">Impuesto</label><select id="pTax">
          <option value="10" ${v.tax === "10" ? "selected" : ""}>IVA 10%</option><option value="5" ${v.tax === "5" ? "selected" : ""}>IVA 5%</option>
          <option value="E" ${v.tax === "E" ? "selected" : ""}>Exento</option></select></div>
      </div>
      <label for="pDesc">Descripción</label><input id="pDesc" value="${esc(v.desc)}" placeholder="Ej. Resma A4 500 hojas">
      <label for="pPrice">Precio unitario (Gs)</label><input id="pPrice" inputmode="numeric" value="${v.price === "" ? "" : FE.fmt(v.price)}">
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const desc = el.querySelector("#pDesc").value.trim();
        const price = FE.parseAmount(el.querySelector("#pPrice").value);
        if (!desc) { toast("Escribí la descripción"); return; }
        if (price <= 0) { toast("El precio tiene que ser mayor a cero"); return; }
        close();
        onSave(Object.assign({ id: (p && p.id) || randomId(6) }, { code: el.querySelector("#pCode").value.trim(), desc, price, tax: el.querySelector("#pTax").value }));
      };
      setTimeout(() => el.querySelector("#pDesc").focus(), 60);
    });
  }

  // ================= Firma electrónica (punto de conexión) =================
  // Hoy simula la firma. Cuando exista el servidor, firmar() enviará el XML al servicio "Firmador",
  // que guarda cifrado el certificado .p12 de cada empresa y devuelve el XML firmado (XMLDSig enveloped
  // sobre el nodo <DE>, RSA-SHA256, digest SHA-256, C14N exclusivo). Ver docs/firma-electronica.md.
  const Firmador = {
    modo: "simulado",
    async firmar(o) {
      const digestValue = await FE.simulatedDigest(Object.assign({ cdc: o.cdc }, o.payload || {}));
      return { ok: true, simulated: true, digestValue, signedAt: new Date().toISOString(),
        algoritmo: "rsa-sha256", certificado: o.empresa && o.empresa.cert ? { titular: o.empresa.cert.titular, vence: o.empresa.cert.vence } : null };
    }
  };

  // ================= Alta guiada =================
  const ONBOARDING = [
    { n: 1, title: "Empresa y RUC" },
    { n: 2, title: "Establecimiento y punto" },
    { n: 3, title: "Certificado" },
    { n: 4, title: "Timbrado y CSC de prueba" },
    { n: 5, title: "Pruebas con la DNIT" },
    { n: 6, title: "Habilitación y producción" }
  ];
  const TEST_CHECKS = [
    ["xml", "XML validado contra el XSD vigente"],
    ["prevalidador", "XML aprobado por el prevalidador de la DNIT"],
    ["firma", "Firma XMLDSig con el certificado de la empresa"],
    ["mtls", "Conexión con autenticación mutua al servicio de prueba"],
    ["minimos", "Pruebas mínimas: 5 aprobados y 5 rechazados por tipo, síncrono y asíncrono"],
    ["eventos", "Eventos: cancelación, inutilización y eventos del receptor"],
    ["consultas", "Consultas por CDC y por QR"],
    ["kude", "KuDE en PDF por tipo de documento con leyenda de prueba"]
  ];

  // ================= Hojas comunes =================
  // Hoja de usuario. o: { user, roles: [roles permitidos], empresas: [{id,name}], fixedEmpresa, onSave(users) }
  function userSheet(o) {
    const u = o.user, list = users();
    const v = u || { name: "", role: o.roles[0], empresas: o.fixedEmpresa ? [o.fixedEmpresa] : [], active: true };
    sheet(`<h3>${u ? "Editar usuario" : "Nuevo usuario"}</h3>
      <label for="uName">Nombre</label><input id="uName" value="${esc(v.name)}" placeholder="Ej. Ana Benítez">
      <label for="uRole">Rol</label><select id="uRole">${o.roles.map(r => `<option value="${r}" ${v.role === r ? "selected" : ""}>${esc(ROLES[r].label)}</option>`).join("")}</select>
      <div class="muted small" id="uRoleDesc" style="margin-top:6px">${esc(ROLES[v.role].desc)}</div>
      ${o.fixedEmpresa ? "" : `<div id="uEmpWrap"><label>Empresas a las que accede</label>
        <div class="card" style="padding:4px 14px">${o.empresas.length ? o.empresas.map(e => `<label style="display:flex;gap:10px;align-items:center;margin:8px 0;color:var(--text);font-weight:500">
          <input type="checkbox" data-emp="${esc(e.id)}" ${(v.empresas || []).includes(e.id) ? "checked" : ""} style="width:20px;min-height:20px;height:20px;flex:none;appearance:auto"> ${esc(e.name)}</label>`).join("")
          : `<div class="muted small" style="padding:8px 0">Todavía no hay empresas.</div>`}</div></div>`}
      <label for="uPin">${u ? "PIN nuevo (dejalo vacío para no cambiarlo)" : "PIN (4 a 6 números)"}</label>
      <input id="uPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off">
      ${u ? checkbox("uActive", v.active !== false, "Usuario activo") : ""}
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      const roleSel = el.querySelector("#uRole"), wrap = el.querySelector("#uEmpWrap");
      const sync = () => { el.querySelector("#uRoleDesc").textContent = ROLES[roleSel.value].desc; if (wrap) wrap.style.display = roleSel.value === "maestro" ? "none" : ""; };
      roleSel.onchange = sync; sync();
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = async () => {
        const name = el.querySelector("#uName").value.trim(), role = roleSel.value, pin = el.querySelector("#uPin").value.trim();
        if (!name) { toast("Escribí el nombre"); return; }
        if (list.some(x => x.name.toLowerCase() === name.toLowerCase() && (!u || x.id !== u.id))) { toast("Ya hay un usuario con ese nombre"); return; }
        if ((!u || pin) && !/^\d{4,6}$/.test(pin)) { toast("El PIN tiene que tener de 4 a 6 números"); return; }
        const emps = o.fixedEmpresa ? Array.from(new Set([...(v.empresas || []), o.fixedEmpresa])) : Array.from(el.querySelectorAll("[data-emp]:checked")).map(c => c.dataset.emp);
        if (role !== "maestro" && !emps.length) { toast("Elegí al menos una empresa"); return; }
        const target = u ? list.find(x => x.id === u.id) : { id: randomId(8), createdAt: new Date().toISOString() };
        Object.assign(target, { name, role, empresas: role === "maestro" ? [] : emps, active: u ? el.querySelector("#uActive").checked : true });
        if (pin) target.pin = await hashPin(pin, target.id);
        if (!u) list.push(target);
        saveUsers(list); close(); o.onSave(list, target);
      };
      setTimeout(() => el.querySelector("#uName").focus(), 60);
    });
  }
  // Pantalla de ingreso: elegir usuario y escribir su PIN. o: { title, users, onSuccess(user) }
  function loginOverlay(o) {
    if (document.querySelector(".lock")) return;
    const el = document.createElement("div");
    el.className = "lock";
    el.innerHTML = `<div class="box">
      <div style="font-size:40px;line-height:1">&#128274;</div>
      <h2>${esc(o.title)}</h2>
      <p class="lead">Elegí tu usuario e ingresá tu PIN.</p>
      <select id="lgUser" style="text-align:left">${o.users.map(u => `<option value="${esc(u.id)}">${esc(u.name)} · ${esc(ROLES[u.role].label)}</option>`).join("")}</select>
      <input id="lgPin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••" style="margin-top:10px">
      <button class="btn primary" id="lgOk" style="margin-top:14px">Entrar</button>
      <div class="muted small" style="margin-top:10px">¿Olvidaste el PIN? Pedile al admin maestro que te asigne uno nuevo.</div>
    </div>`;
    document.body.appendChild(el);
    const pinEl = el.querySelector("#lgPin");
    const submit = async () => {
      const u = getUser(el.querySelector("#lgUser").value), pin = pinEl.value.trim();
      if (await verifyPin(u, pin)) { el.remove(); o.onSuccess(u); }
      else { pinEl.value = ""; toast("PIN incorrecto"); }
    };
    el.querySelector("#lgOk").onclick = submit;
    el.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    setTimeout(() => pinEl.focus(), 60);
  }
  function changeOwnPin(u, onDone) {
    sheet(`<h3>Cambiar mi PIN</h3>
      <label for="cOld">PIN actual</label><input id="cOld" type="password" inputmode="numeric" maxlength="6">
      <label for="cNew">PIN nuevo (4 a 6 números)</label><input id="cNew" type="password" inputmode="numeric" maxlength="6">
      <label for="cNew2">Repetí el PIN nuevo</label><input id="cNew2" type="password" inputmode="numeric" maxlength="6">
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = async () => {
        const fresh = getUser(u.id);
        const a = el.querySelector("#cOld").value.trim(), n = el.querySelector("#cNew").value.trim(), n2 = el.querySelector("#cNew2").value.trim();
        if (!(await verifyPin(fresh, a))) { toast("El PIN actual no es correcto"); return; }
        if (!/^\d{4,6}$/.test(n)) { toast("El PIN nuevo tiene que tener de 4 a 6 números"); return; }
        if (n !== n2) { toast("Los PIN nuevos no coinciden"); return; }
        const list = users(), me = list.find(x => x.id === u.id);
        me.pin = await hashPin(n, me.id); saveUsers(list); close(); toast("PIN cambiado"); onDone && onDone();
      };
    });
  }
  function empresaPicker(list, currentId, onPick) {
    sheet(`<h3>Cambiar de empresa</h3>
      <div style="margin-top:6px">${list.map(e => `<div class="row" data-pickemp="${esc(e.id)}"><div class="main"><div class="title">${esc(e.name)}</div>
        <div class="sub">RUC ${esc(e.ruc)}-${esc(e.dv)} · ${e.env === "prod" ? "Producción" : "Prueba"}</div></div>
        ${e.id === currentId ? '<span class="chip ok">Actual</span>' : '<span class="link">Elegir</span>'}</div>`).join("")}</div>
      <button class="btn" data-x style="margin-top:12px">Cerrar</button>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.addEventListener("click", e => { const r = e.target.closest("[data-pickemp]"); if (r) { close(); onPick(r.dataset.pickemp); } });
    });
  }

  FE.T = {
    ROLES, PERMS, can, isoToDmy, dmyToIso, daysUntil, DEMO,
    listEmpresas, getEmpresa, saveEmpresa, activeId, setActive, storeFor, newEmpresa, ensureEmpresas,
    users, saveUsers, getUser, usersFor, empresasOf, accessTo, hashPin, verifyPin, sessionUser, setSession,
    audit, auditList, timbradoStatus, vigenciaText, timbradoListHTML, timbradoSheet, activateTimbrado,
    certStatus, PRESTADORES, queueFor, alertsFor, SEND_LIMIT_H, encodeCatalog, decodeCatalog, productSheet,
    Firmador, ONBOARDING, TEST_CHECKS, userSheet, loginOverlay, changeOwnPin, empresaPicker, checkbox
  };
})(window);
