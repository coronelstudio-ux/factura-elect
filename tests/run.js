// Pruebas automáticas de las reglas compartidas (shared/core.js). Se corren con: node tests/run.js
// No necesitan instalar nada: simulan lo mínimo del navegador que usa core.js.
"use strict";
const path = require("path");
const assert = require("assert");

global.window = global;
global.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
global.LZString = require(path.join(__dirname, "..", "vendor", "lz-string.min.js"));
require(path.join(__dirname, "..", "shared", "core.js"));
const FE = global.FE;

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

Promise.all(pending).then(() => {
  console.log(`\n${passed} correctas, ${failed} con error`);
  process.exit(failed ? 1 : 0);
});
