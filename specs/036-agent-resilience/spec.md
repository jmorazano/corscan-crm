# 036 — El agente no deja chats colgados (envío, ventana del equipo y mensajes masivos)

Pedido del dueño (13-oct-2026), a partir del reporte de Altos de Calamuchita:
«con 4 a 8 conversaciones simultáneas el agente deja de responder en algunas
mientras responde en otras».

## Diagnóstico (producción, 14 días, ≈960 entrantes)

- **No es rendimiento.** Latencia del agente p50 ≈ 14 s con 1, 2–3 y ≥ 4
  chats activos (máx. 37 s); pico real de 7 chats simultáneos; una réplica,
  pool de 10, sin turnos colgados.
- **El episodio del 8-oct 20:20**: el dueño mandó desde el celular el mismo
  aviso («Se me libero este 👇» + enlace) a ~8 contactos. La regla de 031
  («el equipo escribió → la IA calla N min») silenció esos 8 chats; los que
  respondieron con preguntas («¿Precio?», «¿Cuál es el precio por dos
  noches?») no recibieron respuesta del agente, mientras el agente sí
  respondía en los chats que el dueño no había tocado.
- **Al vencer la ventana del equipo el agente no retoma**: el mensaje que
  llegó durante la ventana queda sin respuesta salvo que el cliente vuelva a
  escribir.
- **Un 5xx/corte de Meta al enviar la respuesta del agente no se reintenta**
  (Gonzalo, 13-oct 10:25: la respuesta quedó como error en el hilo).

## Objetivos (decisión del dueño, 13-oct-2026)

1. **Reintento del envío**: un error transitorio de Meta (5xx, red, timeout)
   al mandar la respuesta del agente se reintenta antes de rendirse. Toda
   llamada a Graph tiene un tope de tiempo.
2. **Retomar al vencer la ventana del equipo — solo si hace falta**: si el
   cliente escribió mientras el equipo atendía y nadie le contestó, al vencer
   la ventana el agente retoma **solo si el cliente quedó esperando una
   respuesta**. Un «gracias», «ok», «barbaro» o un cierre no se contestan.
3. **Los mensajes masivos del equipo no callan al agente**: el mismo texto
   que el equipo manda a varios chats a la vez, sin que esos clientes hayan
   estado escribiendo, es una difusión, no «alguien atendiendo». El agente
   atiende las respuestas.

## Criterios de aceptación

- **AC1.1** Si Meta falla con 5xx o la red se corta al enviar, el agente
  reintenta (2 reintentos: ~2 s y ~5 s). Si el segundo intento sale, el
  cliente recibe UN mensaje y no queda línea de error.
- **AC1.2** Si fallan los tres intentos queda la línea «La respuesta de la IA
  no salió…» con el texto (como en 031). Los errores definitivos (token
  vencido, ventana cerrada, error 4xx de Meta) NO se reintentan.
- **AC1.3** Toda llamada a Graph corta a los 20 s (las subidas de medios, a
  los 120 s) y cuenta como «Meta no disponible».
- **AC2.1** Equipo escribe → cliente pregunta dentro de la ventana → nadie
  responde → al vencer la ventana el agente responde (sin volver a
  presentarse), y queda «La IA retomó la conversación».
- **AC2.2** Igual que AC2.1 pero lo pendiente del cliente es solo un acuse
  («Barbaro», «Gracias!», «👍»): el agente no responde (corte determinístico
  antes del modelo) y queda la línea con el motivo.
- **AC2.3** Si alguien del equipo contestó antes de que venza la ventana, al
  vencer no pasa nada.
- **AC2.4** El modelo, al retomar, puede elegir no responder (`none`) cuando
  el cliente no quedó esperando nada; se ve el motivo en el hilo.
- **AC2.5** Un reinicio del servidor no pierde las retomas pendientes: al
  arrancar se reprograman las ventanas del equipo que vencieron hace poco o
  están por vencer.
- **AC2.6** Al retomar con la ventana de 24 h cerrada no se deriva a atención
  humana (el equipo ya estaba ahí): simplemente no responde.
- **AC3.1** El mismo texto, enviado por el equipo a ≥ 3 conversaciones de la
  empresa en 30 min, a clientes que no escribieron en la hora previa, no
  calla al agente: la respuesta del cliente la atiende el agente.
- **AC3.2** Un mensaje del equipo que responde a un cliente que estaba
  escribiendo sigue callando al agente aunque el mismo texto haya ido a otros
  chats («Ya se reservó, disculpas»).
- **AC3.3** El agente sabe que la difusión la escribió el equipo (sección
  «INTERVENCIÓN DEL EQUIPO» del prompt), no se vuelve a presentar como si no
  hubiera historial.
- **AC3.4** El panel de la bandeja no dice «la IA vuelve a las…» por una
  difusión ya detectada.

## Fuera de alcance

- Colas externas o varias réplicas (Constitución II: in-process alcanza; la
  medición no muestra cuello de botella).
- Idempotencia del envío ante un 5xx que Meta SÍ procesó: Graph no tiene
  clave de idempotencia; el riesgo (un duplicado excepcional) se acepta
  frente al chat mudo.
