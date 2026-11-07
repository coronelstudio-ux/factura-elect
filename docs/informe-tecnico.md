# Informe técnico: facturación electrónica (SIFEN)

Informe de requisitos y plan de trabajo, **ajustado al estado real de este repositorio** (noviembre de 2026).
La normativa citada (Manual Técnico v150, notas técnicas y resoluciones) viene del informe original: hay que verificar cada punto contra la fuente antes de pasar a producción. Los puntos dudosos están en la sección 3.6.

---

## Parte 1: Lista para un cliente

Lo que hay que reunir y configurar para cada empresa que factura.

- [ ] RUC con dígito verificador, razón social, nombre de fantasía, actividad, dirección, ciudad, teléfono y correo, todo igual que en Marangatu
- [ ] Tipo de contribuyente: persona física o jurídica (va en la posición 25 del CDC)
- [ ] Establecimientos y puntos de expedición que va a usar
- [ ] RUC activo y obligaciones tributarias al día
- [ ] Condición: obligado (con resolución de designación) o voluntario
- [ ] Certificado cualificado de firma con el RUC de la empresa, vigente
- [ ] Timbrado electrónico y CSC de producción (cada cliente tiene los suyos)
- [ ] Mandato o representación documentada, si el estudio hace el trámite
- [ ] Usuarios de la empresa con roles (emisión, consulta, administración). En la app actual: principal (Facturador, con PIN) y cargadores de pedidos (app Pedidos)
- [ ] Catálogo de productos y servicios con código interno y tipo de IVA
- [ ] Logo, si lo va a cargar
- [ ] Fecha de baja de preimpresos o autoimpresores, si los usa (no antes de la fecha de obligatoriedad)

## Parte 2: Lista para que se acepte la facturación

Lo que la DNIT exige para habilitar al contribuyente. Todo esto necesita el backend (Parte 3.3); no se puede hacer solo en el navegador.

- [ ] Sistema conforme al Manual Técnico v150 y las notas técnicas NT 001 a 027
- [ ] XML generado y validado contra el XSD vigente
- [ ] XML aprobado por el prevalidador de la DNIT
- [ ] Firma XMLDSig con el certificado de la empresa
- [ ] Conexión con autenticación mutua (mTLS) al servicio de prueba
- [ ] Pruebas mínimas: 5 documentos aprobados y 5 rechazados por cada tipo (factura, nota de crédito, nota de débito, autofactura y nota de remisión), por el servicio síncrono y por el asíncrono
- [ ] Eventos: cancelación, inutilización, conformidad, disconformidad, desconocimiento y notificación de recepción
- [ ] Consultas por CDC y por QR
- [ ] KuDE en PDF por cada tipo de documento, con la leyenda de ambiente de prueba
- [ ] Solicitud de habilitación en Marangatu al terminar las pruebas
- [ ] Timbrado electrónico obtenido y CSC de producción cargado
- [ ] Transmisión dentro de las 72 horas desde la firma
- [ ] Respuesta de la DNIT guardada (protocolo de aprobación o código de rechazo)
- [ ] Conservación de documentos cancelados durante 5 años

---

## Parte 3: Informe técnico

### 3.1 Estado actual del repositorio

Dos apps web instalables (PWA), sin servidor. Todo se guarda en el dispositivo (`localStorage`).

| Parte | Dónde | Estado |
|---|---|---|
| App **Facturador** (principal, con PIN) | `facturador/` | Funciona en modo prueba |
| App **Pedidos** (cargador, no ve facturas) | `pedidos/` | Funciona |
| Pedido → Facturador por **QR** (WhatsApp, imagen o texto), sin cargar dos veces | `shared/core.js` (`encodePedido` / `decodePedido`) | Funciona |
| Detección automática de operación (B2B, B2C, B2G, B2F) | `shared/core.js` (`classify`) | Funciona, con pruebas |
| Receptor sin RUC con tipo de documento (1, 2, 3, 4, 6, 9) e innominado (5) automático | `shared/core.js` | Funciona, con pruebas |
| Límite de innominado: Gs 7.000.000 (NT 024) | `shared/core.js` | Funciona, con pruebas |
| Totales, descuentos y liquidación de IVA 5 % y 10 % | `shared/core.js` | Funciona, con pruebas |
| **CDC de 44 dígitos** con la estructura del manual, código de seguridad aleatorio y DV módulo 11, en grupos de 4 | `shared/core.js` (`buildCdc`) | Funciona, con pruebas |
| **QR del KuDE** con los parámetros de la sección 13.8 y `cHashQR` con el CSC de prueba | `shared/core.js` (`buildQrUrl`) | Funciona; el `DigestValue` es simulado |
| KuDE en pantalla adaptable (sin desplazamiento lateral en celulares) | `facturador/app.js`, `shared/styles.css` | Funciona |
| **PDF del KuDE** con texto real, multipágina, QR vectorial | `facturador/kude-pdf.js` (jsPDF) | Funciona |
| Cancelación solo dentro de 48 h desde la aprobación | `facturador/app.js` | Funciona (simulada) |
| Clientes frecuentes, respaldo, logo, instalación | ambas apps | Funciona |
| Pruebas automáticas | `tests/run.js` | `node tests/run.js` |

Lo que **sigue siendo simulación** y debe reemplazarse cuando exista el backend:

- La respuesta de SIFEN es aleatoria (85 % aprobada).
- La búsqueda de RUC es una tabla fija con cuatro RUC de ejemplo.
- El `DigestValue` del QR se simula con el SHA-256 de los datos de la factura, porque no hay XML firmado.
- La cancelación solo cambia el estado local; no envía el evento.
- Los datos de la empresa y del timbrado son ficticios.
- El estado "facturado" de un pedido no vuelve a la app Pedidos (se resolverá con la base de datos).

Notas sobre el informe original:

- Mencionaba `facturador-v3.html` y html2canvas. En el repositorio solo está el prototipo original (`docs/facturador-prueba-local-original.html`), y el PDF ya no es una captura: se arma con los datos.
- El CDC de ejemplo `0180012345000100100000122202611041417392851` tiene **43 dígitos**: al código de seguridad le falta uno. Con el código de 9 dígitos `417392850`, el CDC es `01800123450001001000001222026110414173928501` (DV 1, verificado en las pruebas y por separado).
- El script `kude_compact.py` sigue fuera del repositorio. El diseño del KuDE ya está portado a `facturador/kude-pdf.js`; cuando exista el backend, el PDF se debería generar allí.

### 3.2 Fuentes normativas

| Fuente | Qué aporta |
|---|---|
| Manual Técnico v150 (2019) | Estructura del DE, CDC, KuDE, QR, plazos y eventos |
| Notas técnicas 001 a 027 | Correcciones y cambios sobre el manual. Son obligatorias y tienen fecha de vigencia en test y en producción |
| Guía de pruebas (feb. 2026) | Requisitos de habilitación |
| Guía de mejores prácticas | Manejo del servicio asíncrono y reintentos |
| RG 23/2019 art. 40 | Convivencia de preimpresos con electrónico hasta la fecha de obligatoriedad |
| RG 105/2021 | Obligados por grupo y plazos de voluntarios |
| RG 757/2024 y RG 6/2024 | Certificado (CCFE) y solicitud de habilitación |
| RG 41/2025 | Proveedores del Estado |

El webinar de la SET (2023) sirve como criterio práctico. No es norma.

### 3.3 Arquitectura objetivo

- **Frontend:** las dos apps actuales (Facturador y Pedidos).
- **Backend con base de datos:** obligatorio, porque la clave privada del certificado y la conexión mTLS no pueden estar en el navegador. También reemplaza el envío de pedidos por QR y devuelve el estado "facturado" al cargador.
- **Módulos del backend:**
  1. Validación de datos: RUC, documentos, receptor, totales (reutilizar las reglas de `shared/core.js` y sus pruebas).
  2. Generación del XML según el XSD.
  3. Cálculo del CDC (ya existe en `shared/core.js`; portarlo o compartirlo).
  4. Firma XMLDSig con el certificado de la empresa.
  5. Validación contra XSD.
  6. Cliente SOAP con mTLS.
  7. Cola de transmisión con reintentos y control de plazos.
  8. Generación del KuDE y del QR (con el `DigestValue` real de la firma).
  9. Eventos y consultas.
  10. Registro de auditoría.
  11. Usuarios y roles (principal y cargadores), pedidos y su estado.

### 3.4 Reglas que el sistema debe cumplir

La columna "App" indica si la app actual ya la aplica.

**Documento**

| Regla | App |
|---|---|
| CDC de 44 dígitos: tipo de documento (2), RUC emisor (8), DV (1), establecimiento (3), punto (3), número (7), tipo de contribuyente (1), fecha AAAAMMDD (8), tipo de emisión (1), código de seguridad (9), DV del CDC (1) | Sí |
| DV módulo 11 con pesos 2 a 9 desde la derecha; si da 10 u 11, el DV es 0 | Sí |
| Código de seguridad aleatorio de 9 dígitos, distinto en cada DE | Sí |
| Autofactura solo en guaraníes (NT 012) | No aplica todavía (solo factura) |
| IVA por ítem: afectación 1 gravado, 2 exonerado, 3 exento, 4 gravado parcial (NT 013) | Parcial: gravado 5 %, 10 % y exento |
| Descuentos con la fórmula de la NT 001 | Parcial: descuento porcentual por ítem; verificar fórmula |
| Tipo de transacción solo con C002 igual a 1 o 4 (NT 006) | Fijo en "Venta de mercadería" |

**Receptor**

| Regla | App |
|---|---|
| Tipo de documento: 1 cédula, 2 pasaporte, 3 cédula extranjera, 4 carnet de residencia, 5 innominado, 6 tarjeta diplomática, 9 otro (NT 023 y 027) | Sí |
| Innominado no permitido desde Gs 7.000.000 (NT 024, desde el 1/1/2025; reemplaza los Gs 35.000.000 de la NT 021) | Sí |
| En nominación (NT 027) no se permite el tipo 5 | No aplica todavía (sin eventos) |
| Contribuyente se identifica por RUC; no contribuyente, por documento | Sí |
| Operación automática: sin RUC → B2C; organismo del Estado → B2G con código DNCP (NT 020 y 026); contribuyente → B2B; extranjero → B2F | Sí (falta pedir el código DNCP en B2G) |
| El tipo de operación no se imprime en el KuDE; se imprime el tipo de transacción | Sí |

**Eventos** (requieren backend)

- Nominación de factura innominada (NT 014 y 027): una sola por factura; el RUC del emisor del evento debe coincidir con el de la factura.
- Eventos del receptor (NT 019): 45 días desde la emisión o la aprobación. La conformidad o disconformidad correctiva tiene 15 días.
- Cancelación dentro de 48 horas desde la aprobación para factura electrónica. **La app ya bloquea la cancelación pasado ese plazo** y sugiere nota de crédito. El manual dice 168 horas para otros tipos (ver 3.6).
- La cancelación se permite aunque el receptor ya haya confirmado (NT 025).
- Inutilización dentro de 360 horas desde el mes siguiente al consumo.

**Plazos de transmisión** (requieren backend)

- Transmisión: hasta 72 horas desde la firma.
- Diferencia entre emisión y transmisión: no más de 120 horas.
- Más de 720 horas: se rechaza.
- No hay contingencia formal. La SET la evalúa.

**Firma** (requiere backend)

- XMLDSig enveloped, C14N, RSA-SHA256 o superior, digest SHA-256 o superior (NT 016).
- Certificado de la empresa emitido por un prestador habilitado por el MIC, con el RUC en el campo correspondiente y extensión clientAuth.
- Cada punto de expedición firma con el certificado de la empresa, no con el del usuario que emite.

**Transmisión** (requiere backend)

- Servicios síncronos: recepción de DE, consulta de DE, recepción de eventos y consulta de RUC.
- Servicios asíncronos: recepción de lote (hasta 50 del mismo tipo y RUC) y consulta de resultado de lote.
- Consultar el lote 10 minutos después de enviarlo y cada 10 minutos después.
- No reenviar un CDC sin respuesta definitiva: el reenvío puede bloquear el RUC entre 10 y 60 minutos.
- Validar con el prevalidador antes de enviar.
- Ambientes (a verificar con el manual, sección 7.10): sifen-test.set.gov.py (prueba) y sifen.set.gov.py (producción).

**QR** (implementado en `buildQrUrl`)

- Parámetros en este orden: `nVersion=150`, `Id` (CDC), `dFeEmiDE` (fecha en hexadecimal), `dRucRec` (RUC sin DV) o `dNumIDRec` (documento, 0 si es innominado), `dTotGralOpe`, `dTotIVA`, `cItems`, `DigestValue` (hexadecimal del digest en base64) e `IdCSC`.
- `cHashQR` = SHA-256 de los parámetros más el CSC. El nombre y el orden se confirman con una prueba en test (ver 3.6).
- El QR real solo puede generarse después de firmar. Hoy el `DigestValue` es simulado.
- CSC de prueba del manual: `ABCD0000000000000000000000000000` (IdCSC 0001).

**KuDE** (implementado)

- Mismo diseño que la muestra de la DNIT: encabezado con logo, timbrado (con fin de vigencia, ver 3.6), receptor, ítems, totales, liquidación de IVA, QR, CDC en grupos de 4 y leyenda legal.
- En ambiente de prueba: "DOCUMENTO ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA".
- Formato A4 (hecho). Formato ticket: pendiente. El cliente puede cargar el logo (hecho).

**Modificación**

- Un documento se puede editar antes de transmitir (en la app: antes de "Emitir").
- Después de aprobado no se modifica: se corrige con cancelación o nota de crédito.

**Convivencia**

- Preimpresos y autoimpresores pueden usarse hasta la fecha de obligatoriedad (RG 23/2019 art. 40).
- Voluntario: 12 meses desde la solicitud para emitir el primer DE, y 6 meses más para emitir todo en forma electrónica. Si emite el primer DE a los 6 meses, el total baja a 12 meses (RG 105/2021).

### 3.5 Casos de prueba

Implementados en `tests/run.js` (`node tests/run.js`, 31 casos):

- **Dígito verificador:** `dv11("80012345")` = 0; `dv11("4567890")` = 1; RUC con DV incorrecto o sin DV → rechazado.
- **Clasificación:** 4567890-1 simple → B2B; 3210987-3 unipersonal → B2B; 80098765-9 sociedad → B2B; 80011111-7 organismo del Estado → B2G; RUC válido no encontrado → B2B con aviso; sin RUC → B2C; extranjero con documento → B2F.
- **Innominado:** Gs 6.999.999 permitido; Gs 7.000.000 y Gs 8.000.000 sin documento → rechazado; con documento → permitido.
- **Totales:** 2 × 45.000 al 10 %, 3 × 8.000 exento y 5 × 3.000 al 5 % → exentas 24.000; base 5 % 15.000 (IVA 714); base 10 % 90.000 (IVA 8.181); total 129.000; IVA 8.895.
- **CDC:** 44 dígitos, cada posición en su lugar, DV correcto (ejemplo corregido con DV 1), código de seguridad distinto en cada CDC, un dígito alterado lo invalida, formato en 11 grupos de 4.
- **QR:** orden de parámetros, RUC sin DV, fecha en hexadecimal, `dNumIDRec=0` para innominado y `cHashQR` igual al SHA-256 de los parámetros más el CSC de prueba.
- **Pedido por QR:** ida y vuelta con cliente extranjero; código alterado → rechazado.

Pendientes: pruebas de integración contra el ambiente de test (lista de la Parte 2), que requieren el backend.

### 3.6 Pendientes y dudas

1. **XSD vigente** (carpeta Estructura_DE): no está disponible. Sin él no se puede generar ni validar el XML.
2. **Fin de vigencia del timbrado:** el manual (10.5) dice que no existe; la muestra de la DNIT la imprime. La app la imprime. Confirmar con el XSD.
3. **cHashQR** y el orden de los parámetros del QR: confirmar con una prueba en test.
4. **Plazo de cancelación:** 48 horas (manual 11.1.2) o 168 horas (tabla). La app usa 48 horas para factura.
5. **Límite de 2.000 caracteres** en la descripción: lo dijo la SET en el webinar, no se encontró en las notas revisadas.
6. **Consulta de RUC:** confirmar si devuelve el tipo de contribuyente (simple, unipersonal o sociedad). Si no, la clasificación depende de otra fuente.
7. **Endpoints** de test y producción: confirmar en la sección 7.10 del manual.
8. **Normativa para pequeños contribuyentes:** anunciada para noviembre de 2026. Revisar si ya salió.
9. **Firma de bancos:** no está claro si la firma que usa un banco sirve también para facturación.
10. **Contingencia:** no hay regla formal todavía.
11. **Código DNCP en B2G:** la app detecta la operación, pero todavía no pide el código.
12. **Tipo de cambio y totales en USD:** confirmar cómo van `dTotGralOpe` y el total en guaraníes en el QR y en el XML.

### 3.7 Orden de trabajo sugerido

Hecho en el frontend: reglas de receptor y totales con pruebas, CDC, QR (con digest simulado), KuDE en pantalla y en PDF, pedidos.

Lo que sigue:

1. Conseguir el XSD vigente y cargarlo en el repositorio.
2. Backend: modelo de datos (empresa, usuarios y roles, clientes, pedidos, documentos) reutilizando las reglas de `shared/core.js` y sus pruebas.
3. Generador de XML a partir del XSD, validado.
4. Firma XMLDSig con certificado de prueba; `DigestValue` real en el QR.
5. Cliente SOAP con mTLS contra test.
6. Cola de transmisión, control de plazos y manejo de rechazos.
7. Eventos (cancelación, inutilización, nominación) y consultas.
8. KuDE generado en el backend con la leyenda de prueba (portar `facturador/kude-pdf.js`); formato ticket.
9. Reemplazar las simulaciones de la app por llamadas al backend, y devolver el estado "facturado" a la app Pedidos.
10. Ejecutar las pruebas mínimas de la guía y corregir.
11. Habilitación en Marangatu y paso a producción con un cliente piloto.
