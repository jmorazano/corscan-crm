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
| ~~WABA "Corscan Ingeniería" vacía~~ | **No existe.** La tercera fila de Business Manager es la entrada de la app móvil (mismo número), no una WABA. WABAs reales hay dos: la de prueba y la `1777760663660067` del celular. | El 555 necesita una **WABA nueva** creada desde Business Manager. |
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

## Fase B — El camino principal: número 555 de negocio (sin chip, sin panel)

**Resultado de la investigación (verificado contra doc oficial):** Meta permite
reclamar hasta **dos números 555 de negocio** gratis por business — números
reales de la plataforma, NO el test number. Diferencias clave con el de prueba:

- **Sin allowlist de 5 destinatarios** (el 131030 no existe acá).
- Se verifican solos (no hay SMS que recibir → no hace falta SIM).
- Las conversaciones de servicio en ventana de 24 h no requieren método de pago.
- Único trámite: aprobar el **display name** antes de enviar (con el negocio
  verificado suele ser rápido).

Y lo mejor: se reclama desde **WhatsApp Manager** (Business Manager), que en
esta cuenta funciona perfecto — no toca el panel roto del App Dashboard.

**Pasos:**

1. WhatsApp Manager (`business.facebook.com/wa/manage`) → portfolio Corscan
   Ingeniería → la WABA **vacía** "Corscan Ingeniería" → Phone numbers → Add.
2. En el alta, elegir la opción del **número provisto por Meta (555)**.
3. Display name: "Corscan" (debe corresponder al negocio). Enviar a aprobación.
4. Registrar el número en Cloud API por API (`POST /{phone_id}/register`).
5. `POST /{waba_id}/subscribed_apps` con el token de Corscan CRM (ya sabemos
   que funciona) y asignar la WABA al usuario del sistema.
6. Conectar el CRM a ese número (conexión manual, como ya se hizo).
7. Desde el celular personal, escribirle al 555 → aparece en la Bandeja →
   responder desde el CRM → `whatsapp_business_messaging` ✅.

Si WhatsApp Manager no ofreciera la opción 555 en la cuenta (rollout regional
sin confirmar), los fallbacks quedan: bug report + caso en Business Support
Home contra el asset WABA huérfana (nunca contra el portfolio).

## Lo que la investigación descartó (no gastar más tiempo acá)

- **La teoría "la huérfana bloquea el botón": no confirmada.** El botón muerto
  de "Get new test number" es un bug/freno recurrente de Meta que ocurre
  también en cuentas sin WABA huérfana (rate-limit interno o "test numbers are
  currently unavailable"). Un caso casi idéntico creó una app nueva en el mismo
  portfolio y el botón siguió muerto. Crear más apps no lo arregla.
- **Borrar la test WABA aislada: no existe** (sin DELETE en la API, sin opción
  en Business Manager). La huérfana es inerte: sin panel no envía, no factura,
  no molesta. **Dejarla quieta.**
- **Borrar el test number** (basura en WhatsApp Manager): evidencia
  contradictoria y sin casos de que revivir el botón. Opcional, valor bajo.
- El botón **"Delete your business"** sigue prohibido para siempre en apps
  atadas al portfolio real: borra el portfolio con la verificación adentro.

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
