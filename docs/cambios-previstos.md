# Cambios previstos

Lista de cambios anotados que **todavía no se programaron**. Se aplican solo cuando el usuario lo autoriza.
Formato: lo que pidió el usuario, la propuesta y las dudas abiertas.

## Pendientes

### 5. Lenguaje de la app según cada tipo de usuario

- **Pedido:** revisar los términos y denominaciones para que sean más neutros y adecuados a cada usuario: admin maestro, admin de la empresa, facturadores y vendedores. Usar un lenguaje propio de una aplicación: menos dirigido (menos órdenes al usuario) y más formal o descriptivo.

- **Diagnóstico (textos actuales):**
  - **Tono dirigido:** unas 140 frases en imperativo con voseo ("Escribí…", "Elegí…", "Tocá…", "Pedile…", "Comunicate…", "Cargalo…"). La mayoría son avisos de error.
    - En el Facturador: 67.
    - En el Admin: 28.
    - En Pedidos: 17.
    - En el núcleo compartido: 30.
  - **Preguntas conversacionales** en el flujo de emisión, copiadas del estilo de una app bancaria: "¿A quién le facturás?", "¿Qué le vendés?", "¿Cómo te paga?", "¿A quién le vendés?".
  - **Términos técnicos que hoy ve el facturador** y no necesita entender:
    - KuDE (58 veces en el Facturador);
    - CDC (44);
    - SIFEN (6);
    - XML (11);
    - "ambiente de prueba";
    - "IdCSC";
    - "módulo";
    - "innominado";
    - "nominación";
    - "simulado/simulación".
  - **Nombres de roles poco claros:** "Admin maestro", "Admin del cliente", "Operador", "Cargador".
  - **Mezcla de nombres para lo mismo:**
    - pedido / nota de pedido;
    - punto de expedición / caja;
    - boleta / factura del servicio;
    - comprobante / documento / KuDE.

- **Qué lee y qué necesita entender cada usuario:**

| Usuario | Qué hace | Qué necesita entender | Qué le sobra hoy |
|---|---|---|---|
| **Admin maestro** (estudio) | Empresas, certificados, timbrados, CSC, ambiente, cobros | Todo el vocabulario técnico y legal (SIFEN, CDC, KuDE, IdCSC, inutilización, XML) | Nada: es el público técnico |
| **Admin de la empresa** (dueño) | Usuarios, cajas, timbrado, productos, preferencias, cuenta del servicio | Timbrado, cajas, tipos de documento, cuenta y vencimientos | IdCSC, ambiente, XML, SIFEN, "módulo" |
| **Facturador** (cajero) | Emitir, cancelar, notas de crédito, consultar | Cliente, productos, condición, número de factura, aprobada o rechazada | KuDE, CDC, SIFEN, XML, "innominado", "simulación" |
| **Vendedor** (notas de pedido) | Cargar notas, enviar el PDF, compartir el QR | Cliente, productos, nota, enviar | "Cargador", "QR del pedido" como algo técnico |

- **Propuesta:**
  1. **Tono general: descriptivo e impersonal.**
     - Los botones y títulos usan acciones en infinitivo o sustantivos: "Emitir factura", "Agregar producto", "Cerrar sesión".
     - Los avisos describen la situación en lugar de ordenar:
       - "Falta el RUC del cliente" en lugar de "Escribí el RUC";
       - "El PIN debe tener de 4 a 6 números" en lugar de "El PIN tiene que tener…";
       - "Disponible para el administrador de la empresa" en lugar de "Pedile al estudio que…".
     - Los textos de ayuda son demostrativos: "La factura se envía por correo al aprobarse".
  2. **Pasos del flujo con títulos en lugar de preguntas:**
     - "¿A quién le facturás?" → **Cliente**;
     - "¿Qué le vendés?" → **Productos**;
     - "¿Cómo te paga?" → **Condición de venta**;
     - "Revisá antes de emitir" → **Revisión**.
     - Debajo de cada título va una línea descriptiva corta.
  3. **Glosario único.** El mismo término en toda la app, con su versión simple para quien no es técnico:

| Concepto | Admin maestro | Admin de empresa, facturador y vendedor |
|---|---|---|
| KuDE | KuDE | Factura (PDF) o "documento" |
| CDC | CDC | Código de control |
| Aprobación de SIFEN | Aprobado por SIFEN | Aprobada por la DNIT |
| Punto de expedición | Caja (punto 001-002) | Caja |
| Ambiente de prueba / producción | Ambiente de prueba / producción | Modo de prueba / (nada en producción) |
| Módulo | Módulo | Función contratada |
| Innominado | Innominado | Consumidor final sin datos |
| Nominación | Nominación | Identificar al comprador |
| Inutilización | Inutilización | (no lo ve) |
| Boleta de pago | Factura del servicio | Cuenta del servicio |
| Pedido | Nota de pedido | Nota de pedido |
| Simulado / simulación | Simulado (prueba) | (no se muestra) |

  4. **Nombres de roles:**
     - Admin maestro → **Administrador general**;
     - Operador → **Operador del estudio**;
     - Admin del cliente → **Administrador de la empresa**;
     - Facturador → **Facturador**;
     - Cargador → **Vendedor**.
  5. **Un archivo de textos compartido** (`shared/textos.js`) con:
     - el glosario;
     - los mensajes comunes;
     - la versión de cada término según el rol.

     Así el lenguaje queda igual en las tres apps y se cambia en un solo lugar. También deja preparada una futura traducción.
  6. **Alcance:** pantallas, botones, avisos, mensajes de error y ayudas de las tres apps. El KuDE y el PDF no cambian, porque sus leyendas las exige la DNIT.

- **Decidido (se aceptan todas las propuestas):**
  - **Trato:** frases **impersonales** siempre que se pueda; si hace falta dirigirse al usuario, **usted**. Se deja el voseo.
  - **Roles:** Administrador general, Operador del estudio, Administrador de la empresa, Facturador, Vendedor.
  - **Emisión:** títulos cortos (Cliente, Productos, Condición de venta, Revisión) en lugar de preguntas.
  - **Admin de la empresa:** términos simples, con el técnico entre paréntesis donde haga falta, por ejemplo "Código de control (CDC)".

- **Análisis ampliado: más cosas que cambian en lo que ven los usuarios**
  1. **Nombres de las apps** (pantalla de inicio del celular y título):
     - Admin → **Administración**;
     - Facturador → **Facturación**;
     - Pedidos → **Notas de pedido**.
  2. **Pestañas de abajo:**
     - Facturador "Nueva" y Pedidos "Nuevo" → **Emitir** y **Nueva nota**;
     - Admin "Panel" → **Inicio**;
     - Facturador "Pedidos" → **Notas** (igual que en Pedidos).
  3. **Estados con nombre completo y uniforme:**
     - Factura "Pendiente" → **Pendiente de envío**;
     - "Rechazada" (factura) y "Rechazado" (nota de pedido) → **Rechazada** en las dos;
     - "Activo · vencido" → **Vencido**;
     - "De baja" y "Dado de baja" → **Dado de baja** en las dos;
     - "Sin compartir" y "Compartido" → **No enviada** y **Enviada**;
     - tipos de documento no disponibles: "Próximamente" → **No disponible**, con el motivo.
  4. **Títulos de pantallas y secciones:**
     - "Últimos comprobantes" → **Últimos documentos**;
     - "KuDE" (sección del detalle) → **Documento**;
     - "Vista previa" → **Revisión**;
     - "Respaldo" y "Respaldo completo" → **Copia de seguridad**;
     - "Cola de envíos a SIFEN" → **Envíos pendientes a SIFEN** (solo el administrador general).
  5. **Ventanas que hoy preguntan en voseo:**
     - "¿Con qué caja emitís?" → **Seleccionar caja**;
     - "¿Cómo te llamás?" → **Nombre del vendedor**;
     - "Crear admin maestro" → **Crear administrador general**;
     - "Nominar la factura" → **Identificar al comprador**.
  6. **Mensajes de "simulación":** hoy aparecen sueltos ("(simulado)", "1103 … (simulación)", "La aprobación de SIFEN es simulada").
     - Se reemplazan por un **único aviso de "Modo de prueba"**, visible arriba mientras la empresa esté en prueba.
     - Los mensajes quedan limpios, por ejemplo "Rechazada por la DNIT: número de timbrado no vigente".
  7. **Botones uniformes:**
     - **Cancelar** para salir sin guardar (hoy se mezclan "Volver", "Cancelar" y "Cerrar");
     - **Guardar** para confirmar datos;
     - el verbo exacto para acciones definitivas: **Emitir**, **Dar de baja**, **Eliminar**.
  8. **Pantallas vacías:** frase corta y uniforme, por ejemplo "Sin documentos emitidos" o "Sin notas de pedido", y un botón con la acción principal.
  9. **Avisos de error:** describen qué falta o qué está mal y, si corresponde, cómo seguir. Por ejemplo:
     - "Falta la fecha de inicio del timbrado";
     - "El RUC no es válido: el dígito verificador no corresponde".
  10. **Avisos de éxito:** en participio y breves: "Cliente guardado", "Factura emitida", "Nota de pedido enviada".
  11. **Pantallas de ingreso y bloqueo:**
      - sin emojis: se usa un ícono de la app;
      - "¿Olvidaste el PIN? Pedile al admin maestro…" → **"Para recuperar el PIN, contacte al administrador de la empresa."**
  12. **Fechas y horas:** formato único `26/11/2026 09:09`, de 24 horas (hoy mezcla "p. m." y "·").
  13. **Abreviaturas de tipos** (FE, NC, ND, AF, NR):
      - en listas, solo para el administrador general;
      - para los demás, el nombre corto: "Factura", "Nota de crédito", etc.
  14. **Textos para lectores de pantalla y accesibilidad:** con el mismo tono impersonal.
  15. **Auditoría:** nombres de las acciones uniformes y en impersonal, por ejemplo "Factura emitida", "Ingreso", "Cierre de sesión", "Timbrado dado de baja".
  16. **Documentación** (README y guías): mismo glosario y mismos nombres de roles.

- **Relación:** el **cambio 6** (qué funciones ve cada usuario) toca las mismas pantallas. Conviene **aplicar el 5 y el 6 juntos**: se revisa cada pantalla una sola vez.
- **Estado:** definido. Se aplica junto con el cambio 6, cuando se autorice.
- **Tamaño:** mediano a grande. Toca casi todos los textos de las tres apps, pero no cambia cómo funcionan. Se prueba revisando pantalla por pantalla.


### 6. Vista enfocada por usuario: qué ve, qué controla, qué le sirve y qué no

- **Pedido:** analizar a fondo lo que ve y lo que puede cambiar cada usuario y tipo de usuario, qué controla, qué le sirve y qué no, para que cada uno tenga una **vista enfocada en su función**.

#### 6.1 Cómo está hoy (relevamiento)

| Usuario | App que usa | Qué ve hoy | Qué puede cambiar hoy |
|---|---|---|---|
| **Administrador general** | Administración (y Facturación) | Panel con alertas de todas las empresas, empresas, usuarios, auditoría, tarifas. En Facturación ve todo y descarga el XML. | Todo |
| **Operador del estudio** | Administración | Panel, empresas asignadas, usuarios, auditoría. Ve la sección "Plan y cobros" (sin editar). | Datos técnicos, CSC y usuarios de sus empresas. Ya **no** timbrados (cambio 2). |
| **Administrador de la empresa** | Facturación | Lo mismo que el facturador, más Preferencias, Usuarios, Boletas y los botones de timbrados | Timbrados, productos, preferencias, logo, usuarios de su empresa |
| **Facturador** | Facturación | Inicio con **el total facturado de toda la empresa**, historial de **todas las cajas y usuarios**, y en Ajustes: Empresa, Timbrados, **Certificado y ambiente (IdCSC)**, Productos, Clientes, **Respaldo (descargar y restaurar todos los datos)** | Emitir, cancelar, notas de crédito y débito, remisión, nominación, recibir y rechazar notas de pedido, clientes |
| **Vendedor** | Notas de pedido (sin usuario) | Sus notas, clientes, catálogo, copia de seguridad | Sus notas y clientes |
| **Modo un dispositivo** (sin usuarios) | Facturación | Todo | Todo |

#### 6.2 Problemas encontrados

1. **El facturador ve y puede hacer demasiado:**
   - el total facturado de toda la empresa;
   - los documentos de todas las cajas;
   - datos técnicos (certificado, IdCSC, ambiente);
   - y puede **descargar y restaurar la copia de seguridad de toda la empresa**: se lleva todos los datos o los pisa.
2. **El administrador de la empresa no tiene "su" lugar:**
   - usa la misma pantalla que el cajero, con más secciones mezcladas en Ajustes;
   - no tiene un resumen del negocio (ventas por caja, por usuario o por mes), ni auditoría de su empresa.
3. **Hueco de permisos:** el administrador de la empresa gestiona timbrados, pero **no puede crear cajas** (eso está solo en Administración, donde no entra). Tampoco puede inutilizar números.
4. **El operador del estudio** quedó sin una función clara después del cambio 2: no gestiona timbrados, no da de alta empresas y ve montos de cobro que no le corresponden.
5. **Permisos de todo o nada:** no se puede limitar a un facturador, por ejemplo para que no cancele o que solo vea lo suyo.
6. **El vendedor** podría quedar en la lista de ingreso de Facturación aunque no factura.
7. **Pestañas iguales para todos** dentro de cada app, aunque cada rol usa cosas distintas.

#### 6.3 Propuesta: una vista por rol

**A. Administrador general (estudio) · app Administración**
- **Inicio:** tablero del estudio.
  - Alertas por empresa (timbrado, certificado, rechazos, envíos atrasados).
  - Cobros: deuda, vencidos y suspendidos.
  - Altas en curso.
- **Pestañas:**
  - **Inicio**.
  - **Empresas**.
  - **Cobros** (nuevo: todo lo de planes, pagos y facturar el servicio, que hoy está dentro de cada empresa).
  - **Usuarios**.
  - **Más**: auditoría, tarifas, copia de seguridad general y perfil.
- **Controla:**
  - empresas, alta guiada, certificados, ambiente y CSC;
  - timbrados, cajas e inutilización (puede actuar en nombre de la empresa);
  - usuarios del estudio y de las empresas;
  - tarifas, precios, descuentos y pagos;
  - XML.
- **No necesita:** nada fuera de su alcance. Es el único que ve abreviaturas y términos técnicos (cambio 5).

**B. Operador del estudio · app Administración**
- **Función propuesta:** soporte técnico de las empresas asignadas.
- **Inicio:** alertas de **sus** empresas.
- **Pestañas:** Inicio, Empresas (solo las suyas), Más (auditoría de sus empresas, perfil).
- **Controla:**
  - datos de la empresa;
  - CSC;
  - registro del certificado (sin el archivo);
  - usuarios de sus empresas;
  - seguimiento del alta guiada.
- **No ve:** cobros, tarifas ni montos del plan; empresas que no tiene asignadas.

**C. Administrador de la empresa (dueño) · app Facturación, con vista de gestión**
- **Inicio "Mi negocio":**
  - ventas de hoy y del mes, por caja y por usuario;
  - documentos pendientes o rechazados;
  - notas de pedido por facturar;
  - aviso de la cuenta del servicio.
- **Pestañas:**
  - **Inicio**.
  - **Emitir**.
  - **Documentos** (todas las cajas, con filtro por caja y por usuario).
  - **Notas** (si tiene la función).
  - **Gestión**.
- **Gestión** reemplaza a la mitad de Ajustes:
  - **Equipo:** usuarios, sus cajas y sus permisos (ver 6.4).
  - **Cajas y establecimientos** (se trae de Administración).
  - **Timbrados**: cargar, activar, ampliar, dar de baja e **inutilizar números**.
  - **Productos** y **clientes**.
  - **Preferencias del documento**: condición, moneda, pie del documento, formato e impresión.
  - **Cuenta del servicio**: boletas y estado de cuenta.
  - **Actividad**: auditoría de su empresa (quién emitió, canceló, cambió qué).
  - **Copia de seguridad.**
- **No ve:** IdCSC, ambiente, XML ni SIFEN. El certificado aparece solo como aviso si está por vencer ("El certificado de firma vence el …; el estudio lo renueva").

**D. Facturador (cajero) · app Facturación, vista operativa**
- **Inicio "Mi caja":**
  - caja en uso;
  - lo que **él** emitió hoy (cantidad y total);
  - un botón grande **Emitir**;
  - notas de pedido por facturar;
  - si no puede emitir, un solo aviso claro ("No es posible emitir: el timbrado no está vigente. Contacte al administrador de la empresa").
- **Pestañas:** Inicio, Emitir, Documentos (**solo los que emitió él**), Notas (si corresponde), Perfil.
- **Controla:**
  - emitir;
  - enviar y descargar el PDF;
  - recibir y rechazar notas de pedido;
  - cargar clientes al emitir.
- **Ajustes reducido a:** Mi perfil, caja en uso, apariencia e instalar.
- **No ve:**
  - totales de la empresa;
  - documentos de otras cajas (salvo permiso);
  - timbrados (solo el número que sale en el documento);
  - certificado, ambiente e IdCSC;
  - preferencias;
  - usuarios;
  - copia de seguridad;
  - boletas.

**E. Vendedor · app Notas de pedido**
- **Inicio "Mis notas":** pendientes de enviar y enviadas.
- **Pestañas:** Notas, Nueva nota, Clientes, Perfil.
- **Controla:** sus notas y sus clientes, enviar el PDF y compartir el QR.
- **Ajustes:** perfil (nombre), catálogo, apariencia, instalar y copia de seguridad de **sus** notas (sus datos viven solo en su celular).
- **No ve:** nada de facturación.
- No aparece en la lista de ingreso de Facturación.

**F. Modo un dispositivo** (sin usuarios cargados): funciona como **administrador de la empresa**. Así un negocio chico de una sola persona sigue teniendo todo.

#### 6.4 Permisos finos por usuario (los marca el administrador de la empresa)

| Permiso | Facturador (por defecto) | Vendedor |
|---|---|---|
| Emitir facturas | Sí | — |
| Emitir notas de crédito y débito | **No: exclusivo del administrador** | — |
| Emitir remisión y autofactura (si la empresa las tiene) | Sí | — |
| Cancelar documentos dentro del plazo | **No: exclusivo del administrador** | — |
| Ver documentos de otros usuarios | No (ve solo lo que emitió él) | — |
| Ver totales del día de la empresa | No | — |
| Recibir y facturar notas de pedido | Sí | — |
| Cargar notas de pedido | — | Sí |
| Cajas asignadas | Las que marque el admin | — |

Esto amplía lo que ya existe ("funciones por usuario" y "cajas por usuario") y lo reúne en una sola ficha del usuario.

#### 6.5 Matriz final (resumen)

| Función | Adm. general | Operador | Adm. empresa | Facturador | Vendedor |
|---|:-:|:-:|:-:|:-:|:-:|
| Empresas: alta, certificado, ambiente | ✓ | Datos y CSC | | | |
| Cobros, tarifas, descuentos | ✓ | | Ve su cuenta | | |
| Timbrados, cajas e inutilización | ✓ | | ✓ | Ve el activo | |
| Usuarios y permisos | ✓ | Sus empresas | Su empresa | | |
| Emitir facturas | ✓ | | ✓ | ✓ | |
| Cancelar, notas de crédito y débito | ✓ | | ✓ | | |
| Documentos | Todos | Sus empresas | Todos los de la empresa | Solo los que emitió él | |
| Resumen del negocio | Todas | Sus empresas | ✓ | Solo lo suyo | |
| Actividad (auditoría) | ✓ | Sus empresas | Su empresa | | |
| Productos, clientes, preferencias | ✓ | | ✓ | Clientes al emitir | Sus clientes |
| Notas de pedido | | | ✓ | Recibir y facturar | Cargar y enviar |
| Copia de seguridad | General | | Su empresa | | Sus notas |
| XML sin firma | ✓ | | | | |

#### 6.6 Decisiones del usuario

1. **Documentos del facturador:** ve **solo lo que emitió él**.
2. **Cancelar y emitir notas de crédito y débito:** **exclusivo del administrador** (de la empresa y del estudio). El facturador no lo hace. Si un documento suyo necesita corregirse, lo pide al administrador; la app muestra "Para cancelar o corregir, contacte al administrador de la empresa".
3. **Inutilización:** también la hace el **administrador de la empresa**, con PIN y registro en la actividad.
4. **Operador del estudio:** se mantiene como **soporte técnico de sus empresas asignadas**, sin ver cobros ni tarifas.
5. **Cobros:** pestaña propia del administrador general.
6. **Modo un dispositivo:** funciona como **administrador de la empresa**.

- **Estado:** definido. Se aplica junto con el cambio 5, cuando se autorice.

- **Relación:** se aplica junto con el cambio 5 (lenguaje), pantalla por pantalla.
- **Tamaño:** grande. Cambia la navegación de las tres apps, el inicio de cada rol y los permisos. Las funciones existentes se reubican; no se pierde ninguna.

## Previstos para más adelante

Temas que no se programan ahora. **Cada vez que se apliquen cambios, preguntar al usuario si se profundiza en alguno o se aplaza.**

- **Perfil (del cambio 3):** correo, teléfono, foto, contraseña con letras, dispositivos conectados, notificaciones.
- **Pedidos con usuario:** el vendedor como usuario de la empresa, con ingreso, PIN y cierre de sesión; la nota llega directo al Facturador sin QR y el PDF lleva el membrete (requiere la base de datos).
- **Boleta de pago como notificación** en la app del cliente (requiere servidor).
- **Fecha de fin del timbrado:** confirmar en Marangatu (e-Kuatia y e-Kuatia'i) si existe y decidir si se quita.

## Cambios para la app oficial (con base de datos)

Cambios grandes que dependen del servidor y de trabajar de forma oficial. No se programan en el prototipo actual.

### O1. Perfil con verificación de identidad (foto del rostro y del documento)

- **Pedido:** app descargable donde cada persona crea su perfil y carga sus datos de identidad, con foto del rostro (selfie) y del documento. Ver cómo funciona en Paraguay; es un cambio importante por la información que requiere y los métodos nuevos.

- **Cómo funciona en Paraguay (investigado en noviembre de 2026):**
  - **Identidad Electrónica del MITIC** (Portal Paraguay), el modelo oficial de referencia:
    - Se cargan los datos personales y tres fotos: frente de la cédula, dorso y una selfie sosteniendo la cédula cerca del rostro.
    - Si las fotos están bien, se valida automáticamente contra los datos del Estado (Sistema de Intercambio de Información). Si no, pasa a revisión humana, con respuesta en un plazo de hasta 48 horas.
    - Después hay preguntas de verificación y doble factor por SMS (obligatorio desde 2026).
    - Más de 1,5 millones de personas la tienen. No encontré una API pública para que empresas privadas validen contra ella: hay que consultarlo al MITIC.
  - **Proveedores privados de verificación (KYC):**
    - **Hacen lo mismo:** foto de la cédula, selfie con **prueba de vida** (detecta fotos de fotos, máscaras y *deepfakes*), comparación del rostro con la foto de la cédula y, algunos, consulta de la cédula contra el registro de Identificaciones.
    - **Ejemplos:**
      - Didit: anuncia consulta a Identificaciones en tiempo real y un plan gratis de 500 verificaciones por mes.
      - Verifik.
      - Shufti.
      - NeoBiometrics (Neosystem, empresa paraguaya): puede instalarse en servidores propios, para que los datos no salgan del país.
    - **A verificar:** son datos de marketing de cada proveedor; precios, cobertura y validez legal hay que confirmarlos con cada uno.
  - **Ley 7593/2025 de Protección de Datos Personales** (promulgada en noviembre de 2025):
    - Los **datos biométricos** (el rostro usado para identificar) son **datos sensibles**. Su tratamiento está prohibido salvo **consentimiento** del titular o las excepciones de la ley.
    - Para tratamiento a gran escala se pide una **evaluación de impacto** (EIPD) antes de empezar.
    - Multas altas: hasta 10.000 jornales mínimos en los casos más graves.
    - Antes de empezar hay que revisar con un abogado el texto oficial, el reglamento y la autoridad de aplicación.

- **Propuesta de flujo (a profundizar):**
  1. **Registro:** correo o teléfono, con código por SMS o correo, y contraseña.
  2. **Datos personales:** nombre, cédula, fecha de nacimiento, teléfono y dirección.
  3. **Documento:** foto del frente y del dorso de la cédula, con guía en pantalla (marco, aviso de reflejos o desenfoque).
  4. **Rostro:** selfie con prueba de vida y comparación con la foto de la cédula.
  5. **Validación:**
     - automática, por un proveedor o, si se puede, por el MITIC;
     - si falla, revisión manual por el estudio, con un plazo de respuesta.
  6. **Consentimiento explícito** antes de capturar el rostro: qué se guarda, para qué, por cuánto tiempo y cómo borrarlo.
  7. **Estados del perfil:**
     - pendiente;
     - verificado;
     - rechazado, con motivo;
     - vencido, cuando vence la cédula.
  8. **Vínculo con la empresa:** el usuario verificado se asocia a una o más empresas con su rol. El maestro o el admin del cliente aprueban el acceso.
  9. **Seguridad:**
     - fotos y datos cifrados, en servidores con control de acceso;
     - retención mínima;
     - borrado a pedido;
     - auditoría de quién vio qué.

- **Decisiones del usuario (de a poco):**
  - **Solo se verifica con rostro y documento al admin dueño del RUC**, es decir, quien contrata el servicio.
  - **Los funcionarios** (cargan facturas, crean notas de pedido) **no** pasan por esa verificación y se cargan con pocos datos. Los habilita el admin dueño, que **controla qué puede y qué no puede hacer cada uno**.
  - **El admin maestro** (estudio) supervisa todo, por encima del admin dueño.
  - Diseñar **todo el sistema de gestión de registros**, contemplando las distintas formas de hacerlo.

- **Propuesta: gestión de registros**
  1. **Formas de alta del admin dueño** (a elegir; pueden convivir):
     - **a) Autoregistro desde la app:**
       - el dueño baja la app, crea su cuenta, verifica su identidad y carga el RUC;
       - queda en **"pendiente de aprobación"** hasta que el estudio lo revisa y activa el servicio.
     - **b) Alta por el estudio:**
       - el maestro crea la empresa (como el alta guiada de hoy) y le manda al dueño una **invitación** (enlace o QR);
       - el dueño entra con la invitación y completa solo su verificación de identidad.
     - **c) Alta presencial:** el estudio carga todo en su oficina, con el dueño presente, y verifica la identidad ahí.
  2. **Verificación del dueño del RUC:**
     - **Persona física:** el RUC es su número de cédula. Se compara la cédula de la foto con el RUC.
     - **Sociedad:** el que se registra es el **representante legal**. Además de su cédula y su rostro, sube el documento que lo acredita (acta, estatuto o poder). El estudio lo revisa a mano.
     - Se puede sumar la comprobación del RUC (razón social y estado activo) contra los datos de la DNIT.
  3. **Funcionarios:**
     - **Datos:** nombre, cédula (opcional), teléfono o correo y un PIN propio.
     - **Alta:**
       - el admin dueño los crea desde su app;
       - o les manda una **invitación** (enlace o QR) para que entren solos a su empresa.
     - **Roles base:** facturador y vendedor (notas de pedido).
     - **Permisos finos**, que el admin marca o desmarca por persona. Por ejemplo:
       - emitir facturas, notas de crédito y remisiones;
       - cancelar;
       - ver el historial completo o solo lo propio;
       - cargar notas de pedido;
       - ver totales del día.
     - **Suspender o dar de baja** a un funcionario al instante; lo que emitió queda con su nombre.
     - **Tope de usuarios** según el plan contratado. Ya existe el cobro por usuario adicional.
  4. **Control del maestro:**
     - bandeja de registros pendientes (aprobar o rechazar con motivo);
     - ver los usuarios de cada empresa y suspender a cualquiera;
     - auditoría de altas, bajas y cambios de permisos.
  5. **Recuperar el acceso:**
     - funcionario: el admin le asigna otro PIN;
     - admin dueño: recupera con código por SMS o correo; si cambia de celular, vuelve a validar el rostro.
- **Dudas para la próxima vuelta:**
  - ¿Qué formas de alta del dueño querés: a, b, c o varias?
  - ¿Los funcionarios necesitan alguna verificación mínima (por ejemplo, código por SMS a su teléfono) o alcanza con que el admin los cree?
  - Para sociedades, ¿se verifica solo al representante legal, o también puede haber más de un admin dueño?
  - ¿Los permisos finos se definen por persona, o con roles armados por el admin (por ejemplo, "Cajero" o "Vendedor de calle")?

- **Decisiones para más adelante:**
  - **Método de validación:**
    - Identidad Electrónica del MITIC, si se permite a privados;
    - un proveedor de KYC, ¿cuál?;
    - o revisión manual por el estudio al principio.
  - **Dónde se guardan las fotos:** en el proveedor, en servidores propios o en la nube. Influye en el costo y en la ley de datos.
  - **Plataforma:**
    - app nativa (Android/iOS, en las tiendas);
    - o la misma app web instalable con cámara.
    - La nativa da mejor captura y lectura del chip de la cédula, si se usa.
  - **Asesoría legal:** EIPD, textos de consentimiento, política de privacidad y contrato con el proveedor.
  - **Firma electrónica** (Ley 6822/2021): ver si conviene que el perfil verificado firme documentos. Queda por investigar.

## Aplicados

### 1. IVA debajo del monto al emitir

- **Pedido:** al emitir una factura aparece el monto final. Debajo, en letra más chica, mostrar el IVA 10 % y/o 5 % según corresponda.
- **Propuesta:**
  - Mostrar solo las tasas que tienen IVA. Ejemplos: `IVA 10 %: Gs 16.363 · IVA 5 %: Gs 1.047`, o solo `IVA 10 %: Gs 16.363`.
  - Si todo es exento: `Exenta de IVA`.
  - En dólares, el IVA en dólares (con 2 decimales).
  - Para nota de crédito y nota de débito, lo mismo. Autofactura y remisión no llevan IVA: no se muestra.
  - Lugares (confirmado): el paso **Productos** (monto grande arriba), el paso **Revisión** (total) y la pantalla de **¡Listo!** después de emitir.
  - Cuando hay 5 % y 10 % juntos, agregar el total (confirmado): `IVA 10 %: Gs 16.363 · IVA 5 %: Gs 1.047 · Total IVA Gs 17.410`.
- **Estado:** aplicado el 26/11/2026.

### 3. Apartado "Mi perfil" en Ajustes (las tres apps, todos los perfiles)

- **Pedido:** crear el apartado de perfil para cerrar sesión, cambiar la contraseña y más datos de perfil que se agregarán después. Se ve arriba, con su ícono, al entrar en Ajustes. Para todas las apps y todos los perfiles.
- **Hoy:**
  - **Facturador:** sección "Sesión" en Ajustes, con usuario, empresa, Cambiar PIN, Cerrar sesión y Abrir Admin.
  - **Admin:** sección "Sesión" con Cambiar mi PIN y Cerrar sesión.
  - **Pedidos:** no tiene usuarios ni sesión; solo el nombre del vendedor en Ajustes → Vendedor.
- **Propuesta:**
  1. **Tarjeta de perfil arriba de todo en Ajustes:**
     - ícono redondo con las iniciales (después, una foto);
     - nombre, rol y empresa;
     - una flecha. Al tocarla se abre **Mi perfil**.
     - La sección "Sesión" actual desaparece y su contenido pasa a Mi perfil.
  2. **Pantalla Mi perfil:**
     - **Datos:** nombre, rol, empresa o empresas asignadas, último ingreso.
     - **Seguridad:** Cambiar PIN (la "contraseña" de hoy).
     - **Empresa:** Cambiar de empresa, si tiene más de una.
     - **Accesos:** Abrir la app Admin (solo el estudio).
     - Lo que falta (correo, teléfono, foto, etc.) **no se muestra**: queda anotado en "Previstos para más adelante".
     - Abajo de todo, **Cerrar sesión** en rojo, con confirmación.
  3. **Facturador sin usuarios (modo un dispositivo):** el perfil muestra "Este dispositivo", con **Cambiar PIN del dispositivo** y **Bloquear ahora** en lugar de Cerrar sesión.
  4. **Pedidos (hoy sin usuarios):**
     - El perfil muestra el nombre del vendedor (editable ahí) y el código del dispositivo.
     - La sección "Vendedor" de Ajustes pasa al perfil.
     - Cerrar sesión y PIN no se muestran todavía: llegan cuando el vendedor sea un usuario de la empresa (con la base de datos).
  5. Un solo componente compartido en `shared/` para que las tres apps se vean iguales.
- **Dudas:**
  - "Contraseña": ¿seguimos con el PIN de números por ahora, y la contraseña con letras llega con el servidor?
  - Pedidos: ¿querés que ya tenga ingreso con usuario y PIN (vendedor creado como cargador de la empresa), o esperamos a la base de datos? Propuesta: esperar, porque sin servidor el usuario solo existiría en ese celular.
- **Decidido:**
  - Lo que todavía no existe no se muestra en la app; queda solo en la lista de "Previstos para más adelante".
  - Se usan las propuestas: por ahora la "contraseña" es el **PIN**, y la contraseña con letras llega con el servidor.
  - **Pedidos** sigue sin ingreso de usuario hasta la base de datos.
- **Estado:** aplicado el 26/11/2026. Además, Pedidos abre en "Mis notas de pedido" (antes abría directo en el flujo, sin barra de abajo).

### 2. Timbrado protegido según las reglas de la DNIT

- **Pedido:** hoy la fecha de fin del timbrado se puede modificar. Revisar las reglas de la DNIT: los datos del timbrado no deberían poder cambiarse una vez cargados y activados; solo darse de baja por término o por el motivo que corresponda.
- **Lo que dicen las fuentes:**
  - El timbrado electrónico **no tiene fecha de fin de vigencia** (preguntas frecuentes de e-Kuatia de la DNIT; RG 23/19, art. 12). La numeración llega hasta 9.999.999 por establecimiento, punto y tipo de documento, y después se reinicia.
  - Es **un solo timbrado para todos los tipos de documento**. Los establecimientos, los puntos de expedición y los tipos se habilitan en Marangatu.
  - En el XML (`gTimb`) solo va la **fecha de inicio** (`dFeIniT`), no la de fin.
  - Una guía de terceros (Fazapp) dice que vence cada año, pero no cita una fuente oficial. Conviene confirmarlo en Marangatu → Datos del timbrado.
- **Lo que permite hoy la app:**
  - Quien puede editar timbrados (maestro u operador) cambia la fecha de fin en cualquier momento.
  - Con el timbrado sin usar, también el número y la fecha de inicio.
  - Puede cambiar el próximo número de cada tipo (solo hacia adelante si ya se usó) y quitar tipos que no tienen documentos.
  - El KuDE muestra "Fin de vigencia" si se cargó una.
- **e-Kuatia (sistema propio, como esta app) y e-Kuatia'i (facturador gratuito de la DNIT):**
  - Los dos son facturación electrónica por SIFEN. En los dos casos el timbrado electrónico se pide en Marangatu después de habilitarse como facturador electrónico.
  - e-Kuatia'i solo sirve para quien tiene **un establecimiento y un punto de expedición**. El sistema propio no tiene ese límite.
  - Ninguna fuente encontrada distingue la vigencia del timbrado entre los dos: la regla "sin fecha de fin" se refiere al timbrado electrónico en general.
  - **Falta confirmarlo** en Marangatu → Datos del timbrado, en un caso de cada tipo.
- **Decisiones del usuario:**
  - Gestionan timbrados (cargar, activar, agregar un tipo, dar de baja) **solo el admin maestro y el admin del cliente**. Los demás, incluido el operador del estudio, **solo ven qué timbrado está activo**.
  - Si un timbrado activado tiene un error: **se da de baja y se carga uno nuevo**. Después de activarlo no se puede hacer ningún cambio.
  - **La fecha de fin no se quita todavía**, hasta confirmar si es necesaria.
- **Propuesta (ajustada):**
  1. **Fecha de fin:** por ahora queda, pero solo se carga **antes de activar**. Una vez activo no se modifica. Se revisa cuando se confirme la regla.
  2. **Estados:**
     - **Cargado:** sin activar; se puede corregir todo.
     - **Activo:** bloqueado.
     - **Dado de baja:** definitivo; queda en el historial.
     - Al activar se pide confirmar con PIN: "Después no se puede modificar".
  3. **Activo = bloqueado:** no se pueden cambiar el número, las fechas, los tipos ni los números de cada tipo.
     - Para saltar números se usa la **inutilización**.
     - Solo se permite **agregar** un tipo de documento que se habilitó después en Marangatu. Queda en la auditoría y nunca se quita.
  4. **Dar de baja:**
     - Motivo obligatorio:
       - cambio de timbrado otorgado por la DNIT;
       - cese de actividades;
       - cancelado por la DNIT;
       - error de carga;
       - vencimiento;
       - otro, con detalle.
     - Pide PIN y queda en la auditoría.
     - No se puede deshacer, y desde ese momento no se emite con ese timbrado.
  5. **Solo uno activo:** activar otro **da de baja** al anterior con el motivo "Cambio de timbrado". Ya no queda inactivo para volver a activarlo.
  6. **Permisos:**
     - El permiso de timbrados pasa a ser del maestro y del admin del cliente. El operador del estudio lo pierde.
     - En el Facturador, los demás usuarios ven solo el timbrado activo, sin botones.
  7. **KuDE y PDF:** sin cambios mientras no se confirme la regla de la fecha de fin.
- **Estado:** aplicado el 26/11/2026. La fecha de fin sigue (solo se carga antes de activar) hasta confirmarla en Marangatu.

### 4. Establecimientos y puntos de expedición dentro del timbrado

- **Pedido:** los puntos de expedición y el establecimiento son parte del timbrado y se definen según las reglas de la DNIT. En la app figuran como dato de la empresa: investigar y cambiar todo lo relacionado.
- **Cómo funciona según la DNIT:**
  - **Establecimientos:** son los locales **declarados en el RUC**, cada uno con código (001, 002…) y dirección. Se dan de alta en el RUC, no en el timbrado.
  - **Puntos de expedición:**
    - se crean en Marangatu **dentro de cada establecimiento**;
    - el sistema les asigna el código (001, 002…);
    - pueden crearse desde la misma solicitud de timbrado.
  - **Timbrado electrónico:**
    - al solicitarlo en Marangatu (Facturación y Timbrado → Solicitudes → Documentos Electrónicos → Generar) se elige el **establecimiento**, los **puntos de expedición** y, **para cada punto**, los **tipos de documento** habilitados (factura, nota de crédito, nota de débito…);
    - al aprobarse llegan el timbrado y el CSC por el buzón Marandu.
  - **Numeración:**
    - el número del documento es `establecimiento-punto-número` (001-002-0000045);
    - el número de 7 dígitos corre **por timbrado, establecimiento, punto y tipo de documento**, hasta 9.999.999.
  - **CDC y XML:**
    - el establecimiento (`dEst`) y el punto (`dPunExp`) van dentro del CDC y del grupo del timbrado (`gTimb`);
    - deben coincidir exactamente con lo aprobado en Marangatu, o SIFEN rechaza el documento.
- **Cómo está hoy la app:**
  - **Configuración:** la empresa tiene **un solo** establecimiento y **un solo** punto (`establishment`, `point`), cargados en el alta (paso 2) y editables en la ficha de la empresa.
  - **Numeración:** el timbrado guarda los tipos y el próximo número de cada tipo, pero **no** por establecimiento ni por punto.
  - **Uso:** la empresa los aplica al número del documento, al CDC y a la inutilización.
  - **Consecuencias:**
    - no se puede tener más de un punto (por ejemplo, dos cajas o dos vendedores emitiendo);
    - cambiar el establecimiento en la ficha cambiaría los números y los CDC siguientes sin control.
- **Propuesta:**
  1. **Establecimientos en la empresa, como en el RUC:**
     - lista con código, nombre (opcional) y dirección;
     - se cargan al dar de alta la empresa;
     - una vez usados en un timbrado activo no se modifican, solo se dan de baja.
  2. **Puntos de expedición y tipos dentro del timbrado.** Cada timbrado tiene sus **habilitaciones**: establecimiento → puntos → tipos habilitados en cada punto → próximo número de cada tipo. Por ejemplo:
     - 001 / 001: factura, nota de crédito, nota de débito;
     - 001 / 002: factura, nota de crédito.
  3. **Mismas reglas que el cambio 2:**
     - **Cargado:** se puede corregir todo.
     - **Activo:** bloqueado. Solo se puede **agregar** un punto o un tipo que se habilitó después en Marangatu; queda en la auditoría y nunca se quita.
     - **Dado de baja:** definitivo.
  4. **Numeración por timbrado + establecimiento + punto + tipo.** La inutilización pide establecimiento, punto, tipo y rango.
  5. **Punto de cada usuario:**
     - el admin asigna a cada funcionario su punto de expedición (por ejemplo, Caja 1 = 001-001, Caja 2 = 001-002);
     - si tiene más de uno, lo elige al emitir;
     - el punto en uso se ve arriba, junto a la empresa.
  6. **Dirección en el KuDE y el XML:** la del **establecimiento** donde se emite.
  7. **Alta guiada (Admin):**
     - el paso 2 pasa a "Establecimientos" (código y dirección);
     - en el paso del timbrado se cargan los puntos y los tipos de cada uno.
  8. **Ficha de la empresa:**
     - se quita la edición de "Establecimiento y punto";
     - en su lugar, la lista de establecimientos y, dentro del timbrado, sus puntos.
  9. **Migración:** el establecimiento y el punto que hoy tiene cada empresa pasan a ser la primera habilitación de su timbrado. Los números siguen desde donde iban.
- **Relación:** se aplica junto con el **cambio 2** (timbrado protegido), porque cambia la misma estructura.
- **Decidido:** se usan las propuestas.
  - El punto se asigna **por usuario**.
  - Cada punto lleva un **nombre** ("Caja 1", "Caja 2"…) además del código.
  - El KuDE muestra la dirección del establecimiento que emite.
- **Estado:** aplicado el 26/11/2026.
- **Dudas:**
  - ¿El punto de expedición se asigna por usuario (propuesta) o por dispositivo (cada celular o caja es un punto)?
  - Si una empresa tiene varios establecimientos, ¿el KuDE muestra solo la dirección del establecimiento que emite, o también la de la casa matriz? Propuesta: la del establecimiento que emite.
  - ¿Los puntos llevan un nombre interno (por ejemplo, "Caja 1" o "Vendedor Ana") además del código, para reconocerlos fácil?

