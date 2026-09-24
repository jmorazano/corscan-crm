# E2E 022 — Miembros sin configuración · espera del agente por empresa · imágenes en el Entrenador

Entorno: dev server del worktree + mocks (`WA_MOCK_ENABLED=true`, wa-mock +
ai-mock, `AGENT_COALESCE_MS=2000` en `.env` local), usuario
`e2e@vocero.test` (owner de «Negocio de Super Admin Local», org A, agente
«Giuliana», IA configurada, WhatsApp mock `111111111`; y MEMBER de
«Inmobiliaria Demo», org B — el cambio de espacio de 018 convierte al mismo
usuario en miembro sin tocar la BD). La UI se conduce en el Browser pane
(escritorio 1024 px y móvil 375 px); los pasos de API se ejecutan con
`fetch` desde la propia página (misma cookie). Migración 0018 aplicada.

## Guion

### B — Espera antes de responder (owner, org A)

1. **Tarjeta**: `/agent` muestra «Espera antes de responder» debajo de
   Comportamiento, input «Segundos» con placeholder = default de instancia
   (2 en local, 20 en producción) y el hint «Vacío: usa el valor por
   defecto de la instancia (2 s)».
2. **Validación en vivo**: escribir «abc» → «Ingresá un número entero entre
   0 y 120 segundos.» y el botón «Guardar espera» queda deshabilitado; con
   «abc5» tampoco guarda (`replyDelayMs` sigue `null`).
3. **Guardar 5 s**: valor «5» → «Guardar espera» → «Guardado ✓»,
   `GET /api/agent/profile` → `replyDelayMs: 5000`,
   `defaultReplyDelayMs: 2000`; hint «El agente espera 5 s de silencio del
   cliente antes de responder.».
4. **Un mensaje**: `DELETE /api/dev/wa-mock/outbox` → `POST
   /api/dev/wa-mock/inbound` (`phoneNumberId 111111111`) → la respuesta del
   agente aparece en el outbox a los **8,6 s** (5 s de espera + turno con
   compilación de dev).
5. **Ráfaga**: dos inbounds con 2 s de diferencia («hola» + fechas y
   personas) → **UNA** sola respuesta, **5,4 s después del segundo**; 4 s
   más tarde sigue habiendo una sola (con el coalesce viejo de 2 s el
   «hola» se respondía aparte).
6. **Fuera de rango por API**: `PUT {replyDelayMs: -1 | 999999 | 2.5}` →
   422 los tres.
7. **Cero**: `PUT {replyDelayMs: 0}` → 200; un inbound se responde a los
   **285 ms**. `PUT {replyDelayMs: null}` → 200 y vuelve el default.

### C — Imágenes en el Entrenador (owner, org A)

8. **Composer**: en «Entrená a Giuliana» el clip es visible (también en
   móvil), `accept` = audio + `image/jpeg,image/png,image/webp`, pie «Podés
   adjuntar o pegar imágenes · los cambios se pueden deshacer».
9. **Feliz con epígrafe**: escribir «esta es la lista de precios de este
   mes» y adjuntar `lista.jpg` (JPEG válido inyectado por `DataTransfer` en
   el input oculto) → burbuja a la derecha con miniatura + epígrafe +
   «Leyendo la imagen…» (`image-message[data-status=pending]`) → «Lo que
   leyó: LISTA DE PRECIOS 2026 / Mensura: precio desde $150.000 …»
   (`ready`) → respuesta del agente «Leí la imagen y guardé lo que dice como
   conocimiento.» → `GET /api/kb` pasa de 25 a 26 entradas con un bloque
   `source: "trainer"` que empieza con «LISTA DE PRECIOS 2026»; el panel
   ENTRENADOR lista «Nuevo bloque: LISTA DE PRECIOS 2026…» con «Deshacer».
   El composer queda vacío (el epígrafe viajó con la imagen).
10. **Imagen que no se entiende**: `borrosa.png` (el mock devuelve
    `[SIN_CONTENIDO]` ante PNG) → `failed` con «La imagen no tiene
    contenido reconocible» en rojo bajo la miniatura → el agente igual
    responde «No pude leer la imagen. ¿Me lo escribís por acá?» (nunca
    queda mudo).
11. **Rechazos locales** (sin subir): `notas.txt` → «El archivo tiene que
    ser una imagen (JPEG, PNG, WebP) o un audio (…)»; `grande.jpg` de 6 MB
    → «La imagen supera el máximo de 5 MB».
12. **Rechazos de API**: `POST …/messages/image` a una conversación de
    WhatsApp → 409 `not_trainer`; un `.txt` declarado `image/jpeg` → 415
    `unsupported_media` («El archivo no es una imagen JPEG, PNG o WebP
    válida»: manda la firma binaria); sin `file` → 422; conversación
    inexistente → 404.
13. **Pegar**: `ClipboardEvent('paste')` con un JPEG sobre el composer →
    `defaultPrevented` y aparece una burbuja de imagen nueva.
14. **Modelo de visión**: Ajustes → IA muestra «Modelo de visión para
    imágenes (opcional)» junto al de transcripción; guardar
    `google/gemini-2.5-pro` (rotando el token del mock) → «Configuración
    guardada» y `GET /api/settings/ai` → `config.visionModel:
    "google/gemini-2.5-pro"`, `defaults.visionModel:
    "google/gemini-2.5-flash"`.

### A — Miembro (org B vía cambio de espacio)

15. `POST /api/workspaces/switch {org B}` → 200; `GET /api/workspaces`
    → activo = org B con `role: "member"`.
16. **API 403 `forbidden`**: `PUT /api/agent/profile`, `POST /api/kb`,
    `POST /api/templates`, `POST /api/templates/sync`, `PUT
    /api/settings/sending`, `PUT /api/settings/whatsapp`, `POST
    /api/settings/whatsapp/recheck`, `POST /api/lab/runs`, `GET
    /api/trainer/changes`, `POST /api/trainer/clear`, `PUT
    /api/settings/ai`, `PUT /api/settings/branding`. **Lecturas siguen
    200**: `GET /api/agent/profile`, `/api/kb`, `/api/templates`,
    `/api/settings/sending`.
17. **Entrenador oculto**: `GET /api/conversations` → `trainer: null`
    (10 conversaciones reales).
18. **Páginas**: `/settings/ai`, `/agent`, `/integrations/google-calendar`
    y `/lab` terminan en `/inbox`; `/settings` cae en
    `/settings/notifications`.
19. **Escritorio**: la barra lateral solo tiene Bandeja, Pipeline,
    Contactos, Campañas y «Ajustes» (→ `/settings/notifications`); la
    navegación de Ajustes muestra Notificaciones y Mi contraseña; el pie
    dice «Equipo · En línea».
20. **Móvil (375 px)**: la hoja «Más» lista Espacios de trabajo,
    Notificaciones y Mi contraseña — sin Agente, Laboratorio,
    Integraciones ni Ajustes.
21. **Vuelta al owner**: switch a org A → la barra vuelve a mostrar todo y
    `trainer` reaparece en la lista.

## Resultado

Conducido y verde el 24-sep-2026 (todos los pasos anteriores con los
valores indicados). Capturas en la transcripción de la sesión.
