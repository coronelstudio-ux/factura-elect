# Factura Elect (prueba)

Facturador electrónico de prueba (SIFEN simulado) con un módulo de **pedidos**.
Son dos apps web instalables (PWA), cada una con su ícono. Todo se guarda **en el dispositivo** (`localStorage`); no hay servidor ni base de datos todavía.

| App | Carpeta | Quién la usa | Qué puede hacer |
|---|---|---|---|
| **Facturador** (verde) | `facturador/` | Principal | Inicio, Nueva factura, **Pedidos** (bandeja), Historial, Ajustes. Lee los QR de pedidos, factura o rechaza con motivo. Protegida con PIN. |
| **Pedidos** (azul) | `pedidos/` | Cargador / vendedor | Nuevo pedido, Mis pedidos, Clientes frecuentes, Ajustes. Crea, edita y elimina pedidos y los comparte como QR. **No ve ni genera facturas.** |

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
facturador/             App del principal (index.html, app.js, manifest, sw.js, icons/)
pedidos/                App del cargador (index.html, app.js, manifest, sw.js, icons/)
shared/core.js          Cálculo de IVA, RUC (módulo 11), clientes, QR, cámara, compartir, respaldo
shared/styles.css       Estilos comunes (del facturador original)
vendor/                 qrcode-generator, jsQR, lz-string, html2canvas, jsPDF (para funcionar sin internet)
docs/                   Archivo original facturador-prueba-local.html
```

## Publicar e instalar

Para instalar como app y usar la cámara hace falta HTTPS. Con **GitHub Pages**:

1. En GitHub: *Settings → Pages → Build and deployment → Deploy from a branch*, elegí la rama y la carpeta `/ (root)`.
2. Abrí `https://<usuario>.github.io/factura-elect/` en el celular.
3. Entrá a la app que corresponda e instalala (Android: menú ⋮ → *Instalar app*; iPhone: Compartir → *Agregar a inicio*).

Para probar en la computadora: `python3 -m http.server 8080` y abrir `http://localhost:8080/`.

## Seguridad y datos (prueba)

- El PIN evita que se abra el Facturador en otro celular, pero los datos **no están cifrados**.
- El QR lleva los datos del pedido comprimidos, **no cifrados**.
- Cada app guarda sus datos por separado. Usá **Ajustes → Descargar respaldo** de vez en cuando.
- Los datos de empresa, timbrado y contribuyentes son **ficticios**; la aprobación de SIFEN es simulada.
