# Google Calendar — paso a paso en Google Cloud (para el operador)

La integración Google Calendar de Vocero funciona con **una app OAuth de
Google por instancia** (tuya, del operador) y **una conexión por empresa**
(cada empresa autoriza su propia cuenta desde Integraciones → Google
Calendar). Esta guía cubre la parte tuya: crear la app en Google Cloud y
cargar dos variables de entorno. Tiempo estimado: 15 minutos.

## 0. Qué vas a necesitar

- Una cuenta de Google con la que administrar el proyecto de Google Cloud
  (puede ser la de la agencia; NO hace falta que sea la del negocio).
- La URL pública de la instancia (`APP_BASE_URL`, p. ej.
  `https://crm.tudominio.com`). La URI de redirección se construye a partir
  de ella y tiene que coincidir **exactamente**.

## 1. Crear (o elegir) el proyecto

1. Entrá a <https://console.cloud.google.com/> con tu cuenta.
2. Arriba a la izquierda, selector de proyecto → **Nuevo proyecto** →
   nombre sugerido: `Vocero CRM` → **Crear**. Esperá a que quede activo y
   seleccionalo.

## 2. Habilitar la API de Google Calendar

1. Menú ☰ → **APIs y servicios** → **Biblioteca**.
2. Buscá **Google Calendar API** → **Habilitar**.

## 3. Pantalla de consentimiento OAuth (branding + audiencia)

En **APIs y servicios** → **Pantalla de consentimiento de OAuth** (en la
consola nueva aparece como "Google Auth Platform" → **Descripción general**
→ **Comenzar**):

1. **Información de la app**: nombre visible (p. ej. `Vocero CRM`), correo
   de asistencia. Este nombre es el que ven las empresas en la pantalla
   "X quiere acceder a tu cuenta".
2. **Audiencia / Tipo de usuario**: **Externo** (salvo que TODAS las
   empresas usen cuentas de un mismo Google Workspace tuyo: ahí "Interno"
   evita la advertencia y no requiere publicar).
3. **Datos de contacto**: tu email.
4. Aceptá las políticas y **Crear**.
5. **Permisos (scopes)** → **Agregar o quitar permisos**. Marcá exactamente:
   - `openid`
   - `.../auth/userinfo.email` (email)
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
   Los dos de calendario son "sensibles" (no "restringidos"): no exigen la
   auditoría de seguridad de terceros. Guardá.
6. **Publicar la app** (Audiencia → **Publicar la app** / "In production").
   ⚠️ Esto es IMPORTANTE aunque no pidas verificación: mientras la app
   esté en estado **"Testing"**, (a) solo los "usuarios de prueba" que
   agregues pueden conectar, y (b) **los refresh tokens caducan a los 7
   días**: la integración se cae sola cada semana y la empresa ve
   "Requiere reconexión". Publicada, Google muestra una pantalla de
   "app no verificada" (el usuario pulsa *Avanzado → Ir a Vocero CRM*) pero
   la conexión es permanente. Podés pedir la verificación más adelante para
   quitar esa advertencia (requiere una página pública de política de
   privacidad en tu dominio y un video corto del flujo).

## 4. Crear las credenciales (ID de cliente OAuth)

1. **APIs y servicios** → **Credenciales** → **Crear credenciales** →
   **ID de cliente de OAuth**.
2. Tipo de aplicación: **Aplicación web**. Nombre: `Vocero CRM (prod)`.
3. **Orígenes autorizados de JavaScript**: podés dejarlo vacío (el flujo es
   server-side); si querés, agregá `https://crm.tudominio.com`.
4. **URI de redireccionamiento autorizados** → **Agregar URI**:

   ```text
   https://crm.tudominio.com/api/integrations/google-calendar/callback
   ```

   Reemplazá el dominio por tu `APP_BASE_URL`. Sin barra final, con https,
   exactamente ese path. Si tenés un entorno de staging, agregá también su
   URI (Google acepta varias).
5. **Crear**. Copiá el **ID de cliente** (`….apps.googleusercontent.com`) y
   el **Secreto del cliente** (`GOCSPX-…`). El secreto se muestra una sola
   vez: guardalo en tu gestor de contraseñas.

## 5. Cargar las variables en la instancia

En tu plataforma de hosting (Railway/Coolify → Variables) o en el `.env`
de la Ruta B, en **runtime** (no hace falta rebuild):

```bash
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
```

Reiniciá el servicio. A partir de ahí, en **Integraciones → Google
Calendar** de cada empresa aparece el botón **Conectar con Google**.

## 6. Conectar una empresa (lo hace el propietario de la empresa)

1. Entrar como propietario → **Integraciones** → **Google Calendar** →
   **Conectar con Google**.
2. Elegir la cuenta de Google del negocio (la que tiene el calendario de
   turnos). Si aparece "Google no verificó esta app": **Avanzado → Ir a
   Vocero CRM (no seguro)**. Marcar los permisos y **Continuar**.
3. De vuelta en Vocero: estado **Conectada**, cuenta y calendario
   principal. Elegir otro calendario si corresponde, ajustar **Reglas de
   turnos** (días/franjas, duración, margen, anticipación, horizonte,
   instrucciones para el agente) y **Guardar reglas**.
4. Revisar la **Vista previa** de horarios libres: es exactamente lo que el
   agente va a ofrecer.
5. Probarlo: desde un WhatsApp escribirle al número del negocio "quiero un
   turno para el jueves" → el agente ofrece horarios → elegir uno → el
   evento aparece en el Google Calendar y el turno en la lista de la
   integración.

## 6b. Verificar el dominio en Search Console (para la verificación de la app)

Cuando pidas la verificación de la app OAuth (para quitar el aviso "app no
verificada"), Google exige que el dominio de la app esté verificado en
**Google Search Console** con la misma cuenta que administra el proyecto.
Vocero sirve el archivo de verificación por vos:

1. Entrá a <https://search.google.com/search-console> con la cuenta del
   proyecto de Google Cloud → **Agregar propiedad** → tipo **Prefijo de
   URL** → `https://crm.tudominio.com` (con https, sin barra final).
2. Método **Archivo HTML** → **Descargar**. El archivo se llama
   `google<token>.html` (por ejemplo `google1234abcd5678ef90.html`) y
   contiene `google-site-verification: google<token>.html`. No lo subas a
   ningún lado: solo necesitás el nombre.
3. En Railway/Coolify agregá la variable (runtime, sin rebuild) y reiniciá:

   ```bash
   GOOGLE_SITE_VERIFICATION=google1234abcd5678ef90.html
   ```

4. Comprobá en el navegador que
   `https://crm.tudominio.com/google1234abcd5678ef90.html` responde el texto
   `google-site-verification: google1234abcd5678ef90.html` (sin login, sin
   redirección). Después, en Search Console, **Verificar**.
5. Dejá la variable puesta para siempre: Google vuelve a comprobar el
   archivo periódicamente y, si desaparece, retira la verificación.
6. En Google Cloud → **Google Auth Platform → Branding** agregá el dominio
   en **Dominios autorizados** (`tudominio.com`) y completá los enlaces de
   página principal, política de privacidad y términos que la verificación
   pide.
7. **El nombre de la app debe coincidir con la página de inicio.** Google
   rechaza la verificación con "The app name configured for your OAuth
   consent screen does not match the app name on your home page" si la URL
   de "Application home page" no muestra ese mismo nombre. Vocero lo
   resuelve con la identidad pública de la instancia (runtime, sin
   rebuild):

   ```bash
   APP_PUBLIC_NAME=Corscan CRM              # EXACTAMENTE el "App name" del consent screen
   APP_PRIVACY_URL=https://tudominio.com/privacidad
   APP_TERMS_URL=https://tudominio.com/terminos
   ```

   Con eso, `https://crm.tudominio.com/` muestra (sin login ni redirección)
   una landing con ese nombre en el título de la pestaña y en el
   encabezado, más los enlaces legales. Comprobalo en una ventana de
   incógnito antes de pulsar "I have fixed the issues".

El método de etiqueta `<meta>` no sirve en Vocero: la página raíz redirige
al login y Search Console no sigue redirecciones.

## 7. Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `Error 400: redirect_uri_mismatch` al conectar | La URI del paso 4.4 no coincide con `APP_BASE_URL` | Copiar la URI exacta (https, sin barra final) en la credencial |
| `Error 403: access_denied` / "app no verificada" y no deja seguir | App en modo Testing y la cuenta no es usuario de prueba | Publicar la app (paso 3.6) o agregar la cuenta como usuario de prueba |
| Cada semana pasa a "Requiere reconexión" | App en modo Testing (refresh tokens de 7 días) | Publicar la app (paso 3.6) y reconectar |
| "Requiere reconexión" tras cambiar la contraseña de Google o quitar el acceso desde la cuenta | Google revocó el refresh token | **Reconectar con Google** en la tarjeta de conexión |
| La tarjeta dice "No habilitada" | Faltan `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` en runtime | Cargar las variables y reiniciar |
| No aparece el calendario deseado en el selector | La cuenta conectada no tiene permiso de escritura sobre él | Compartir el calendario con la cuenta con permiso "Hacer cambios en eventos" |

## 8. Seguridad (lo que hace Vocero por vos)

- El refresh token y el access token se guardan **cifrados (AES-256-GCM)**
  con la `ENCRYPTION_KEY` de la instancia; nunca salen al navegador ni a
  logs. La UI solo muestra la cuenta y el calendario.
- Solo se piden permisos de lectura de calendarios/ocupación y creación de
  eventos. La disponibilidad se consulta con `freeBusy`: Google devuelve
  solo intervalos ocupados, sin títulos ni asistentes, así que el agente
  **no puede** ver ni contar detalles de otros turnos.
- Desconectar revoca el acceso en Google y borra las credenciales.
- Las conversaciones del Laboratorio jamás tocan el calendario real.
