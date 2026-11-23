# Cambios previstos

Lista de cambios anotados que **todavía no se programaron**. Se aplican solo cuando el usuario lo autoriza.
Formato: lo que pidió el usuario, la propuesta y las dudas abiertas.

## Pendientes

### 1. IVA debajo del monto al emitir

- **Pedido:** al emitir una factura aparece el monto final. Debajo, en letra más chica, mostrar el IVA 10 % y/o 5 % según corresponda.
- **Propuesta:**
  - Mostrar solo las tasas que tienen IVA. Ejemplos: `IVA 10 %: Gs 16.363 · IVA 5 %: Gs 1.047`, o solo `IVA 10 %: Gs 16.363`.
  - Si todo es exento: `Exenta de IVA`.
  - En dólares, el IVA en dólares (con 2 decimales).
  - Para nota de crédito y nota de débito, lo mismo. Autofactura y remisión no llevan IVA: no se muestra.
  - Lugares (confirmado): el paso **Productos** (monto grande arriba), el paso **Revisión** (total) y la pantalla de **¡Listo!** después de emitir.
  - Cuando hay 5 % y 10 % juntos, agregar el total (confirmado): `IVA 10 %: Gs 16.363 · IVA 5 %: Gs 1.047 · Total IVA Gs 17.410`.
- **Estado:** definido, listo para aplicar.

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
- **Estado:** definido, salvo la confirmación de la fecha de fin, que no bloquea aplicar lo demás.

## Aplicados

(Todavía ninguno con este método.)
