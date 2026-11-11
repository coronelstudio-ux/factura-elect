/* App Admin (estudio): administra varias empresas clientes desde un solo lugar.
   Admin maestro: todo. Operador del estudio: solo las empresas asignadas, sin certificados ni usuarios del estudio.
   Mientras no exista el servidor, los datos viven en este dispositivo (ver shared/tenant.js). */
(function () {
  "use strict";
  const { fmt, esc, fmtDate, toast, sheet, confirmSheet, parseRuc, dv11 } = FE;
  const T = FE.T;
  T.ensureEmpresas();

  let user = null;
  const can = p => T.can(user, p);
  const log = (action, detail, empId) => T.audit(action, detail, empId || null, user);
  const state = { screen: "panel", empId: null, alta: null, auditEmp: "" };
  const myEmpresas = () => T.empresasOf(user);
  const STUDIO_ROLES = ["maestro", "operador"];

  // ================= Utilidades =================
  const chip = (cls, text) => `<span class="chip ${cls}">${esc(text)}</span>`;
  function statusChip(e) {
    if (e.env === "prod") return chip("ok", "Producción");
    const step = (e.onboarding && e.onboarding.step) || 1;
    return step < 5 ? chip("warn", "En alta · paso " + step + " de 6") : chip("neutral", "Prueba");
  }
  const levelCls = l => l === "bad" ? "bad" : l === "warn" ? "warn" : "neutral";
  const section = (title, body, extra) => `<div class="section"><div class="section-title">${title}${extra || ""}</div>${body}</div>`;
  const invoicesOf = e => T.storeFor(e.id).get("invoices", []);
  const timbradosOf = e => T.storeFor(e.id).get("timbrados", []);

  // ================= Pantallas =================
  function screenPanel() {
    const emps = myEmpresas();
    const all = emps.map(e => ({ e, alerts: T.alertsFor(e) }));
    const problems = all.flatMap(x => x.alerts.filter(a => a.level !== "info").map(a => Object.assign({ e: x.e }, a)))
      .sort((a, b) => (a.level === "bad" ? 0 : 1) - (b.level === "bad" ? 0 : 1));
    const queue = emps.flatMap(e => T.queueFor(e).map(q => Object.assign({ e }, q))).sort((a, b) => b.hours - a.hours);
    const prod = emps.filter(e => e.env === "prod").length;
    return `
      <div class="hero">
        <div class="label">Empresas a cargo</div>
        <div class="value">${emps.length}</div>
        <div class="meta">${prod} en producción · ${emps.length - prod} en prueba o en alta · ${problems.length} alerta(s)</div>
      </div>
      <div class="quick">
        ${can("empresas.alta") ? `<button class="btn primary" data-newemp>Nueva empresa</button>` : ""}
        <button class="btn soft" data-go="empresas">Ver empresas</button>
      </div>
      ${section("Alertas", `<div class="card">${problems.length ? problems.map(a => `<div class="row" data-openemp="${esc(a.e.id)}" role="button" tabindex="0">
          <div class="main"><div class="title">${esc(a.e.name)}</div><div class="sub">${esc(a.text)}</div></div>${chip(levelCls(a.level), a.level === "bad" ? "Urgente" : "Atención")}</div>`).join("")
        : `<div class="muted small">Todo en orden: certificados, timbrados y envíos al día.</div>`}</div>`)}
      ${section("Cola de envíos a SIFEN", `<div class="card">${queue.length ? queue.map(q => `<div class="row" data-openemp="${esc(q.e.id)}" role="button" tabindex="0">
          <div class="main"><div class="title">${esc(q.invoice.number)} · ${esc(q.e.name)}</div><div class="sub">${esc(q.invoice.client)} · Gs ${fmt(q.invoice.total)}</div></div>
          ${q.late ? chip("bad", "Pasaron las 72 h") : chip("warn", "Quedan " + Math.floor(q.left) + " h")}</div>`).join("")
        : `<div class="muted small">No hay facturas pendientes de envío.</div>`}
        <div class="muted small" style="margin-top:8px">Plazo: 72 horas desde la firma. El envío y los reintentos los hará el servidor; hoy la respuesta de SIFEN es simulada.</div></div>`)}`;
  }

  function screenEmpresas() {
    const emps = myEmpresas();
    return `
      <h2>Empresas</h2>
      <div class="card">${emps.length ? emps.map(e => {
        const n = T.alertsFor(e).filter(a => a.level !== "info").length;
        return `<div class="row" data-openemp="${esc(e.id)}" role="button" tabindex="0"><div class="main"><div class="title">${esc(e.name)}</div>
          <div class="sub">RUC ${esc(e.ruc)}-${esc(e.dv)}${n ? " · " + n + " alerta(s)" : ""}</div></div>
          <div style="text-align:right">${statusChip(e)}</div></div>`; }).join("") : `<div class="muted small">No tenés empresas asignadas.</div>`}</div>
      ${can("empresas.alta") ? `<button class="btn primary" data-newemp style="margin-top:14px">Nueva empresa (alta guiada)</button>` : ""}`;
  }

  function screenEmpresa() {
    const e = T.getEmpresa(state.empId);
    if (!e || !T.accessTo(user, e.id) && user.role !== "maestro") return screenEmpresas();
    const alerts = T.alertsFor(e), cs = T.certStatus(e.cert), inv = invoicesOf(e), tims = timbradosOf(e);
    const step = (e.onboarding && e.onboarding.step) || 1;
    const empUsers = T.usersFor(e.id).filter(u => !T.ROLES[u.role].estudio);
    const kv = (k, v) => `<div class="kv"><span class="muted">${k}</span><span>${v}</span></div>`;
    return `
      <button class="link" data-go="empresas">← Empresas</button>
      <h2>${esc(e.name)}</h2>
      <div style="margin-bottom:10px">${statusChip(e)} ${e.demo ? chip("neutral", "Datos de ejemplo") : ""}</div>
      ${alerts.filter(a => a.level !== "info").map(a => `<div class="notice ${a.level === "bad" ? "bad" : "warn"}" style="margin-top:6px">${esc(a.text)}</div>`).join("")}
      <a class="btn soft" href="../facturador/" data-openfac="${esc(e.id)}" style="display:flex;align-items:center;justify-content:center;margin-top:12px;text-decoration:none">Abrir en el Facturador</a>
      ${step < 6 && e.env !== "prod" && can("empresa.tecnico") ? `<button class="btn" data-continuealta style="margin-top:10px">Continuar el alta guiada (paso ${step} de 6)</button>` : ""}
      ${section("Datos de la empresa", `<div class="card">
          ${kv("RUC", esc(e.ruc) + "-" + esc(e.dv))}${kv("Nombre de fantasía", esc(e.fantasy || "-"))}${kv("Actividad", esc(e.activity || "-"))}
          ${kv("Dirección", esc((e.address || "") + (e.city ? " · " + e.city : "")))}${kv("Teléfono y correo", esc((e.phone || "-") + " · " + (e.mail || "-")))}
          ${kv("Tipo de contribuyente", e.taxpayerType === "1" ? "Persona física" : "Persona jurídica")}${kv("Establecimiento y punto", esc(e.establishment) + "-" + esc(e.point))}
          ${can("empresa.tecnico") ? `<button class="btn soft" data-editdatos style="margin-top:10px">Editar datos</button>` : ""}
        </div>`)}
      ${section("Certificado de firma", `<div class="card">
          ${kv("Estado", esc(cs.text))}
          ${can("empresa.certificado") && e.cert ? kv("Titular", esc(e.cert.titular || "-")) + kv("RUC del certificado", esc(e.cert.ruc || "-")) + kv("Prestador", esc(e.cert.prestador || "-")) +
            kv("Tipo", esc(e.cert.tipo || "F1")) + kv("Vigencia", T.isoToDmy(e.cert.desde) + " al " + T.isoToDmy(e.cert.vence)) : ""}
          ${can("empresa.certificado") ? `<button class="btn soft" data-editcert style="margin-top:10px">${e.cert ? "Actualizar certificado" : "Registrar certificado"}</button>`
            : `<div class="muted small" style="margin-top:6px">Los certificados los administra el admin maestro.</div>`}
          <div class="muted small" style="margin-top:8px">Aquí se registran solo los datos. El archivo .p12 y su contraseña se cargarán en el servidor (servicio Firmador), nunca en el celular.</div>
        </div>`)}
      ${section("Timbrados", `<div class="card">${T.timbradoListHTML(tims, { editable: can("timbrados.editar") })}</div>`)}
      ${section("CSC y ambiente", `<div class="card">
          ${kv("IdCSC de prueba", esc(e.csc || "-"))}${kv("IdCSC de producción", esc(e.cscProd || "Sin cargar"))}${kv("Ambiente", e.env === "prod" ? "Producción" : "Prueba")}
          ${can("empresa.ambiente") ? `<div class="seg" style="margin-top:8px"><button data-setenv="test" class="${e.env !== "prod" ? "on" : ""}">Prueba</button><button data-setenv="prod" class="${e.env === "prod" ? "on" : ""}">Producción</button></div>` : ""}
          ${can("empresa.tecnico") ? `<button class="btn soft" data-editcsc style="margin-top:10px">Editar IdCSC</button>` : ""}
        </div>`)}
      ${section("Facturas", `<div class="card">
          ${kv("Aprobadas", inv.filter(i => i.status === "ok").length)}${kv("Rechazadas por corregir", inv.filter(i => i.status === "bad" && !i.cancelled).length)}
          ${kv("Canceladas", inv.filter(i => i.cancelled).length)}${kv("Pendientes de envío", inv.filter(i => i.status === "warn").length)}
        </div>`)}
      ${section("Usuarios de la empresa", `<div class="card">
          ${empUsers.length ? empUsers.map(u => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(u.name)}${u.active === false ? " (inactivo)" : ""}</div>
            <div class="sub">${esc(T.ROLES[u.role].label)}</div></div>${can("usuarios.empresa") ? `<button class="link" data-useredit="${esc(u.id)}">Editar</button>` : ""}</div>`).join("")
            : `<div class="muted small">Sin usuarios propios. Mientras no tenga, el Facturador usa el PIN del dispositivo o los usuarios del estudio.</div>`}
          ${can("usuarios.empresa") ? `<button class="add" data-empuseradd>+ Agregar usuario</button>` : ""}
        </div>`)}`;
  }

  function screenUsuarios() {
    if (!can("usuarios.estudio")) return screenPanel();
    const list = T.users(), emps = T.listEmpresas();
    const empNames = u => u.role === "maestro" ? "Todas las empresas" : (u.empresas || []).map(id => (emps.find(e => e.id === id) || {}).name).filter(Boolean).join(", ");
    return `
      <h2>Usuarios</h2>
      <p class="lead">Cada persona entra con su PIN y ve solo lo que su rol permite.</p>
      <div class="card">${list.map(u => `<div class="row" style="cursor:default;align-items:flex-start"><div class="main"><div class="title">${esc(u.name)}${u.active === false ? " (inactivo)" : ""}</div>
          <div class="sub">${esc(T.ROLES[u.role].label)}</div><div class="sub">${esc(empNames(u) || "Sin empresas")}</div></div>
          <button class="link" data-usereditall="${esc(u.id)}">Editar</button></div>`).join("")}</div>
      <button class="btn primary" data-useraddall style="margin-top:14px">Nuevo usuario</button>
      ${section("Roles", `<div class="card">${Object.keys(T.ROLES).map(r => `<div class="kv"><span><b>${esc(T.ROLES[r].label)}</b><br><span class="small muted">${esc(T.ROLES[r].desc)}</span></span></div>`).join("")}</div>`)}`;
  }

  function screenAuditoria() {
    const emps = myEmpresas(), ids = new Set(emps.map(e => e.id));
    const visible = T.auditList().filter(a => (user.role === "maestro" || !a.empresaId || ids.has(a.empresaId)) && (!state.auditEmp || a.empresaId === state.auditEmp)).slice(0, 300);
    const empName = id => (T.getEmpresa(id) || {}).name || "General";
    return `
      <h2>Auditoría</h2>
      <label for="audEmp">Empresa</label>
      <select id="audEmp" class="inline"><option value="">Todas</option>${emps.map(e => `<option value="${esc(e.id)}" ${state.auditEmp === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>
      <div class="card" style="margin-top:12px">${visible.length ? visible.map(a => `<div class="kv" style="align-items:flex-start"><span><b>${esc(a.action)}</b>${a.detail ? `<br><span class="small">${esc(a.detail)}</span>` : ""}
          <br><span class="small muted">${esc(a.user)} · ${esc(empName(a.empresaId))}</span></span><span class="small muted" style="white-space:nowrap">${fmtDate(a.ts)}</span></div>`).join("")
        : `<div class="muted small">Sin registros todavía.</div>`}</div>`;
  }

  function screenAjustes() {
    return `
      <h2>Ajustes</h2>
      ${section("Sesión", `<div class="card">
          <div class="kv"><span class="muted">Usuario</span><span>${esc(user.name)} · ${esc(T.ROLES[user.role].label)}</span></div>
          <div class="btn-row" style="margin-top:10px"><button class="btn soft" data-mypin>Cambiar mi PIN</button><button class="btn" data-logout>Cerrar sesión</button></div>
        </div>`)}
      ${section("Apariencia", FE.themeHTML())}
      ${section("Instalar en este dispositivo", `<div class="card">${FE.installHTML("Admin")}</div>`)}
      ${user.role === "maestro" ? section("Respaldo completo", `<div class="card">
          <p class="small muted" style="margin-top:0">Empresas, usuarios, auditoría y los datos de todas las empresas guardados en este dispositivo.</p>
          <div class="btn-row"><button class="btn soft" data-backupall>Descargar respaldo</button>
          <label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Restaurar<input type="file" id="restoreAll" accept="application/json,.json" hidden></label></div>
        </div>`) : ""}
      <div class="muted small" style="margin-top:16px">Mientras no exista el servidor, esta app administra los datos guardados en este dispositivo. Ver docs/arquitectura-multiempresa.md.</div>`;
  }

  // ================= Alta guiada =================
  function screenAlta() {
    const a = state.alta; if (!a) return screenEmpresas();
    const e = a.emp, step = a.step;
    const nav = `<div style="display:flex;gap:6px;margin:8px 0 4px">${T.ONBOARDING.map(s => `<span title="${esc(s.title)}" style="flex:1;height:6px;border-radius:3px;background:${s.n <= step ? "var(--accent)" : "var(--border)"}"></span>`).join("")}</div>
      <div class="muted small">Paso ${step} de 6 · ${esc(T.ONBOARDING[step - 1].title)}</div>`;
    const inp = (id, label, val, extra) => `<label for="${id}">${label}</label><input id="${id}" value="${esc(val || "")}" ${extra || ""}>`;
    let body = "";
    if (step === 1) {
      body = `${inp("aName", "Razón social", e.name, 'placeholder="Ej. Comercial Ejemplo S.A."')}
        ${inp("aRuc", "RUC con dígito verificador", e.ruc ? e.ruc + "-" + e.dv : "", 'placeholder="80012345-0"')}
        ${inp("aFantasy", "Nombre de fantasía (opcional)", e.fantasy)}
        ${inp("aActivity", "Actividad económica", e.activity)}
        ${inp("aAddress", "Dirección", e.address)}
        <div class="grid2"><div>${inp("aCity", "Ciudad", e.city)}</div><div>${inp("aPhone", "Teléfono", e.phone, 'inputmode="tel"')}</div></div>
        ${inp("aMail", "Correo", e.mail, 'type="email"')}
        <label>Tipo de contribuyente</label>
        <div class="seg"><button data-tptype="1" class="${e.taxpayerType === "1" ? "on" : ""}">Persona física</button><button data-tptype="2" class="${e.taxpayerType !== "1" ? "on" : ""}">Persona jurídica</button></div>
        <div class="muted small" style="margin-top:6px">Los datos tienen que ser iguales a los de Marangatu.</div>`;
    } else if (step === 2) {
      body = `<div class="grid2"><div>${inp("aEst", "Establecimiento", e.establishment, 'inputmode="numeric" maxlength="3"')}</div><div>${inp("aPoint", "Punto de expedición", e.point, 'inputmode="numeric" maxlength="3"')}</div></div>
        <div class="muted small" style="margin-top:6px">Tres dígitos cada uno, por ejemplo 001 y 001. Van en el número de factura y en el CDC.</div>`;
    } else if (step === 3) {
      const c = e.cert || { titular: e.name, ruc: e.ruc + "-" + e.dv, prestador: T.PRESTADORES[0], tipo: "F1", desde: FE.todayKey(), vence: "" };
      body = `<div class="notice ok" style="margin-top:0">El certificado F1 (archivo .p12) lo emite un prestador habilitado. Aquí se registran sus datos para controlar el vencimiento; el archivo se cargará en el servidor.</div>
        ${inp("cTit", "Titular", c.titular)}${inp("cRuc", "RUC del certificado", c.ruc)}
        <label for="cPre">Prestador</label><select id="cPre">${T.PRESTADORES.map(p => `<option ${c.prestador === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        ${inp("cSerie", "Número de serie (opcional)", c.serie)}
        <div class="grid2"><div>${inp("cDesde", "Válido desde", c.desde, 'type="date"')}</div><div>${inp("cVence", "Vence", c.vence, 'type="date"')}</div></div>
        <button class="link" data-altaskip>Lo registro después</button>`;
    } else if (step === 4) {
      const tims = timbradosOf(e), act = tims.find(t => t.active);
      body = `${act ? `<div class="notice ok" style="margin-top:0"><b>Timbrado activo ${esc(act.number)}</b>${esc(T.vigenciaText(act))}</div>` : ""}
        ${inp("tNum4", "Número de timbrado (8 dígitos)", act ? act.number : "", 'inputmode="numeric" maxlength="8"')}
        <div class="grid2"><div>${inp("tStart4", "Fecha de inicio", act ? act.start : FE.todayKey(), 'type="date"')}</div><div>${inp("tEnd4", "Fecha de fin (vacío = sin fin)", act ? act.end : "", 'type="date"')}</div></div>
        ${inp("tNext4", "Número de la primera factura", act ? act.nextNumber : 1, 'inputmode="numeric"')}
        ${inp("aCsc", "IdCSC de prueba", e.csc || "0001", 'inputmode="numeric" maxlength="4"')}
        <div class="muted small" style="margin-top:6px">En prueba se usa el CSC del manual. El CSC de producción se carga en el paso 6.</div>`;
    } else if (step === 5) {
      const ch = (e.onboarding && e.onboarding.checks) || {};
      body = `<p class="small muted" style="margin-top:0">Marcá lo que ya se completó en el ambiente de prueba de la DNIT. Esto requiere el servidor (XML, firma y envío).</p>
        <div class="card">${T.TEST_CHECKS.map(([k, t]) => `<label style="display:flex;gap:10px;align-items:flex-start;margin:10px 0;color:var(--text);font-weight:500">
          <input type="checkbox" data-check="${k}" ${ch[k] ? "checked" : ""} style="width:20px;min-height:20px;height:20px;flex:none;margin-top:2px;appearance:auto"> ${esc(t)}</label>`).join("")}</div>`;
    } else {
      const ob = e.onboarding || {}, ch = ob.checks || {}, done = T.TEST_CHECKS.filter(([k]) => ch[k]).length, cs = T.certStatus(e.cert);
      body = `${T.checkbox("aHab", ob.habilitado, "Habilitación aprobada en Marangatu (timbrado electrónico de producción obtenido)")}
        ${inp("aCscProd", "IdCSC de producción", e.cscProd, 'inputmode="numeric" maxlength="4"')}
        <div class="card" style="margin-top:12px">
          <div class="kv"><span class="muted">Pruebas completadas</span><span>${done} de ${T.TEST_CHECKS.length}</span></div>
          <div class="kv"><span class="muted">Certificado</span><span>${esc(cs.text)}</span></div>
        </div>
        <div class="muted small" style="margin-top:8px">Para pasar a producción hace falta: habilitación aprobada, IdCSC de producción, certificado vigente y todas las pruebas completadas. Recordá cargar el timbrado de producción en Timbrados.</div>
        ${user.role === "maestro" ? `<button class="btn primary" data-altaprod style="margin-top:12px">Pasar a producción</button>` : `<div class="muted small" style="margin-top:8px">El paso a producción lo hace el admin maestro.</div>`}`;
    }
    return `
      <button class="link" data-altaexit>← Salir del alta</button>
      <h2>${e.name ? esc(e.name) : "Nueva empresa"}</h2>
      ${nav}
      <div class="section">${body}</div>
      <div class="btn-row" style="margin-top:18px">
        <button class="btn" data-altaback ${step === 1 ? "disabled" : ""}>Atrás</button>
        <button class="btn primary" data-altanext>${step === 6 ? "Guardar y terminar" : "Guardar y seguir"}</button>
      </div>`;
  }
  function startAlta(emp) {
    state.alta = { emp: emp || T.newEmpresa({ name: "", ruc: "", dv: "", taxpayerType: "2" }), step: emp ? Math.min((emp.onboarding && emp.onboarding.step) || 1, 6) : 1 };
    go("alta");
  }
  // Lee y valida el paso actual. Devuelve false si hay un error.
  function readAltaStep() {
    const a = state.alta, e = a.emp, g = id => document.getElementById(id), v = id => (g(id) ? g(id).value.trim() : "");
    e.onboarding = e.onboarding || { step: 1, checks: {}, habilitado: false };
    if (a.step === 1) {
      const p = parseRuc(v("aRuc"));
      if (!v("aName")) { toast("Escribí la razón social"); return false; }
      if (!p) { toast("Escribí el RUC con su dígito verificador, por ejemplo 80012345-0"); return false; }
      if (dv11(p.base) !== p.dv) { toast("El dígito verificador no corresponde a ese RUC"); return false; }
      if (T.listEmpresas().some(x => x.ruc === p.base && x.id !== e.id)) { toast("Ya hay una empresa con ese RUC"); return false; }
      Object.assign(e, { name: v("aName"), ruc: p.base, dv: String(p.dv), fantasy: v("aFantasy"), activity: v("aActivity"), address: v("aAddress"),
        city: v("aCity"), phone: v("aPhone"), mail: v("aMail") });
    } else if (a.step === 2) {
      if (!/^\d{1,3}$/.test(v("aEst")) || !/^\d{1,3}$/.test(v("aPoint"))) { toast("Establecimiento y punto: hasta 3 dígitos"); return false; }
      e.establishment = v("aEst").padStart(3, "0"); e.point = v("aPoint").padStart(3, "0");
    } else if (a.step === 3) {
      if (a.skipCert) { a.skipCert = false; }
      else {
        if (!v("cVence")) { toast("Elegí la fecha de vencimiento del certificado, o tocá «Lo registro después»"); return false; }
        const cr = parseRuc(v("cRuc"));
        if (!cr || cr.base !== e.ruc) { toast("El RUC del certificado tiene que ser el de la empresa (" + e.ruc + "-" + e.dv + ")"); return false; }
        if (v("cDesde") && v("cVence") < v("cDesde")) { toast("El vencimiento no puede ser anterior a la fecha de inicio"); return false; }
        e.cert = { titular: v("cTit"), ruc: cr.full, prestador: v("cPre"), tipo: "F1", serie: v("cSerie"), desde: v("cDesde"), vence: v("cVence"), archivo: false };
        log("Certificado registrado", e.name + " · vence " + T.isoToDmy(e.cert.vence), e.id);
      }
    } else if (a.step === 4) {
      const num = v("tNum4").replace(/\D/g, ""), start = v("tStart4"), end = v("tEnd4"), next = parseInt(v("tNext4"), 10);
      if (!/^\d{8}$/.test(num)) { toast("El timbrado tiene que tener 8 dígitos"); return false; }
      if (!start) { toast("Elegí la fecha de inicio del timbrado"); return false; }
      if (end && end < start) { toast("La fecha de fin no puede ser anterior a la de inicio"); return false; }
      if (!(next >= 1)) { toast("El número de la primera factura tiene que ser 1 o más"); return false; }
      if (!/^\d{1,4}$/.test(v("aCsc"))) { toast("El IdCSC tiene hasta 4 dígitos"); return false; }
      e.csc = v("aCsc").padStart(4, "0");
      T.saveEmpresa(e);
      const st = T.storeFor(e.id), tims = st.get("timbrados", []), act = tims.find(t => t.active);
      if (act && act.number === num) Object.assign(act, act.used ? { end } : { start, end, nextNumber: next });
      else if (tims.some(t => t.number === num)) { toast("Ese timbrado ya está cargado en la empresa"); return false; }
      else { tims.forEach(t => t.active = false); tims.push({ id: FE.randomId(6), number: num, start, end, nextNumber: next, active: true, createdAt: new Date().toISOString() }); }
      st.set("timbrados", tims);
      log("Timbrado cargado (alta)", e.name + " · " + num, e.id);
    } else if (a.step === 5) {
      const checks = {};
      document.querySelectorAll("[data-check]").forEach(c => { if (c.checked) checks[c.dataset.check] = true; });
      e.onboarding.checks = checks;
    } else if (a.step === 6) {
      e.onboarding.habilitado = g("aHab").checked;
      if (v("aCscProd") && !/^\d{1,4}$/.test(v("aCscProd"))) { toast("El IdCSC de producción tiene hasta 4 dígitos"); return false; }
      e.cscProd = v("aCscProd") ? v("aCscProd").padStart(4, "0") : "";
    }
    return true;
  }
  function saveAltaProgress(nextStep) {
    const a = state.alta, e = a.emp, isNew = !T.getEmpresa(e.id);
    e.onboarding.step = Math.max(e.onboarding.step || 1, nextStep);
    e.status = e.env === "prod" ? "produccion" : nextStep >= 5 ? "prueba" : "alta";
    T.saveEmpresa(e);
    if (isNew) {
      log("Empresa creada", e.name + " · RUC " + e.ruc + "-" + e.dv, e.id);
      // un operador que crea una empresa queda asignado a ella (hoy solo el maestro puede crear)
    }
  }
  function goProduction() {
    const e = state.alta.emp, ob = e.onboarding, missing = [];
    if (!ob.habilitado) missing.push("habilitación aprobada");
    if (!e.cscProd) missing.push("IdCSC de producción");
    if (T.certStatus(e.cert).state === "none" || T.certStatus(e.cert).state === "expired") missing.push("certificado vigente");
    const done = T.TEST_CHECKS.filter(([k]) => (ob.checks || {})[k]).length;
    if (done < T.TEST_CHECKS.length) missing.push("pruebas completas (" + done + " de " + T.TEST_CHECKS.length + ")");
    if (missing.length) { toast("Falta: " + missing.join(", ")); return; }
    confirmSheet("¿Pasar " + e.name + " a producción?", "Desde ahora sus facturas tienen validez tributaria. Verificá que el timbrado activo sea el de producción.", "Pasar a producción", () => {
      e.env = "prod"; e.status = "produccion"; e.onboarding.step = 6; T.saveEmpresa(e);
      log("Paso a producción", e.name, e.id); toast(e.name + " está en producción");
      state.empId = e.id; state.alta = null; go("empresa");
    });
  }

  // ================= Hojas de edición =================
  function editDatos(e) {
    sheet(`<h3>Datos de la empresa</h3>
      <label for="eName">Razón social</label><input id="eName" value="${esc(e.name)}">
      <label for="eFan">Nombre de fantasía</label><input id="eFan" value="${esc(e.fantasy || "")}">
      <label for="eAct">Actividad</label><input id="eAct" value="${esc(e.activity || "")}">
      <label for="eAdr">Dirección</label><input id="eAdr" value="${esc(e.address || "")}">
      <div class="grid2"><div><label for="eCity">Ciudad</label><input id="eCity" value="${esc(e.city || "")}"></div><div><label for="ePhone">Teléfono</label><input id="ePhone" value="${esc(e.phone || "")}"></div></div>
      <label for="eMail">Correo</label><input id="eMail" type="email" value="${esc(e.mail || "")}">
      <div class="grid2"><div><label for="eEst">Establecimiento</label><input id="eEst" inputmode="numeric" maxlength="3" value="${esc(e.establishment)}"></div>
        <div><label for="ePoint">Punto</label><input id="ePoint" inputmode="numeric" maxlength="3" value="${esc(e.point)}"></div></div>
      <label for="eTp">Tipo de contribuyente</label><select id="eTp"><option value="1" ${e.taxpayerType === "1" ? "selected" : ""}>Persona física</option><option value="2" ${e.taxpayerType !== "1" ? "selected" : ""}>Persona jurídica</option></select>
      <div class="muted small" style="margin-top:8px">El RUC no se cambia: para otro RUC, creá otra empresa.</div>
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const v = id => el.querySelector("#" + id).value.trim();
        if (!v("eName")) { toast("Escribí la razón social"); return; }
        if (!/^\d{1,3}$/.test(v("eEst")) || !/^\d{1,3}$/.test(v("ePoint"))) { toast("Establecimiento y punto: hasta 3 dígitos"); return; }
        Object.assign(e, { name: v("eName"), fantasy: v("eFan"), activity: v("eAct"), address: v("eAdr"), city: v("eCity"), phone: v("ePhone"), mail: v("eMail"),
          establishment: v("eEst").padStart(3, "0"), point: v("ePoint").padStart(3, "0"), taxpayerType: v("eTp") });
        T.saveEmpresa(e); log("Datos de empresa editados", e.name, e.id); close(); render(); toast("Datos guardados");
      };
    });
  }
  function editCert(e) {
    const c = e.cert || { titular: e.name, ruc: e.ruc + "-" + e.dv, prestador: T.PRESTADORES[0], tipo: "F1", desde: FE.todayKey(), vence: "" };
    sheet(`<h3>Certificado de firma (F1)</h3>
      <label for="cTit">Titular</label><input id="cTit" value="${esc(c.titular || "")}">
      <label for="cRuc">RUC del certificado</label><input id="cRuc" value="${esc(c.ruc || "")}">
      <label for="cPre">Prestador</label><select id="cPre">${T.PRESTADORES.map(p => `<option ${c.prestador === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
      <label for="cSerie">Número de serie (opcional)</label><input id="cSerie" value="${esc(c.serie || "")}">
      <div class="grid2"><div><label for="cDesde">Válido desde</label><input id="cDesde" type="date" value="${esc(c.desde || "")}"></div><div><label for="cVence">Vence</label><input id="cVence" type="date" value="${esc(c.vence || "")}"></div></div>
      <div class="muted small" style="margin-top:8px">No se guarda el archivo .p12 ni su contraseña: eso irá al servidor.</div>
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const v = id => el.querySelector("#" + id).value.trim(), cr = parseRuc(v("cRuc"));
        if (!cr || cr.base !== e.ruc) { toast("El RUC del certificado tiene que ser el de la empresa (" + e.ruc + "-" + e.dv + ")"); return; }
        if (!v("cVence")) { toast("Elegí la fecha de vencimiento"); return; }
        if (v("cDesde") && v("cVence") < v("cDesde")) { toast("El vencimiento no puede ser anterior a la fecha de inicio"); return; }
        e.cert = { titular: v("cTit"), ruc: cr.full, prestador: v("cPre"), tipo: "F1", serie: v("cSerie"), desde: v("cDesde"), vence: v("cVence"), archivo: false };
        T.saveEmpresa(e); log("Certificado actualizado", e.name + " · vence " + T.isoToDmy(e.cert.vence), e.id); close(); render(); toast("Certificado guardado");
      };
    });
  }
  function editCsc(e) {
    sheet(`<h3>Código de seguridad (CSC)</h3>
      <div class="grid2"><div><label for="sTest">IdCSC de prueba</label><input id="sTest" inputmode="numeric" maxlength="4" value="${esc(e.csc || "")}"></div>
        <div><label for="sProd">IdCSC de producción</label><input id="sProd" inputmode="numeric" maxlength="4" value="${esc(e.cscProd || "")}"></div></div>
      <div class="muted small" style="margin-top:8px">Solo el identificador. El valor del CSC de producción es secreto y se guardará en el servidor.</div>
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const a = el.querySelector("#sTest").value.trim(), b = el.querySelector("#sProd").value.trim();
        if (!/^\d{1,4}$/.test(a) || (b && !/^\d{1,4}$/.test(b))) { toast("El IdCSC tiene hasta 4 dígitos"); return; }
        e.csc = a.padStart(4, "0"); e.cscProd = b ? b.padStart(4, "0") : "";
        T.saveEmpresa(e); log("IdCSC editado", e.name, e.id); close(); render(); toast("Guardado");
      };
    });
  }

  // ================= Respaldo completo =================
  function backupAll() {
    const data = { app: "admin", exportedAt: new Date().toISOString(), data: {} };
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^(fe_|fac_)/.test(k) && k !== "fac_pin") data.data[k] = localStorage.getItem(k); } } catch (_) {}
    FE.downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "respaldo-admin-" + FE.todayKey() + ".json");
    log("Respaldo completo descargado", ""); toast("Respaldo descargado");
  }
  function restoreAll(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(r.result);
        if (o.app !== "admin" || !o.data) { toast("Ese respaldo no es de la app Admin"); return; }
        confirmSheet("¿Restaurar el respaldo?", "Reemplaza empresas, usuarios y datos de las empresas de este dispositivo.", "Restaurar", () => {
          Object.keys(o.data).forEach(k => { if (/^(fe_|fac_)/.test(k)) localStorage.setItem(k, o.data[k]); });
          toast("Respaldo restaurado"); setTimeout(() => location.reload(), 600);
        }, true);
      } catch (_) { toast("El archivo de respaldo no es válido"); }
    };
    r.readAsText(file);
  }

  // ================= Render =================
  const titles = { panel: "Panel", empresas: "Empresas", empresa: "Empresa", alta: "Alta de empresa", usuarios: "Usuarios", auditoria: "Auditoría", ajustes: "Ajustes" };
  function render() {
    if (!user) { document.getElementById("screen").innerHTML = ""; return; }
    const s = state.screen;
    const map = { panel: screenPanel, empresas: screenEmpresas, empresa: screenEmpresa, alta: screenAlta, usuarios: screenUsuarios, auditoria: screenAuditoria, ajustes: screenAjustes };
    document.getElementById("screen").innerHTML = (map[s] || screenPanel)();
    FE.enhance(document.getElementById("screen"));
    document.getElementById("title").textContent = titles[s] || "Panel";
    document.getElementById("companyLine").textContent = user.name + " · " + T.ROLES[user.role].label;
    document.querySelectorAll(".tab").forEach(t => {
      const k = t.dataset.go;
      t.classList.toggle("on", s === k || (k === "empresas" && (s === "empresa" || s === "alta")));
      if (k === "usuarios") t.style.display = can("usuarios.estudio") ? "" : "none";
    });
    document.querySelector(".tabbar").style.setProperty("--tabs", can("usuarios.estudio") ? 5 : 4);
    window.scrollTo(0, 0);
  }
  function go(s) { state.screen = s; render(); }

  // ================= Eventos =================
  const screenEl = document.getElementById("screen");
  screenEl.addEventListener("click", e => {
    const t = e.target.closest("button, a, [data-openemp]"); if (!t) return;
    const ds = t.dataset, emp = T.getEmpresa(state.empId);
    if (ds.openfac) { T.setActive(ds.openfac); log("Abrir en el Facturador", (T.getEmpresa(ds.openfac) || {}).name, ds.openfac); return; } // sigue el enlace
    if (ds.go) { go(ds.go); return; }
    if (ds.openemp) { state.empId = ds.openemp; go("empresa"); return; }
    if (ds.newemp !== undefined) { if (can("empresas.alta")) startAlta(null); return; }
    if (ds.continuealta !== undefined && emp) { startAlta(emp); return; }
    // alta guiada
    if (ds.tptype) { readAltaFieldsQuiet(); state.alta.emp.taxpayerType = ds.tptype; render(); return; }
    if (ds.altaskip !== undefined) { state.alta.skipCert = true; altaNext(); return; }
    if (ds.altanext !== undefined) { altaNext(); return; }
    if (ds.altaback !== undefined) { state.alta.step = Math.max(1, state.alta.step - 1); render(); return; }
    if (ds.altaexit !== undefined) { const id = state.alta && T.getEmpresa(state.alta.emp.id) ? state.alta.emp.id : null; state.alta = null; if (id) { state.empId = id; go("empresa"); } else go("empresas"); return; }
    if (ds.altaprod !== undefined) { if (readAltaStep()) { saveAltaProgress(6); goProduction(); } return; }
    // empresa
    if (ds.editdatos !== undefined && emp) { editDatos(emp); return; }
    if (ds.editcert !== undefined && emp) { if (can("empresa.certificado")) editCert(emp); return; }
    if (ds.editcsc !== undefined && emp) { editCsc(emp); return; }
    if (ds.setenv && emp) {
      if (!can("empresa.ambiente")) return;
      if (ds.setenv === "prod" && emp.env !== "prod") { startAlta(emp); state.alta.step = 6; render(); toast("Completá el paso 6 para pasar a producción"); return; }
      if (ds.setenv === "test" && emp.env === "prod") {
        confirmSheet("¿Volver a prueba?", "Las facturas dejan de tener validez tributaria.", "Volver a prueba", () => { emp.env = "test"; emp.status = "prueba"; T.saveEmpresa(emp); log("Ambiente cambiado a prueba", emp.name, emp.id); render(); }, true);
      }
      return;
    }
    if ((ds.timadd !== undefined || ds.timedit) && emp) {
      if (!can("timbrados.editar")) return;
      const st = T.storeFor(emp.id), list = st.get("timbrados", []), tt = ds.timedit ? list.find(x => x.id === ds.timedit) : null;
      const used = !!tt && (tt.used || st.get("invoices", []).some(i => i.kude && i.kude.timbrado && i.kude.timbrado.id === tt.id));
      T.timbradoSheet({ list, t: tt, used, onSave: (l, msg) => { st.set("timbrados", l); log(tt ? "Timbrado editado" : "Timbrado cargado", emp.name + " · " + msg, emp.id); toast(msg); render(); } });
      return;
    }
    if (ds.timact && emp) {
      if (!can("timbrados.editar")) return;
      const st = T.storeFor(emp.id), list = st.get("timbrados", []);
      const tt = T.activateTimbrado(list, ds.timact);
      if (!tt) { toast("Ese timbrado está vencido"); return; }
      st.set("timbrados", list); log("Timbrado activado", emp.name + " · " + tt.number, emp.id); toast("Timbrado " + tt.number + " activo"); render(); return;
    }
    if ((ds.empuseradd !== undefined || ds.useredit) && emp) {
      const u = ds.useredit ? T.getUser(ds.useredit) : null;
      T.userSheet({ user: u, roles: ["admincliente", "facturador", "cargador"], fixedEmpresa: emp.id, empresas: [],
        onSave: (list, saved) => { log(u ? "Usuario editado" : "Usuario creado", saved.name + " · " + T.ROLES[saved.role].label, emp.id); render(); } });
      return;
    }
    // usuarios (maestro)
    if (ds.useraddall !== undefined || ds.usereditall) {
      if (!can("usuarios.estudio")) return;
      const u = ds.usereditall ? T.getUser(ds.usereditall) : null;
      if (u && u.id === user.id) { toast("Tu propio usuario: cambiá tu PIN en Ajustes"); }
      T.userSheet({ user: u, roles: Object.keys(T.ROLES), empresas: T.listEmpresas(), onSave: (list, saved) => {
        if (saved.id === user.id) user = T.getUser(user.id);
        log(u ? "Usuario editado" : "Usuario creado", saved.name + " · " + T.ROLES[saved.role].label); render();
      } });
      return;
    }
    // ajustes
    if (ds.mypin !== undefined) { T.changeOwnPin(user); return; }
    if (ds.logout !== undefined) { log("Sesión cerrada", ""); user = null; T.setSession("admin", null); render(); Access.login(); return; }
    if (ds.themeSet) { FE.setTheme(ds.themeSet); render(); return; }
    if (ds.install !== undefined) { FE.promptInstall(); return; }
    if (ds.backupall !== undefined) { backupAll(); return; }
  });
  function readAltaFieldsQuiet() {
    const e = state.alta && state.alta.emp, g = id => document.getElementById(id); if (!e || state.alta.step !== 1) return;
    [["aName", "name"], ["aFantasy", "fantasy"], ["aActivity", "activity"], ["aAddress", "address"], ["aCity", "city"], ["aPhone", "phone"], ["aMail", "mail"]]
      .forEach(([id, k]) => { if (g(id)) e[k] = g(id).value.trim(); });
    const p = g("aRuc") && parseRuc(g("aRuc").value); if (p) { e.ruc = p.base; e.dv = String(p.dv); }
  }
  function altaNext() {
    const a = state.alta;
    if (!readAltaStep()) return;
    const next = Math.min(6, a.step + 1);
    saveAltaProgress(a.step === 6 ? 6 : next);
    if (a.step === 6) { toast("Alta guardada"); state.empId = a.emp.id; state.alta = null; go("empresa"); return; }
    a.step = next; render();
  }
  screenEl.addEventListener("change", e => {
    if (e.target.id === "audEmp") { state.auditEmp = e.target.value; render(); return; }
    if (e.target.id === "restoreAll") { const f = e.target.files && e.target.files[0]; if (f) restoreAll(f); return; }
  });
  screenEl.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.openemp) { e.preventDefault(); e.target.click(); } });
  document.querySelector(".tabbar").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) { state.alta = null; go(b.dataset.go); } });

  // ================= Acceso =================
  const Access = {
    init() {
      const studio = T.users().filter(u => STUDIO_ROLES.includes(u.role));
      if (!studio.some(u => u.role === "maestro")) { this.firstRun(); return; }
      const u = T.sessionUser("admin");
      if (u && u.active !== false && STUDIO_ROLES.includes(u.role)) { user = u; render(); }
      else this.login();
      let hiddenAt = 0;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) hiddenAt = Date.now();
        else if (hiddenAt && user && Date.now() - hiddenAt > 5 * 60 * 1000) { user = null; T.setSession("admin", null); render(); this.login(); }
      });
    },
    login() {
      const list = T.users().filter(u => u.active !== false && STUDIO_ROLES.includes(u.role));
      T.loginOverlay({ title: "Admin del estudio", users: list, onSuccess: u => { user = u; T.setSession("admin", u); log("Ingreso a Admin", ""); state.screen = "panel"; render(); } });
    },
    // Primer uso: crear el admin maestro
    firstRun() {
      const el = document.createElement("div");
      el.className = "lock";
      el.innerHTML = `<div class="box">
        <div style="font-size:40px;line-height:1">&#128273;</div>
        <h2>Crear admin maestro</h2>
        <p class="lead">Es el usuario del estudio con acceso a todo: empresas, certificados y usuarios.</p>
        <input id="fmName" placeholder="Tu nombre" style="text-align:left">
        <input id="fmPin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN (4 a 6 números)" style="margin-top:10px">
        <input id="fmPin2" type="password" inputmode="numeric" maxlength="6" placeholder="Repetí el PIN" style="margin-top:10px">
        <button class="btn primary" id="fmOk" style="margin-top:14px">Crear y entrar</button>
      </div>`;
      document.body.appendChild(el);
      el.querySelector("#fmOk").onclick = async () => {
        const name = el.querySelector("#fmName").value.trim(), p1 = el.querySelector("#fmPin").value.trim(), p2 = el.querySelector("#fmPin2").value.trim();
        if (!name) { toast("Escribí tu nombre"); return; }
        if (!/^\d{4,6}$/.test(p1)) { toast("El PIN tiene que tener de 4 a 6 números"); return; }
        if (p1 !== p2) { toast("Los PIN no coinciden"); return; }
        const list = T.users(), u = { id: FE.randomId(8), name, role: "maestro", empresas: [], active: true, createdAt: new Date().toISOString() };
        u.pin = await T.hashPin(p1, u.id); list.push(u); T.saveUsers(list);
        user = u; T.setSession("admin", u); log("Admin maestro creado", name); el.remove(); render(); toast("Bienvenido, " + name);
      };
      setTimeout(() => el.querySelector("#fmName").focus(), 60);
    }
  };

  FE.onInstallChange(() => { if (state.screen === "ajustes") render(); });
  Access.init();
  FE.registerSW();
})();
