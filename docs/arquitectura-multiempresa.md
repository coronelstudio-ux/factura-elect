# Arquitectura multiempresa

Cómo un estudio administra varias empresas clientes, cada una con sus facturas, timbrados, certificado y usuarios.
Hoy funciona en un solo dispositivo (datos en el navegador). Este documento describe también cómo pasa al servidor.

## Apps

| App | Carpeta | Para quién | Qué hace |
|---|---|---|---|
| **Admin** (violeta) | `admin/` | Estudio: admin maestro y operadores | Panel con alertas y cola de envíos, alta guiada de empresas, certificados, timbrados, CSC, ambiente, usuarios y auditoría |
| **Facturador** (verde) | `facturador/` | Empresa cliente: admin del cliente y facturadores | Factura, recibe pedidos por QR, productos frecuentes, preferencias |
| **Pedidos** (azul) | `pedidos/` | Vendedores (cargadores) | Carga pedidos y los comparte por QR; puede cargar el catálogo de productos |

El núcleo compartido está en `shared/tenant.js` (empresas, usuarios, permisos, auditoría, timbrados, alertas, catálogo, firma) y `shared/core.js` (cálculos, RUC, CDC, QR, receptor).

## Roles y permisos

| Permiso | Maestro | Operador | Admin del cliente | Facturador | Cargador |
|---|:-:|:-:|:-:|:-:|:-:|
| Entrar a la app Admin (`admin.app`) | ✓ | ✓ | | | |
| Crear empresas (`empresas.alta`) | ✓ | | | | |
| Datos técnicos: RUC, establecimiento, IdCSC (`empresa.tecnico`) | ✓ | ✓ | | | |
| Certificado (`empresa.certificado`) | ✓ | | | | |
| Ambiente prueba/producción (`empresa.ambiente`) | ✓ | | | | |
| Timbrados (`timbrados.editar`) | ✓ | ✓ | | | |
| Usuarios del estudio (`usuarios.estudio`) | ✓ | | | | |
| Usuarios de una empresa (`usuarios.empresa`) | ✓ | ✓ | ✓ | | |
| Logo, productos, preferencias (`cliente.config`) | ✓ | ✓ | ✓ | | |
| Facturar, cancelar, recibir pedidos (`facturar`) | ✓ | ✓ | ✓ | ✓ | |
| Auditoría (`auditoria`) | ✓ | ✓ | | | |

- El **maestro** accede a todas las empresas. Los demás, solo a las asignadas.
- El **operador** ve solo sus empresas en el panel, la lista y la auditoría.
- El **cargador** usa solo la app Pedidos.
- **Modo de un solo dispositivo:** si una empresa no tiene usuarios con acceso, el Facturador usa el PIN del dispositivo y permite todo, como en la primera versión. Apenas se crea un usuario con acceso, cada persona entra con su propio PIN.
- Las reglas están en `PERMS` de `shared/tenant.js` y se prueban en `tests/run.js`.

## Alta guiada de una empresa (app Admin)

1. **Empresa y RUC:** razón social, RUC con DV (módulo 11), actividad, dirección, tipo de contribuyente (posición 25 del CDC). Igual que en Marangatu.
2. **Establecimiento y punto:** 3 dígitos cada uno.
3. **Certificado:** titular, RUC (debe ser el de la empresa), prestador, vigencia. Solo datos: el `.p12` irá al servidor (ver `docs/firma-electronica.md`).
4. **Timbrado y CSC de prueba:** queda como timbrado activo.
5. **Pruebas con la DNIT:** lista de verificación de la guía de pruebas.
6. **Habilitación y producción:** habilitación aprobada, IdCSC de producción. El paso a producción exige: habilitación, IdCSC de producción, certificado vigente y todas las pruebas marcadas.

El avance se guarda en cada paso (`empresa.onboarding`) y se puede retomar desde la ficha de la empresa.

## Panel y alertas

`T.alertsFor(empresa)` calcula, por empresa:

| Alerta | Nivel |
|---|---|
| Sin timbrado activo o timbrado vencido | Urgente |
| Timbrado todavía no vigente o que vence en 30 días o menos | Atención |
| Certificado sin cargar o que vence en 30 días o menos | Atención |
| Certificado vencido | Urgente |
| Facturas rechazadas sin corregir (no cuenta las canceladas) | Urgente |
| Facturas pendientes de envío | Atención; urgente si pasaron 72 h |
| Empresa en ambiente de prueba | Informativa |

La **cola de envíos** (`T.queueFor`) lista las facturas pendientes con las horas que quedan del plazo de 72 h desde la firma.

## Auditoría

`T.audit(acción, detalle, empresaId, usuario)` registra ingresos, cierres de sesión, facturas emitidas y canceladas, pedidos recibidos y rechazados, timbrados, certificados, usuarios, ambiente, preferencias y respaldos. Hoy guarda los últimos 2.000 registros en el dispositivo.

## Facilidades para el usuario del Facturador

- **Productos frecuentes** con código, precio e IVA, para elegirlos al facturar. Se pueden compartir a la app Pedidos como QR o código (`FEC1.…`), y el código del producto viaja en el pedido.
- **Valores por defecto:** condición de venta, moneda y tipo de cambio del día.
- **Texto fijo al pie del KuDE** (cuentas, condiciones), en pantalla y en el PDF.
- **Formato de impresión:** A4 o ticket de 80 mm (PDF con texto real en ambos).
- **Envío automático por correo** al aprobarse (hoy simulado; lo hará el servidor).
- **PIN por usuario** y cambio de empresa desde la línea superior cuando el usuario tiene más de una.

## Datos hoy (en el dispositivo)

| Clave | Contenido |
|---|---|
| `fe_empresas` | Lista de empresas |
| `fe_activeEmpresa` | Empresa abierta en el Facturador |
| `fe_users` | Usuarios con rol, empresas y PIN (hash SHA-256 con el id del usuario) |
| `fe_audit` | Auditoría |
| `fac_<empresa>_invoices` / `_timbrados` / `_pedidos` / `_clients` / `_products` / `_prefs` | Datos de cada empresa |
| `ped_*` | Datos de la app Pedidos del cargador |

La primera vez, los datos de la versión de una sola empresa (`fac_invoices`, `fac_timbrados`, etc.) se mueven a la empresa de ejemplo.

## Modelo para la base de datos

```
estudio (id, nombre)
empresa (id, estudio_id, ruc, dv, razon_social, fantasia, actividad, direccion, ciudad, telefono, correo,
         tipo_contribuyente, ambiente, id_csc_prueba, id_csc_prod, estado, alta_paso, alta_checks, habilitado,
         logo, creado, actualizado)
establecimiento (id, empresa_id, codigo, punto, direccion)
certificado (id, empresa_id, titular, ruc, prestador, tipo, serie, desde, vence,
             p12_cifrado, clave_cifrada)          -- solo lo lee el servicio Firmador
csc (id, empresa_id, ambiente, id_csc, valor_cifrado)
timbrado (id, empresa_id, numero, inicio, fin, proximo_numero, activo, usado)
usuario (id, estudio_id, nombre, rol, pin_hash, activo)
usuario_empresa (usuario_id, empresa_id)
producto (id, empresa_id, codigo, descripcion, precio, iva)
cliente (id, empresa_id, tipo, ruc, tipo_doc, documento, pais, nombre, correo)
pedido (id, empresa_id, vendedor_id, version, estado, motivo, datos_json, recibido, factura_id)
documento (id, empresa_id, timbrado_id, numero, cdc, fecha_emision, receptor_json, items_json, totales_json,
           xml_firmado, digest_value, qr_url, estado, motivo, enviado, respuesta_sifen, cancelado, pedido_id)
envio (id, documento_id, lote, intento, enviado, respuesta, plazo_limite)
auditoria (id, estudio_id, empresa_id, usuario_id, accion, detalle, fecha)
preferencias (empresa_id, condicion, moneda, tipo_cambio, fecha_tipo_cambio, pie_kude, formato, correo_automatico)
```

Reglas para el servidor:
- Toda consulta filtra por `empresa_id` y por las empresas del usuario (no solo en la pantalla).
- `timbrado`: un solo `activo = true` por empresa (índice único parcial).
- `documento.numero` único por empresa, timbrado, establecimiento y punto. El número se asigna en una transacción.
- El estado "facturado" de un pedido vuelve a la app Pedidos (hoy no puede, porque no hay servidor).

## Del dispositivo al servidor

Las pantallas no llaman a `localStorage` directamente: usan `FE.T` (`listEmpresas`, `saveEmpresa`, `storeFor`, `users`, `audit`, `alertsFor`, `Firmador.firmar`…). Para pasar al servidor:

1. Reemplazar esas funciones por llamadas a la API, con sesión por usuario.
2. Mover la emisión al servidor: generar el XML, firmar, armar el QR con el `DigestValue` real, enviar a SIFEN y guardar la respuesta.
3. Mantener `shared/core.js` (reglas y cálculos) para validar en la app y en el servidor con las mismas pruebas.
