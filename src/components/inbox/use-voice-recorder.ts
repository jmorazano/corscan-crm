"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav, pickRecorderMimeType } from "@/lib/audio-record";

/**
 * Grabador de notas de voz (015, US3). Tap para grabar / tap para enviar.
 *
 * Camino principal: PCM por AudioWorklet → WAV 16 kHz mono codificado en el
 * cliente. Es el formato más robusto para cualquier modelo de transcripción
 * (sin contenedor ni códec que decodificar) y el reproductor muestra la
 * duración real. El MP4 fragmentado de MediaRecorder (Chrome) se reproducía
 * con 0:00/0:00 y el modelo alucinaba frases sobre audio que no decodificaba.
 * Respaldo (sin AudioWorklet): MediaRecorder en `audio/mp4` u `audio/ogg`;
 * nunca WebM (el proveedor no lo acepta).
 */

export type RecorderState = "idle" | "requesting" | "recording" | "uploading" | "error";

export type RecorderApi = {
  state: RecorderState;
  elapsedMs: number;
  error: string | null;
  supported: boolean;
  start: () => Promise<void>;
  /** Detiene y entrega el blob a `onBlob`. */
  stop: () => Promise<void>;
  /** Descarta lo grabado. */
  cancel: () => void;
  clearError: () => void;
};

const PERMISSION_COPY =
  "Necesitamos permiso para usar el micrófono. Activalo en los ajustes del navegador (en la app instalada: Ajustes del teléfono → Safari/Chrome → Micrófono).";

export function useVoiceRecorder(opts: {
  maxMs: number;
  onBlob: (blob: Blob, meta: { mimeType: string; durationMs: number }) => Promise<string | null>;
}): RecorderApi {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const ctxRef = useRef<AudioContext | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const nodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onBlobRef = useRef(opts.onBlob);
  onBlobRef.current = opts.onBlob;
  const maxMsRef = useRef(opts.maxMs);
  maxMsRef.current = opts.maxMs;
  const stopRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        window.isSecureContext
    );
  }, []);

  const release = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (nodeRef.current) {
      try {
        nodeRef.current.disconnect();
      } catch {
        // ya desconectado
      }
      nodeRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.stop();
    }
    chunksRef.current = [];
    pcmRef.current = [];
    release();
    setElapsedMs(0);
    setState("idle");
  }, [release]);

  const finish = useCallback(
    async (blob: Blob, mimeType: string) => {
      const durationMs = Math.round(performance.now() - startedAtRef.current);
      release();
      setState("uploading");
      const err = await onBlobRef.current(blob, { mimeType, durationMs });
      setElapsedMs(0);
      if (err) {
        setError(err);
        setState("error");
      } else {
        setState("idle");
      }
    },
    [release]
  );

  const stop = useCallback(async () => {
    if (state !== "recording") return;
    const rec = recorderRef.current;
    if (rec) {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      chunksRef.current = [];
      await finish(blob, mimeRef.current);
      return;
    }
    // Camino WAV (AudioWorklet / ScriptProcessor).
    const rate = ctxRef.current?.sampleRate ?? 48000;
    const wav = encodeWav(pcmRef.current, rate, 16000);
    pcmRef.current = [];
    await finish(new Blob([wav], { type: "audio/wav" }), "audio/wav");
  }, [state, finish]);
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (state === "recording" || state === "requesting") return;
    setError(null);
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? PERMISSION_COPY
          : name === "NotFoundError"
            ? "No encontramos un micrófono en este dispositivo"
            : "No se pudo iniciar la grabación"
      );
      setState("error");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    pcmRef.current = [];

    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    try {
      if (Ctx) {
        const ctx = new Ctx();
        ctxRef.current = ctx;
        // iOS crea el contexto suspendido hasta un gesto: estamos dentro del tap.
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        if (ctx.audioWorklet) {
          await ctx.audioWorklet.addModule("/pcm-recorder-worklet.js");
          const node = new AudioWorkletNode(ctx, "pcm-recorder");
          node.port.onmessage = (e: MessageEvent<Float32Array>) => {
            pcmRef.current.push(e.data);
          };
          source.connect(node);
          node.connect(ctx.destination);
          nodeRef.current = node;
        } else {
          const proc = ctx.createScriptProcessor(4096, 1, 1);
          proc.onaudioprocess = (e) => {
            pcmRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
          };
          source.connect(proc);
          proc.connect(ctx.destination);
          nodeRef.current = proc;
        }
      } else {
        const mime =
          typeof MediaRecorder !== "undefined"
            ? pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t))
            : null;
        if (!mime) throw new Error("sin formato de grabación aceptado");
        mimeRef.current = mime;
        const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorderRef.current = rec;
        rec.start(1000);
      }
    } catch {
      release();
      setError("No se pudo iniciar la grabación");
      setState("error");
      return;
    }

    startedAtRef.current = performance.now();
    setElapsedMs(0);
    setState("recording");
    tickRef.current = setInterval(() => {
      const ms = performance.now() - startedAtRef.current;
      setElapsedMs(ms);
      if (ms >= maxMsRef.current) void stopRef.current();
    }, 250);
  }, [state, release]);

  // La app pasa a segundo plano (iOS suspende la pestaña): mejor enviar lo
  // grabado que perderlo.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && state === "recording") {
        void stopRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [state]);

  useEffect(() => release, [release]);

  return {
    state,
    elapsedMs,
    error,
    supported,
    start,
    stop,
    cancel,
    clearError: () => {
      setError(null);
      if (state === "error") setState("idle");
    },
  };
}
