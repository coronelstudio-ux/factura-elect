/* PDF de la NOTA DE PEDIDO: comprobante del vendedor para el cliente (se envía por WhatsApp).
   Mismo formato que la factura, simplificado: sin timbrado, CDC, QR ni leyendas del KuDE.
   No es un comprobante fiscal. El membrete queda en blanco hasta que los datos de la empresa
   lleguen desde la base de datos. Usa jsPDF (vendor/jspdf.umd.min.js). */
(function (global) {
  "use strict";
  const W = 210, H = 297, M = 10, CW = W - M * 2;
  const BLACK = [17, 17, 17], GREY = [85, 85, 85], LIGHT = [200, 200, 200];
  const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  const clean = s => String(s == null ? "" : s).replace(/[−]/g, "-").replace(/[ ]/g, " ")
    .replace(/[^\x00-\xFF]/g, c => WINANSI_EXTRA.includes(c) ? c : "?");
  const lh = size => size * 0.3528 * 1.22;
  const LEYENDA = "DOCUMENTO NO VÁLIDO COMO COMPROBANTE FISCAL. La factura electrónica se emite por separado.";

  // p: pedido { id, seller, createdAt, updatedAt, client, condition, installments, currency, exchange, note, items }
  function build(p) {
    const FE = global.FE, { jsPDF } = global.jspdf, cur = p.currency || "PYG";
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const fmt = n => FE.fmt(n, cur);
    const font = (size, bold, color) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor.apply(doc, color || BLACK); };
    const text = (s, x, y, o) => { o = o || {}; font(o.size || 8.5, o.bold, o.color); doc.text(clean(s), x, y, { align: o.align || "left" }); };
    const wrap = (s, w, size, bold) => { font(size, bold); return doc.splitTextToSize(clean(s), w); };
    const box = (x, y, w, h) => { doc.setDrawColor.apply(doc, BLACK); doc.setLineWidth(0.3); doc.rect(x, y, w, h); };
    const hr = (y, color, width) => { doc.setDrawColor.apply(doc, color || BLACK); doc.setLineWidth(width || 0.2); doc.line(M, y, M + CW, y); };
    const date = new Date(p.updatedAt || p.createdAt || Date.now());
    const dateLabel = date.toLocaleDateString("es-PY") + " " + date.toTimeString().slice(0, 5);
    let y = M;

    // ---------- Encabezado: membrete en blanco a la izquierda, datos de la nota a la derecha ----------
    const top = y, hH = 34, RX = M + 106;
    text("NOTA DE PEDIDO", RX, top + 9, { size: 15, bold: true });
    text("Nº " + p.id + (p.rev > 1 ? " (versión " + p.rev + ")" : ""), RX, top + 16, { size: 11, bold: true });
    text("Fecha: " + dateLabel, RX, top + 22.5, { size: 8.5 });
    if (p.seller) text("Vendedor: " + p.seller, RX, top + 27.5, { size: 8.5 });
    box(M, top, CW, hH); doc.setLineWidth(0.2); doc.line(M + 103, top + 3, M + 103, top + hH - 3);
    y = top + hH + 3;

    // ---------- Cliente y condiciones ----------
    const c = p.client || {}, idLabel = FE.receiverIdLabel(c), idText = FE.receiverIdText(c);
    const cond = p.condition === "credito" ? "Crédito" + (p.installments > 1 ? " · " + p.installments + " cuotas" : "") : "Contado";
    const pairs = [["Cliente", FE.receiverDisplayName(c)], [idLabel, idText], ["Condición", cond],
      ["Moneda", cur === "USD" ? "Dólares" + (p.exchange ? " · TC " + p.exchange : "") : "Guaraníes"],
      ["Dirección", c.address], ["Teléfono", c.phone], ["Correo", c.email]].filter(([, v]) => v != null && String(v).trim());
    const colW = (CW - 12) / 2, rows = Math.ceil(pairs.length / 2), rowH = 9.2;
    const bTop = y;
    pairs.forEach(([k, v], i) => {
      const col = i % 2, row = Math.floor(i / 2), x = M + 4 + col * (colW + 4), yy = bTop + 5 + row * rowH;
      text(k, x, yy, { size: 7.5, bold: true });
      text(wrap(v, colW, 8.5)[0] || "", x, yy + 4, { size: 8.5 });
    });
    const bH = rows * rowH + 3;
    box(M, bTop, CW, bH); y = bTop + bH + 4;

    // ---------- Productos (con IVA por producto, como en la factura) ----------
    const cols = [{ t: "Cant.", w: 14, a: "right" }, { t: "Descripción", w: 74 }, { t: "Precio unit.", w: 24, a: "right" }, { t: "Desc.", w: 12, a: "right" },
      { t: "Exentas", w: 22, a: "right" }, { t: "5%", w: 22, a: "right" }, { t: "10%", w: 22, a: "right" }];
    const drawHead = () => {
      let x = M; font(8, true); hr(y); y += 4.6;
      cols.forEach(cl => { doc.text(cl.t, cl.a === "right" ? x + cl.w - 1.5 : x + 1.5, y, { align: cl.a || "left" }); x += cl.w; });
      y += 2.2; hr(y);
    };
    const newPage = () => { doc.addPage(); y = M; drawHead(); };
    drawHead();
    (p.items || []).forEach(it => {
      const total = FE.calcItem(it, cur).total, desc = wrap(it.desc + (it.code ? " (" + it.code + ")" : ""), cols[1].w - 3, 8.5);
      const h = Math.max(1, desc.length) * lh(8.5) + 2.6;
      if (y + h > H - 50) newPage();
      let x = M; const yy = y + 4.2;
      const vals = [FE.fmtQty(it.qty), null, fmt(it.price), it.discount ? it.discount + "%" : "0",
        it.tax === "E" ? fmt(total) : "0", it.tax === "5" ? fmt(total) : "0", it.tax === "10" ? fmt(total) : "0"];
      cols.forEach((cl, i) => {
        if (i === 1) { font(8.5); desc.forEach((l, j) => doc.text(l, x + 1.5, yy + j * lh(8.5))); }
        else text(vals[i], cl.a === "right" ? x + cl.w - 1.5 : x + 1.5, yy, { size: 8.5, align: cl.a });
        x += cl.w;
      });
      y += h; hr(y, LIGHT, 0.15);
    });
    hr(y);

    // ---------- Totales ----------
    const t = FE.calcItems(p.items || [], cur);
    if (y + 40 > H - 20) { doc.addPage(); y = M; }
    const tx = M + CW - 1.5, sub = (label, v, bold) => { y += 5.4; text(label, M + 1.5, y, { size: 9, bold }); text(v, tx, y, { size: 9, bold, align: "right" }); };
    y += 1;
    let x0 = M; cols.slice(0, 4).forEach(cl => x0 += cl.w);
    y += 5; text("SUBTOTAL", M + 1.5, y, { size: 9, bold: true });
    [t.exe, t.b5, t.b10].forEach((v, i) => { x0 += cols[4 + i].w; text(fmt(v), x0 - 1.5, y, { size: 9, bold: true, align: "right" }); });
    y += 2; hr(y, LIGHT, 0.15);
    sub("TOTAL DEL PEDIDO", FE.money(t.total, cur), true);
    if (cur === "USD" && FE.pygTotal(t.total, "USD", p.exchange)) sub("Total en guaraníes", FE.money(FE.pygTotal(t.total, "USD", p.exchange), "PYG"));
    y += 2; hr(y, LIGHT, 0.15); y += 5;
    text("IVA incluido:  (5%) " + fmt(t.iva5) + "    (10%) " + fmt(t.iva10) + "    Total IVA " + fmt(t.iva), M + 1.5, y, { size: 8.5, color: GREY });
    y += 3; hr(y);

    // ---------- Nota ----------
    if (p.note) {
      y += 6; text("Nota", M + 1.5, y, { size: 8, bold: true }); y += 4.2;
      const nl = wrap(p.note, CW - 3, 8.5); font(8.5); nl.forEach(l => { if (y > H - 22) { doc.addPage(); y = M + 4; } doc.text(l, M + 1.5, y); y += lh(8.5); });
    }

    // ---------- Leyenda no fiscal ----------
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor.apply(doc, LIGHT); doc.setLineWidth(0.2); doc.line(M, H - 16, M + CW, H - 16);
      text(LEYENDA, W / 2, H - 11.5, { size: 8, bold: true, align: "center" });
      text("Nota de pedido " + p.id, M, H - 6, { size: 7, color: GREY });
      text("Página " + i + " de " + pages, W - M, H - 6, { size: 7, color: GREY, align: "right" });
    }
    return doc;
  }

  const fileName = p => "Nota_de_pedido_" + String(p.id || "borrador").replace(/[^0-9A-Za-z-]/g, "_") + ".pdf";
  // Comparte el PDF (WhatsApp aparece en la lista del celular). Si el navegador no puede compartir archivos, lo descarga.
  async function share(p) {
    const doc = build(p), blob = doc.output("blob"), name = fileName(p);
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Nota de pedido " + p.id, text: "Nota de pedido " + p.id }); return "shared"; }
      catch (err) { if (err && err.name === "AbortError") return "cancelled"; }
    }
    global.FE.downloadBlob(blob, name);
    return "downloaded";
  }

  global.NotaPedidoPdf = { build, share, fileName, LEYENDA };
})(window);
