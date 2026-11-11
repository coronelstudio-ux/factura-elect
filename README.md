# Factura Elect (prueba)

Facturador electrónico de prueba (SIFEN simulado) para un **estudio que atiende varias empresas**, con un módulo de **pedidos**.
Son tres apps web instalables (PWA), cada una con su ícono. Todo se guarda **en el dispositivo** (`localStorage`); no hay servidor ni base de datos todavía.

| App | Carpeta | Quién la usa | Qué puede hacer |
|---|---|---|---|
| **Admin** (violeta) | `admin/` | Estudio: admin maestro y operadores | Panel con alertas (certificados, timbrados, rechazadas, envíos fuera de plazo) y cola de envíos; **alta guiada** de empresas en 6 pasos; certificado, timbrados, CSC y ambiente; usuarios y roles; auditoría. |
| **Facturador** (verde) | `facturador/` | Empresa cliente: admin del cliente y facturadores | Inicio, Nueva factura, **Pedidos** (bandeja), Historial, Ajustes. Lee los QR de pedidos, factura o rechaza con motivo. Cada usuario entra con su PIN (o PIN del dispositivo si no hay usuarios). Productos frecuentes, valores por defecto, pie del KuDE, A4 o ticket, correo automático. |
| **Pedidos** (azul) | `pedidos/` | Cargador / vendedor | Nuevo pedido, Mis pedidos, Clientes frecuentes, Ajustes. Crea, edita y elimina pedidos y los comparte como QR; carga el catálogo de productos del facturador. **No ve ni genera facturas.** |

Roles, permisos, datos y el modelo para la base de datos: [`docs/arquitectura-multiempresa.md`](docs/arquitectura-multiempresa.md).
Firma electrónica y servicio Firmador: [`docs/firma-electronica.md`](docs/firma-electronica.md).

## Flujo del pedido (sin cargar dos veces)

1. El cargador crea el pedido en **Pedidos** → se guarda y se genera un **QR** con todo el pedido (cliente, productos, condición, vendedor, nota).
2. **Compartir por WhatsApp** envía la imagen del QR (o **Copiar código** para mandarlo como texto).
3. El principal, en **Facturador → Pedidos**, usa **Escanear QR**, **Elegir imagen** (la imagen que llegó por WhatsApp) o **Pegar código**.
4. El pedido queda **Pendiente de facturar**. El principal decide:
   - **Facturar** → se abre Nueva factura ya completa → Vista previa → Emitir. Si se aprueba, el pedido pasa a **Facturado** y queda en el historial con el número de factura.
   - **Rechazar** con motivo → **Rechazado** (se puede volver a pendiente o eliminar).
5. Si el mismo QR se lee de nuevo, no se duplica. Si el cargador edita el pedido, el QR nuevo lleva una versión mayor y reemplaza al anterior mientras no esté facturado.

> Por ahora el estado *facturado / rechazado* queda solo en el Facturador. Avisarle al cargador se resolverá cuando haya base de datos.

### Formato del QR
`FEP1.<suma de control FNV-1a>.<JSON compacto comprimido con lz-string en base64>` — ver `shared/core.js` (`encodePedido` / `decodePedido`). Entran unos 25–30 productos por QR; si no entra, la app avisa.

## Estructura

```
index.html              Página de entrada con los enlaces para instalar cada app
admin/                  App del estudio (index.html, app.js, manifest, sw.js, icons/)
facturador/             App del principal (index.html, app.js, kude-pdf.js, manifest, sw.js, icons/)
pedidos/                App del cargador (index.html, app.js, manifest, sw.js, icons/)
shared/core.js          Cálculo de IVA, RUC (módulo 11), receptor, CDC, QR, cámara, compartir, respaldo
shared/tenant.js        Multiempresa: empresas, usuarios y roles, auditoría, timbrados, alertas, catálogo, firma
shared/styles.css       Estilos comunes (del facturador original)
vendor/                 qrcode-generator, jsQR, lz-string, jsPDF (para funcionar sin internet)
docs/                   Informe técnico y archivo original facturador-prueba-local.html
tests/run.js            Pruebas automáticas (node tests/run.js)
```

## Publicar e instalar

Para instalar como app y usar la cámara hace falta HTTPS. Con **GitHub Pages**:

1. En GitHub: *Settings → Pages → Build and deployment → Deploy from a branch*, elegí la rama y la carpeta `/ (root)`.
2. Abrí `https://<usuario>.github.io/factura-elect/` en el celular.
3. Entrá a la app que corresponda e instalala (Android: menú ⋮ → *Instalar app*; iPhone: Compartir → *Agregar a inicio*).

Cada app también tiene **Ajustes → Instalar en este dispositivo**, que abre el instalador cuando el navegador lo permite.

**Si dice «ya está instalada»:** las versiones anteriores compartían el mismo identificador y el celular las tomaba como una sola app. Ya está corregido (`"id"` único en cada `manifest.webmanifest`), pero el ícono que quedó instalado conserva el identificador viejo: desinstalalo (mantener presionado → Desinstalar), abrí de nuevo la página e instalá cada app.

Para probar en la computadora: `python3 -m http.server 8080` y abrir `http://localhost:8080/`.

## Seguridad y datos (prueba)

- El PIN evita que se abra el Facturador en otro celular, pero los datos **no están cifrados**.
- El QR lleva los datos del pedido comprimidos, **no cifrados**.
- Cada app guarda sus datos por separado. Usá **Ajustes → Descargar respaldo** de vez en cuando.
- Los datos de empresa, timbrado y contribuyentes son **ficticios**; la aprobación de SIFEN es simulada.

## Reglas de facturación (modo prueba)

- **Cliente:** *Con RUC* (DV módulo 11), *Sin RUC* (cédula, pasaporte, cédula extranjera, carnet de residencia, tarjeta diplomática u otro; sin documento queda innominado) o *Extranjero*. La operación (B2B, B2C, B2G, B2F) se detecta sola.
- **Innominado** solo por debajo de Gs 7.000.000 (NT 024).
- **CDC** de 44 dígitos con la estructura del Manual Técnico v150, código de seguridad aleatorio y DV módulo 11, mostrado en grupos de 4.
- **QR** con los parámetros de la sección 13.8 y `cHashQR` calculado con el CSC de prueba del manual. El `DigestValue` es simulado hasta que exista la firma del XML.
- **Timbrados** (Ajustes → Timbrados): cada timbrado cargado queda guardado con su fecha de inicio y de fin (o «sin fecha de fin») y su propia numeración. Solo uno está activo, y solo se factura con él mientras esté vigente. Cada factura guarda el timbrado con el que se emitió.
- **Cancelación** solo dentro de las 48 horas desde la aprobación; después, nota de crédito.
- La respuesta de SIFEN sigue siendo simulada. El detalle de qué falta está en [`docs/informe-tecnico.md`](docs/informe-tecnico.md).

## Pruebas

```
node tests/run.js
```

Prueban el dígito verificador, la clasificación de clientes, el límite de innominado, los totales e IVA, el CDC, el QR, el pedido por QR y el núcleo multiempresa (permisos por rol, datos separados por empresa, PIN, timbrados, certificado, alertas, catálogo y firma simulada). No hace falta instalar nada.

## KuDE y PDF

- En pantalla el KuDE se adapta al ancho: en celulares los productos se muestran como lista, sin desplazamiento lateral.
- **Descargar PDF** arma un A4 con los datos reales (texto seleccionable, varias páginas si hace falta, QR vectorial con la URL de consulta y el CDC). Ver `facturador/kude-pdf.js`.
