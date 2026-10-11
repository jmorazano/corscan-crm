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

2–4 minutos, con la interfaz en inglés si es posible (o subtitulado). Tiene
que mostrar:

1. La home `crm.corscan.com.ar` y el enlace a la política de privacidad.
2. Login en el CRM → Integraciones → Google Calendar → **Connect with
   Google**: la pantalla de consentimiento con el **nombre de la app y la
   barra de direcciones visibles** (Google exige ver el client ID en la URL)
   y los permisos pedidos.
3. Cada permiso en uso: elegir el calendario (calendarlist), la vista previa
   de horarios libres (freebusy), un turno agendado por el agente que
   aparece en Google Calendar y su cancelación (events).
4. Google Sheets → conectar → elegir planilla con el selector → un
   comprobante enviado por WhatsApp que aparece como fila nueva.
5. Desconectar (y mencionar myaccount.google.com/permissions).

## 4. Qué esperar

- Verificación de marca: 2–3 días hábiles. Permisos sensibles: de unos días
  a algunas semanas; Google responde por email y suele pedir aclaraciones.
- Mientras tanto la app sigue funcionando: quien conecta ve el aviso y entra
  por *Avanzado → Ir a Corscan CRM*.
- Con solo `drive.file` (Sheets), al no pedir permisos sensibles, el aviso no
  debería aparecer ni siquiera antes de la verificación.
