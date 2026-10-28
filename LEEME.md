# Tienda Eben-Ezer — sistema para tienda / supermercado

Ventas, inventario con foto e inteligencia artificial, compras, fiados, caja, reportes,
bitácora y copias de seguridad. Funciona sin internet y se actualiza sin tocar los datos.

---

## 1. Cómo abrirlo

**En el computador de la tienda (recomendado):** doble clic en **`Iniciar Tienda.bat`**.
Se abre una ventana negra (el servidor: **no la cierre**) y el navegador en `http://localhost:8080`.
Solo necesita tener instalado Node.js (ya lo tiene).

**En el celular u otro computador (mismo WiFi):** la ventana negra muestra una dirección como
`http://192.168.x.x:8080` y una **clave**. Abra esa dirección en el celular y escriba la clave una sola vez.
Queda con el mismo inventario, ventas y usuarios.

La primera vez pide el nombre de la tienda, crea el usuario administrador y pide el **código de activación**
junto con el correo y la clave de la nube de la tienda.

### Licencia (código de activación)

Los códigos se sacan en la **Consola de licencias** de Global ACCE (`Documents\software\panel-admin.html`),
sección **Eben-ezer**: Demo (8 días), Trial (30 días), Anual (365 días), PRO (permanente) o Test (10 minutos).
Cada código sirve una sola vez y queda a nombre de la cuenta (correo) que lo activó.

- **Al crear la tienda:** se escribe el código, el correo y la clave. Con eso se activa y se conecta la nube.
- **Configuración → Licencia:** muestra el tipo, cuándo vence y cuántos días quedan; ahí se escribe un código nuevo para renovar.
- **Cuando vence:** el programa muestra "La licencia venció" y pide un código nuevo. Los datos no se tocan.
- Faltando 7 días, Inicio avisa. La licencia viaja con la nube: los demás equipos de la tienda quedan activados solos.
- Al activar, la cuenta de la tienda aparece en **Cuentas registradas** del panel.

**Una sola vez:** el proyecto de licencias (`globalacce-37997`) necesita el permiso para la colección `ebe_users`.
Copie el bloque de `reglas-licencias-acce.rules` y péguelo en Firebase → Firestore → Reglas de ese proyecto,
antes de `match /{document=**}`, y toque *Publicar*. No publique ese archivo solo ni el `firestore.rules` de la tienda allá.

> Si Windows pregunta por el firewall al iniciar, permita el acceso en "Redes privadas"
> (solo hace falta para que los celulares entren).

---

## 2. Qué hace

| Módulo | Qué incluye |
|---|---|
| **Vender** | Buscador y lector de código de barras (USB o cámara), productos por peso, descuentos, venta en espera, pago en efectivo / Nequi / Daviplata / tarjeta / transferencia / fiado, pago mixto, cambio, recibo para impresora térmica (58 u 80 mm) y por WhatsApp. `F2` cobrar, `F4` buscar. |
| **Inventario** | Productos con foto, código, categoría, costo, precio, IVA, mínimo y vencimiento. Kárdex por producto. Ajustes con motivo. Importar / exportar CSV. |
| **Foto con IA** | Tome una foto de los productos o del estante y la IA propone nombre, marca, categoría, cantidad y precio, y recorta la foto de cada uno. Usted revisa y guarda. Detecta si el producto ya existe para no duplicarlo. |
| **Factura con IA** | Botón **Factura con IA** en Inicio, Inventario y Compras. Tome una foto por cada hoja de la factura o elija el **PDF de la factura electrónica**. La IA lee proveedor, NIT, número, productos, cajas y pacas (las pasa a unidades), costos con IVA y el total. Usted revisa —con la factura en grande al lado— y toca **Subir al inventario**: crea los productos nuevos, suma existencias, actualiza costos y registra la compra. Marca los renglones que no cuadran, avisa si la factura ya se había subido y guarda la lectura hasta que se suba. |
| **Compras** | Compras a proveedores (pagada, con plata de la caja o a crédito), cuentas por pagar, costo promedio. Se pueden digitar por paca o caja. |
| **Pedido sugerido** | Compras → Pedido sugerido: qué pedir a cada proveedor según lo vendido en 4 semanas y el mínimo de cada producto; se envía por WhatsApp y, cuando llega, se registra como compra con un clic. |
| **Presentaciones** | Un producto puede venderse por unidad, six-pack, paca o caja, cada una con su precio y código. El inventario siempre se lleva en unidades. |
| **Devoluciones** | Desde Caja o Reportes → Devolución: el cliente devuelve algunos productos; vuelven al inventario y el dinero se descuenta primero de lo fiado y el resto sale en efectivo. |
| **Ventas y fiado** | Lo fiado **no cuenta como venta** hasta que el cliente paga: "Ventas" es el dinero que entró (ventas de contado + abonos de fiados). Lo fiado se muestra aparte como "por cobrar". La utilidad, las categorías y los productos sí cuentan toda la mercancía que salió, incluida la fiada. |
| **Clientes y fiados** | Cupo por cliente, cuenta detallada, abonos, cobro por WhatsApp. |
| **Caja** | Apertura con base, gastos, ingresos, retiros, cierre con arqueo (faltante / sobrante) e impresión del cierre. |
| **Reportes** | Ventas, utilidad, medios de pago, categorías, vendedores, productos más vendidos; anular ventas; exportar. |
| **Informes en PDF** | Botones **PDF / Imprimir**: informe de ventas (Reportes), inventario valorizado (Inventario), estado de cuenta (cuenta de cada cliente), cartera (Clientes) y compras. Salen en hoja carta con el encabezado de la tienda; en la ventana de impresión elija la impresora o **Guardar como PDF**. |
| **Asistente IA** | Preguntas en lenguaje normal sobre el negocio ("¿qué debo pedir?", "¿qué no se vende?"). |
| **Bitácora** | Registro de todo lo que hace cada usuario, con verificación de integridad. |

---

## 3. Reglas

**Fijas (no se pueden apagar):**

- Las ventas no se borran: solo se **anulan**, con motivo y responsable.
- Las existencias solo cambian por **movimientos** (venta, compra, ajuste con motivo). No se editan a mano.
- La **bitácora** no se puede editar ni borrar; cada registro va encadenado al anterior y
  "Verificar integridad" detecta cualquier alteración o registro faltante.
- Ningún registro se elimina de verdad: lo "eliminado" queda marcado y en el historial.
- Siempre debe quedar un administrador activo.
- De la caja no puede salir más efectivo del que hay.

**Configurables (Configuración → Reglas):** exigir caja abierta, vender sin existencias, bloquear vencidos,
no vender bajo el costo, descuento máximo sin autorización, cupo de fiado, redondeo del total,
costo promedio, ganancia sugerida, días de aviso de vencimiento, cierre de sesión por inactividad,
intentos de clave.

**Varias tiendas en un mismo equipo:** en la entrada, **Crear cuenta nueva** abre otra tienda con su propio
código de activación, usuarios, inventario y cuenta de la nube. **Cambiar de tienda** pasa de una a otra.
Ninguna se borra al cambiar.

**¿Olvidó la clave?** En la pantalla de entrada toque **Olvidé mi clave**: con el correo y la clave de la nube
de la tienda se pone una clave nueva (queda anotado en la bitácora). Si tampoco recuerda la clave de la nube,
ahí mismo se pide un enlace al correo. Sin nube conectada, la clave la cambia otro administrador en Configuración → Usuarios.

**Permisos por cargo** (Administrador, Supervisor, Cajero, Bodeguero): tabla editable en la misma pantalla.
Cuando un cajero necesita algo que no puede (anular, descuento alto, fiar sobre el cupo, cambiar un precio),
el sistema pide la clave de un supervisor y deja anotado quién autorizó.

Las reglas están escritas en `js/reglas.js` (permisos y reglas) y `js/neg.js` (cómo se aplican).

---

## 4. Dónde quedan guardados los datos (para que no se pierda nada)

1. **En el navegador de cada equipo**, al instante, aunque no haya internet.
2. **En el computador principal**, carpeta `datos/` (archivo `registro.ndjson`): cada cambio se agrega
   al final; nunca se sobrescribe, así que queda el historial completo.
3. **Respaldos completos** en la carpeta `respaldos/`: uno al cerrar cada caja y cada 30 minutos si hubo
   cambios (se conservan los últimos 60).
4. **Copia manual**: Configuración → Copias y nube → *Descargar copia*. Guárdela en una USB o en su correo.
5. **Nube (opcional)**: copia fuera del local, ver punto 6.

> **Importante:** copie de vez en cuando las carpetas `datos/` y `respaldos/` a una USB o a Google Drive.
> Si el computador se daña o se lo roban, lo que solo estaba ahí se pierde. La nube evita ese riesgo.

**Restaurar:** Configuración → Copias y nube → *Restaurar copia*. Une el respaldo con lo que haya
(gana el registro más reciente); no borra nada.

---

## 5. Activar la inteligencia artificial (gratis)

1. Entre a **aistudio.google.com/apikey** con una cuenta de Google y cree una clave de API.
2. En la tienda: Configuración → Inteligencia artificial → pegue la clave → *Probar conexión*.

La clave se guarda solo en ese equipo. La IA necesita internet; el resto del sistema no.
La IA siempre **propone**: nada entra al inventario hasta que una persona revisa y guarda.

---

## 6. Nube con Firebase

Sirve para tener copia fuera del local y entrar desde cualquier parte. **Ya viene conectada** al proyecto
`ebenezer-fiados` (reglas publicadas, página en **https://ebenezer-fiados.web.app**). No hay que pegar nada.

- **Computador principal:** Configuración → Copias y nube → escriba un correo y una clave → *Crear cuenta*. Se hace una sola vez.
- **Celular u otro equipo:** abra `https://ebenezer-fiados.web.app` → *Ya tengo la tienda en la nube* → mismo correo y clave.
  Llegan los usuarios, el inventario y las ventas.

Para publicar cambios del programa (en PowerShell use `firebase.cmd`):
`firebase.cmd deploy --only hosting` y, si cambió `firestore.rules`, `firebase.cmd deploy --only firestore:rules`.

Para pasar la tienda a otro proyecto de Firebase: Configuración → Copias y nube → *Cambiar proyecto*, o cambie `NUBE_DEF` en `js/sync.js`
y `.firebaserc`. No use el proyecto de ACCE PRO (`globalacce-37997`): publicar estas reglas reemplazaría las de ese.

`firestore.rules` hace cumplir en la nube que solo la cuenta dueña lea sus datos, que nada se borre
y que bitácora, kárdex, abonos y movimientos de caja no se puedan modificar.

Mientras un equipo no tenga la nube conectada, la barra de arriba dice **"Sin nube"** en rojo e Inicio muestra
un aviso con el botón **Conectar la nube**. Al crear una tienda nueva se pide conectarla de una vez.
Todos los equipos deben entrar con **el mismo correo y clave**.

---

## 7. Cómo actualizar el sistema

Los datos están separados del programa, así que actualizar no los toca.

1. Reemplace los archivos del programa por los nuevos (**no borre** `datos/` ni `respaldos/`).
2. Suba el número de versión en **dos** lugares, igual en ambos: `version.json` y `T.VERSION` en `js/core.js`.
3. Los equipos abiertos muestran solos el aviso "Hay una versión nueva → Actualizar ahora".

Si una versión nueva necesita tablas nuevas: agréguelas en `ESQUEMA` y suba `VERSION_BD` en `js/db.js`.
Si necesita transformar datos existentes: agregue un paso en `MIGRACIONES` en `js/app.js` (se ejecuta una vez por equipo).
Si agrega archivos `.js`, añádalos también a `index.html` y a la lista de `sw.js`.

---

## 8. Archivos

```
Iniciar Tienda.bat   abre el servidor y el navegador
servidor.js          servidor de la tienda: sirve la app, guarda datos/ y respaldos/
index.html           página única
css/app.css          estilos (tema claro y oscuro)
js/core.js           utilidades, ventanas, formularios, impresión
js/db.js             base de datos local, transacciones, bitácora encadenada
js/reglas.js         permisos, reglas del negocio, usuarios y sesión
js/neg.js            ventas, kárdex, compras, fiados, caja (toda la lógica)
js/ia.js             Gemini: fotos de productos, facturas y asistente
js/sync.js           copia al servidor de la tienda, a la nube y respaldos
js/informes.js       informes en hoja carta para imprimir o guardar en PDF
js/vistas/*.js       pantallas
js/app.js            arranque, entrada, menú, tablero, actualizaciones
firestore.rules      reglas de seguridad de la nube
sw.js, manifest.json, version.json   instalación como app, uso sin internet, versión
datos/, respaldos/   se crean solos — AQUÍ ESTÁ LA INFORMACIÓN DE LA TIENDA
```

---

## 9. Límites que conviene conocer

- **No es facturación electrónica DIAN.** Los recibos son comprobantes internos. Si la tienda está obligada
  a facturar electrónicamente, eso se hace con un proveedor autorizado.
- La cámara para leer códigos de barras solo funciona en navegadores compatibles (Chrome en Android) y con
  conexión segura; por WiFi local use un lector USB o escriba el código. Tomar fotos para la IA sí funciona.
- Las claves de los usuarios son para control interno de la tienda, no seguridad bancaria. No comparta la
  clave del servidor ni deje el WiFi de la tienda abierto a clientes.
- Si se borran los datos del navegador sin tener servidor, nube ni respaldo, se pierde la información de ese equipo.
  Por eso se recomienda abrir siempre con `Iniciar Tienda.bat`.
