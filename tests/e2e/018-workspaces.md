# E2E 018 — Espacios de trabajo (varias empresas por usuario)

Entorno: dev server + mocks (`WA_MOCK_ENABLED=true`, wa-mock), BD local con
dos empresas: A = `Negocio de Super Admin Local` (`principal`, número mock
`111111111`) y B = `Inmobiliaria Demo` (`inmobiliaria-demo`, número mock
`222222222`). Identidades: `e2e@vocero.test` (owner de A),
`socio@vocero.test` (owner de B), `superadmin@vocero.test` (plataforma). La
UI se conduce en el Browser pane; los entrantes los entrega el wa-mock por
loopback (`POST /api/dev/wa-mock/inbound` con `phoneNumberId` de B).

## Guion

1. **Una sola empresa = sin rail**: entrar como `e2e` (solo A) → no hay
   `workspace-rail`, la barra lateral dice «CRM · WhatsApp» y
   `GET /api/workspaces` devuelve un solo espacio.
2. **Sumar cuenta existente (propietario)**: entrar como `socio` → Ajustes
   → Equipo → crear cuenta con `e2e@vocero.test` + contraseña temporal →
   409 «Ya existe una cuenta con ese correo» + tarjeta «Sumar esa cuenta a
   esta empresa» → click → «Cuenta sumada ✓» y `e2e` aparece como Miembro
   en la lista. Infeliz (por API, misma sesión): repetir el attach → 409
   `already_member`; `superadmin@vocero.test` → 403 `reserved_email`;
   correo sin cuenta → 404 `user_not_found`; alta normal del correo que
   YA es miembro → 409 `duplicate` con `canAttach: false`.
3. **Rail**: entrar como `e2e` → `workspace-rail` con dos mosaicos en
   orden de antigüedad (A activo con la barra al borde, B con globo rojo
   «5»), tooltips «… · ⌘1» / «… · ⌘2», subtítulo de la barra lateral con
   el nombre de la empresa activa, colores de mosaico distintos aunque
   ambas usen el acento por defecto.
4. **Cambiar (click)**: click en B → overlay «Cambiando a…» → recarga en
   `/inbox` → subtítulo «Inmobiliaria Demo», Bandeja con SOLO las 9
   conversaciones de B, rol «Equipo», mosaico A con globo «36».
   **Aislamiento**: `GET /api/conversations/<id de A>` estando en B → 404.
   Ajustes → WhatsApp de B muestra `222222222` (A tiene `111111111`).
5. **Atajos**: ⌘1 → vuelve a A; Ctrl+2 → va a B (misma recarga que el
   click; el navegador no cambia de pestaña).
6. **Globo en vivo**: parado en A, `POST /api/dev/wa-mock/inbound` a B →
   a los 3 s el mosaico de B pasa de «5» a «6» sin recargar (evento SSE
   `workspace.unread` → refetch).
7. **Dos pestañas**: pestaña 2 en B; en la pestaña 1 ⌘1 (→ A); al volver
   la pestaña 2 a primer plano (`focus`/`visibilitychange`) se recarga sola
   en A. (El pane emulado no emite esos eventos al cambiar de pestaña; se
   dispararon a mano y la recarga ocurrió. Red de seguridad: sondeo cada
   60 s con ≥ 2 espacios.)
8. **Móvil (375 px)**: sin rail (`display: none`), `scrollWidth 375`,
   punto rojo en «Más» (B tiene no leídos) → «Más» muestra la sección
   «Espacios de trabajo» con las dos filas (activa marcada, B con globo
   «6») → tocar B → recarga en B con la Bandeja de B («Nuevo B» arriba).
   Sin botones anidados (`workspace-row button` = 0).
9. **Sesión con empresa inválida**: `session.active_organization_id =
   'org_bogus'` en BD → el siguiente pedido resuelve A (la más antigua) y
   repara SOLO la sesión viva (las 25 sesiones viejas quedan hasta usarse).
10. **Última empresa al entrar**: en B → cerrar sesión → entrar → arranca
    en B (FR-009).
11. **Notificaciones**: Ajustes → Notificaciones con dos espacios muestra
    la nota «este dispositivo recibe los avisos de la última empresa…».
12. **Sumar cuenta existente (super admin)**: entrar como `superadmin`
    (sin rail: una sola membresía) → Administración → empresa A →
    «Agregar usuario» con `compa@vocero.test` → 409 + tarjeta «Sumar esa
    cuenta a esta empresa» → click → «Cuenta sumada ✓», `compa` aparece
    como Miembro de A conservando su contraseña.

## Resultado (23-sep-2026)

Todo ✅ tal como está descrito arriba, en escritorio y a 375 px.
Correcciones durante la prueba: (a) la fila de la hoja «Más» anidaba el
mosaico (`<button>` dentro de `<button>`, error de hidratación) → se
extrajo `WorkspaceAvatar` no interactivo; (b) dos empresas con el acento
por defecto se veían iguales → color estable por id cuando no hay acento
propio; (c) se agregó el sondeo de convergencia de 60 s para pestañas que
no reciben `visibilitychange`. Unit tests nuevos: `workspace-shortcut`
(6), `resolve-active-membership` (7), `workspaces-switch` (4),
`attach-existing-user` (7), `workspaces-routes` (11).
