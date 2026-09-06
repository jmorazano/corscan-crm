# US-GC-1 — Conectar Google Calendar a mi empresa

Guion E2E de comportamiento (feature 005, US1). Entorno: quickstart 005
(google-mock interceptando `GOOGLE_*`, org A = 111111111, sesión de
propietario `superadmin@vocero.test`).

## Camino feliz

1. Sidenav → **Integraciones**.
   ✅ Página índice con la tarjeta "Google Calendar" en estado "No
   conectada" y botón Abrir.
2. Abrir → **Conectar con Google**.
   ✅ Pasa por la autorización (mock: sin pantalla) y vuelve a
   `/integrations/google-calendar?connected=1`: aviso "Google Calendar
   conectado", tarjeta "Conectada", cuenta `agenda@negocio.test`, calendario
   "Agenda del negocio". Aparecen Reglas, Vista previa y Turnos.
3. BD: `select left(refresh_token_cipher,12), account_email, status from
   calendar_integration`.
   ✅ La fila tiene solo cifrado (jamás `mock-refresh-…` en claro), status
   `connected`. `GET /api/integrations/google-calendar` no contiene tokens.
4. Índice: `GET /api/integrations`.
   ✅ `connected: true`, `status: "connected"`, `accountEmail`.

## Caminos infelices

5. `POST /api/dev/google-mock/state {"nextAuthError":"access_denied"}` →
   Conectar (o Reconectar).
   ✅ Vuelve con `?error=cancelled` y aviso claro; la integración previa
   sigue intacta (o nada queda conectado si no había).
6. Rol equipo (`miembro-t029@vocero.test`): la página se ve, pero sin
   Conectar/Desconectar ni Guardar (cubierto además por
   `tests/unit/integrations-route.test.ts`: PUT/DELETE/connect → 403).
7. `POST /api/dev/google-mock/state {"revokeAll":true}` → Vista previa
   (Actualizar).
   ✅ 502 "reconectá la integración"; la tarjeta pasa a "Requiere
   reconexión" con botón **Reconectar con Google**; el índice lo refleja.
8. Reconectar.
   ✅ Vuelve a "Conectada" conservando calendario y reglas.
9. **Desconectar** → confirmar.
   ✅ Vuelve a "No conectada"; la fila desaparece; el mock registra el
   refresh token revocado (`GET /api/dev/google-mock/state` → `revoked`).

## Última conducción

**5-sep-2026 — VERDE** (google-mock, navegador + API desde la sesión):

- Índice y tarjeta OK; Conectar → `?connected=1`, cuenta y calendario
  correctos; fila con cifrado (`HXC0ywkAIsT3…`), status connected.
- `nextAuthError` → `?error=cancelled`, integración intacta.
- `revokeAll` → agente derivó, availability 502, índice y vista
  `reconnect_required`; Reconectar → `connected` con calendario y
  `slotMinutes=45` conservados.
- Rol equipo: verificado por unit test de rutas (403); la UI oculta los
  botones con `canManage=false`.
- Desconectar (UI, tras los guiones 2 y 3): confirmación inline → aviso
  "Google Calendar desconectado. El agente ya no ofrece turnos", tarjeta
  "No conectada", `integration: null`, índice `connected:false`, el mock
  registró el refresh token revocado; el siguiente inbound que pide turno
  recibe la respuesta genérica del agente (sin sección de agenda).
