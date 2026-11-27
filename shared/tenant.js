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
    maestro: { label: "Administrador general", estudio: true, desc: "Todo el estudio: empresas, certificados, cobros, usuarios y producción." },
    operador: { label: "Operador del estudio", estudio: true, desc: "Soporte técnico de las empresas asignadas: datos, CSC, certificado y usuarios. Sin acceso a cobros." },
    admincliente: { label: "Administrador de la empresa", estudio: false, desc: "Gestión de su empresa: equipo, cajas, timbrados, productos, preferencias y documentos. Emite, cancela y corrige." },
    facturador: { label: "Facturador", estudio: false, desc: "Emite facturas y recibe notas de pedido. Ve solo los documentos que emitió." },
    cargador: { label: "Vendedor", estudio: false, desc: "Carga notas de pedido en la app Notas de pedido." }
  };
  // Permisos por rol. Sin usuario (modo un dispositivo) se actúa como administrador de la empresa.
  const PERMS = {
    "admin.app": ["maestro", "operador"],
    "empresas.alta": ["maestro"],
    "empresa.tecnico": ["maestro", "operador"],
    "empresa.certificado": ["maestro", "operador"],
    "empresa.ambiente": ["maestro"],
    "timbrados.editar": ["maestro", "admincliente"],      // timbrados, cajas e inutilización
    "usuarios.estudio": ["maestro"],
    "usuarios.empresa": ["maestro", "operador", "admincliente"],
    "cliente.config": ["maestro", "admincliente"],          // productos, preferencias, logo, copia de seguridad de la empresa
    "facturar": ["maestro", "admincliente", "facturador"],
    "documentos.corregir": ["maestro", "admincliente"],     // cancelar, notas de crédito y débito, nominación
    "documentos.todos": ["maestro", "operador", "admincliente"],
    "negocio.resumen": ["maestro", "admincliente"],
    "actividad.empresa": ["maestro", "admincliente"],
    "cobros": ["maestro"],
    "auditoria": ["maestro", "operador"]
  };
  const DEVICE_PERMS_EXCLUDE = ["usuarios.estudio", "cobros", "admin.app", "empresas.alta", "empresa.ambiente"];
  // Lenguaje técnico (estudio) o simple (empresa)
  const tecnico = u => !!u && (u.role === "maestro" || u.role === "operador");
  const GLOSARIO = {
    kude: ["KuDE", "documento (PDF)"], KuDE: ["KuDE", "Documento (PDF)"], cdc: ["CDC", "código de control (CDC)"], CDC: ["CDC", "Código de control (CDC)"],
    sifenOk: ["Aprobado por SIFEN", "Aprobado por la DNIT"], sifenBad: ["Rechazado por SIFEN", "Rechazado por la DNIT"],
    prueba: ["Ambiente de prueba", "Modo de prueba"], modulo: ["Módulo", "Función contratada"], innominado: ["Innominado", "Consumidor final sin datos"],
    nominar: ["Nominación", "Identificar al comprador"]
  };
  const term = (key, u) => { const g = GLOSARIO[key]; return g ? g[tecnico(u) ? 0 : 1] : key; };
  // Sin usuario (modo de un solo dispositivo, sin usuarios cargados) se permite todo, como antes.
  const can = (user, perm) => !user ? !DEVICE_PERMS_EXCLUDE.includes(perm) : (PERMS[perm] || []).includes(user.role);

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
  const listEmpresas = () => G.get("empresas", []).map(e => { establecimientosOf(e); return e; }); // migra establecimiento y punto a la lista de establecimientos
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
      taxpayerType: "2", csc: "0001", cscProd: "", cert: null, logo: null, status: "alta", modulos: {},
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
      emp.modulos = Object.fromEntries(MODULES.map(m => [m.key, true])); // la empresa de ejemplo tiene todo
      saveEmpresa(emp);
      const st = storeFor(emp.id);
      ["invoices", "pedidos", "clients", "timbrados"].forEach(k => { const v = legacy.get(k, null); if (v != null) st.set(k, v); });
      if (!st.get("timbrados", null)) st.set("timbrados", [{ id: randomId(6), number: emp.timbrado, start: dmyToIso(emp.start), end: dmyToIso(emp.end),
        nextNumber: emp.nextNumber || 1, tipos: HABILITABLES.slice(), numeros: Object.fromEntries(HABILITABLES.map(c => [c, c === "1" ? emp.nextNumber || 1 : 1])),
        active: true, createdAt: new Date().toISOString() }]);
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

  // ================= Módulos contratables =================
  // El plan base (factura, notas de crédito y débito, historial, PDF, cancelación, clientes) siempre está.
  // perUser: además de la empresa, el admin del cliente puede habilitarlo por usuario.
  const MODULES = [
    { key: "pedidos", label: "Pedidos", desc: "Bandeja de pedidos por QR, app Pedidos para los cargadores y catálogo compartido", perUser: true },
    { key: "remision", label: "Nota de remisión", desc: "Traslado de mercaderías desde factura o pedido", perUser: true },
    { key: "autofactura", label: "Autofactura", desc: "Compras a no contribuyentes y extranjeros", perUser: true },
    { key: "usuarios", label: "Usuarios múltiples", desc: "Varias personas con su PIN y su rol (se cobra por usuario adicional)" },
    { key: "productos", label: "Productos frecuentes y catálogo", desc: "Lista de productos para elegir al facturar" },
    { key: "usd", label: "Moneda extranjera (USD)", desc: "Facturas en dólares con tipo de cambio" },
    { key: "correo", label: "Envío automático por correo", desc: "Manda la factura al cliente al aprobarse" },
    { key: "ticket", label: "Formato ticket", desc: "PDF en ticket de 80 mm" }
  ];
  const moduleOf = key => MODULES.find(m => m.key === key);
  // Empresas creadas antes de los módulos (sin el campo) conservan todo habilitado
  const hasModule = (emp, key) => !emp || !emp.modulos ? true : !!emp.modulos[key];
  const userHas = (user, emp, key) => hasModule(emp, key) && !(user && moduleOf(key) && moduleOf(key).perUser && (user.sinModulos || []).includes(key));

  // ================= Planes y cobros del servicio =================
  // Tarifas del estudio (ejemplo inicial, se editan en Admin → Ajustes → Tarifas).
  // incl[concepto] = true: el concepto figura como "Incluido en el plan" y no suma.
  const TARIFAS_DEF = { base: 89000, incluidos: 100, extraDoc: 500, usuarioExtra: 10000, alta: 150000, venceDia: 10, graciaDias: 10,
    modulos: { pedidos: 35000, remision: 20000, autofactura: 15000, usuarios: 0, productos: 0, usd: 10000, correo: 10000, ticket: 10000 },
    incl: { usuarios: true, productos: true }, estudioEmpresaId: "" };
  function tarifas() {
    const t = G.get("tarifas", {});
    return Object.assign({}, TARIFAS_DEF, t, { modulos: Object.assign({}, TARIFAS_DEF.modulos, t.modulos || {}), incl: Object.assign({}, t.incl ? {} : TARIFAS_DEF.incl, t.incl || {}) });
  }
  const saveTarifas = t => G.set("tarifas", t);
  // Conceptos que se cobran (los módulos usan su clave). unit: el monto es por unidad (documento o usuario).
  const CONCEPTS = [{ key: "base", label: "Plan base" }, { key: "extraDoc", label: "Documento extra", unit: "documento" },
    { key: "usuarioExtra", label: "Usuario adicional", unit: "usuario" }, { key: "alta", label: "Alta y habilitación (única vez)" }]
    .concat(MODULES.map(m => ({ key: m.key, label: "Módulo " + m.label, module: true })));
  const conceptOf = key => CONCEPTS.find(c => c.key === key);
  const generalMonto = (t, key) => conceptOf(key) && conceptOf(key).module ? t.modulos[key] || 0 : t[key] || 0;
  // Precio que paga una empresa por un concepto: tarifa general, monto propio o incluido
  function precioDe(emp, key) {
    const t = tarifas(), esp = (planOf(emp).precios || {})[key];
    if (esp && esp.modo === "incluido") return { monto: 0, incluido: true, especial: true };
    if (esp && esp.modo === "propio") return { monto: Number(esp.monto) || 0, incluido: false, especial: true };
    return { monto: t.incl[key] ? 0 : generalMonto(t, key), incluido: !!t.incl[key], especial: false };
  }
  const incluidosDe = emp => { const p = planOf(emp); return p.incluidosPropio != null && p.incluidosPropio !== "" ? Number(p.incluidosPropio) : tarifas().incluidos; };
  const periodOf = iso => FE.localDayKey(iso).slice(0, 7);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const periodLabel = p => MESES[+p.slice(5, 7) - 1] + " " + p.slice(0, 4);
  const nextPeriod = p => { let [y, m] = p.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return y + "-" + String(m).padStart(2, "0"); };
  const addPeriods = (p, n) => { for (let i = 0; i < n; i++) p = nextPeriod(p); return p; };
  function planOf(emp) { return Object.assign({ activo: true, desde: periodOf(emp.createdAt || new Date().toISOString()), descuento: 0, noSuspender: false, cobrarAlta: true }, emp.plan || {}); }
  function periodsOf(emp) {
    const p = planOf(emp), now = periodOf(new Date().toISOString()), out = [];
    for (let x = p.desde; x <= now && out.length < 120; x = nextPeriod(x)) out.push(x);
    return out;
  }
  // Descuentos: { id, tipo: "pct"|"monto", valor, aplica: "total"|clave de concepto, duracion: "siempre"|"meses"|"hasta", meses, desde: "AAAA-MM", hasta: "AAAA-MM", motivo, by, at }
  function descuentosDe(emp) {
    const p = planOf(emp);
    if (Array.isArray(p.descuentos)) return p.descuentos;
    return p.descuento > 0 ? [{ id: "legacy", tipo: "pct", valor: p.descuento, aplica: "total", duracion: "siempre", desde: p.desde, motivo: "Descuento general" }] : [];
  }
  function descuentoVigente(d, period) {
    if (period < d.desde) return false;
    if (d.duracion === "meses") return period <= addPeriods(d.desde, Math.max(1, d.meses || 1) - 1);
    if (d.duracion === "hasta") return !!d.hasta && period <= d.hasta;
    return true;
  }
  function descuentoTexto(d) {
    const que = d.aplica === "total" ? "total del mes" : (conceptOf(d.aplica) || { label: d.aplica }).label;
    const cuanto = d.tipo === "pct" ? d.valor + "%" : "Gs " + FE.fmt(d.valor);
    const dur = d.duracion === "meses" ? (d.meses || 1) + " mes(es) desde " + periodLabel(d.desde) : d.duracion === "hasta" ? "de " + periodLabel(d.desde) + " a " + periodLabel(d.hasta) : "desde " + periodLabel(d.desde) + ", sin fin";
    return cuanto + " sobre " + que + " · " + dur;
  }
  // Cargo de un mes: plan base + módulos + documentos y usuarios extra (+ alta en el primer mes) − descuentos.
  // Cada línea: [texto, monto, { key, incluido, especial, descuento }]
  function cargoDe(emp, period) {
    const p = planOf(emp), lines = [], inc = incluidosDe(emp);
    const docs = storeFor(emp.id).get("invoices", []).filter(i => i.status === "ok" && i.date && periodOf(i.date) === period).length;
    const add = (key, text, mult) => { const pr = precioDe(emp, key); lines.push([text, Math.round(pr.monto * (mult || 1)), { key, incluido: pr.incluido, especial: pr.especial }]); };
    add("base", "Plan base (hasta " + inc + " documentos)");
    MODULES.forEach(m => { if (hasModule(emp, m.key)) add(m.key, "Módulo " + m.label); });
    if (docs > inc) add("extraDoc", (docs - inc) + " documento(s) extra × Gs " + FE.fmt(precioDe(emp, "extraDoc").monto), docs - inc);
    const users = usersFor(emp.id).filter(u => !ROLES[u.role].estudio && u.active !== false).length;
    if (hasModule(emp, "usuarios") && users > 1) add("usuarioExtra", (users - 1) + " usuario(s) adicional(es)", users - 1);
    if (p.cobrarAlta && period === p.desde) add("alta", "Alta y habilitación (única vez)");
    // Descuentos por concepto, después los del total
    const ds = descuentosDe(emp).filter(d => descuentoVigente(d, period));
    ds.filter(d => d.aplica !== "total").forEach(d => {
      const base = lines.filter(l => l[2].key === d.aplica && !l[2].descuento).reduce((a, l) => a + l[1], 0); if (base <= 0) return;
      const v = Math.min(base, d.tipo === "pct" ? Math.round(base * d.valor / 100) : d.valor);
      if (v > 0) lines.push(["Descuento " + (d.tipo === "pct" ? d.valor + "% " : "") + "en " + conceptOf(d.aplica).label.replace(/^Módulo /, "") + (d.motivo ? " · " + d.motivo : ""), -v, { key: d.aplica, descuento: d.id }]);
    });
    let sub = lines.reduce((a, l) => a + l[1], 0);
    ds.filter(d => d.aplica === "total").forEach(d => {
      const v = Math.min(sub, d.tipo === "pct" ? Math.round(sub * d.valor / 100) : d.valor);
      if (v > 0) { lines.push(["Descuento " + (d.tipo === "pct" ? d.valor + "% " : "") + "sobre el total" + (d.motivo ? " · " + d.motivo : ""), -v, { key: "total", descuento: d.id }]); sub -= v; }
    });
    return { period, docs, lines, total: Math.max(0, lines.reduce((a, l) => a + l[1], 0)) };
  }
  // Los meses cerrados quedan congelados con lo que se cobró (no cambian si después se tocan módulos o tarifas)
  function cargoCerrado(emp, period) {
    const all = G.get("cierres", {}), mine = all[emp.id] || {};
    if (mine[period]) return mine[period];
    const c = cargoDe(emp, period);
    if (period < periodOf(new Date().toISOString())) { mine[period] = c; all[emp.id] = mine; G.set("cierres", all); }
    return c;
  }
  const pagosDe = empId => G.get("pagos", []).filter(x => x.empresaId === empId);
  function registrarPago(o) {
    const l = G.get("pagos", []);
    l.unshift(Object.assign({ id: randomId(8), at: new Date().toISOString() }, o));
    G.set("pagos", l);
  }
  // Boletas de pago: se registran cuando el estudio emite la factura del servicio a una empresa cliente.
  // El Facturador del cliente las muestra como aviso hasta que se marcan como vistas. Con servidor, se enviarán como notificación.
  const boletasDe = empId => G.get("boletas", []).filter(b => b.empresaId === empId).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  function registrarBoleta(o) {
    const l = G.get("boletas", []).filter(b => !(b.empresaId === o.empresaId && b.period === o.period && b.invoiceId === o.invoiceId && b.estudioId === o.estudioId));
    const b = Object.assign({ id: randomId(8), at: new Date().toISOString(), vista: false }, o);
    l.unshift(b); G.set("boletas", l); return b;
  }
  const boletaNueva = empId => boletasDe(empId).find(b => !b.vista) || null;
  function marcarBoletaVista(id) { const l = G.get("boletas", []); const b = l.find(x => x.id === id); if (b) { b.vista = true; b.vistaAt = new Date().toISOString(); G.set("boletas", l); } }
  // Estado de cuenta por mes y estado general. El mes P vence el día venceDia del mes siguiente; después de graciaDias se suspende la emisión.
  function cuenta(emp) {
    const t = tarifas(), p = planOf(emp), today = FE.todayKey(), pagos = pagosDe(emp.id);
    if (!p.activo) return { meses: [], deuda: 0, state: "inactivo", text: "Sin plan activo" };
    let credit = pagos.reduce((a, x) => a + (Number(x.monto) || 0), 0);
    const meses = periodsOf(emp).map(per => {
      const c = cargoCerrado(emp, per), vence = nextPeriod(per) + "-" + String(t.venceDia).padStart(2, "0");
      const aplicado = Math.min(credit, c.total); credit -= aplicado;
      const saldo = c.total - aplicado, d = new Date(vence + "T00:00:00"); d.setDate(d.getDate() + t.graciaDias);
      const corte = FE.localDayKey(d.toISOString());
      const st = saldo <= 0 ? "pagado" : today > corte && !p.noSuspender ? "suspendido" : today > vence ? "vencido" : "pendiente";
      return Object.assign({}, c, { vence, corte, pagado: aplicado, saldo, state: st, abierto: per === periodOf(new Date().toISOString()) });
    });
    const deuda = meses.reduce((a, m) => a + (m.state === "vencido" || m.state === "suspendido" ? m.saldo : 0), 0);
    const susp = meses.find(m => m.state === "suspendido"), venc = meses.find(m => m.state === "vencido");
    const state = susp ? "suspendido" : venc ? "vencido" : "al_dia";
    const text = susp ? "Emisión suspendida por falta de pago (" + periodLabel(susp.period) + ")"
      : venc ? "Pago vencido de " + periodLabel(venc.period) + ": se suspende el " + isoToDmy(venc.corte) : "Al día";
    return { meses, deuda, state, text, aFavor: credit };
  }

  // ================= Tipos de documento electrónico (iTiDE) =================
  // code = tipo de documento del CDC (posiciones 1-2). available = SIFEN ya lo recibe; los demás se muestran deshabilitados con el motivo.
  const DE_TYPES = [
    { code: "1", key: "factura", label: "Factura electrónica", short: "Factura", abbr: "FE", title: "FACTURA ELECTRÓNICA", available: true, cancelH: 48 },
    { code: "5", key: "nc", label: "Nota de crédito electrónica", short: "Nota de crédito", abbr: "NC", title: "NOTA DE CRÉDITO ELECTRÓNICA", available: true, cancelH: 48, assoc: true },
    { code: "6", key: "nd", label: "Nota de débito electrónica", short: "Nota de débito", abbr: "ND", title: "NOTA DE DÉBITO ELECTRÓNICA", available: true, cancelH: 48, assoc: true },
    { code: "4", key: "autofactura", label: "Autofactura electrónica", short: "Autofactura", abbr: "AF", title: "AUTOFACTURA ELECTRÓNICA", available: true, cancelH: 48 },
    { code: "7", key: "remision", label: "Nota de remisión electrónica", short: "Nota de remisión", abbr: "NR", title: "NOTA DE REMISIÓN ELECTRÓNICA", available: true, cancelH: 168 },
    { code: "RD", key: "recibo", label: "Recibo de dinero electrónico", short: "Recibo", abbr: "RD", available: false,
      reason: "Lo crea el Decreto 872; SIFEN todavía no publicó su formato ni su tipo de documento." },
    { code: "8", key: "retencion", label: "Comprobante de retención electrónico", short: "Retención", abbr: "CR", available: false,
      reason: "Previsto en SIFEN para el futuro; hoy la retención se emite en forma virtual en Marangatu." },
    { code: "2", key: "exportacion", label: "Factura electrónica de exportación", short: "Exportación", abbr: "FX", available: false, reason: "Prevista para el futuro en SIFEN." },
    { code: "3", key: "importacion", label: "Factura electrónica de importación", short: "Importación", abbr: "FI", available: false, reason: "Prevista para el futuro en SIFEN." }
  ];
  const deType = code => DE_TYPES.find(t => t.code === String(code || "1")) || DE_TYPES[0];
  const HABILITABLES = DE_TYPES.filter(t => t.available).map(t => t.code);
  // Motivos de emisión (códigos del manual técnico; a confirmar con la versión vigente)
  const MOTIVOS_NC = [["1", "Devolución y ajuste de precios"], ["2", "Devolución"], ["3", "Descuento"], ["4", "Bonificación"], ["5", "Crédito incobrable"],
    ["6", "Recupero de costo"], ["7", "Recupero de gasto"], ["8", "Ajuste de precio"]];
  const MOTIVOS_ND = [["8", "Ajuste de precio"], ["9", "Intereses o recargos"], ["10", "Gastos adicionales"], ["99", "Otro"]];
  const MOTIVOS_REM = [["1", "Traslado por venta"], ["2", "Traslado por consignación"], ["3", "Exportación"], ["4", "Traslado por compra"], ["5", "Importación"],
    ["6", "Traslado por devolución"], ["7", "Traslado entre locales de la empresa"], ["8", "Traslado para transformación"], ["9", "Traslado para reparación"],
    ["10", "Traslado por emisor móvil"], ["11", "Exhibición o demostración"], ["12", "Participación en ferias"], ["13", "Traslado de encomienda"], ["14", "Decomiso"], ["99", "Otro"]];
  const MODOS_TRANSPORTE = [["1", "Terrestre"], ["2", "Fluvial"], ["3", "Aéreo"], ["4", "Multimodal"]];
  const CONSTANCIAS = [["1", "Constancia de no ser contribuyente"], ["2", "Constancia de microproductor"]];
  const labelOf = (list, code) => (list.find(x => x[0] === String(code)) || [code, ""])[1];

  // ================= Establecimientos y puntos de expedición =================
  // Como en el RUC y en Marangatu: los establecimientos son de la empresa (código y dirección) y cada uno tiene sus
  // puntos de expedición ("cajas"). El timbrado habilita puntos y, en cada punto, tipos de documento.
  // empresa.establecimientos = [{ code: "001", address, city, baja, puntos: [{ code: "001", nombre: "Caja 1", baja }] }]
  const pad3 = v => String(v == null ? "" : v).replace(/\D/g, "").padStart(3, "0").slice(-3);
  const keyOf = (est, pt) => pad3(est) + "-" + pad3(pt);
  function establecimientosOf(emp) {
    if (!emp) return [];
    if (!Array.isArray(emp.establecimientos) || !emp.establecimientos.length)
      emp.establecimientos = [{ code: pad3(emp.establishment || "001"), address: emp.address || "", city: emp.city || "", puntos: [{ code: pad3(emp.point || "001"), nombre: "Caja 1" }] }];
    emp.establecimientos.forEach(e => {
      e.code = pad3(e.code); if (!Array.isArray(e.puntos)) e.puntos = [];
      e.puntos.forEach((p, i) => { p.code = pad3(p.code); if (!p.nombre) p.nombre = "Caja " + (i + 1); });
    });
    return emp.establecimientos;
  }
  // Lista plana de puntos: { key: "001-002", est, code, nombre, address, city, baja }
  function puntosOf(emp, conBaja) {
    const out = [];
    establecimientosOf(emp).forEach(e => e.puntos.forEach(p => {
      const baja = !!(e.baja || p.baja);
      if (conBaja || !baja) out.push({ key: keyOf(e.code, p.code), est: e.code, code: p.code, nombre: p.nombre, address: e.address, city: e.city, baja });
    }));
    return out;
  }
  const puntoInfo = (emp, key) => puntosOf(emp, true).find(p => p.key === key) || null;
  const puntoLabel = (emp, key) => { const p = puntoInfo(emp, key); return p ? p.nombre + " (" + key + ")" : key; };
  // Puntos que puede usar un usuario: los admins y el modo dispositivo, todos; los demás, los asignados (si no tiene ninguno asignado, todos)
  function puntosDeUsuario(u, emp) {
    const all = puntosOf(emp).map(p => p.key);
    if (!u || ["maestro", "operador", "admincliente"].includes(u.role)) return all;
    const asig = (u.puntos && u.puntos[emp.id]) || [];
    return asig.length ? all.filter(k => asig.includes(k)) : all;
  }

  // ================= Timbrados =================
  // { id, number, start, end, estado: "cargado" | "activo" | "baja", active (= estado activo), activatedAt,
  //   baja: { motivo, detalle, at, user }, habilita: { "001-001": { tipos: ["1","5"], numeros: { "1": 13, "5": 1 } } } }
  // Reglas (DNIT): cargado = se puede corregir; activo = no se modifica (solo se agregan puntos o tipos habilitados después en Marangatu);
  // baja = definitivo. La numeración corre por timbrado + establecimiento + punto + tipo.
  // tipos (todos los habilitados), numeros y nextNumber (del primer punto) se derivan para compatibilidad.
  const MOTIVOS_BAJA_TIM = [["cambio", "Cambio de timbrado otorgado por la DNIT"], ["cese", "Cese de actividades"], ["dnit", "Cancelado por la DNIT"],
    ["error", "Error de carga"], ["vencimiento", "Vencimiento"], ["otro", "Otro"]];
  function normTimbrado(t, defKey) {
    if (!t) return t;
    if (!t.habilita || !Object.keys(t.habilita).length) {
      const tipos = Array.isArray(t.tipos) && t.tipos.length ? t.tipos.slice() : ["1"];
      t.habilita = { [defKey || "001-001"]: { tipos, numeros: Object.assign({}, t.numeros || { "1": t.nextNumber || 1 }) } };
    }
    Object.values(t.habilita).forEach(h => {
      if (!Array.isArray(h.tipos) || !h.tipos.length) h.tipos = ["1"];
      h.numeros = h.numeros || {}; h.tipos.forEach(c => { if (!(h.numeros[c] >= 1)) h.numeros[c] = 1; });
    });
    if (!t.estado) {
      t.estado = t.active ? "activo" : t.used ? "baja" : "cargado";
      if (t.estado === "baja" && !t.baja) t.baja = { motivo: "cambio", detalle: "Registrado al actualizar la app", at: new Date().toISOString(), user: "" };
    }
    t.active = t.estado === "activo";
    const keys = Object.keys(t.habilita), first = t.habilita[keys[0]];
    t.tipos = Array.from(new Set(keys.flatMap(k => t.habilita[k].tipos)));
    t.numeros = first.numeros; t.nextNumber = first.numeros["1"] || 1;
    return t;
  }
  const habKeys = t => Object.keys(normTimbrado(t).habilita);
  const habOf = (t, key) => { normTimbrado(t); return t.habilita[key || habKeys(t)[0]] || null; };
  const typeEnabled = (t, code, key) => { if (!t) return false; if (!key) return normTimbrado(t).tipos.includes(String(code)); const h = habOf(t, key); return !!h && h.tipos.includes(String(code)); };
  const nextNum = (t, code, key) => { const h = habOf(t, key); return (h && h.numeros[String(code)]) || 1; };
  function bumpNum(t, code, key) { const h = habOf(t, key); h.numeros[code] = (h.numeros[code] || 1) + 1; t.used = true; normTimbrado(t); }
  function timbradoStatus(t) {
    const today = FE.todayKey();
    if (!t) return "none";
    if (t.estado === "baja") return "baja";
    if (t.start && today < t.start) return "futuro";
    if (t.end && today > t.end) return "vencido";
    return "vigente";
  }
  const vigenciaText = t => t.end ? isoToDmy(t.start) + " al " + isoToDmy(t.end) : "Desde " + isoToDmy(t.start) + " · sin fecha de fin";
  const motivoBajaText = b => b ? labelOf(MOTIVOS_BAJA_TIM, b.motivo) + (b.detalle ? " · " + b.detalle : "") : "";
  const habText = (t, emp, key) => { const h = t.habilita[key]; return h.tipos.map(c => deType(c).short + " · " + String(h.numeros[c] || 1).padStart(7, "0")); };
  // opts: { editable, emp }. Los que no administran timbrados ven solo el activo.
  function timbradoListHTML(list, opts) {
    opts = opts || {};
    const sorted = list.map(t => normTimbrado(t)).sort((a, b) => ({ activo: 0, cargado: 1, baja: 2 }[a.estado] - { activo: 0, cargado: 1, baja: 2 }[b.estado]) || String(b.start).localeCompare(String(a.start)));
    const shown = opts.editable ? sorted : sorted.filter(t => t.estado === "activo");
    const rows = shown.map(t => {
      const st = timbradoStatus(t);
      const chip = t.estado === "activo" ? (st === "vigente" ? '<span class="chip ok">Activo</span>' : '<span class="chip bad">Activo · ' + st + '</span>')
        : t.estado === "cargado" ? '<span class="chip warn">Cargado · sin activar</span>' : '<span class="chip neutral">Dado de baja</span>';
      const habs = Object.keys(t.habilita).map(k => `<div class="hab"><b>${esc(opts.emp ? puntoLabel(opts.emp, k) : k)}</b>
        <div class="tipos">${habText(t, opts.emp, k).map(x => `<span class="tipo-chip">${esc(x)}</span>`).join("")}</div></div>`).join("");
      const acts = !opts.editable ? "" : t.estado === "cargado"
        ? `<button class="link" data-timact="${esc(t.id)}" ${st === "vencido" ? "disabled" : ""}>Activar</button><button class="link" data-timedit="${esc(t.id)}">Corregir</button><button class="link danger" data-timdel="${esc(t.id)}">Eliminar</button>`
        : t.estado === "activo" ? `<button class="link" data-timamp="${esc(t.id)}">Ampliar</button><button class="link danger" data-timbaja="${esc(t.id)}">Dar de baja</button>` : "";
      return `<div class="row tim-row" style="cursor:default;align-items:flex-start"><div class="main">
        <div class="title">Nº ${esc(t.number)}</div>
        <div class="sub">${esc(vigenciaText(t))}</div>
        ${habs}
        <div style="margin-top:6px">${chip}</div>
        ${t.estado === "baja" && t.baja ? `<div class="small muted" style="margin-top:4px">Baja: ${esc(motivoBajaText(t.baja))}${t.baja.at ? " · " + esc(isoToDmy(t.baja.at.slice(0, 10))) : ""}${t.baja.user ? " · " + esc(t.baja.user) : ""}</div>` : ""}</div>
        ${acts ? `<span class="tim-acts">${acts}</span>` : ""}</div>`;
    }).join("");
    return (rows || `<div class="muted small">${opts.editable ? "Todavía no hay timbrados cargados." : "No hay timbrado activo."}</div>`) +
      (opts.editable ? `<button class="add" data-timadd>+ Cargar timbrado</button>` : "") +
      `<div class="muted small" style="margin-top:8px">${opts.editable ? "Cargá el timbrado tal como lo aprobó la DNIT en Marangatu, con sus cajas y tipos. Una vez activo no se modifica: si hay un error, se da de baja y se carga otro."
        : "Los timbrados los administran el admin maestro y el admin de la empresa. El número al lado de cada tipo es el próximo a usar."}</div>`;
  }
  const checkbox = (id, checked, text) => `<label style="display:flex;gap:10px;align-items:center;font-weight:600;color:var(--text);margin-top:12px">
    <input type="checkbox" id="${id}" ${checked ? "checked" : ""} style="width:22px;min-height:22px;height:22px;flex:none;appearance:auto"> ${text}</label>`;
  // Casillas de tipos habilitados (alta guiada, una sola caja). sel: tipos marcados
  function tiposFieldsHTML(sel) {
    return `<label>Tipos de documento habilitados en este timbrado</label>
      <div class="card" style="padding:4px 14px">${HABILITABLES.map(c => `<div class="tipo-row"><label style="display:flex;gap:10px;align-items:center;margin:0;color:var(--text);font-weight:600;flex:1">
          <input type="checkbox" data-tipo="${c}" ${sel.includes(c) ? "checked" : ""} style="width:20px;min-height:20px;height:20px;flex:none;appearance:auto"> ${esc(deType(c).short)}</label></div>`).join("")}</div>
      <div class="muted small" style="margin-top:6px">Marcá los mismos tipos que habilitaste en Marangatu. SIFEN rechaza un documento cuyo tipo no esté en el timbrado.</div>`;
  }
  function readTipos(el) { return { tipos: Array.from(el.querySelectorAll("[data-tipo]")).filter(c => c.checked).map(c => c.dataset.tipo), nums: {} }; }
  function bindTipos() {}
  // Campos de habilitación por caja: para cada punto de la empresa, qué tipos habilita y desde qué número.
  // hab: habilitaciones actuales; fixed: true = las que ya existen quedan fijas (ampliar un timbrado activo)
  function habFieldsHTML(emp, hab, fixed) {
    hab = hab || {};
    return puntosOf(emp).map(p => {
      const h = hab[p.key];
      return `<div class="hab-card"><div class="hab-title">${esc(p.nombre)} <span class="muted small">${esc(p.key)}${p.address ? " · " + esc(p.address) : ""}</span></div>
        ${HABILITABLES.map(c => {
          const on = !!h && h.tipos.includes(c), lock = fixed && on, id = p.key + "|" + c;
          return `<div class="tipo-row"><label style="display:flex;gap:10px;align-items:center;margin:0;color:var(--text);font-weight:600;flex:1">
            <input type="checkbox" data-ht="${esc(id)}" ${on ? "checked" : ""} ${lock ? "disabled" : ""} style="width:20px;min-height:20px;height:20px;flex:none;appearance:auto"> ${esc(deType(c).short)}</label>
            ${lock ? `<span class="small muted">próximo ${String(h.numeros[c] || 1).padStart(7, "0")}</span>`
              : `<input data-hn="${esc(id)}" data-kb="digits" value="${esc((h && h.numeros[c]) || 1)}" ${on ? "" : "disabled"} aria-label="Primer número de ${esc(deType(c).short)} en ${esc(p.nombre)}" style="width:110px;min-height:40px;padding:6px 10px">`}</div>`;
        }).join("")}</div>`;
    }).join("") || `<div class="notice warn">La empresa no tiene cajas cargadas. Agregalas en Establecimientos y cajas.</div>`;
  }
  // Lee las casillas: { "001-001": { tipos, numeros } } (solo lo marcado y no fijo)
  function readHab(el) {
    const out = {};
    el.querySelectorAll("[data-ht]").forEach(cb => {
      if (!cb.checked || cb.disabled) return;
      const [key, c] = cb.dataset.ht.split("|"), n = el.querySelector(`[data-hn="${cb.dataset.ht}"]`);
      const num = n ? parseInt(String(n.value).replace(/\D/g, ""), 10) || 1 : 1;
      out[key] = out[key] || { tipos: [], numeros: {} }; out[key].tipos.push(c); out[key].numeros[c] = num;
    });
    return out;
  }
  function bindHab(el) { el.querySelectorAll("[data-ht]").forEach(cb => cb.addEventListener("change", () => { const n = el.querySelector(`[data-hn="${cb.dataset.ht}"]`); if (n) n.disabled = !cb.checked; })); }
  // Cargar o corregir un timbrado (solo si está "cargado"). o: { list, t, emp, onSave(list, message) }
  function timbradoSheet(o) {
    const list = o.list, t = o.t ? normTimbrado(o.t) : null, editing = !!t;
    if (editing && t.estado !== "cargado") { toast("Un timbrado activo o dado de baja no se modifica"); return; }
    const v = t || { number: "", start: FE.todayKey(), end: "", habilita: (() => { const k = (puntosOf(o.emp)[0] || {}).key; return k ? { [k]: { tipos: ["1", "5", "6"], numeros: { "1": 1, "5": 1, "6": 1 } } } : {}; })() };
    sheet(`<h3>${editing ? "Corregir timbrado" : "Cargar timbrado"}</h3>
      <p class="muted small">Cargalo tal como lo aprobó la DNIT. Mientras no lo actives se puede corregir; una vez activo ya no se modifica.</p>
      <label for="tNum">Número de timbrado (8 dígitos)</label>
      <input id="tNum" inputmode="numeric" maxlength="8" placeholder="12345678" value="${esc(v.number)}">
      <div class="grid2">
        <div><label for="tStart">Inicio de vigencia</label><input id="tStart" type="date" value="${esc(v.start)}"></div>
        <div><label for="tEnd">Fin de vigencia</label><input id="tEnd" type="date" value="${esc(v.end)}" ${v.end ? "" : "disabled"}></div>
      </div>
      ${checkbox("tNoEnd", !v.end, "Sin fecha de fin (timbrado electrónico)")}
      <label>Cajas y tipos habilitados</label>
      ${habFieldsHTML(o.emp, v.habilita, false)}
      <div class="muted small" style="margin-top:6px">Marcá, en cada caja, los tipos que habilitaste en Marangatu. El número es el primero a usar.</div>
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      const noEnd = el.querySelector("#tNoEnd"), endEl = el.querySelector("#tEnd");
      noEnd.onchange = () => { endEl.disabled = noEnd.checked; if (noEnd.checked) endEl.value = ""; };
      bindHab(el);
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const number = el.querySelector("#tNum").value.replace(/\D/g, ""), start = el.querySelector("#tStart").value;
        const end = noEnd.checked ? "" : endEl.value, habilita = readHab(el);
        if (!/^\d{8}$/.test(number)) { toast("El timbrado tiene que tener 8 dígitos"); return; }
        if (!start) { toast("Elegí la fecha de inicio"); return; }
        if (!noEnd.checked && !end) { toast("Elegí la fecha de fin o marcá «Sin fecha de fin»"); return; }
        if (end && end < start) { toast("La fecha de fin no puede ser anterior a la de inicio"); return; }
        if (!Object.keys(habilita).length) { toast("Marcá al menos un tipo de documento en una caja"); return; }
        if (Object.values(habilita).some(h => Object.values(h.numeros).some(n => n > 9999999))) { toast("El número tiene que ser menor a 10.000.000"); return; }
        if (list.some(x => x.number === number && x !== t)) { toast("Ese timbrado ya está cargado"); return; }
        if (editing) { Object.assign(t, { number, start, end, habilita }); normTimbrado(t); }
        else list.push(normTimbrado({ id: randomId(6), number, start, end, habilita, estado: "cargado", createdAt: new Date().toISOString() }));
        close(); o.onSave(list, "Timbrado " + number + (editing ? " corregido" : " cargado. Revisalo y activalo para empezar a emitir"));
      };
    });
  }
  // Campo de PIN para confirmar acciones que no se deshacen. o.checkPin(pin) → Promise<boolean>
  const pinFieldHTML = `<label for="cfPin">Confirmá con tu PIN</label><input id="cfPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off">`;
  async function pinOk(el, o) { const pin = el.querySelector("#cfPin").value.trim(); if (!(await o.checkPin(pin))) { toast("PIN incorrecto"); el.querySelector("#cfPin").value = ""; return false; } return true; }
  // Activar: confirma con PIN. El activo anterior se da de baja por cambio de timbrado. o: { list, id, by, checkPin, onSave(list, msg) }
  function activarSheet(o) {
    const t = o.list.find(x => x.id === o.id), prev = o.list.find(x => normTimbrado(x).estado === "activo");
    if (!t) return;
    sheet(`<h3>Activar el timbrado ${esc(t.number)}</h3>
      <p class="muted small">Revisá que el número, la fecha y las cajas coincidan con Marangatu. <b>Una vez activo no se puede modificar.</b>
      ${prev ? "El timbrado activo actual (Nº " + esc(prev.number) + ") se da de baja por cambio de timbrado." : ""}</p>
      ${pinFieldHTML}
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Activar</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = async () => {
        if (!(await pinOk(el, o))) return;
        const r = activateTimbrado(o.list, o.id, o.by);
        if (!r) { toast("Ese timbrado no se puede activar (vencido o ya usado)"); return; }
        close(); o.onSave(o.list, "Timbrado " + r.number + " activo" + (prev ? " · el " + prev.number + " quedó dado de baja" : ""));
      };
      setTimeout(() => el.querySelector("#cfPin").focus(), 60);
    });
  }
  // Dar de baja: motivo obligatorio, PIN, no se deshace. o: { list, id, by, checkPin, onSave(list, msg) }
  function bajaSheet(o) {
    const t = o.list.find(x => x.id === o.id); if (!t) return;
    sheet(`<h3>Dar de baja el timbrado ${esc(t.number)}</h3>
      <p class="muted small">No se puede deshacer. Desde ese momento no se emite con este timbrado; para seguir facturando cargá y activá otro.</p>
      <label for="bMot">Motivo</label><select id="bMot">${MOTIVOS_BAJA_TIM.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select>
      <label for="bDet">Detalle <span class="muted">(obligatorio si elegís «Otro»)</span></label><input id="bDet" data-kb="sentence" placeholder="Ej. Nuevo timbrado 12345678">
      ${pinFieldHTML}
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok style="background:var(--bad);border-color:var(--bad)">Dar de baja</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = async () => {
        const motivo = el.querySelector("#bMot").value, detalle = el.querySelector("#bDet").value.trim();
        if (motivo === "otro" && !detalle) { toast("Escribí el detalle del motivo"); return; }
        if (!(await pinOk(el, o))) return;
        normTimbrado(t); t.estado = "baja"; t.active = false; t.baja = { motivo, detalle, at: new Date().toISOString(), user: o.by || "" };
        close(); o.onSave(o.list, "Timbrado " + t.number + " dado de baja");
      };
    });
  }
  // Ampliar un timbrado activo: solo agregar cajas o tipos habilitados después en Marangatu. o: { list, id, emp, onSave(list, msg) }
  function ampliarSheet(o) {
    const t = normTimbrado(o.list.find(x => x.id === o.id)); if (!t) return;
    sheet(`<h3>Ampliar el timbrado ${esc(t.number)}</h3>
      <p class="muted small">Solo para agregar cajas o tipos de documento que habilitaste después en Marangatu. Lo que ya está no se cambia ni se quita.</p>
      ${habFieldsHTML(o.emp, t.habilita, true)}
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Agregar</button></div>`, (el, close) => {
      bindHab(el);
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = () => {
        const add = readHab(el), parts = [];
        Object.keys(add).forEach(k => {
          const h = t.habilita[k] || (t.habilita[k] = { tipos: [], numeros: {} });
          add[k].tipos.forEach(c => { if (!h.tipos.includes(c)) { h.tipos.push(c); h.numeros[c] = add[k].numeros[c]; parts.push(puntoLabel(o.emp, k) + ": " + deType(c).short); } });
        });
        if (!parts.length) { toast("No marcaste nada nuevo"); return; }
        normTimbrado(t); close(); o.onSave(o.list, "Timbrado " + t.number + " ampliado: " + parts.join(", "));
      };
    });
  }
  // Timbrados de una empresa, normalizados (los viejos pasan a la primera caja de la empresa)
  const timbradosOf = emp => storeFor(emp.id).get("timbrados", []).map(t => normTimbrado(t, (puntosOf(emp, true)[0] || {}).key));
  // Tipos ya usados en documentos emitidos con un timbrado
  const usedTiposOf = (docs, timbradoId) => Array.from(new Set(docs.filter(d => d.kude && d.kude.timbrado && d.kude.timbrado.id === timbradoId && d.status === "ok").map(d => String(d.deType || "1"))));
  // Inutilización: rangos de números que no se van a usar. { id, timbradoId, timbrado, deType, key, est, point, desde, hasta, motivo, at, user }
  function inutilizar(o) {
    const { t, deTypeCode, desde, hasta, docs, inutils } = o;
    if (!t) return { ok: false, error: "Elegí un timbrado" };
    const key = o.key || (o.prefix ? o.prefix.replace(/-$/, "") : habKeys(t)[0]), prefix = key + "-";
    if (!typeEnabled(t, deTypeCode, key)) return { ok: false, error: "Ese tipo no está habilitado en el timbrado para esa caja" };
    if (!(desde >= 1) || !(hasta >= desde) || hasta > 9999999) return { ok: false, error: "Revisá el rango: desde tiene que ser 1 o más y hasta, igual o mayor" };
    if (hasta - desde > 9999) return { ok: false, error: "Un rango puede tener hasta 10.000 números" };
    const numOf = d => parseInt(String(d.number || "").split("-").pop(), 10);
    // Un número está usado si un documento no rechazado lo tiene, en la misma caja: del mismo timbrado, o sin timbrado registrado (documentos viejos)
    const sameTim = d => String(d.number || "").startsWith(prefix) && (d.kude && d.kude.timbrado ? d.kude.timbrado.id === t.id : true);
    const taken = docs.find(d => sameTim(d) && String(d.deType || "1") === deTypeCode && d.status !== "bad" && numOf(d) >= desde && numOf(d) <= hasta);
    if (taken) return { ok: false, error: "El número " + taken.number + " ya se usó en un documento" };
    const keyX = x => x.key || (x.est && x.point ? x.est + "-" + x.point : key);
    const overlap = (inutils || []).find(x => x.timbradoId === t.id && x.deType === deTypeCode && keyX(x) === key && !(hasta < x.desde || desde > x.hasta));
    if (overlap) return { ok: false, error: "Ese rango se superpone con una inutilización anterior (" + overlap.desde + " al " + overlap.hasta + ")" };
    const h = habOf(t, key);
    if (desde <= h.numeros[deTypeCode] && hasta >= h.numeros[deTypeCode]) { h.numeros[deTypeCode] = hasta + 1; normTimbrado(t); }
    return { ok: true, key };
  }
  // Activa un timbrado cargado; el activo anterior queda dado de baja por cambio de timbrado.
  function activateTimbrado(list, id, by) {
    const t = list.find(x => x.id === id);
    if (!t || normTimbrado(t).estado !== "cargado" || timbradoStatus(t) === "vencido") return null;
    const at = new Date().toISOString();
    list.forEach(x => { normTimbrado(x); if (x.estado === "activo") { x.estado = "baja"; x.active = false; x.baja = { motivo: "cambio", detalle: "Se activó el timbrado " + t.number, at, user: by || "" }; } });
    t.estado = "activo"; t.active = true; t.activatedAt = at;
    return t;
  }

  // Un establecimiento o caja está "en uso" si algún timbrado activo o dado de baja lo habilitó: su código ya no se cambia
  const enUso = (e, key) => timbradosOf(e).some(t => t.estado !== "cargado" && t.habilita[key]);
  const estEnUso = (e, est) => puntosOf(e, true).some(p => p.est === est.code && enUso(e, p.key));
  // Lista de inutilizaciones de una empresa
  function inutilListHTML(e, ctx) {
    const list = storeFor(e.id).get("inutilizaciones", []);
    return (list.length ? list.map(x => `<div class="kv"><span><b>${esc(deType(x.deType).short)} · ${esc(puntoLabel(e, x.key || x.est + "-" + x.point))} · ${String(x.desde).padStart(7, "0")} al ${String(x.hasta).padStart(7, "0")}</b>
      <br><span class="small muted">Timbrado ${esc(x.timbrado)} · ${esc(x.motivo)} · ${esc(x.user)}</span></span><span class="small muted">${FE.fmtDate(x.at)}</span></div>`).join("")
      : `<div class="muted small">Sin números inutilizados.</div>`) +
      (ctx.edit ? `<button class="add" data-inutil>+ Inutilizar números</button>` : "") +
      `<div class="muted small" style="margin-top:8px">Para números que no se van a usar (saltos o errores). El aviso a SIFEN lo enviará el servidor.</div>`;
  }
  // ---- Establecimientos (como en el RUC) y sus cajas (puntos de expedición) ----
  function estPtoHTML(e, ctx) {
    const edit = ctx.edit;
    return establecimientosOf(e).map(est => `<div class="est-block ${est.baja ? "off" : ""}">
        <div class="est-head"><b>Establecimiento ${esc(est.code)}</b>${est.baja ? ' <span class="chip neutral">De baja</span>' : ""}
          ${edit && !est.baja ? `<button class="link" data-editest="${esc(est.code)}">${estEnUso(e, est) ? "Ver" : "Editar"}</button>` : ""}</div>
        <div class="small muted">${esc([est.address, est.city].filter(Boolean).join(", ") || "Sin dirección")}</div>
        ${est.puntos.map(p => { const key = est.code + "-" + p.code; return `<div class="kv"><span>${esc(p.nombre)} <span class="small muted">${esc(key)}</span>${p.baja ? ' <span class="chip neutral">De baja</span>' : enUso(e, key) ? ' <span class="chip ok">En timbrado</span>' : ""}</span>
          <span>${edit && !p.baja && !est.baja ? `<button class="link" data-renpto="${esc(key)}">Renombrar</button><button class="link danger" data-bajapto="${esc(key)}">Dar de baja</button>` : ""}</span></div>`; }).join("")}
      </div>`).join("") +
      (edit ? `<div class="btn-row" style="margin-top:10px"><button class="btn soft" data-addpto>+ Agregar caja</button><button class="btn soft" data-addest>+ Establecimiento</button></div>` : "") +
      `<div class="muted small" style="margin-top:8px">Cargalos como figuran en el RUC y en Marangatu. Después, habilitá las cajas nuevas en el timbrado con «Ampliar». Los códigos en uso no se cambian.</div>`;
  }
  function estPtoAction(e, ds, ctx) {
    const ests = establecimientosOf(e), save = (what, detail) => { saveEmpresa(e); ctx.log(what, e.name + " · " + detail); ctx.onChange(); toast(what); };
    if (ds.addest !== undefined || ds.editest) {
      const est = ds.editest ? ests.find(x => x.code === ds.editest) : null, locked = est && estEnUso(e, est);
      sheet(`<h3>${est ? "Establecimiento " + esc(est.code) : "Nuevo establecimiento"}</h3>
        ${locked ? `<p class="muted small">Ya está habilitado en un timbrado: el código y la dirección no se cambian (son los del RUC). Si dejó de usarse, dalo de baja.</p>` : `<p class="muted small">Como figura en el RUC (Marangatu).</p>`}
        <label for="esCode">Código (3 dígitos)</label><input id="esCode" inputmode="numeric" maxlength="3" value="${esc(est ? est.code : "")}" ${est ? "disabled" : ""}>
        <label for="esAdr">Dirección</label><input id="esAdr" data-kb="address" value="${esc(est ? est.address : "")}" ${locked ? "disabled" : ""}>
        <label for="esCity">Ciudad</label><input id="esCity" data-kb="city" value="${esc(est ? est.city : "")}" ${locked ? "disabled" : ""}>
        ${est ? "" : `<label for="esPto">Primera caja</label><input id="esPto" value="Caja 1">`}
        <div class="btn-row" style="margin-top:16px">${est && !est.baja ? `<button class="btn" data-baja style="color:var(--bad)">Dar de baja</button>` : `<button class="btn" data-x>Cancelar</button>`}${locked ? `<button class="btn" data-x>Cerrar</button>` : `<button class="btn primary" data-ok>Guardar</button>`}</div>`, (el, close) => {
        el.querySelectorAll("[data-x]").forEach(b => b.onclick = close);
        const bj = el.querySelector("[data-baja]");
        if (bj) bj.onclick = () => { close(); FE.confirmSheet("¿Dar de baja el establecimiento " + est.code + "?", "Sus cajas dejan de usarse para emitir. No se puede deshacer.", "Dar de baja", () => { est.baja = true; save("Establecimiento dado de baja", est.code); }, true); };
        const ok = el.querySelector("[data-ok]");
        if (ok) ok.onclick = () => {
          const g = id => el.querySelector("#" + id).value.trim();
          if (!est) {
            if (!/^\d{1,3}$/.test(g("esCode"))) { toast("El código tiene hasta 3 dígitos"); return; }
            const code = pad3(g("esCode"));
            if (ests.some(x => x.code === code)) { toast("Ese establecimiento ya está cargado"); return; }
            ests.push({ code, address: g("esAdr"), city: g("esCity"), puntos: [{ code: "001", nombre: g("esPto") || "Caja 1" }] });
            close(); save("Establecimiento agregado", code + " · " + g("esAdr"));
          } else { Object.assign(est, { address: g("esAdr"), city: g("esCity") }); close(); save("Establecimiento editado", est.code); }
        };
      });
      return;
    }
    if (ds.addpto !== undefined) {
      const act = ests.filter(x => !x.baja);
      sheet(`<h3>Agregar caja</h3><p class="muted small">Un punto de expedición creado en Marangatu.</p>
        <label for="ptEst">Establecimiento</label><select id="ptEst">${act.map(x => `<option value="${esc(x.code)}">${esc(x.code)} · ${esc(x.address || "")}</option>`).join("")}</select>
        <div class="grid2"><div><label for="ptCode">Punto (3 dígitos)</label><input id="ptCode" inputmode="numeric" maxlength="3"></div><div><label for="ptName">Nombre</label><input id="ptName"></div></div>
        <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Agregar</button></div>`, (el, close) => {
        const estSel = el.querySelector("#ptEst"), sug = () => { const est = ests.find(x => x.code === estSel.value), n = est.puntos.length + 1;
          el.querySelector("#ptCode").value = String(Math.max(0, ...est.puntos.map(p => +p.code)) + 1).padStart(3, "0"); el.querySelector("#ptName").value = "Caja " + (puntosOf(e, true).length + 1); };
        estSel.onchange = sug; sug();
        el.querySelector("[data-x]").onclick = close;
        el.querySelector("[data-ok]").onclick = () => {
          const est = ests.find(x => x.code === estSel.value), codeIn = el.querySelector("#ptCode").value.trim(), name = el.querySelector("#ptName").value.trim();
          if (!/^\d{1,3}$/.test(codeIn)) { toast("El punto tiene hasta 3 dígitos"); return; }
          const code = pad3(codeIn);
          if (est.puntos.some(p => p.code === code)) { toast("Esa caja ya existe en el establecimiento"); return; }
          if (!name) { toast("Poné un nombre, por ejemplo Caja 2"); return; }
          est.puntos.push({ code, nombre: name }); close(); save("Caja agregada", name + " (" + est.code + "-" + code + "). Habilitala en el timbrado con «Ampliar»");
        };
      });
      return;
    }
    const [ec, pc] = (ds.renpto || ds.bajapto).split("-"), est = ests.find(x => x.code === ec), p = est && est.puntos.find(x => x.code === pc);
    if (!p) return;
    if (ds.renpto) {
      sheet(`<h3>Renombrar ${esc(p.nombre)}</h3><p class="muted small">El nombre es interno; el código ${esc(ec + "-" + pc)} no cambia.</p>
        <label for="rnName">Nombre</label><input id="rnName" value="${esc(p.nombre)}">
        <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
        el.querySelector("[data-x]").onclick = close;
        el.querySelector("[data-ok]").onclick = () => { const n = el.querySelector("#rnName").value.trim(); if (!n) { toast("Escribí el nombre"); return; } const old = p.nombre; p.nombre = n; close(); save("Caja renombrada", old + " → " + n); };
      });
      return;
    }
    FE.confirmSheet("¿Dar de baja " + p.nombre + " (" + ec + "-" + pc + ")?", "Deja de usarse para emitir. Lo emitido queda igual. No se puede deshacer.", "Dar de baja", () => { p.baja = true; save("Caja dada de baja", p.nombre + " (" + ec + "-" + pc + ")"); }, true);
  }
  function inutilSheet(e, ctx) {
    const st = storeFor(e.id), tims = timbradosOf(e).filter(t => t.estado !== "cargado"), act = tims.find(t => t.estado === "activo") || tims[0];
    if (!act) { toast("La empresa no tiene timbrados activos o usados"); return; }
    // Opciones "caja + tipo" del timbrado elegido
    const opts = t => Object.keys(t.habilita).flatMap(k => t.habilita[k].tipos.map(c => `<option value="${esc(k + "|" + c)}">${esc(puntoLabel(e, k))} · ${esc(deType(c).short)} (próximo ${String(nextNum(t, c, k)).padStart(7, "0")})</option>`)).join("");
    sheet(`<h3>Inutilizar números</h3>
      <p class="muted small">Declara a SIFEN que esos números no se van a usar. No se puede deshacer.</p>
      <label for="iuTim">Timbrado</label><select id="iuTim">${tims.map(t => `<option value="${esc(t.id)}" ${t === act ? "selected" : ""}>${esc(t.number)}${t.estado === "activo" ? " (activo)" : " (dado de baja)"}</option>`).join("")}</select>
      <label for="iuTipo">Caja y tipo de documento</label><select id="iuTipo">${opts(act)}</select>
      <div class="grid2"><div><label for="iuDesde">Desde el número</label><input id="iuDesde" data-kb="digits"></div><div><label for="iuHasta">Hasta el número</label><input id="iuHasta" data-kb="digits"></div></div>
      <label for="iuMot">Motivo</label><input id="iuMot" data-kb="sentence" placeholder="Ej. Salto de numeración por error del sistema">
      ${pinFieldHTML}
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok style="background:var(--bad);border-color:var(--bad)">Inutilizar</button></div>`, (el, close) => {
      el.querySelector("#iuTim").onchange = ev => { const t = tims.find(x => x.id === ev.target.value); el.querySelector("#iuTipo").innerHTML = opts(t); };
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("[data-ok]").onclick = async () => {
        const t = tims.find(x => x.id === el.querySelector("#iuTim").value), [key, code] = el.querySelector("#iuTipo").value.split("|");
        const desde = parseInt(el.querySelector("#iuDesde").value, 10), hasta = parseInt(el.querySelector("#iuHasta").value, 10), motivo = el.querySelector("#iuMot").value.trim();
        if (motivo.length < 5) { toast("Escribí el motivo (al menos 5 letras)"); return; }
        if (!(await pinOk(el, ctx))) return;
        const list = st.get("inutilizaciones", []), r = inutilizar({ t, deTypeCode: code, desde, hasta, docs: st.get("invoices", []), inutils: list, key });
        if (!r.ok) { toast(r.error); return; }
        const [est, point] = key.split("-");
        list.unshift({ id: randomId(6), timbradoId: t.id, timbrado: t.number, deType: code, key, est, point, desde, hasta, motivo, at: new Date().toISOString(), user: ctx.by });
        const all = timbradosOf(e).map(x => x.id === t.id ? t : x);
        st.set("inutilizaciones", list); st.set("timbrados", all);
        ctx.log("Inutilización de numeración", e.name + " · " + puntoLabel(e, key) + " · " + deType(code).short + " " + desde + " al " + hasta + " · " + motivo);
        close(); ctx.onChange(); toast("Números inutilizados");
      };
    });
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
    const tims = timbradosOf(emp), act = tims.find(t => t.estado === "activo"), ts = timbradoStatus(act);
    if (ts === "none") out.push({ level: "bad", kind: "timbrado", text: "Sin timbrado activo: no puede facturar" });
    else if (ts === "vencido") out.push({ level: "bad", kind: "timbrado", text: "Timbrado " + act.number + " vencido el " + isoToDmy(act.end) });
    else if (ts === "futuro") out.push({ level: "warn", kind: "timbrado", text: "Timbrado " + act.number + " empieza el " + isoToDmy(act.start) });
    else if (act.end && daysUntil(act.end) <= 30) out.push({ level: "warn", kind: "timbrado", text: "Timbrado " + act.number + " vence en " + daysUntil(act.end) + " día(s)" });
    if (act && !typeEnabled(act, "5")) out.push({ level: "warn", kind: "timbrado", text: "El timbrado activo no habilita nota de crédito: no se podrán corregir facturas después de 48 h" });
    const cs = certStatus(emp.cert);
    if (cs.state === "none") out.push({ level: "warn", kind: "certificado", text: "Certificado sin cargar" });
    else if (cs.state === "expired") out.push({ level: "bad", kind: "certificado", text: "Certificado vencido (" + isoToDmy(emp.cert.vence) + ")" });
    else if (cs.state === "warn") out.push({ level: "warn", kind: "certificado", text: "Certificado vence en " + cs.days + " día(s)" });
    if (emp.env !== "prod") out.push({ level: "info", kind: "ambiente", text: "En ambiente de prueba" });
    const cta = cuenta(emp);
    if (cta.state === "suspendido") out.push({ level: "bad", kind: "cobro", text: cta.text });
    else if (cta.state === "vencido") out.push({ level: "warn", kind: "cobro", text: cta.text });
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
      ${o.modulesFor ? `<label>Puede usar</label><div class="card" style="padding:4px 14px">${MODULES.filter(m => m.perUser && hasModule(o.modulesFor, m.key)).map(m => `<label style="display:flex;gap:10px;align-items:center;margin:8px 0;color:var(--text);font-weight:500">
          <input type="checkbox" data-umod="${m.key}" ${(v.sinModulos || []).includes(m.key) ? "" : "checked"} style="width:20px;min-height:20px;height:20px;flex:none;appearance:auto"> ${esc(m.label)}</label>`).join("") || `<div class="muted small" style="padding:8px 0">La empresa no tiene módulos opcionales habilitados.</div>`}</div>` : ""}
      ${o.puntosFor && puntosOf(o.puntosFor).length > 1 ? `<div id="uPtoWrap"><label>Cajas que usa</label><div class="card" style="padding:4px 14px">${puntosOf(o.puntosFor).map(p => `<label style="display:flex;gap:10px;align-items:center;margin:8px 0;color:var(--text);font-weight:500">
          <input type="checkbox" data-upto="${esc(p.key)}" ${((v.puntos || {})[o.puntosFor.id] || []).includes(p.key) ? "checked" : ""} style="width:20px;min-height:20px;height:20px;flex:none;appearance:auto"> ${esc(p.nombre)} <span class="muted small">${esc(p.key)}</span></label>`).join("")}</div>
          <div class="muted small" style="margin-top:6px">Sin ninguna marcada, puede usar todas. Los admins usan todas.</div></div>` : ""}
      <label for="uPin">${u ? "PIN nuevo (dejalo vacío para no cambiarlo)" : "PIN (4 a 6 números)"}</label>
      <input id="uPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off">
      ${u ? checkbox("uActive", v.active !== false, "Usuario activo") : ""}
      <div class="btn-row" style="margin-top:16px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (el, close) => {
      const roleSel = el.querySelector("#uRole"), wrap = el.querySelector("#uEmpWrap");
      const ptoWrap = el.querySelector("#uPtoWrap");
      const sync = () => { el.querySelector("#uRoleDesc").textContent = ROLES[roleSel.value].desc; if (wrap) wrap.style.display = roleSel.value === "maestro" ? "none" : "";
        if (ptoWrap) ptoWrap.style.display = ["facturador", "cargador"].includes(roleSel.value) ? "" : "none"; };
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
        if (o.puntosFor && el.querySelector("[data-upto]")) { target.puntos = Object.assign({}, target.puntos || {}, { [o.puntosFor.id]: Array.from(el.querySelectorAll("[data-upto]:checked")).map(c => c.dataset.upto) }); }
        if (o.modulesFor) target.sinModulos = Array.from(el.querySelectorAll("[data-umod]")).filter(c => !c.checked).map(c => c.dataset.umod);
        if (pin) target.pin = await hashPin(pin, target.id);
        if (!u) list.push(target);
        saveUsers(list); close(); o.onSave(list, target);
      };
      setTimeout(() => el.querySelector("#uName").focus(), 60);
    });
  }
  // Último ingreso del usuario (se muestra en Mi perfil)
  function markLogin(id) { const l = users(), u = l.find(x => x.id === id); if (u) { u.lastLoginAt = new Date().toISOString(); saveUsers(l); } }

  // ================= Mi perfil (las tres apps) =================
  const initialsOf = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
  // Tarjeta arriba de todo en Ajustes. o: { name, sub }
  function profileCardHTML(o) {
    return `<button class="profile-card" data-profile aria-label="Abrir mi perfil"><span class="pf-avatar">${esc(initialsOf(o.name))}</span>
      <span class="pf-t"><b>${esc(o.name || "Sin nombre")}</b><span>${esc(o.sub || "")}</span></span><span class="pf-go" aria-hidden="true">›</span></button>`;
  }
  // Panel Mi perfil. o: { name, sub, rows: [[etiqueta, valor]], actions: [{ id, label }], exit: { label, confirm, text }, onAction(id, close) }
  function profileSheet(o) {
    const rows = (o.rows || []).filter(r => r[1] != null && String(r[1]).trim() !== "");
    sheet(`<div class="pf-head"><span class="pf-avatar big">${esc(initialsOf(o.name))}</span><div><h3 style="margin:0">${esc(o.name || "Sin nombre")}</h3><div class="muted small">${esc(o.sub || "")}</div></div></div>
      ${rows.length ? `<div class="card" style="margin-top:12px">${rows.map(([k, v]) => `<div class="kv"><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div>` : ""}
      ${(o.actions || []).length ? `<div class="pf-actions">${o.actions.map(a => `<button class="pf-act" data-pfa="${esc(a.id)}">${esc(a.label)}<span aria-hidden="true">›</span></button>`).join("")}</div>` : ""}
      ${o.exit ? `<button class="btn pf-exit" data-pfexit>${esc(o.exit.label)}</button>` : ""}
      <button class="link" data-x style="display:block;margin:10px auto 0">Cerrar</button>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelectorAll("[data-pfa]").forEach(b => b.onclick = () => o.onAction(b.dataset.pfa, close));
      const ex = el.querySelector("[data-pfexit]");
      if (ex) ex.onclick = () => { close(); if (o.exit.confirm) FE.confirmSheet(o.exit.confirm, o.exit.text || "", o.exit.label, () => o.onAction("exit", () => {}), true); else o.onAction("exit", () => {}); };
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
      if (await verifyPin(u, pin)) { el.remove(); markLogin(u.id); o.onSuccess(getUser(u.id) || u); }
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
    ROLES, PERMS, can, tecnico, term, GLOSARIO, isoToDmy, dmyToIso, daysUntil, DEMO, profileCardHTML, profileSheet, markLogin,
    listEmpresas, getEmpresa, saveEmpresa, activeId, setActive, storeFor, newEmpresa, ensureEmpresas,
    users, saveUsers, getUser, usersFor, empresasOf, accessTo, hashPin, verifyPin, sessionUser, setSession,
    audit, auditList, timbradoStatus, vigenciaText, timbradoListHTML, timbradoSheet, activateTimbrado,
    DE_TYPES, deType, HABILITABLES, MOTIVOS_NC, MOTIVOS_ND, MOTIVOS_REM, MODOS_TRANSPORTE, CONSTANCIAS, labelOf,
    normTimbrado, typeEnabled, nextNum, bumpNum, tiposFieldsHTML, readTipos, bindTipos, usedTiposOf, inutilizar,
    MOTIVOS_BAJA_TIM, motivoBajaText, habKeys, habOf, habFieldsHTML, readHab, bindHab, activarSheet, bajaSheet, ampliarSheet,
    establecimientosOf, puntosOf, puntoInfo, puntoLabel, puntosDeUsuario, keyOf, pad3, timbradosOf, estPtoHTML, estPtoAction, inutilSheet, inutilListHTML,
    certStatus, PRESTADORES, queueFor, alertsFor, SEND_LIMIT_H, encodeCatalog, decodeCatalog, productSheet,
    Firmador, ONBOARDING, TEST_CHECKS, MODULES, moduleOf, hasModule, userHas,
    TARIFAS_DEF, tarifas, saveTarifas, CONCEPTS, conceptOf, generalMonto, precioDe, incluidosDe, descuentosDe, descuentoVigente, descuentoTexto, addPeriods, periodOf, periodLabel, nextPeriod, planOf, periodsOf, cargoDe, cargoCerrado, pagosDe, registrarPago, cuenta, boletasDe, registrarBoleta, boletaNueva, marcarBoletaVista, userSheet, loginOverlay, changeOwnPin, empresaPicker, checkbox
  };
})(window);
