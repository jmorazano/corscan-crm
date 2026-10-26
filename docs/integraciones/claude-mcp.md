# Conversar con el CRM desde Claude — guía del propietario (040)

Conectá Claude (Claude Desktop, claude.ai o Claude Code) a tu CRM y
preguntale por tus números y tus conversaciones en lenguaje natural:
«¿cuántos mensajes llegaron esta semana en cada negocio?», «¿cuántos
respondieron la campaña de octubre?», «¿qué preguntan los que llegan por
anuncios?».

El acceso es de **solo lectura**: Claude no puede enviar mensajes, mover
leads, cambiar etiquetas ni tocar nada. Solo lee.

## Qué necesitás

- Ser **propietario** de la empresa en el CRM (los miembros del equipo no
  pueden conectar asistentes).
- Una cuenta de Claude que permita agregar **conectores personalizados**
  (Claude Desktop o claude.ai). Para Claude Code alcanza con tenerlo
  instalado.

## 1. Activar el acceso en cada empresa

En el CRM: **Ajustes → Asistentes (Claude)** → encendé **«Permitir
asistentes externos»**. Si manejás varias empresas, hacelo en cada una que
quieras consultar (por ejemplo, Altos de Calamuchita y Altos de la Ciudad).
Mientras esté apagado, ningún asistente obtiene datos de esa empresa.

En esa misma pantalla está la **dirección del conector**, algo como
`https://<tu-crm>/api/mcp`, con un botón «Copiar».

## 2. Conectar Claude

**Claude Desktop o claude.ai**

1. Configuración → **Conectores** → **«Agregar conector personalizado»**.
2. Nombre: `Vocero CRM`. URL: la dirección del conector. Agregar.
3. Tocá **«Conectar»**: se abre el CRM en el navegador. Entrá con tu usuario
   de siempre.
4. En la pantalla de permiso, **tildá las empresas** a las que le das acceso
   y tocá **«Permitir»**.
5. En un chat nuevo, activá el conector desde el menú de herramientas y
   preguntá.

**Claude Code**

```bash
claude mcp add --transport http vocero https://<tu-crm>/api/mcp
```

Después, dentro de Claude Code: `/mcp` → `vocero` → **Authenticate** (o
`claude mcp login vocero` desde la terminal) y el mismo permiso en el
navegador.

## 3. Qué le podés preguntar

| Tema | Ejemplos |
|---|---|
| Mensajes | «¿Cuántos mensajes llegaron este mes por WhatsApp y por Instagram?» · «¿Cómo venimos contra el mes pasado?» · «¿Cuánto tarda el agente en responder?» |
| Origen | «¿Cuántas conversaciones llegaron por anuncios?» · «¿Y por comentarios de Instagram?» |
| Campañas | «¿A cuántos les llegó la campaña de reactivación y cuántos respondieron?» · «Pasame la lista de los que respondieron» |
| Conversaciones | «¿Qué chats quedaron en atención humana?» · «Leeme la conversación con Juan Pérez» · «¿Qué preguntaron sobre precios esta semana?» |
| Contactos | «Buscá a María González: ¿en qué etapa está y qué campañas recibió?» |
| Pipeline y agente | «¿Cuántos leads hay en cada etapa?» · «¿Cuántas veces derivó el agente a una persona y por qué?» |

Las cifras son las mismas que ves en **Métricas** y en el detalle de cada
campaña. Si tenés varias empresas conectadas, Claude te dice siempre de cuál
es cada número.

## 4. Qué ve y qué no

- **Ve**: métricas, campañas, contactos (nombre, teléfono, etiquetas, etapa,
  notas del equipo), pipeline, actividad del agente y **los textos de las
  conversaciones**, con las transcripciones de los audios y los resúmenes que
  el CRM ya hizo de imágenes, PDFs y videos.
- **No ve**: los archivos adjuntos en sí, contraseñas ni credenciales, las
  conversaciones de prueba del Laboratorio ni las del Entrenador.
- Lo que Claude lee queda en tu cuenta de Claude, bajo las condiciones de
  Anthropic.

## 5. Controlar y cortar el acceso

En **Ajustes → Asistentes (Claude)** de cada empresa:

- **Conexiones**: qué asistente está conectado, quién lo conectó, desde
  cuándo y su último uso. **«Revocar»** corta el acceso al instante.
- **Qué consultaron**: cada consulta con fecha, usuario y qué se pidió
  («Métricas de mensajes · Esta semana», «Leyó la conversación con …»). Nunca
  se guarda lo que el CRM devolvió. Se conserva 90 días.
- **Apagar el switch** corta el acceso a esa empresa sin borrar la conexión;
  al volver a encenderlo, sigue funcionando.

El acceso también se corta solo si cambiás o restablecés tu contraseña, si
dejás de ser propietario de la empresa o si la conexión pasa 90 días sin
usarse. Para volver a usarlo, conectá de nuevo desde Claude.

## Problemas frecuentes

- **«No tenés empresas que puedas autorizar»**: falta encender «Permitir
  asistentes externos» en esa empresa, o no sos su propietario.
- **«El acceso de asistentes está desactivado en …»**: alguien apagó el
  switch de esa empresa.
- **Claude pide volver a conectar**: la conexión se revocó, cambió la
  contraseña o pasaron 90 días sin uso.
- **«Demasiadas consultas seguidas»**: hay un tope de 60 consultas por
  minuto por conexión; esperá un minuto.
