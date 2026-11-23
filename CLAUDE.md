# Instrucciones para Claude en este repositorio

## Forma de trabajar: cambios previstos

Cuando el usuario diga **"anota los cambios"** (o dicte cambios para más adelante):

1. **No programar.** Anotar cada cambio en `docs/cambios-previstos.md`, numerado, con lo que pidió el usuario y la propuesta.
2. **Mostrar la lista** actualizada después de anotar.
3. **Preguntar** lo que no esté claro y **proponer** una solución concreta para cada punto.
4. **Esperar autorización.** Programar solo cuando el usuario diga "apliquemos los cambios previstos" (o equivalente). Antes, mostrar el plan final.
5. Al aplicar: pruebas (`node tests/run.js` y pruebas en el navegador), documentación, commit y push. Marcar en la lista lo hecho y moverlo a "Aplicados".

En general: evaluar cada pedido y **pedir autorización antes de crear archivos o código**.

## Proyecto

- PWAs sin build ni backend: `admin/`, `facturador/`, `pedidos/`; núcleo en `shared/` (`core.js`, `tenant.js`).
- Datos solo en el dispositivo (`localStorage`). El modelo para el servidor está en `docs/arquitectura-multiempresa.md`.
- Textos de la interfaz en español (voseo, como el resto de la app). Commits en español, cortos y en tiempo presente.
- Al publicar cambios, subir la versión de la caché en el `sw.js` de cada app tocada.
- Pruebas: `node tests/run.js`. Sintaxis: `node --check <archivo>`.
- No subir datos reales de clientes ni de facturas.
