# Verificación de la app de Google (quitar «app no verificada»)

Google muestra «This app hasn't been verified by Google» cuando una app
publicada pide permisos **sensibles** sin estar verificada. Los de Calendar
lo son; `drive.file` (Sheets) no. Esta guía es para el operador.

## Estado de lo que depende del código y del sitio (11-oct-2026)

- [x] Permisos mínimos: Calendar pide `calendar.calendarlist.readonly`,
      `calendar.freebusy` y `calendar.events` (ya NO `calendar.readonly`).
      Sheets pide solo `drive.file`. Ninguna conexión arrastra permisos de
      otra (sin `include_granted_scopes`).
- [x] Política de privacidad con la sección «Datos de Google» y la
      declaración de Limited Use: <https://corscan.com.ar/privacidad#google>
- [x] Home pública que describe la app y enlaza la política:
      <https://crm.corscan.com.ar/>

## 1. Ajustar el consent screen (Google Auth Platform)

1. **Marca** (*Branding*):
   - Nombre: `Corscan CRM` · logo (opcional; si lo subís, también se revisa).
   - Página principal: `https://crm.corscan.com.ar`
   - Política de privacidad: `https://corscan.com.ar/privacidad`
   - Condiciones del servicio: `https://corscan.com.ar/terminos`
   - **Dominios autorizados**: dejá SOLO `corscan.com.ar`. Quitá cualquier
     otro (hubo uno ajeno, `ad-dashboard-oqyc.vercel.app`).
2. **Acceso a los datos** (*Data Access*): que queden exactamente
   `openid`, `.../auth/userinfo.email`,
   `.../auth/calendar.calendarlist.readonly`, `.../auth/calendar.freebusy`,
   `.../auth/calendar.events` y `.../auth/drive.file`. **Quitá
   `calendar.readonly`** si está.
3. **Dominio verificado**: `corscan.com.ar` tiene que estar verificado en
   Google Search Console con la MISMA cuenta que administra el proyecto
   (propiedad de dominio por DNS, o prefijo de URL de `https://corscan.com.ar`).

## 2. Enviar a verificación

**Google Auth Platform → Centro de verificación** (*Verification Center*) →
**Preparar para la verificación**. Google pide, por cada permiso sensible,
una justificación y un video. Textos sugeridos (en inglés, que es lo que
revisan más rápido):

**calendar.calendarlist.readonly**
> Corscan CRM lets a business connect its Google Calendar so its WhatsApp
> assistant can offer and book appointments. We list the user's calendars
> (only those they can write to) so the business owner can choose which
> calendar receives the bookings. We do not read events.

**calendar.freebusy**
> To offer appointment times to the business's customers, we query only the
> busy/free intervals of the calendar the owner selected, within the
> business hours they configure. We never read event titles, descriptions
> or attendees.

**calendar.events**
> When a customer confirms a time slot, we create one event on the selected
> calendar with the customer's name and phone, and we delete that same
> event if the booking is cancelled from the CRM. We only create and delete
> events created by Corscan CRM.

**drive.file** (no sensible, pero lo describen igual)
> The business picks a spreadsheet with the Google Picker (or lets the app
> create one). We append one row per payment receipt a customer sends, and
> we read the spreadsheets the business selected (prices, availability) so
> the assistant answers with current data. No other Drive file is accessible.

## 3. Video de demostración (YouTube, «No listado»)

En la consola solo `calendar.events` figura como sensible: el video y la
justificación son para ese permiso. Justificación lista para pegar (902/1000):

```
Corscan CRM is a WhatsApp CRM for small businesses. When a business connects its Google Calendar, our assistant offers free time slots to the business's customers over WhatsApp and books the slot the customer confirms.

We use calendar.events only to: (1) create one event on the calendar the business owner selected, with the customer's name, phone and booking note, when a customer confirms a slot; and (2) delete that same event if the business cancels the booking from the CRM. We never read, edit or delete events we did not create. Availability comes from calendar.freebusy (busy/free only).

Narrower scopes are not sufficient: calendar.app.created only works on calendars created by our app, but businesses need bookings in the calendar they already use; calendar.events.owned excludes calendars shared with the owner with write access, which businesses commonly use for their team's bookings.
```

### Antes de grabar (una vez)

1. **Idioma de Google en inglés** (temporal): <https://myaccount.google.com/language>
   con la cuenta dueña del calendario. Así la pantalla de consentimiento sale
   en inglés. Al terminar, lo volvés a español.
2. Empresa: **«Negocio de Juan Morazano»** en `crm.corscan.com.ar`. Revisado
   en producción el 24-nov-2026: Calendar «Turnos Corscan CRM» conectado,
   lunes 9 a 19, agente prendido, WhatsApp reconectado y entregando.
   ⚠️ **«El agente puede agendar turnos por su cuenta» está APAGADO**: hay que
   encenderlo en Integraciones → Google Calendar (Guardar) o en el paso 6 el
   agente informa horarios y deriva, sin crear el evento. Volvelo a como
   estaba al terminar.
3. En Google Calendar, en «Turnos Corscan CRM», creá un evento **«Busy»
   mañana 10:00–11:00**: sirve para mostrar que ese horario no se ofrece.
4. Un celular para escribirle al WhatsApp del negocio, en una conversación
   con la IA prendida, sin atención humana pendiente y donde **nadie del
   equipo haya escrito en los últimos 10 minutos** (si no, el agente calla a
   propósito). **Hacé una prueba completa antes de grabar** y cancelá ese turno.
5. Elegí un día con horario de atención: si mañana es sábado o domingo, usá
   el lunes en el evento «Busy» y en el mensaje.
6. Chrome en una sola ventana, barra de direcciones visible, zoom 110–125 %.
   Grabación: ⌘⇧5 → «Grabar toda la pantalla». Opcional: Duplicación del
   iPhone (macOS) para mostrar el chat del celular al costado.

### Guion (≈3 min). Subtítulos/voz en inglés porque la UI está en español

| # | Qué mostrar | Subtítulo / voz (inglés) |
|---|---|---|
| 1 | `crm.corscan.com.ar` → clic en «Política de privacidad» → bajar a «Datos de Google» | "Corscan CRM is a WhatsApp CRM for small businesses. This is our homepage and privacy policy, including how we handle Google user data." |
| 2 | Iniciar sesión → Integraciones → Google Calendar (se ve conectado) | "A business owner connects their Google Calendar from Integrations." |
| 3 | Ir a `crm.corscan.com.ar/api/integrations/google-calendar/connect` (reconecta SIN perder la configuración) → elegir cuenta → **pantalla de consentimiento: parar 5 s y hacer zoom en la barra de direcciones (`client_id=821087396643-…`) y en los permisos** → Continue | "This is the OAuth consent screen for Corscan CRM. The client ID is visible in the address bar. We request calendar.events, plus non-sensitive scopes to list calendars and read free/busy times." |
| 4 | De vuelta en el CRM: el selector de calendario con «Turnos Corscan CRM» | "The owner chooses which calendar receives the bookings." |
| 5 | Tarjeta «Vista previa: próximos horarios libres» + pestaña de Google Calendar con el evento «Busy» de mañana 10:00 | "We only read busy/free intervals. Tomorrow 10:00 is busy in Google Calendar, so it is not offered." |
| 6 | En el celular: «Hola, quiero agendar una llamada para mañana» → el agente ofrece horarios (sin las 10:00) → elegir uno → confirma. Mostrar la conversación en la Bandeja del CRM | "A customer asks for an appointment over WhatsApp. The assistant offers free slots and books the one the customer confirms." |
| 7 | Google Calendar → refrescar → abrir el evento nuevo (título «Turno: …» y descripción; hoy la descripción termina en «Agendado desde Vocero CRM», un nombre distinto al de la pantalla de permisos) | "calendar.events is used to create exactly one event on the selected calendar, with the customer's name, phone and note." |
| 8 | CRM → Integraciones → Google Calendar → «Turnos agendados desde el CRM» → Cancelar → refrescar Google Calendar: desapareció | "If the business cancels the booking in the CRM, we delete that same event. We never read, edit or delete events we did not create." |
| 9 | Mostrar el botón «Desconectar» (sin tocarlo) y `myaccount.google.com/permissions` | "The business can disconnect at any time from the CRM or revoke access from their Google account." |

Subí el video a YouTube como **No listado** y pegá el enlace en el
formulario. Después, volvé el idioma de Google a español y borrá el evento
«Busy».

## 4. Qué esperar

- Verificación de marca: 2–3 días hábiles. Permisos sensibles: de unos días
  a algunas semanas; Google responde por email y suele pedir aclaraciones.
- Mientras tanto la app sigue funcionando: quien conecta ve el aviso y entra
  por *Avanzado → Ir a Corscan CRM*.
- Con solo `drive.file` (Sheets), al no pedir permisos sensibles, el aviso no
  debería aparecer ni siquiera antes de la verificación.
