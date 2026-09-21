// 015: captura PCM mono para el fallback WAV del grabador de notas de voz
// (navegadores cuyo MediaRecorder solo ofrece WebM). Sin caché (el SW no
// cachea nada), así que siempre se sirve la versión actual.
class PcmRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-recorder", PcmRecorder);
