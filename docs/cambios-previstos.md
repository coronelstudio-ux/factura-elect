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
- **Propuesta:**
  1. **Sin fecha de fin.** Se quita el campo. Las fechas de fin que ya están cargadas dejan de usarse: ni vencen el timbrado ni salen en el KuDE.
  2. **Estados:**
     - **Cargado:** sin activar; se puede corregir todo.
     - **Activo:** bloqueado; no se modifica.
     - **Dado de baja:** definitivo; queda en el historial.
     - Al activar se pide confirmar: "Después no se puede modificar".
  3. **Activo = bloqueado:** no se pueden cambiar el número, la fecha de inicio, los tipos ni los números de cada tipo.
     - Para saltar números se usa la **inutilización**, que ya existe y queda registrada.
     - Lo único permitido es **agregar** un tipo de documento que se habilitó después en Marangatu. Queda en la auditoría y nunca se quita.
  4. **Dar de baja:**
     - Botón "Dar de baja" con motivo obligatorio:
       - cambio de timbrado otorgado por la DNIT;
       - cese de actividades;
       - cancelado por la DNIT;
       - error de carga;
       - otro, con detalle.
     - Pide PIN y queda en la auditoría.
     - No se puede deshacer, y desde ese momento no se emite con ese timbrado.
     - Para seguir facturando hay que cargar y activar otro timbrado.
  5. **Solo uno activo a la vez**, como ahora. Activar otro **da de baja** al anterior, con el motivo "Cambio de timbrado". Hoy solo lo deja inactivo y se lo podía volver a activar.
  6. **KuDE y PDF:** solo número de timbrado e inicio de vigencia.
- **Dudas:**
  - ¿Quién puede dar de baja: solo el admin maestro, o también el operador?
  - Si se cargó mal un timbrado y ya se activó, pero todavía no se emitió nada, ¿se permite corregirlo, o se da de baja como "error de carga" y se carga uno nuevo? Propuesta: darlo de baja, para no dejar ninguna puerta de modificación.
  - ¿Confirmás que se quita la fecha de fin? Si en Marangatu tu timbrado sí muestra una, la dejamos solo como dato informativo, sin que bloquee la emisión.

## Aplicados

(Todavía ninguno con este método.)
