# Plan desde cero — Meta + CRM, sin comprar un chip

Escrito para retomar el control. Un solo documento: qué tenés, qué está hecho,
qué falta y en qué orden. Reemplaza como guía operativa a los documentos
anteriores (que quedan como referencia de detalle).

## Tu mapa de activos (y qué hacer con cada uno)

| Activo | Qué es | Veredicto |
|---|---|---|
| App **Corscan CRM** (`2262662764507422`) | La app real del producto. Configuración completa y verificada por API. | La única que importa. |
| Apps **ST-dev** y **ST-dev - Test1** | Experimentos tuyos del pasado. | **Sospechosas de haber creado la WABA de prueba.** No borrar nada hasta el sondeo de la Fase 0. |
| App **Masterbrand** | Otro proyecto tuyo. | Ídem: sondear primero, decidir después. |
| WABA **Test WhatsApp Business Account** (`1596377001926229`) | La de prueba, con el `+1 555-659-8579`. Sin método de pago (correcto). | El emisor para el App Review — si el sondeo encuentra su panel. |
| WABA **Corscan Ingenieria — WhatsApp Business App** | El número nuevo del negocio, vivo en el celular. | **Candidato a coexistence. NO TOCAR hasta la Fase D.** |
| WABA **Corscan Ingeniería** (vacía, sin números) | Resto de algún experimento. | Ignorar. No molesta. |
| Tu número personal | Tu WhatsApp de toda la vida. | Solo como **receptor** en las pruebas y videos. Recibir mensajes no registra nada ni toca tu cuenta. |
| El número nuevo del negocio | En la app WhatsApp Business del otro teléfono. | Se conecta por **coexistence al final del plan**, nunca antes, nunca por la vía normal. |

La sensación de "cosas de más" es correcta pero no es grave: son tres apps
viejas y una WABA vacía. Nada de eso rompe nada por existir. **No borres nada
todavía** — si una de esas apps resulta dueña de la WABA de prueba, borrarla
destruiría justo lo que necesitamos.

## Lo que YA está hecho (no volver a hacer)

- Verificación de negocio: **aprobada**.
- App Corscan CRM: privacidad, términos, eliminación de datos, ícono,
  categoría, OAuth, dominios del SDK — **todo verificado contra la API de Meta**.
- Llamadas reales con `whatsapp_business_management`: **hechas**.
- CRM conectado al número de prueba con **token permanente de usuario del
  sistema** (el aviso de "Additional approval needed" no impidió generarlo).
- Webhook configurado en el panel (falta confirmar el campo `messages` suscrito).
- Código de coexistence: **escrito, testeado y deployado**.
- Guiones de los dos videos y textos del formulario: **escritos**
  (en [meta-app-review.md](meta-app-review.md)).

Lo único que falta del App Review: **una llamada exitosa de
`whatsapp_business_messaging`** (un mensaje que salga de verdad) y **grabar los
videos**. Todo lo demás es camino ya recorrido.

## Fase 0 — El sondeo (2 minutos, decide todo)

Entrá al dashboard de **cada una de las otras tres apps** (ST-dev,
ST-dev - Test1, Masterbrand) → WhatsApp → **API Setup** → desplegable **From**.

- Si en alguna aparece **+1 555-659-8579** → hipótesis confirmada: esa app es
  la dueña del panel de la WABA de prueba. Seguí a la **Fase A**.
- Si en ninguna aparece → **Fase B**.

## Fase A — El panel vive en otra app (el camino feliz)

1. En esa app, campo **To** → **Manage phone number list** → agregá tu número
   **personal**. Llega un código de 6 dígitos a tu WhatsApp; cargalo ahí.
   ⚠️ El matching es exacto: para Argentina el formato que cuenta es el del
   `wa_id` (`549...`). Máximo 5 lugares y no se liberan.
2. En **Corscan CRM** (no en la app vieja): pasá la app a **Live** y confirmá
   que el campo `messages` del webhook esté **Subscribed**.
3. Desde tu celular personal: `wa.me/15556598579` → mandá un mensaje.
   Debe aparecer en la **Bandeja del CRM**. (Eso valida webhook + Live.)
4. **Respondé desde el CRM.** Con tu número en la allowlist, la respuesta sale
   y llega a tu celular. En ese momento: `whatsapp_business_messaging` ✅ —
   los dos requisitos de App Review quedan cumplidos.
5. Nota: la allowlist es un atributo del número, así que el CRM (que envía con
   su propio token de Corscan CRM) puede usarla aunque la gestione el panel de
   la app vieja. La llamada queda atribuida a Corscan CRM, que es lo que Meta
   mira.

## Fase B — Si ningún panel muestra el número (los caminos sin chip)

En orden de preferencia:

1. **¿Tenés un teléfono fijo?** (casa u oficina, que no esté en WhatsApp).
   Los fijos se registran con verificación por **llamada de voz** y el alta
   completa va por API, sin panel: `POST /{waba_id}/phone_numbers` en la WABA
   vacía → `request_code` (VOICE) → `verify_code` → `register`. Con número
   real no hay allowlist. Gratis: las respuestas dentro de la ventana de 24 h
   no requieren método de pago.
2. **Bug report a Meta** (texto listo en el chat / dashboard → WhatsApp →
   Resources → Bug tool) y esperar el arreglo del panel. Sin fecha, pero
   legítimo: tenemos evidencia de que la API funciona y el panel no.
3. Si aparece cualquier otra línea a la que tengas acceso legítimo (una SIM
   vieja en un cajón, el fijo de un familiar directo con su permiso), sirve
   igual que el fijo: solo tiene que recibir una llamada o SMS una vez.

## Fase C — Videos y envío del App Review

Con el circuito funcionando (A o B), grabar los dos videos siguiendo los
guiones de [meta-app-review.md](meta-app-review.md) y enviar. Recordatorios:

- `DEMO_TOOLS_ENABLED` apagado antes de grabar.
- UI subtitulada en inglés, ventana < 1440 px.
- La pantalla de Configuration del webhook (la URL es secreta) no aparece.
- Un video por permiso; sin cortes.

## Fase D — Tech Provider y coexistence (el final)

1. Aprobado el App Review → completar **Tech Provider onboarding** (el tablero
   ya muestra Business verification ✅ / App review pendiente).
2. Recién entonces, conectar el **número del negocio** con el botón
   **"Conectar sin perder el celular"** del CRM (coexistence, ya implementado).
3. Riesgo conocido a presupuestar: hay reportes de que el portfolio dueño de la
   app aparece deshabilitado en el selector de coexistence. Si pasa, la
   pregunta va a Direct Support antes de tocar nada.

## Limpieza (al final de todo, no ahora)

Cuando el App Review esté aprobado y coexistence funcionando:

- Borrar las apps viejas que NO resulten dueñas de la WABA de prueba.
- La app dueña de la WABA de prueba se queda mientras el número de prueba siga
  siendo útil.
- La WABA vacía puede quedarse o borrarse; no afecta nada.
- **Nunca** usar el botón "Delete your business" de Test account: borra el
  portfolio entero con la verificación adentro.
