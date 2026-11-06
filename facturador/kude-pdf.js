/* Genera el PDF del KuDE con los datos de la factura (texto real, seleccionable y buscable),
   en A4, con varias páginas si hay muchos productos. Usa jsPDF (vendor/jspdf.umd.min.js)
   y qrcode-generator (vendor/qrcode.js) para el QR vectorial. */
(function (global) {
  "use strict";
  const W = 210, H = 297, M = 10, CW = W - M * 2;
  const BLACK = [17, 17, 17], GREY = [85, 85, 85], LIGHT = [200, 200, 200], RED = [180, 35, 24], BLUE = [31, 90, 166];
  // Caracteres extra que la fuente estándar Helvetica (WinAnsi) sí puede mostrar
  const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  const clean = s => String(s == null ? "" : s).replace(/[−]/g, "-").replace(/[ ]/g, " ")
    .replace(/[^\x00-\xFF]/g, c => WINANSI_EXTRA.includes(c) ? c : "?");
  const fmt = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const lh = size => size * 0.3528 * 1.22; // alto de línea en mm

  // Convierte el logo (PNG/JPG/SVG/WebP en data URL) a PNG para jsPDF y devuelve su tamaño.
  function prepareLogo(dataUrl) {
    return new Promise(resolve => {
      if (!dataUrl) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round((img.naturalWidth || 300) * k)); cv.height = Math.max(1, Math.round((img.naturalHeight || 120) * k));
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        try { resolve({ data: cv.toDataURL("image/png"), w: cv.width, h: cv.height }); } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function build(inv, company, opts) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const T = inv.totals, isUSD = inv.currency === "USD", test = company.env === "test";
    const logo = await prepareLogo(company.logo);
    let y = M;

    const font = (size, bold, color) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor.apply(doc, color || BLACK); };
    const text = (s, x, yy, o) => { o = o || {}; font(o.size || 8.5, o.bold, o.color); doc.text(clean(s), x, yy, { align: o.align || "left" }); };
    const wrap = (s, w, size, bold) => { font(size, bold); return doc.splitTextToSize(clean(s), w); };
    const lines = (arr, x, yy, size, bold, color) => { font(size, bold, color); arr.forEach((l, i) => doc.text(l, x, yy + i * lh(size))); return arr.length * lh(size); };
    const hr = (yy, color, width) => { doc.setDrawColor.apply(doc, color || BLACK); doc.setLineWidth(width || 0.2); doc.line(M, yy, M + CW, yy); };
    const box = (x, yy, w, h) => { doc.setDrawColor.apply(doc, BLACK); doc.setLineWidth(0.3); doc.rect(x, yy, w, h); };

    // ---------- Encabezado de ambiente ----------
    if (test) {
      text("AMBIENTE DE PRUEBA - SIN VALIDEZ TRIBUTARIA", W / 2, y + 3, { size: 9, bold: true, color: RED, align: "center" }); y += 5;
      text("DOCUMENTO ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA", W / 2, y + 2, { size: 6.5, color: RED, align: "center" }); y += 4;
    }
    text("KuDE de Factura Electrónica", W / 2, y + 3.5, { size: 10.5, align: "center" }); y += 7;

    // ---------- Emisor ----------
    const top = y, LX = M + 3, RX = M + 106, LW = 98, RW = CW - 106 - 3;
    let ly = top + 3;
    if (logo) {
      const k = Math.min(45 / logo.w, 18 / logo.h);
      doc.addImage(logo.data, "PNG", LX, ly, logo.w * k, logo.h * k); ly += logo.h * k + 2;
    } else {
      doc.setDrawColor(138, 138, 138); doc.setLineDashPattern([1, 1], 0); doc.setLineWidth(0.2); doc.rect(LX, ly, 50, 12); doc.setLineDashPattern([], 0);
      text("Logo del emisor", LX + 25, ly + 7, { size: 7, color: [138, 138, 138], align: "center" }); ly += 14;
    }
    ly += 3;
    ly += lines(wrap(company.name, LW, 10, true), LX, ly, 10, true);
    const emisor = [company.fantasy, company.address, company.city + " · Tel. " + company.phone, company.mail, "Actividad: " + company.activity].filter(Boolean);
    emisor.forEach(l => { ly += lines(wrap(l, LW, 8), LX, ly, 8); });
    let ry = top + 6;
    text("RUC: " + company.ruc + "-" + company.dv, RX, ry, { size: 10.5, bold: true }); ry += 5.5;
    ["Timbrado Nº: " + company.timbrado, "Inicio de vigencia: " + company.start, "Fin de vigencia: " + company.end].forEach(l => { text(l, RX, ry, { size: 8.5 }); ry += lh(8.5); });
    ry += 5;
    text("FACTURA ELECTRÓNICA", RX, ry, { size: 12.5, bold: true }); ry += 6;
    text(inv.number, RX, ry, { size: 11.5, bold: true }); ry += 2;
    const hH = Math.max(ly, ry) - top + 2;
    box(M, top, CW, hH); doc.setLineWidth(0.2); doc.line(M + 103, top + 3, M + 103, top + hH - 3);
    y = top + hH + 3;

    // ---------- Receptor ----------
    const cond = inv.condition === "credito"
      ? "[  ] Contado   [X] Crédito" + (inv.installments > 1 ? " · " + inv.installments + " cuotas" : "")
      : "[X] Contado   [  ] Crédito";
    const pairs = [
      ["Fecha y hora de emisión", inv.dateLabel], ["RUC / Documento Nº", inv.receiverId || "Innominado"],
      ["Condición de venta", cond], ["Nombre o razón social", inv.receiverName || "-"],
      ["Moneda", isUSD ? "USD" + (inv.exchange ? " · Tipo de cambio " + inv.exchange : "") : "PYG - Guaraní"], ["Dirección / Correo", inv.receiverEmail || "-"],
      ["Tipo de transacción", "Venta de mercadería"], ["Tipo de operación", (inv.operationLabel || "") + (inv.operation ? " (" + inv.operation + ")" : "")]
    ];
    if (inv.pedidoId) pairs.push(["Pedido", inv.pedidoId]);
    const rTop = y, colW = (CW - 9) / 2;
    let rowY = rTop + 3.5;
    for (let i = 0; i < pairs.length; i += 2) {
      let rowH = 0;
      [pairs[i], pairs[i + 1]].forEach((p, c) => {
        if (!p) return;
        const x = M + 3 + c * (colW + 3);
        text(p[0], x, rowY, { size: 7.5, bold: true });
        const h = lines(wrap(p[1], colW, 8.5), x, rowY + lh(7.5) + 0.3, 8.5);
        rowH = Math.max(rowH, lh(7.5) + h + 1.8);
      });
      rowY += rowH;
    }
    box(M, rTop, CW, rowY - rTop - 1.5);
    y = rowY + 1.5;

    // ---------- Productos ----------
    const cols = [
      { t: "Cod", w: 15 }, { t: "Descripción", w: 55 }, { t: "Unidad", w: 12 }, { t: "Cantidad", w: 15, r: 1 }, { t: "Precio", w: 22, r: 1 },
      { t: "Desc.", w: 11, r: 1 }, { t: "Exentas", w: 20, r: 1 }, { t: "5%", w: 20, r: 1 }, { t: "10%", w: 20, r: 1 }
    ];
    const colX = []; cols.reduce((x, c, i) => (colX[i] = x, x + c.w), M);
    const cell = (i, s, yy, o) => { const c = cols[i]; text(s, c.r ? colX[i] + c.w - 1.2 : colX[i] + 1.2, yy, Object.assign({ align: c.r ? "right" : "left" }, o)); };
    const bottomLimit = H - M - 8;
    const header = () => {
      hr(y, BLACK, 0.3);
      cols.forEach((c, i) => cell(i, c.t, y + 4, { size: 8, bold: true }));
      y += 6; hr(y, BLACK, 0.3);
    };
    const ensure = h => { if (y + h > bottomLimit) { doc.addPage(); y = M; header(); } };
    header();
    inv.items.forEach((it, i) => {
      const gross = Math.round(it.qty * it.price), total = gross - Math.round(gross * (it.discount || 0) / 100);
      const dl = wrap(it.desc, cols[1].w - 2.4, 8);
      const h = Math.max(1, dl.length) * lh(8) + 2.6;
      ensure(h);
      const by = y + 3.6;
      cell(0, "INF" + String(i + 1).padStart(3, "0"), by, { size: 8 });
      lines(dl, colX[1] + 1.2, by, 8);
      cell(2, "UNI", by, { size: 8 });
      cell(3, String(it.qty).replace(".", ","), by, { size: 8 });
      cell(4, fmt(it.price), by, { size: 8 });
      cell(5, it.discount ? it.discount + "%" : "0", by, { size: 8 });
      cell(6, it.tax === "E" ? fmt(total) : "0", by, { size: 8 });
      cell(7, it.tax === "5" ? fmt(total) : "0", by, { size: 8 });
      cell(8, it.tax === "10" ? fmt(total) : "0", by, { size: 8 });
      y += h; hr(y, LIGHT, 0.15);
    });
    const totalRow = (label, vals) => {
      ensure(6.5);
      text(label, M + 1.2, y + 4.2, { size: 8.5, bold: true });
      vals.forEach(([i, v]) => cell(i, v, y + 4.2, { size: 8.5, bold: true }));
      y += 6.5; hr(y, BLACK, 0.25);
    };
    totalRow("SUBTOTAL", [[6, fmt(T.exe)], [7, fmt(T.b5)], [8, fmt(T.b10)]]);
    totalRow("TOTAL DE LA OPERACIÓN" + (isUSD ? " (USD)" : ""), [[8, fmt(T.total)]]);
    totalRow("TOTAL EN GUARANÍES", [[8, fmt(isUSD ? T.totalPyg : T.total)]]);
    ensure(8);
    const liq = [["LIQUIDACIÓN IVA", M + 1.2, "left"], ["(5%) " + fmt(T.iva5), M + 85, "right"], ["(10%) " + fmt(T.iva10), M + 135, "right"], ["TOTAL IVA " + fmt(T.iva), M + CW - 1.2, "right"]];
    liq.forEach(([s, x, a]) => text(s, x, y + 4.5, { size: 8.5, bold: true, align: a }));
    y += 6.5; hr(y, BLACK, 0.3); y += 4;

    // ---------- Pie con QR y CDC ----------
    const TX = M + 40, TW = CW - 43;
    const legal1 = wrap("ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML)", TW, 7.5, true);
    const legal2 = wrap("Información de interés del facturador electrónico emisor. Si su documento electrónico presenta algún error, podrá solicitar la modificación dentro de las 72 horas siguientes a la emisión de este comprobante.", TW, 7.5);
    const footH = Math.max(38, 3 + lh(8) + lh(8) + 10 + (legal1.length + legal2.length) * lh(7.5) + 5);
    ensure(footH + 8);
    const fTop = y, QS = 32;
    if (opts.qrText && global.qrcode) {
      const qr = global.qrcode(0, "M"); qr.addData(opts.qrText, "Byte"); qr.make();
      const n = qr.getModuleCount(), cs = QS / n; doc.setFillColor(0, 0, 0);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) doc.rect(M + 3 + c * cs, fTop + 3 + r * cs, cs + 0.02, cs + 0.02, "F");
    } else {
      doc.setDrawColor.apply(doc, BLACK); doc.setLineWidth(0.2); doc.rect(M + 3, fTop + 3, QS, QS);
      text("QR al aprobarse", M + 3 + QS / 2, fTop + 3 + QS / 2, { size: 7.5, color: GREY, align: "center" });
    }
    let fy = fTop + 6;
    text("Consulte la validez de esta factura electrónica con el número de CDC en:", TX, fy, { size: 8 }); fy += lh(8) + 0.4;
    text(opts.consultUrl, TX, fy, { size: 8, color: BLUE }); doc.link(TX, fy - 3, doc.getTextWidth(clean(opts.consultUrl)), 4, { url: opts.consultUrl }); fy += 2.5;
    doc.setFillColor(201, 219, 239); doc.rect(TX, fy, TW, 6.5, "F");
    text("CDC: " + (inv.cdc || "Pendiente de aprobación"), TX + TW / 2, fy + 4.4, { size: 8.5, bold: true, align: "center" }); fy += 10;
    fy += lines(legal1, TX, fy, 7.5, true) + 1;
    lines(legal2, TX, fy, 7.5);
    box(M, fTop, CW, footH);
    y = fTop + footH + 4;
    if (test) text("Prueba: IdCSC " + company.csc + " con CSC de prueba del manual · Datos ficticios, no es un documento tributario.", M, y, { size: 7, color: GREY });

    // ---------- Numeración de páginas ----------
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      text("Factura electrónica " + inv.number, M, H - 5, { size: 7, color: GREY });
      text("Página " + p + " de " + pages, W - M, H - 5, { size: 7, color: GREY, align: "right" });
    }
    doc.setProperties({ title: "KuDE " + inv.number, subject: "Factura electrónica " + inv.number + " · " + (inv.receiverName || ""),
      author: company.name, creator: "Factura Elect", keywords: "KuDE, factura electrónica, " + (inv.cdc || "") });
    return doc;
  }

  async function save(inv, company, opts) {
    const doc = await build(inv, company, opts || {});
    doc.save("KuDE_" + String(inv.number || "prueba").replace(/[^0-9A-Za-z-]/g, "_") + ".pdf");
    return doc;
  }

  global.KudePdf = { build, save };
})(window);
