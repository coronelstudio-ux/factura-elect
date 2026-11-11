# Firma electrónica de los documentos (SIFEN)

Resumen de cómo se firma cada factura electrónica y cómo se integrará en este sistema.
Fuentes: manual técnico y guías de la DNIT (consultadas por búsqueda) y el código de la librería abierta `facturacionelectronicapy-xmlsign` (revisado línea por línea). **Confirmar con la DNIT y con el prestador antes de implementar.**

## Cómo funciona

- La firma **no la hace una app externa** documento por documento. Un **prestador habilitado** (lista oficial en acraiz.gov.py; entre ellos Confirma, ITTI y SOS Tecnología) emite el **certificado**, y es **nuestro sistema** el que firma cada XML con él.
- Para SIFEN se usa el certificado **F1**: un archivo **`.p12` / `.pfx` con contraseña**, con el **RUC de la empresa**, válido por **un año**. Según guías comerciales, el F2 (token USB) y el F3 (firma en la nube) **no reemplazan** al F1 para facturar (confirmar con el prestador).
- El mismo certificado sirve para **firmar** y para **autenticarse** ante SIFEN (TLS 1.2 con autenticación mutua). Por eso el archivo y su contraseña **nunca** pueden estar en el navegador ni en el celular.
- **e-Kuatia'i** (sistema gratuito de la DNIT) gestiona el certificado sin costo; con sistema propio, cada empresa contrata el suyo.

## Datos técnicos de la firma

| Elemento | Valor |
|---|---|
| Estándar | XMLDSig *enveloped* (la firma va dentro del XML) |
| Nodo firmado | `<DE>` (su atributo `Id` es el CDC) |
| Algoritmo de firma | `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256` |
| Resumen | `http://www.w3.org/2001/04/xmlenc#sha256` |
| Transformaciones | `enveloped-signature` y `xml-exc-c14n#` |
| Canonicalización | `http://www.w3.org/2001/10/xml-exc-c14n#` |
| KeyInfo | `X509Data` / `X509Certificate` con el certificado |

## Flujo de una factura

1. Armar el XML del documento (según el XSD vigente).
2. **Firmar** el nodo `<DE>` con el certificado de la empresa.
3. Calcular el **QR** con el `DigestValue` de la firma: `nVersion`, `Id`, `dFeEmiDE` (hex), `dRucRec` o `dNumIDRec`, `dTotGralOpe`, `dTotIVA`, `cItems`, `DigestValue` (hex del base64), `IdCSC`, y `cHashQR` = SHA-256 de esos parámetros + CSC.
4. Agregar el QR al XML (`gCamFuFD/dCarQR`).
5. Enviar a SIFEN por mTLS (síncrono o por lote) y guardar la respuesta.

La app ya calcula el QR exactamente así (`buildQrUrl` en `shared/core.js`, igual que la librería de referencia); hoy el `DigestValue` es simulado.

## Integración en este sistema

```
App Facturador ──► Servidor (base de datos) ──► Servicio Firmador ──► SIFEN (mTLS)
                                               · .p12 de cada empresa, cifrado
                                               · firmar(xml) → xml firmado
```

- **Punto de conexión ya preparado:** `FE.T.Firmador.firmar({ empresa, cdc, payload })` en `shared/tenant.js`. Hoy devuelve un `DigestValue` simulado; el Facturador ya emite a través de él. Cuando exista el servidor, esa función enviará el XML al servicio Firmador y devolverá el XML firmado y su `DigestValue`.
- **Servicio Firmador:** un servicio propio y aislado, que es el único que puede leer los certificados.
  - Cada empresa sube su `.p12` una vez.
  - El archivo y la contraseña se guardan **cifrados**, con una clave en un gestor de secretos (KMS o HSM).
  - El servicio recibe un XML y devuelve el XML firmado, y registra cada firma en la auditoría.
  - Si un cliente usa otro tipo de firma (nube, HSM), se cambia solo esta pieza.
- **En la app Admin** (ya hecho) se registran los **datos** del certificado: titular, RUC, prestador, tipo, serie y vigencia. Con eso se generan las alertas de vencimiento (30 días antes y vencido). No se guarda el archivo ni la contraseña.
- **Librerías de referencia** (Node, licencia MIT): `facturacionelectronicapy-xmlgen` (XML), `-xmlsign` (firma con `xml-crypto` y `node-forge`), `-qrgen` (QR), `-setapi` (envío a SIFEN) y `-kude` (PDF).

## Preguntas para el prestador / la DNIT

1. ¿El F1 se entrega solo como `.p12`, o también en token? ¿Se puede exportar a un servidor?
2. Costo, plazo de emisión y requisitos para empresas y personas físicas.
3. ¿El mismo certificado sirve para todos los establecimientos y puntos de la empresa?
4. ¿Un estudio puede firmar en nombre del cliente con el certificado del cliente? ¿Qué mandato hace falta?
5. Procedimiento de renovación sin cortar la facturación.
6. Confirmar que F2 y F3 no sirven para SIFEN.
