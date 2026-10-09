# Google Sheets — paso a paso en Google Cloud (para el operador)

Google Sheets usa **la misma app OAuth de Google** que Google Calendar
(`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, ver
[google-calendar-gcp.md](google-calendar-gcp.md)). Cada empresa la conecta
aparte desde **Integraciones → Google Sheets**. Tiempo estimado: 10 minutos.

Permiso que pide: **`drive.file`** (no sensible). Vocero solo puede abrir las
planillas que la empresa elige con el selector de Google o que crea él mismo;
nunca ve el resto del Drive. No hace falta volver a verificar la app.

## 1. Habilitar las APIs

Menú ☰ → **APIs y servicios** → **Biblioteca**, y habilitá:

1. **Google Sheets API**
2. **Google Picker API** (el selector de archivos)

## 2. Pantalla de consentimiento: sumar el permiso

**Google Auth Platform** → **Acceso a los datos** → **Agregar o quitar
permisos** → marcá `.../auth/drive.file` → **Actualizar** → **Guardar**.
Es un permiso no sensible: Google no pide verificación nueva.

## 3. Cliente OAuth: URI de redirección y origen

**Google Auth Platform** → **Clientes** → el cliente web de Vocero:

- **URIs de redireccionamiento autorizados** → agregar EXACTA:
  `<APP_BASE_URL>/api/integrations/google-sheets/callback`
- **Orígenes autorizados de JavaScript** → agregar `<APP_BASE_URL>`
  (el selector pide el permiso desde el navegador).

## 4. API key del selector

**APIs y servicios** → **Credenciales** → **Crear credenciales** → **Clave
de API**. Después, en **Editar clave de API**:

- **Restricciones de aplicaciones** → *Sitios web* → `<APP_BASE_URL>/*`
- **Restricciones de API** → *Restringir clave* → solo **Google Picker API**

La clave va al navegador: es pública por diseño, por eso se restringe.

## 5. Número del proyecto

**Panel** del proyecto (o ⚙ Configuración del proyecto) → **Número del
proyecto** (12 dígitos).

## 6. Variables de entorno (runtime, no build)

```
GOOGLE_PICKER_API_KEY=AIza...
GOOGLE_CLOUD_PROJECT_NUMBER=123456789012
```

Sin estas dos, la empresa igual puede conectar y **crear** la planilla de
comprobantes, pero no elegir una existente ni agregar planillas de consulta.

## Cómo lo usa cada empresa

1. **Conectar con Google** (la cuenta dueña de las planillas).
2. **Comprobantes**: «Crear planilla nueva» (columnas sugeridas) o «Elegir una
   planilla existente» + pestaña. La fila 1 son las columnas; las
   indicaciones de cómo completarlas van en el conocimiento del agente.
3. **Planillas que consulta el agente**: «Agregar planilla» → pestaña → para
   qué sirve.

Ojo: con `drive.file` el acceso es de la CUENTA conectada. Si se reconecta
con otra cuenta, hay que volver a elegir las planillas.
