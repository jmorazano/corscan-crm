# Borrador: párrafo nuevo para la política de privacidad (feature 040)

> **BORRADOR, no publicado.** Destino: https://corscan.com.ar/privacidad (la
> política vive fuera de este repo; es la URL de `APP_PRIVACY_URL`). Se publica
> solo con el OK del dueño. Es una plantilla específica del producto, no
> asesoramiento legal: conviene revisarla con un profesional antes de
> publicarla (ver «Notas para el dueño»).
>
> Ubicación sugerida: dentro de la sección que hoy habla de proveedores y
> terceros que reciben datos, o como subsección propia después de ella.

---

## Asistentes de inteligencia artificial conectados por el propietario

Vocero permite, de forma opcional, que el propietario de una empresa conecte al
CRM un asistente de inteligencia artificial que él mismo elige (hoy, Claude de
Anthropic, a través de Claude Desktop, claude.ai o Claude Code), usando el
estándar abierto MCP y una autorización con inicio de sesión en Vocero. Esta
función viene **desactivada por defecto** en cada empresa: solo el propietario
puede activarla en Ajustes → Asistentes, elegir en una pantalla de permiso a
qué empresas da acceso y revocarlo en cualquier momento. Una vez conectado, el
asistente tiene acceso de **solo lectura** a datos de esa empresa: métricas y
cifras de mensajes, campañas y sus resultados, contactos (por ejemplo nombre,
teléfono, usuario de Instagram, email y etiquetas), el pipeline de leads, la
actividad del agente de IA del CRM y **los textos de las conversaciones** de
WhatsApp e Instagram, incluidas las transcripciones de notas de voz y los
resúmenes de adjuntos que el propio CRM ya hubiera generado. No se entregan
archivos adjuntos, credenciales ni claves de integraciones, ni el contenido de
las conversaciones de prueba del sistema. El asistente no puede enviar
mensajes ni modificar ningún dato.

Los datos que el asistente consulta se transmiten a la cuenta del propietario
en ese proveedor y, desde ese momento, quedan sujetos a las condiciones de uso y
a la política de privacidad de ese proveedor, no a las de CorScan. CorScan no
envía información al asistente por iniciativa propia: solo responde a las
consultas que el asistente hace en nombre del propietario autorizado. En cada
consulta el sistema vuelve a verificar que la conexión siga vigente, que el
usuario siga siendo propietario de la empresa y que el acceso siga activado.
Los códigos de acceso se guardan únicamente en forma de hash y vencen en poco
tiempo; las conexiones que no se usan durante 90 días vencen, y cambiar o
restablecer la contraseña del usuario corta todas sus conexiones. CorScan
conserva durante 90 días un registro de cada consulta (fecha, conexión, usuario,
empresa y tipo de consulta), sin guardar el contenido devuelto, y el propietario
puede verlo en Ajustes → Asistentes.

Las personas que escriben a un negocio por WhatsApp o Instagram son titulares
de los datos que figuran en esas conversaciones. Cada negocio que usa Vocero
decide si activa esta función y con qué asistente, y es el **responsable del
tratamiento** de los datos de sus clientes; CorScan actúa como **encargado del
tratamiento**, siguiendo las instrucciones del negocio y limitando el acceso a
lo descrito arriba. Quien ejerza derechos de acceso, rectificación o supresión
sobre sus datos puede hacerlo ante el negocio con el que se comunicó o ante
CorScan en [COMPLETAR: correo o canal de contacto de privacidad]; borrar un dato
en Vocero no elimina las copias que el propietario ya hubiera consultado a
través de su asistente, que se rigen por las condiciones del proveedor de ese
asistente.

---

## Notas para el dueño (revisar con un abogado antes de publicar)

1. **Transferencia internacional de datos.** Los servidores de Anthropic
   (y, según el plan del usuario, sus subencargados) están fuera de la
   Argentina, principalmente en EE. UU. Verificar el encuadre en la Ley
   25.326 (art. 12: la transferencia a países sin nivel de protección
   adecuado exige consentimiento del titular o garantías contractuales) y en
   la normativa de la AAIP vigente (decisiones sobre países adecuados,
   cláusulas contractuales modelo). Definir si el esquema es «transferencia»
   o «cesión/encargo» según quién envía el dato: acá lo lleva el propietario
   por su decisión, pero conviene que un profesional confirme si eso alcanza o
   si el negocio necesita base legal o aviso adicional frente a sus clientes
   finales.
2. **Rol de cada parte.** El párrafo dice negocio = responsable y CorScan =
   encargado. Confirmar que es así en cada contrato (en especial si CorScan
   opera la instancia propia, donde también podría ser responsable) y si hace
   falta un contrato o anexo de encargo de tratamiento que mencione esta
   función, el switch por empresa y la lectura de textos de conversaciones.
3. **Contrato o términos con el negocio.** Evaluar si los Términos de Vocero o
   el contrato con cada cliente (por ejemplo Altos de Calamuchita y Altos de la
   Ciudad) deben mencionar: que es opcional y apagada por defecto, que el
   propietario asume la decisión de llevar datos a su proveedor de IA, que
   CorScan no responde por el tratamiento posterior en ese proveedor, y la
   obligación del negocio de informar a sus clientes finales en su propia
   política.
4. **Aviso a los titulares finales.** Quien escribe por WhatsApp o Instagram no
   interactúa con CorScan. Revisar si el negocio debe actualizar su aviso de
   privacidad (finalidad, destinatarios, transferencia) y si hay base de datos
   a inscribir o actualizar en el Registro Nacional de Bases de Datos de la
   AAIP.
5. **Condiciones del proveedor del asistente.** El tratamiento posterior
   depende del plan del usuario en Anthropic (retención, uso para mejorar
   modelos, subencargados), que puede ser distinto entre planes personales y
   de empresa. Verificar las condiciones vigentes antes de afirmar algo más
   específico en la política; el borrador evita prometerlas a propósito. Por
   ahora solo se prueban y documentan Claude Desktop y Claude Code.
6. **Datos sensibles.** Los chats pueden contener datos sensibles que escriben
   los propios clientes finales (salud, por ejemplo). Confirmar si el aviso
   debe decir algo sobre ellos.
7. **Plazos y cifras del borrador.** Los 90 días (vencimiento por falta de uso
   y conservación del registro) y el vencimiento corto de los códigos de
   acceso salen de la especificación de la feature 040. Si cambian en la
   implementación, ajustar el texto. «Revocar» corta el acceso a datos
   futuros pero no recupera lo que el asistente ya leyó.
8. **Coherencia con el resto de la política.** Revisar que no contradiga lo que
   la política ya dice sobre proveedores de IA del agente (OpenRouter), sobre
   retención y sobre eliminación de datos (`/eliminacion-de-datos` o
   equivalente), y que el contacto de privacidad sea el mismo en todas las
   secciones.
9. **Marcadores pendientes.** [COMPLETAR] razón social de CorScan y datos de
   contacto de privacidad; [COMPLETAR] fecha de «última actualización» de la
   política al publicar este cambio. No se inventaron nombres legales.
