// Pruebas automáticas de las reglas compartidas (shared/core.js). Se corren con: node tests/run.js
// No necesitan instalar nada: simulan lo mínimo del navegador que usa core.js.
"use strict";
const path = require("path");
const assert = require("assert");

global.window = global;
global.addEventListener = () => {};
global.LZString = require(path.join(__dirname, "..", "vendor", "lz-string.min.js"));
// localStorage en memoria, para probar el núcleo multiempresa
const mem = new Map();
global.localStorage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
  key: i => Array.from(mem.keys())[i] || null, get length() { return mem.size; } };
require(path.join(__dirname, "..", "shared", "core.js"));
require(path.join(__dirname, "..", "shared", "tenant.js"));
const FE = global.FE;
const T = FE.T;

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  pending.push((async () => {
    try { await fn(); passed++; console.log("  ✓ " + name); }
    catch (err) { failed++; console.log("  ✗ " + name + "\n      " + (err && err.message)); }
  })());
}

// ---------- Dígito verificador (módulo 11) ----------
test("dv11('80012345') = 0", () => assert.strictEqual(FE.dv11("80012345"), 0));
test("dv11('4567890') = 1", () => assert.strictEqual(FE.dv11("4567890"), 1));
test("RUC con DV incorrecto se rechaza", () => assert.strictEqual(FE.classify({ mode: "con", ruc: "4567890-2" }, 0).valid, false));
test("RUC sin dígito verificador se rechaza", () => assert.strictEqual(FE.classify({ mode: "con", ruc: "4567890" }, 0).valid, false));

// ---------- Clasificación del receptor (operación automática) ----------
const op = (ruc) => FE.classify({ mode: "con", ruc }, 0);
test("4567890-1 → persona física simple → B2B", () => { const r = op("4567890-1"); assert.ok(r.valid); assert.strictEqual(r.operation, "B2B"); assert.match(r.label, /Simple/); });
test("3210987-3 → unipersonal → B2B", () => { const r = op("3210987-3"); assert.strictEqual(r.operation, "B2B"); assert.match(r.label, /Unipersonal/); });
test("80098765-9 → sociedad → B2B", () => { const r = op("80098765-9"); assert.strictEqual(r.operation, "B2B"); assert.match(r.label, /Sociedad/); });
test("80011111-7 → organismo del Estado → B2G", () => assert.strictEqual(op("80011111-7").operation, "B2G"));
test("RUC válido no encontrado → B2B con aviso", () => { const r = op("80012345-0"); assert.ok(r.valid); assert.strictEqual(r.operation, "B2B"); assert.match(r.why, /No aparece/); });
test("Sin RUC → B2C", () => assert.strictEqual(FE.classify({ mode: "sin" }, 100000).operation, "B2C"));
test("Sin RUC y sin documento → tipo 5 (innominado)", () => assert.strictEqual(FE.classify({ mode: "sin" }, 100000).docType, "5"));
test("Sin RUC con cédula → tipo 1", () => assert.strictEqual(FE.classify({ mode: "sin", doc: "1234567", docType: "1" }, 100000).docType, "1"));
test("Innominado con Gs 6.999.999 → permitido", () => assert.strictEqual(FE.classify({ mode: "sin" }, 6999999).valid, true));
test("Innominado con Gs 7.000.000 → rechazado (NT 024)", () => assert.strictEqual(FE.classify({ mode: "sin" }, 7000000).valid, false));
test("Innominado con Gs 8.000.000 → rechazado", () => assert.strictEqual(FE.classify({ mode: "sin" }, 8000000).valid, false));
test("Gs 8.000.000 con documento → permitido", () => assert.strictEqual(FE.classify({ mode: "sin", doc: "1234567" }, 8000000).valid, true));
test("Extranjero con nombre y pasaporte → B2F", () => { const r = FE.classify({ mode: "ext", name: "Cliente Exterior", doc: "X123", docType: "2" }, 0); assert.ok(r.valid); assert.strictEqual(r.operation, "B2F"); });
test("Extranjero sin documento → rechazado", () => assert.strictEqual(FE.classify({ mode: "ext", name: "Cliente Exterior" }, 0).valid, false));
test("Extranjero no acepta cédula paraguaya (pasa a pasaporte)", () => assert.strictEqual(FE.classify({ mode: "ext", name: "A", doc: "1", docType: "1" }, 0).docType, "2"));

// ---------- Totales e IVA ----------
test("Totales del caso de ejemplo", () => {
  const t = FE.calcItems([{ qty: 2, price: 45000, tax: "10" }, { qty: 3, price: 8000, tax: "E" }, { qty: 5, price: 3000, tax: "5" }]);
  assert.deepStrictEqual({ exe: t.exe, b5: t.b5, iva5: t.iva5, b10: t.b10, iva10: t.iva10, total: t.total, iva: t.iva },
    { exe: 24000, b5: 15000, iva5: 714, b10: 90000, iva10: 8181, total: 129000, iva: 8895 });
});
test("Descuento por ítem antes de calcular el IVA", () => {
  const c = FE.calcItem({ qty: 1, price: 110000, tax: "10", discount: 10 });
  assert.strictEqual(c.total, 99000); assert.strictEqual(c.iva10, 9000);
});

// ---------- CDC ----------
// El ejemplo del informe (0180012345000100100000122202611041417392851) tiene 43 dígitos: al código de seguridad le falta uno.
// Se usa el mismo CDC con un código de seguridad de 9 dígitos (417392850).
const fecha = new Date(2026, 10, 4, 16, 22, 48);
const cdcEj = FE.buildCdc({ deType: "1", ruc: "80012345", dv: "0", establishment: "001", point: "001", number: 12, taxpayerType: "2", date: fecha, emissionType: "1", securityCode: "417392850" });
test("CDC tiene 44 dígitos", () => assert.strictEqual(cdcEj.length, 44));
test("CDC: estructura por posiciones", () => {
  assert.strictEqual(cdcEj.slice(0, 2), "01");          // tipo de documento
  assert.strictEqual(cdcEj.slice(2, 10), "80012345");   // RUC emisor
  assert.strictEqual(cdcEj.slice(10, 11), "0");         // DV
  assert.strictEqual(cdcEj.slice(11, 14), "001");       // establecimiento
  assert.strictEqual(cdcEj.slice(14, 17), "001");       // punto
  assert.strictEqual(cdcEj.slice(17, 24), "0000012");   // número
  assert.strictEqual(cdcEj.slice(24, 25), "2");         // tipo de contribuyente
  assert.strictEqual(cdcEj.slice(25, 33), "20261104");  // fecha
  assert.strictEqual(cdcEj.slice(33, 34), "1");         // tipo de emisión
  assert.strictEqual(cdcEj.slice(34, 43), "417392850"); // código de seguridad
});
test("CDC: DV del ejemplo = 1 (módulo 11 sobre los 43 primeros, verificado aparte)", () => assert.strictEqual(cdcEj, "0180012345000100100000122202611041417392850" + "1"));
test("CDC generado es válido y el código de seguridad cambia", () => {
  const a = FE.buildCdc({ ruc: "80012345", dv: "0", establishment: "001", point: "001", number: 13, date: fecha });
  const b = FE.buildCdc({ ruc: "80012345", dv: "0", establishment: "001", point: "001", number: 13, date: fecha });
  assert.ok(FE.isValidCdc(a) && FE.isValidCdc(b)); assert.notStrictEqual(a.slice(34, 43), b.slice(34, 43));
});
test("CDC con un dígito cambiado no es válido", () => assert.strictEqual(FE.isValidCdc(cdcEj.slice(0, 20) + ((+cdcEj[20] + 1) % 10) + cdcEj.slice(21)), false));
test("CDC se muestra en 11 grupos de 4", () => assert.strictEqual(FE.formatCdc(cdcEj).split(" ").length, 11));

// ---------- QR (sección 13.8) ----------
test("QR: parámetros en orden y hash con el CSC de prueba", async () => {
  const url = await FE.buildQrUrl({ env: "test", cdc: cdcEj, date: "2026-11-04T16:22:48", receiver: { mode: "con", ruc: "80098765-9" },
    total: 129000, iva: 8895, items: 3, digest: "abc=", csc: FE.CSC_TEST });
  assert.ok(url.startsWith("https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150&Id=" + cdcEj + "&dFeEmiDE="));
  const q = url.split("?")[1];
  const names = q.split("&").map(p => p.split("=")[0]);
  assert.deepStrictEqual(names, ["nVersion", "Id", "dFeEmiDE", "dRucRec", "dTotGralOpe", "dTotIVA", "cItems", "DigestValue", "IdCSC", "cHashQR"]);
  assert.match(q, /dRucRec=80098765&/);                                   // RUC sin DV
  assert.match(q, new RegExp("dFeEmiDE=" + FE.toHex("2026-11-04T16:22:48") + "&"));
  const params = q.slice(0, q.indexOf("&cHashQR="));
  assert.strictEqual(q.split("cHashQR=")[1], await FE.sha256Hex(params + FE.CSC_TEST.value));
});
test("QR: receptor sin RUC usa dNumIDRec (0 si es innominado)", async () => {
  const url = await FE.buildQrUrl({ env: "test", cdc: cdcEj, date: "2026-11-04T16:22:48", receiver: { mode: "sin" }, total: 1, iva: 0, items: 1, digest: "", csc: FE.CSC_TEST });
  assert.match(url, /&dNumIDRec=0&/);
});

// ---------- Pedido por QR ----------
test("Pedido: ida y vuelta por el código QR, incluido extranjero", () => {
  const p = { id: "AB12-0001", rev: 2, seller: "Ana", createdAt: "2026-11-06T10:00:00Z", client: { mode: "ext", name: "Cliente Exterior", doc: "X123", docType: "2", country: "Brasil", ruc: "", email: "" },
    condition: "credito", installments: 3, currency: "USD", exchange: "7800", items: [{ desc: "Resma", qty: 2, price: 45000, tax: "10", discount: 0 }], note: "nota" };
  const r = FE.decodePedido("Pedido AB12-0001\n" + FE.encodePedido(p));
  assert.ok(r.ok); assert.strictEqual(r.pedido.client.mode, "ext"); assert.strictEqual(r.pedido.client.country, "Brasil");
  assert.strictEqual(r.pedido.items[0].price, 45000); assert.strictEqual(r.pedido.rev, 2);
});
test("Pedido: código alterado se rechaza", () => {
  const code = FE.encodePedido({ id: "X-1", seller: "A", client: { mode: "sin" }, items: [{ desc: "a", qty: 1, price: 1, tax: "10" }] });
  assert.strictEqual(FE.decodePedido(code.slice(0, -4) + "AAAA").ok, false);
});

// ---------- Montos en guaraníes y en dólares ----------
test("Guaraníes: «45.000» se lee como 45000", () => assert.strictEqual(FE.parseAmount("45.000"), 45000));
test("Dólares: 12,50 / 12.50 / 1.250,50 / 1,250.50", () => {
  assert.strictEqual(FE.parseAmount("12,50", "USD"), 12.5); assert.strictEqual(FE.parseAmount("12.50", "USD"), 12.5);
  assert.strictEqual(FE.parseAmount("1.250,50", "USD"), 1250.5); assert.strictEqual(FE.parseAmount("1,250.50", "USD"), 1250.5);
  assert.strictEqual(FE.parseAmount("1.250", "USD"), 1250);
});
test("Formato: Gs sin decimales y USD con 2", () => { assert.strictEqual(FE.fmt(1250000), "1.250.000"); assert.strictEqual(FE.fmt(1250.5, "USD"), "1.250,50"); assert.strictEqual(FE.money(7, "USD"), "USD 7,00"); });
test("IVA en dólares con 2 decimales", () => {
  const c = FE.calcItem({ qty: 3, price: 12.5, tax: "10" }, "USD");
  assert.strictEqual(c.total, 37.5); assert.strictEqual(c.iva10, 3.41);
  const t = FE.calcItems([{ qty: 1, price: 10.1, tax: "5" }, { qty: 2, price: 0.35, tax: "10" }], "USD");
  assert.strictEqual(t.total, 10.8); assert.strictEqual(t.iva5, 0.48); assert.strictEqual(t.iva10, 0.06);
});
test("Límite de innominado se mide en guaraníes", () => {
  assert.strictEqual(FE.pygTotal(1000, "USD", "7.800"), 7800000); assert.strictEqual(FE.pygTotal(1000, "USD", ""), null);
  assert.strictEqual(FE.classify({ mode: "sin" }, FE.pygTotal(1000, "USD", "7.800")).valid, false);
});

// ---------- Multiempresa: roles y permisos ----------
test("Sin usuario (un solo dispositivo) se permite todo", () => assert.ok(T.can(null, "empresa.certificado")));
test("Facturador no edita timbrados ni ve certificados", () => { const u = { role: "facturador" }; assert.ok(T.can(u, "facturar")); assert.ok(!T.can(u, "timbrados.editar")); assert.ok(!T.can(u, "empresa.certificado")); });
test("Operador edita timbrados pero no certificados ni usuarios del estudio", () => { const u = { role: "operador" }; assert.ok(T.can(u, "timbrados.editar")); assert.ok(!T.can(u, "empresa.certificado")); assert.ok(!T.can(u, "usuarios.estudio")); });
test("Admin del cliente configura su empresa pero no el ambiente", () => { const u = { role: "admincliente" }; assert.ok(T.can(u, "cliente.config")); assert.ok(!T.can(u, "empresa.ambiente")); });
test("Cargador no factura", () => assert.ok(!T.can({ role: "cargador" }, "facturar")));

// ---------- Multiempresa: empresas, datos separados y acceso ----------
test("Primer uso: crea la empresa de ejemplo y migra los datos viejos", () => {
  localStorage.setItem("fac_invoices", JSON.stringify([{ id: 1, number: "001-001-0000001", status: "ok" }]));
  const e = T.ensureEmpresas();
  assert.strictEqual(e.ruc, "80012345"); assert.ok(e.demo);
  assert.strictEqual(T.storeFor(e.id).get("invoices", []).length, 1);
  assert.strictEqual(T.storeFor(e.id).get("timbrados", []).filter(t => t.active).length, 1);
});
test("Cada empresa guarda sus datos aparte", () => {
  const e2 = T.saveEmpresa(T.newEmpresa({ name: "Otra", ruc: "4567890", dv: "1" }));
  assert.strictEqual(T.storeFor(e2.id).get("invoices", []).length, 0);
  assert.strictEqual(T.listEmpresas().length, 2);
});
test("Usuarios: el maestro accede a todas, el resto solo a las asignadas", () => {
  const [a, b] = T.listEmpresas();
  T.saveUsers([{ id: "m", name: "M", role: "maestro", empresas: [] }, { id: "f", name: "F", role: "facturador", empresas: [b.id] }]);
  assert.strictEqual(T.empresasOf(T.getUser("m")).length, 2);
  assert.deepStrictEqual(T.empresasOf(T.getUser("f")).map(e => e.id), [b.id]);
  assert.deepStrictEqual(T.usersFor(a.id).map(u => u.id), ["m"]);
});
test("PIN: se guarda con hash y se verifica", async () => {
  const u = { id: "x1" }; u.pin = await T.hashPin("4321", u.id);
  assert.ok(u.pin.startsWith("s256:")); assert.ok(!u.pin.includes("4321"));
  assert.ok(await T.verifyPin(u, "4321")); assert.ok(!(await T.verifyPin(u, "1234")));
});

// ---------- Timbrados, certificado y alertas ----------
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return FE.localDayKey(d.toISOString()); };
test("Timbrado: vigente, futuro y vencido", () => {
  assert.strictEqual(T.timbradoStatus({ start: plusDays(-10), end: "" }), "vigente");
  assert.strictEqual(T.timbradoStatus({ start: plusDays(5), end: "" }), "futuro");
  assert.strictEqual(T.timbradoStatus({ start: plusDays(-30), end: plusDays(-1) }), "vencido");
});
test("Activar un timbrado deja uno solo activo y no activa vencidos", () => {
  const l = [{ id: "a", start: plusDays(-5), end: "", active: true }, { id: "b", start: plusDays(-5), end: "", active: false }, { id: "c", start: plusDays(-9), end: plusDays(-2), active: false }];
  assert.ok(T.activateTimbrado(l, "b")); assert.deepStrictEqual(l.filter(t => t.active).map(t => t.id), ["b"]);
  assert.strictEqual(T.activateTimbrado(l, "c"), null);
});
test("Certificado: sin cargar, por vencer y vencido", () => {
  assert.strictEqual(T.certStatus(null).state, "none");
  assert.strictEqual(T.certStatus({ vence: plusDays(10) }).state, "warn");
  assert.strictEqual(T.certStatus({ vence: plusDays(-1) }).state, "expired");
  assert.strictEqual(T.certStatus({ vence: plusDays(200) }).state, "ok");
});
test("Alertas: timbrado, certificado, rechazadas y envío fuera de plazo", () => {
  const e = T.saveEmpresa(T.newEmpresa({ name: "Alertas", ruc: "3210987", dv: "3", cert: { vence: plusDays(5) } }));
  const st = T.storeFor(e.id);
  st.set("invoices", [{ id: 1, status: "bad" }, { id: 2, status: "bad", cancelled: true }, { id: 3, status: "warn", date: new Date(Date.now() - 80 * 3600000).toISOString() }]);
  const kinds = T.alertsFor(e).map(a => a.kind + ":" + a.level);
  assert.ok(kinds.includes("timbrado:bad")); assert.ok(kinds.includes("certificado:warn")); assert.ok(kinds.includes("rechazadas:bad")); assert.ok(kinds.includes("envio:bad"));
  assert.match(T.alertsFor(e).find(a => a.kind === "rechazadas").text, /^1 /);
});

// ---------- Catálogo y firma ----------
test("Catálogo de productos: ida y vuelta por código y rechazo si está alterado", () => {
  const code = T.encodeCatalog([{ code: "RES-A4", desc: "Resma A4", price: 45000, tax: "10" }, { desc: "Cuaderno", price: 12000, tax: "5" }], "Empresa");
  const r = T.decodeCatalog("Catálogo\n" + code);
  assert.ok(r.ok); assert.strictEqual(r.products.length, 2); assert.strictEqual(r.products[0].code, "RES-A4"); assert.strictEqual(r.products[1].tax, "5");
  assert.strictEqual(T.decodeCatalog(code.slice(0, -4) + "AAAA").ok, false);
});
test("Firmador (simulado) devuelve un DigestValue en base64", async () => {
  const f = await T.Firmador.firmar({ empresa: { cert: { titular: "X", vence: "2027-01-01" } }, cdc: "1", payload: { a: 1 } });
  assert.ok(f.ok && f.simulated); assert.match(f.digestValue, /^[A-Za-z0-9+/]+=*$/); assert.strictEqual(Buffer.from(f.digestValue, "base64").length, 32);
});
test("Pedido: el código de producto viaja en el QR", () => {
  const p = { id: "X-2", seller: "A", client: { mode: "sin" }, items: [{ desc: "Resma", qty: 1, price: 1, tax: "10", code: "RES-A4" }] };
  assert.strictEqual(FE.decodePedido(FE.encodePedido(p)).pedido.items[0].code, "RES-A4");
});

// ---------- Tipos de documento y timbrado por tipo ----------
test("Tipos: factura, notas, autofactura y remisión disponibles; recibo, retención y exportación no", () => {
  assert.deepStrictEqual(T.HABILITABLES, ["1", "5", "6", "4", "7"]);
  ["RD", "8", "2", "3"].forEach(c => { assert.strictEqual(T.deType(c).available, false); assert.ok(T.deType(c).reason); });
});
test("Timbrado viejo (solo nextNumber) pasa a factura con su numeración", () => {
  const t = T.normTimbrado({ id: "x", nextNumber: 13 });
  assert.deepStrictEqual(t.tipos, ["1"]); assert.strictEqual(T.nextNum(t, "1"), 13);
  assert.ok(!T.typeEnabled(t, "5"));
});
test("Numeración propia por tipo", () => {
  const t = T.normTimbrado({ id: "y", tipos: ["1", "5"], numeros: { "1": 20 } });
  assert.strictEqual(T.nextNum(t, "5"), 1);
  T.bumpNum(t, "5"); T.bumpNum(t, "5"); T.bumpNum(t, "1");
  assert.strictEqual(T.nextNum(t, "5"), 3); assert.strictEqual(T.nextNum(t, "1"), 21); assert.strictEqual(t.nextNumber, 21);
});
test("Plazo de cancelación: 48 h; remisión 168 h", () => { assert.strictEqual(T.deType("1").cancelH, 48); assert.strictEqual(T.deType("5").cancelH, 48); assert.strictEqual(T.deType("7").cancelH, 168); });
test("CDC lleva el tipo de documento", () => {
  const c = FE.buildCdc({ deType: "5", ruc: "80012345", dv: "0", establishment: "001", point: "001", number: 1, date: new Date(2026, 10, 11) });
  assert.strictEqual(c.slice(0, 2), "05"); assert.ok(FE.isValidCdc(c));
});
test("Inutilización: avanza la numeración, rechaza superpuestos y números usados", () => {
  const t = T.normTimbrado({ id: "z", tipos: ["1"], numeros: { "1": 13 } });
  const docs = [{ number: "001-001-0000009", status: "ok" }, { number: "001-001-0000011", status: "bad" }];
  assert.ok(T.inutilizar({ t, deTypeCode: "1", desde: 13, hasta: 15, docs, inutils: [], prefix: "001-001-" }).ok);
  assert.strictEqual(T.nextNum(t, "1"), 16);
  const prev = [{ timbradoId: "z", deType: "1", desde: 13, hasta: 15 }];
  assert.match(T.inutilizar({ t, deTypeCode: "1", desde: 15, hasta: 18, docs, inutils: prev, prefix: "001-001-" }).error, /superpone/);
  assert.match(T.inutilizar({ t, deTypeCode: "1", desde: 9, hasta: 9, docs, inutils: prev, prefix: "001-001-" }).error, /ya se usó/);
  assert.ok(T.inutilizar({ t, deTypeCode: "1", desde: 11, hasta: 11, docs, inutils: prev, prefix: "001-001-" }).ok); // el 11 fue rechazado: se puede inutilizar
  assert.match(T.inutilizar({ t, deTypeCode: "5", desde: 1, hasta: 2, docs, inutils: prev }).error, /no está habilitado/);
});
test("Motivos y modos tienen etiqueta", () => {
  assert.strictEqual(T.labelOf(T.MOTIVOS_NC, "2"), "Devolución");
  assert.strictEqual(T.labelOf(T.MOTIVOS_REM, "7"), "Traslado entre locales de la empresa");
  assert.strictEqual(T.labelOf(T.MODOS_TRANSPORTE, "1"), "Terrestre");
});
test("Producto sin precio (remisión) tiene total cero", () => assert.strictEqual(FE.calcItems([{ qty: 10, price: 0, tax: "E" }]).total, 0));

Promise.all(pending).then(() => {
  console.log(`\n${passed} correctas, ${failed} con error`);
  process.exit(failed ? 1 : 0);
});
