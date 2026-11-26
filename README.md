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

## Nota de pedido (app Pedidos)

- El vendedor carga la **nota de pedido por pasos**, igual que una factura en el Facturador:
  1. **Cliente:** frecuentes, RUC, sin RUC o extranjero; correo y, en un desplegable, dirección y teléfono (opcionales).
  2. **Productos:** del catálogo o nuevos.
  3. **Condición:** contado o crédito, moneda y una nota.
  4. **Revisión:** cada línea vuelve a su paso.
- Al guardarla, el vendedor tiene dos salidas:
  - **Para el cliente:** "Enviar PDF por WhatsApp". El PDF tiene el formato de la factura, simplificado: sin timbrado, CDC, QR ni leyendas del KuDE; con IVA por producto, totales, nota y la leyenda "Documento no válido como comprobante fiscal". El membrete queda en blanco por ahora.
  - **Para el facturador:** el QR o el código, como antes. La dirección y el teléfono también viajan en el QR.
- El Facturador muestra "Notas de pedido" y puede descargar el mismo PDF desde la nota recibida.
- **Pendiente para la base de datos:** el vendedor será un usuario de la empresa. La nota llegará directo al Facturador sin QR y el PDF llevará el membrete de la empresa.

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
facturador/             App del principal (index.html, app.js, kude-pdf.js, xml-preview.js, manifest, sw.js, icons/)
pedidos/                App del vendedor: notas de pedido (index.html, app.js, manifest, sw.js, icons/)
shared/core.js          Cálculo de IVA, RUC (módulo 11), receptor, CDC, QR, cámara, compartir, respaldo
shared/tenant.js        Multiempresa: empresas, usuarios y roles, auditoría, timbrados, alertas, catálogo, firma
shared/nota-pedido-pdf.js  PDF de la nota de pedido (sin datos fiscales)
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

## Emisión por pasos

Emitir un documento sigue el flujo de una transferencia bancaria, tomando como modelo el de ueno según su centro de ayuda: una pregunta por pantalla, barra de progreso, flecha atrás, ✕ para salir (el borrador queda guardado) y un botón grande **Continuar** que se habilita cuando el paso está completo.

| Tipo | Pasos |
|---|---|
| Factura | ¿Qué vas a emitir? → ¿A quién le facturás? → ¿Qué le vendés? → ¿Cómo te paga? → Revisá |
| Nota de crédito / débito | ¿Qué vas a emitir? → ¿Sobre qué factura? → ¿Qué se acredita / debita? → ¿Por qué la emitís? → Revisá |
| Autofactura | ¿Qué vas a emitir? → ¿A quién le compraste? → ¿Qué constancia tiene? → ¿Qué compraste? → Revisá |
| Nota de remisión | ¿Qué vas a emitir? → ¿A quién le enviás la mercadería? → ¿De dónde a dónde? → ¿Cómo se traslada? → ¿Qué se traslada? → Revisá |

- **Cliente:** se elige como el destino de una transferencia. Se busca entre los clientes frecuentes (aparecen como contactos), se escribe un RUC (se reconoce solo) o se usa "Cargar RUC", "Sin RUC" o "Extranjero".
- **Productos:** el total se ve grande arriba y los productos frecuentes se agregan con un toque.
- **Revisión:** resumen con el total y una fila por paso; tocar una fila vuelve a ese paso. El KuDE se despliega desde ahí.
- **Confirmación con PIN** en un teclado propio y **comprobante final** con "Compartir PDF". Si SIFEN rechaza, "Revisar y volver a intentar" recarga los datos.
- Si la empresa tiene un solo tipo habilitado, el paso "¿Qué vas a emitir?" no aparece.

## Módulos y cobros (app Admin)

- **Plan base:** factura, notas de crédito y débito, historial, PDF, cancelación y clientes.
- **Módulos que se contratan por empresa:** Pedidos, Nota de remisión, Autofactura, Usuarios múltiples, Productos frecuentes, Moneda extranjera, Correo automático y Formato ticket.
  - Si un módulo no está, **todo lo suyo desaparece** del Facturador: pestaña, botones, tipos, ajustes.
  - Pedidos, Remisión y Autofactura también se pueden quitar **por usuario**.
- **Tarifas configurables** (Admin → Ajustes → Tarifas): plan base con documentos incluidos, documento extra, usuario adicional, precio de cada módulo, alta única, día de vencimiento y días de gracia. Los montos iniciales son un ejemplo.
  - Cada concepto tiene su monto y la casilla **Incluido** (no se cobra a nadie).
- **Precios por empresa** (botón "Cambiar precios de esta empresa"): para cada concepto, *tarifa general*, *monto propio* o *incluido*, y una cantidad propia de documentos incluidos por mes.
- **Descuentos** (solo el admin maestro):
  - porcentaje o monto fijo;
  - sobre el total del mes o sobre un concepto (por ejemplo, solo el módulo Pedidos);
  - duración: siempre, durante N meses o hasta un mes;
  - con motivo; se pueden sumar varios. Primero se aplican los de cada concepto y después los del total. El total nunca queda negativo.
  - Los meses cerrados no cambian si después se tocan precios o descuentos.
- **Cada empresa tiene una sección Plan y cobros:**
  - módulos contratados y cargo del mes en curso;
  - estado de cuenta por mes (los meses cerrados quedan congelados);
  - registro de pagos (se aplican al mes más antiguo);
  - precios propios, descuentos, cobro del alta y "no suspender nunca".
- **Suspensión:** pasados los días de gracia, se bloquea solo la **emisión de documentos nuevos**. El cliente lo ve en Inicio y puede seguir viendo y descargando lo emitido.
- **Facturar el servicio:** prepara la factura al cliente en el Facturador de la empresa del estudio y la abre en la revisión. Como una factura no admite ítems negativos, los descuentos se restan del precio del concepto (o de los ítems mayores, si son sobre el total) y los conceptos incluidos no aparecen.

## Timbrados, establecimientos y cajas (reglas de la DNIT)

- **Establecimientos** (Admin → empresa → Establecimientos y cajas): como figuran en el RUC, con código y dirección. Cada uno tiene sus **cajas** (puntos de expedición), con código y un nombre interno ("Caja 1", "Caja 2"…). Los códigos en uso no se cambian; se dan de baja.
- **El timbrado habilita cajas y tipos**: en cada caja, los tipos de documento que se habilitaron en Marangatu. La numeración corre por **timbrado + establecimiento + caja + tipo** (`001-002-0000001`), y el CDC lleva el establecimiento y la caja con que se emitió.
- **Estados del timbrado:**
  - *Cargado:* se puede corregir o eliminar.
  - *Activo:* se activa con PIN y **ya no se modifica**. Solo se puede **Ampliar** (agregar cajas o tipos habilitados después en Marangatu).
  - *Dado de baja:* con motivo obligatorio y PIN; no se deshace. Activar un timbrado nuevo da de baja al anterior ("Cambio de timbrado").
- **Quién los gestiona:** el admin maestro y el admin de la empresa. Los demás solo ven el timbrado activo.
- **Cajas por usuario:** al crear o editar un facturador o vendedor se marcan sus cajas. Sin ninguna marcada usa todas; los admins usan todas. Si tiene varias, elige con cuál emite en Ajustes; la caja en uso se ve arriba.
- **KuDE, PDF y XML:** la dirección del emisor es la del establecimiento que emitió.
- **Inutilización:** se elige timbrado, caja y tipo.
- **Datos anteriores:** el establecimiento y el punto que tenía cada empresa pasan a ser su primera caja ("Caja 1"), y la numeración sigue donde iba.

## Mi perfil

- En las tres apps, arriba de todo en **Ajustes**, una tarjeta con el ícono, el nombre y el rol abre **Mi perfil**.
- Mi perfil muestra los datos del usuario (rol, empresas, último ingreso) y las acciones: cambiar el PIN, cambiar de empresa, abrir la otra app y **cerrar sesión** (con confirmación).
- **Facturador sin usuarios:** muestra "Este dispositivo", con cambiar el PIN del dispositivo y **Bloquear ahora**.
- **Pedidos:** muestra el nombre del vendedor (se cambia desde el perfil) y el código del dispositivo. La app abre en "Mis notas de pedido".
- Componente compartido: `T.profileCardHTML` y `T.profileSheet` en `shared/tenant.js`.

## IVA al emitir

En factura, nota de crédito y nota de débito, debajo del monto (paso Productos, Revisión y pantalla ¡Listo!) se muestra el IVA en letra más chica: solo las tasas que correspondan y, si hay 5 % y 10 %, también el total. Si todo es exento: "Exenta de IVA" (`FE.ivaText`).

## Boleta de pago (aviso al cliente)

- Cuando el estudio emite la **factura del servicio** (Admin → empresa → "Facturar el servicio"), queda registrada una **boleta de pago** para esa empresa (`fe_boletas`).
- En el Facturador del cliente aparece un **punto rojo en Ajustes** y, arriba de todo en Ajustes, un recuadro resaltado con el mes, el monto y el vencimiento.
  - **Ver detalle:** conceptos del mes (incluidos y descuentos), total, vencimiento, estado del pago y **Descargar PDF** de la factura del servicio.
  - **Entendido** (o cerrar el detalle) lo marca como visto. Las boletas quedan listadas en Ajustes → Boletas de pago.
- Lo ve quien administra la empresa: admin del cliente, estudio, o el dispositivo sin usuarios.
- Hoy funciona en el mismo dispositivo. Con el servidor, la boleta llegará como notificación a la app del cliente.

## Datos del cliente al facturar

- Con RUC se piden **RUC, razón social y correo**.
- El desplegable **"Dirección y teléfono (opcional)"** suma esos dos datos. Se guardan en el cliente frecuente, se completan solos la próxima vez y salen en el KuDE, el PDF y el XML (`dDirRec`, `dNumCasRec`, `dTelRec`).

## Membrete del KuDE

- A4 y pantalla: **logo centrado a la izquierda**, los **datos del establecimiento** al lado (hacia el medio) y, separados por una línea, RUC, timbrado, tipo y número de documento.
- **Persona física (unipersonal) con nombre de fantasía:** la fantasía va grande y debajo, más chico, el nombre completo del titular. En sociedades, la razón social grande y la fantasía debajo. El ticket usa el mismo criterio (`FE.emisorNombres`).

## XML del documento (solo admin maestro)

En el detalle de cada documento, el admin maestro ve **Descargar XML (sin firma)**. Baja `DE_<CDC>_sin_firma.xml`:

- Es el `rDE` con la estructura del Manual Técnico v150 (`DE`, `gOpeDE`, `gTimb`, `gDatGralOpe`, `gDtipDE`, `gTotSub`, `gCamDEAsoc`, `gCamFuFD/dCarQR`), con los campos propios de cada tipo: `gCamFE`, `gCamAE`, `gCamNCDE`, `gCamNRE` y `gTransp`.
- **No tiene firma** (`Signature`) y no sirve para enviar a SIFEN: es para revisar los datos y contrastarlos con el XSD o el prevalidador de la DNIT. La firma la agregará el servidor.
- Los códigos que la app todavía no guarda (departamento, ciudad, actividad económica, país del extranjero) quedan como comentario "a completar".
- Montos en guaraníes sin decimales; en dólares, con hasta 2 decimales y el total en guaraníes (`dTotalGs`).

## KuDE simplificado

El KuDE y el PDF muestran solo lo que le sirve al contribuyente:
- Sin códigos de control (B2B, B2C…).
- Sin la nota interna del CSC de prueba.
- Sin códigos automáticos de producto.
- Sin la referencia interna al pedido.
- Sin filas vacías.
- El "Total en guaraníes" aparece solo si la factura está en dólares.

Los datos que exige el KuDE se mantienen.

## Documentos electrónicos

El primer paso de **Nueva** muestra todos los tipos: los habilitados para elegir y, en gris y con el motivo, los que no se pueden usar (no habilitados en el timbrado o próximamente). Los de un módulo no contratado no aparecen.

| Tipo | Código | Qué permite |
|---|---|---|
| Factura | 1 | Venta, como hasta ahora |
| Nota de crédito | 5 | Desde una factura aprobada (botón en el detalle o al elegir la factura). Trae sus productos para quitar o bajar cantidades, con motivo; no puede superar el saldo de la factura |
| Nota de débito | 6 | Aumenta una factura (intereses, recargos, ajustes), con motivo |
| Autofactura | 4 | Compra a no contribuyentes o extranjeros: datos del vendedor y de la constancia; solo guaraníes, sin IVA |
| Nota de remisión | 7 | Traslado de mercaderías: motivo, fechas, salida y entrega, transporte, vehículo y chofer, cantidades sin precio. Se arma desde una factura o un pedido |
| Recibo de dinero · Comprobante de retención · Facturas de exportación e importación | — | Se muestran como **Próximamente**: SIFEN todavía no los recibe o falta su reglamentación |

- **Timbrado por tipo:** cada timbrado lleva los **tipos habilitados** (los mismos que se eligieron al habilitarse en Marangatu) y una **numeración propia por tipo**. Solo se emite un tipo si está en el timbrado activo y vigente. Un tipo ya usado no se puede quitar.
- **El tipo va en el CDC** (posiciones 1 y 2: 01, 04, 05, 06, 07). El KuDE y el PDF (A4 y ticket) cambian según el tipo.
- **Eventos (simulados):**
  - **Cancelación** dentro del plazo (48 h; la remisión, 168 h). Pasado el plazo de una factura, se ofrece la nota de crédito.
  - **Inutilización** de rangos no usados (app Admin, ficha de la empresa).
  - **Nominación** de facturas emitidas sin identificar al comprador (una vez).
- **Preferencias de documentos** (Ajustes): punto de salida, vehículo y chofer por defecto para la remisión, y tipo de constancia de la autofactura.
- Los motivos de emisión y de traslado siguen el manual técnico; **hay que confirmarlos con la versión vigente** antes de producción.

## Carga rápida

- **Teclados:** cada campo abre el teclado que corresponde. Es numérico en RUC, PIN, timbrado, cédula, precios y cantidades, y completo en nombres, descripciones y pasaportes. En correo y teléfono abre el teclado propio de cada uno. Los nombres empiezan con mayúscula y los caracteres que no corresponden se descartan.
- **Enter** pasa al campo siguiente; en el último confirma la hoja.
- **Precios** con separador de miles mientras se escriben, y el total de la línea se ve antes de agregar.
- **«Agregar y otro»** carga varios productos sin cerrar la hoja. Las cantidades se ajustan con **−** y **+**.
- **Cliente frecuente:** al escribir un RUC o documento ya usado, se completan solos el nombre y el correo.
- **Búsqueda** en el Historial, en la bandeja de Pedidos y en Mis pedidos.
- El **borrador de la factura** se guarda: si se cierra la app, sigue donde quedó.
- **Dólares:** precios, IVA y totales con 2 decimales. Para facturar en USD hace falta el tipo de cambio del día. El límite de innominado se mide en guaraníes.

## Pruebas

```
node tests/run.js
```

Prueban el dígito verificador, la clasificación de clientes, el límite de innominado, los totales e IVA, el CDC, el QR, el pedido por QR y el núcleo multiempresa (permisos por rol, datos separados por empresa, PIN, timbrados, certificado, alertas, catálogo y firma simulada). No hace falta instalar nada.

## KuDE y PDF

- En pantalla el KuDE se adapta al ancho: en celulares los productos se muestran como lista, sin desplazamiento lateral.
- **Descargar PDF** arma un A4 con los datos reales (texto seleccionable, varias páginas si hace falta, QR vectorial con la URL de consulta y el CDC). Ver `facturador/kude-pdf.js`.
