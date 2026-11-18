/* XML del documento electrónico (rDE) con la estructura del Manual Técnico SIFEN v150, SIN FIRMA.
   Es una vista previa para revisar los datos y contrastarlos con el XSD o el prevalidador de la DNIT:
   no es válido para enviar a SIFEN. La firma XMLDSig y el envío los hará el servidor (servicio Firmador).
   Los nombres de los campos siguen el manual v150; confirmar contra el XSD vigente antes de producción. */
(function (global) {
  "use strict";
  const FE = global.FE, T = FE.T;
  const xesc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Nodo: [nombre, valor | hijos[], atributos]. Los valores null/"" se omiten.
  function render(node, ind) {
    if (node == null) return "";
    if (typeof node === "string") return ind + node + "\n"; // comentario ya armado
    const [name, val, attrs] = node, pad = ind || "";
    const at = attrs ? Object.entries(attrs).map(([k, v]) => ` ${k}="${xesc(v)}"`).join("") : "";
    if (Array.isArray(val)) {
      const inner = val.map(n => render(n, pad + "  ")).join("");
      return inner ? `${pad}<${name}${at}>\n${inner}${pad}</${name}>\n` : "";
    }
    if (val === null || val === undefined || val === "") return "";
    return `${pad}<${name}${at}>${xesc(val)}</${name}>\n`;
  }
  const note = t => `<!-- ${String(t).replace(/--/g, "—")} -->`;
  // Números: guaraníes sin decimales; dólares con hasta 2; cantidades con hasta 4 (punto decimal)
  const amt = (n, cur) => cur === "USD" ? String(Math.round((Number(n) || 0) * 100) / 100) : String(Math.round(Number(n) || 0));
  const qty = n => String(Math.round((Number(n) || 0) * 10000) / 10000);
  const OPE_CODE = { B2B: "1", B2C: "2", B2G: "3", B2F: "4" };
  const DOC_REC = { "1": "Cédula paraguaya", "2": "Pasaporte", "3": "Cédula extranjera", "4": "Carnet de residencia", "5": "Innominado", "6": "Tarjeta Diplomática de exoneración fiscal", "9": "Otro" };

  function build(inv, company) {
    const code = String(inv.deType || "1"), ty = T.deType(code), cur = inv.currency || "PYG", cdc = String(inv.cdc || "").replace(/\s/g, "");
    const num = String(inv.number || "").split("-"), tim = inv.timbrado || {}, r = inv.receiver || {}, isNR = code === "7", isAF = code === "4";
    const t = inv.totals || {};
    const cdcOk = /^\d{44}$/.test(cdc);

    // ----- Receptor -----
    const rec = [];
    if (isAF) {            // en la autofactura el receptor es el propio emisor
      rec.push(["iNatRec", "1"], ["iTiOpe", "2"], ["cPaisRec", "PRY"], ["dDesPaisRe", "Paraguay"], ["iTiContRec", company.taxpayerType || "2"],
        ["dRucRec", company.ruc], ["dDVRec", company.dv], ["dNomRec", company.name]);
    } else if (r.mode === "con") {
      const p = FE.parseRuc(r.ruc) || { base: String(r.ruc || "").split("-")[0], dv: String(r.ruc || "").split("-")[1] };
      const reg = FE.registry[p.full || r.ruc] || {};
      rec.push(["iNatRec", "1"], ["iTiOpe", OPE_CODE[inv.operation] || "1"], ["cPaisRec", "PRY"], ["dDesPaisRe", "Paraguay"],
        ["iTiContRec", reg.type === "Persona física" ? "1" : "2"], ["dRucRec", p.base], ["dDVRec", p.dv], ["dNomRec", r.name || inv.receiverName], ["dEmailRec", inv.receiverEmail]);
    } else {
      const innom = r.mode === "sin" && !String(r.doc || "").trim(), dt = innom ? "5" : r.docType || (r.mode === "ext" ? "2" : "1");
      rec.push(["iNatRec", "2"], ["iTiOpe", r.mode === "ext" ? "4" : "2"],
        r.mode === "ext" ? note("cPaisRec: código ISO 3166 alfa-3 del país (" + (r.country || "sin país") + "), a completar") : ["cPaisRec", "PRY"],
        ["dDesPaisRe", r.mode === "ext" ? r.country || "" : "Paraguay"], ["iTipIDRec", dt], ["dDTipIDRec", DOC_REC[dt]],
        ["dNumIDRec", innom ? "0" : r.doc], ["dNomRec", innom ? "Sin Nombre" : r.name || inv.receiverName], ["dEmailRec", inv.receiverEmail]);
    }

    // ----- Ítems -----
    const items = (inv.items || []).map((it, i) => {
      const c = FE.calcItem(it, cur), gross = Math.round((it.qty * it.price) * (cur === "USD" ? 100 : 1)) / (cur === "USD" ? 100 : 1);
      const descUnit = it.discount ? (it.price * it.discount / 100) : 0;
      const node = [["dCodInt", it.code || String(i + 1).padStart(3, "0")], ["dDesProSer", it.desc], ["cUniMed", "77"], ["dDesUniMed", "UNI"], ["dCantProSer", qty(it.qty)]];
      if (!isNR) {
        node.push(["gValorItem", [["dPUniProSer", amt(it.price, cur)], ["dTotBruOpeItem", amt(gross, cur)],
          ["gValorRestaItem", [["dDescItem", amt(descUnit, cur)], ["dPorcDesIt", it.discount ? String(it.discount) : ""], ["dTotOpeItem", amt(c.total, cur)]]]]]);
        if (!isAF) {
          const ex = it.tax === "E", tasa = it.tax === "5" ? "5" : it.tax === "10" ? "10" : "0", iva = c.iva10 + c.iva5;
          node.push(["gCamIVA", [["iAfecIVA", ex ? "3" : "1"], ["dDesAfecIVA", ex ? "Exento" : "Gravado IVA"], ["dPropIVA", "100"], ["dTasaIVA", tasa],
            ["dBasGravIVA", amt(ex ? 0 : c.total - iva, cur)], ["dLiqIVAItem", amt(ex ? 0 : iva, cur)]]]);
        }
      }
      return ["gCamItem", node];
    });

    // ----- Campos propios de cada tipo -----
    const tipo = [];
    if (code === "1") tipo.push(["gCamFE", [["iIndPres", "1"], ["dDesIndPres", "Operación presencial"]]]);
    if (isAF) {
      const s = inv.seller || {};
      tipo.push(["gCamAE", [["iNatVen", s.kind === "2" ? "2" : "1"], ["dDesNatVen", s.kind === "2" ? "Extranjero" : "No contribuyente"],
        ["iTipIDVen", s.docType || "1"], ["dDTipIDVen", DOC_REC[s.docType || "1"]], ["dNumIDVen", s.doc], ["dNomVen", s.name],
        ["dDirVen", s.address || "Sin dirección"], ["dNumCasVen", "0"], note("cDepVen / cCiuVen: códigos de departamento y ciudad del vendedor, a completar"),
        ["dDesCiuVen", s.city]]]);
    }
    if (code === "5" || code === "6") tipo.push(["gCamNCDE", [["iMotEmi", inv.motivo], ["dDesMotEmi", inv.motivoLabel]]]);
    if (isNR) {
      const m = inv.rem || {};
      tipo.push(["gCamNRE", [["iMotEmiNR", m.motivo], ["dDesMotEmiNR", T.labelOf(T.MOTIVOS_REM, m.motivo)], ["iRespEmiNR", "1"], ["dDesRespEmiNR", "Emisor de la factura"]]]);
    }
    if (code === "1" || isAF) {
      const contado = isAF || inv.condition !== "credito";
      tipo.push(["gCamCond", [["iCondOpe", contado ? "1" : "2"], ["dDCondOpe", contado ? "Contado" : "Crédito"],
        contado ? ["gPaConEIni", [["iTiPago", "1"], ["dDesTiPag", "Efectivo"], ["dMonTiPag", amt(t.total, cur)], ["cMoneTiPag", cur], ["dDMoneTiPag", cur === "USD" ? "US Dollar" : "Guarani"],
          cur === "USD" ? ["dTiCamTiPag", String(FE.parseAmount(inv.exchange, "USD"))] : null]]
          : ["gPagCred", [["iCondCred", "2"], ["dDCondCred", "Cuota"], ["dCuotas", String(inv.installments || 1)]]]]]);
    }
    tipo.push(...items);
    if (isNR) {
      const m = inv.rem || {}, tercero = m.responsable === "tercero", pt = FE.parseRuc(m.transportistaRuc) || {};
      tipo.push(["gTransp", [["iTipTrans", tercero ? "2" : "1"], ["dDesTipTrans", tercero ? "Tercero" : "Propio"], ["iModTrans", m.modo], ["dDesModTrans", T.labelOf(T.MODOS_TRANSPORTE, m.modo)],
        ["iRespFlete", "1"], ["dIniTras", m.inicio], ["dFinTras", m.fin],
        ["gCamSal", [["dDirLocSal", m.salida], ["dNumCasSal", "0"]]], ["gCamEnt", [["dDirLocEnt", m.entrega], ["dNumCasEnt", "0"]]],
        ["gVehTras", [["dTiVehTras", "Vehículo"], ["dMarVeh", m.marca], ["dNroMatVeh", String(m.chapa || "").toUpperCase()]]],
        ["gCamTrans", [["iNatTrans", "1"], ["dNomTrans", tercero ? m.transportista : company.name], ["dRucTrans", tercero ? pt.base : company.ruc], ["dDVTrans", tercero ? pt.dv : company.dv],
          ["dNumIDChof", m.choferDoc], ["dNomChof", m.chofer]]]]]);
    }

    // ----- Totales -----
    const tot = isNR ? null : ["gTotSub", [["dSubExe", amt(t.exe, cur)], ["dSubExo", "0"], ["dSub5", amt(t.b5, cur)], ["dSub10", amt(t.b10, cur)],
      ["dTotOpe", amt(t.total, cur)], ["dTotDesc", amt((inv.items || []).reduce((a, it) => a + (it.discount ? it.qty * it.price * it.discount / 100 : 0), 0), cur)],
      ["dTotDescGlotem", "0"], ["dTotAntItem", "0"], ["dTotAnt", "0"], ["dPorcDescTotal", "0"], ["dDescTotal", "0"], ["dAnticipo", "0"], ["dRedon", "0"],
      ["dTotGralOpe", amt(t.total, cur)], ["dIVA5", amt(isAF ? 0 : t.iva5, cur)], ["dIVA10", amt(isAF ? 0 : t.iva10, cur)], ["dTotIVA", amt(isAF ? 0 : t.iva, cur)],
      ["dBaseGrav5", amt(isAF ? 0 : t.b5 - t.iva5, cur)], ["dBaseGrav10", amt(isAF ? 0 : t.b10 - t.iva10, cur)], ["dTBasGraIVA", amt(isAF ? 0 : t.b5 - t.iva5 + t.b10 - t.iva10, cur)],
      cur === "USD" ? ["dTotalGs", String(Math.round(t.totalPyg || 0))] : null]];

    // ----- Documento asociado -----
    let asoc = null;
    if (inv.assoc && inv.assoc.cdc) asoc = ["gCamDEAsoc", [["iTipDocAso", "1"], ["dDesTipDocAso", "Electrónico"], ["dCdCDERef", String(inv.assoc.cdc).replace(/\s/g, "")]]];
    if (isAF) { const k = inv.constancia || {}; asoc = ["gCamDEAsoc", [["iTipDocAso", "3"], ["dDesTipDocAso", "Constancia electrónica"],
      ["iTipCons", k.tipo || "1"], ["dDesTipCons", T.labelOf(T.CONSTANCIAS, k.tipo || "1")], ["dNumCons", k.numero]]]; }

    // ----- Documento completo -----
    const emisor = ["gEmis", [["dRucEm", company.ruc], ["dDVEmi", company.dv], ["iTipCont", company.taxpayerType || "2"], ["dNomEmi", company.name], ["dNomFanEmi", company.fantasy],
      ["dDirEmi", company.address], ["dNumCas", "0"], note("cDepEmi / cCiuEmi: códigos de departamento y ciudad, a completar con la tabla del manual"),
      ["dDesCiuEmi", company.city], ["dTelEmi", company.phone], ["dEmailE", company.mail],
      ["gActEco", [note("cActEco: código de actividad económica, a completar"), ["dDesActEco", company.activity]]]]];
    const opeCom = isNR ? null : ["gOpeCom", [code === "1" || isAF ? ["iTipTra", isAF ? "2" : "1"] : null, code === "1" || isAF ? ["dDesTipTra", isAF ? "Prestación de servicios / compra" : "Venta de mercadería"] : null,
      ["iTImp", "1"], ["dDesTImp", "IVA"], ["cMoneOpe", cur], ["dDesMoneOpe", cur === "USD" ? "US Dollar" : "Guarani"],
      cur === "USD" ? ["dCondTiCam", "1"] : null, cur === "USD" ? ["dTiCam", String(FE.parseAmount(inv.exchange, "USD"))] : null]];
    const de = ["DE", [
      ["dDVId", cdcOk ? cdc[43] : ""], ["dFecFirma", ""], note("dFecFirma: la completa el Firmador al firmar"), ["dSisFact", "1"],
      ["gOpeDE", [["iTipEmi", "1"], ["dDesTipEmi", "Normal"], ["dCodSeg", cdcOk ? cdc.slice(34, 43) : ""]]],
      ["gTimb", [["iTiDE", code], ["dDesTiDE", ty.label], ["dNumTim", tim.number], ["dEst", num[0]], ["dPunExp", num[1]], ["dNumDoc", num[2]], ["dFeIniT", tim.start]]],
      ["gDatGralOpe", [["dFeEmiDE", inv.issuedAt], opeCom, emisor, ["gDatRec", rec]]],
      ["gDtipDE", tipo],
      tot, asoc
    ], { Id: cdcOk ? cdc : "SIN-CDC" }];
    const xml = render(["rDE", [["dVerFor", "150"], de,
      note("Signature: firma XMLDSig (enveloped, RSA-SHA256) del nodo DE. NO INCLUIDA: la agrega el servicio Firmador"),
      inv.qrUrl ? ["gCamFuFD", [["dCarQR", inv.qrUrl]]] : null
    ], { xmlns: "http://ekuatia.set.gov.py/sifen/xsd", "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "xsi:schemaLocation": "http://ekuatia.set.gov.py/sifen/xsd siRecepDE_v150.xsd" }], "");
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      note("VISTA PREVIA SIN FIRMA · " + ty.label + " " + (inv.number || "") + " · NO VÁLIDO PARA SIFEN · estructura Manual Técnico v150, confirmar contra el XSD") + "\n" + xml;
  }

  function download(inv, company) {
    const xml = build(inv, company), cdc = String(inv.cdc || "").replace(/\s/g, "");
    FE.downloadBlob(new Blob([xml], { type: "application/xml;charset=utf-8" }), "DE_" + (cdc || String(inv.number || "borrador").replace(/[^0-9-]/g, "")) + "_sin_firma.xml");
    return xml;
  }

  global.DEXml = { build, download };
})(window);
