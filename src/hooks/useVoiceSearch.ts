import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const MAX_LISTENING_MS = 6000;
const SILENCE_AFTER_SPEECH_MS = 850;
const MIN_RECORDING_MS = 450;
const VOICE_RMS_THRESHOLD = 0.018;

export function normalizeVoiceSearchTranscript(value: string) {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "")
    .trim();

  const key = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

  if (key === "sau") {
    return "sal";
  }

  const poncaAliases = new Set([
    "ponca",
    "poncan",
    "poncam",
    "ponka",
    "ponkan",
    "ponkam",
    "poca",
    "pocan",
    "pocam",
    "pokan",
    "pokam",
  ]);

  if (poncaAliases.has(key)) {
    return "poncã";
  }

  return normalized;
}

function silentVoiceSupported() {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function microphoneErrorMessage(error: unknown) {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permita o acesso ao microfone para buscar por voz.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Não encontrei um microfone disponível.";
  }
  return "Não foi possível acessar o microfone. Tente novamente.";
}

function preferredAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  return (
    candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ??
    ""
  );
}

export function useVoiceSearch() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const speechDetectedRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const disposedRef = useRef(false);

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSupported = silentVoiceSupported();

  const clearTimers = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const releaseMicrophone = useCallback(() => {
    clearTimers();

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }

    recorderRef.current = null;
  }, [clearTimers]);

  const stopListening = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const startListening = useCallback(
    async (onTranscript: (transcript: string) => void) => {
      if (!silentVoiceSupported()) {
        setError("Busca por voz silenciosa não está disponível neste navegador.");
        return false;
      }

      const activeRecorder = recorderRef.current;
      if (activeRecorder && activeRecorder.state !== "inactive") {
        activeRecorder.stop();
        return false;
      }

      setError(null);
      chunksRef.current = [];
      speechDetectedRef.current = false;
      lastVoiceAtRef.current = 0;
      disposedRef.current = false;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;

        const mimeType = preferredAudioMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        recorderRef.current = recorder;

        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.2;
        source.connect(analyser);

        const samples = new Uint8Array(analyser.fftSize);

        const watchVoiceLevel = () => {
          if (recorder.state === "inactive") return;

          analyser.getByteTimeDomainData(samples);
          let sumSquares = 0;

          for (let index = 0; index < samples.length; index += 1) {
            const centered = (samples[index] - 128) / 128;
            sumSquares += centered * centered;
          }

          const rms = Math.sqrt(sumSquares / samples.length);
          const now = performance.now();

          if (rms >= VOICE_RMS_THRESHOLD) {
            speechDetectedRef.current = true;
            lastVoiceAtRef.current = now;
          } else if (
            speechDetectedRef.current &&
            lastVoiceAtRef.current > 0 &&
            now - lastVoiceAtRef.current >= SILENCE_AFTER_SPEECH_MS &&
            now - startedAtRef.current >= MIN_RECORDING_MS
          ) {
            recorder.stop();
            return;
          }

          animationFrameRef.current =
            window.requestAnimationFrame(watchVoiceLevel);
        };

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        recorder.onerror = () => {
          setError("Não consegui gravar sua voz. Tente novamente.");
          setIsListening(false);
          releaseMicrophone();
        };

        recorder.onstop = () => {
          const chunks = [...chunksRef.current];
          const recordedType =
            recorder.mimeType || chunks[0]?.type || "audio/webm";
          releaseMicrophone();

          if (disposedRef.current) {
            setIsListening(false);
            return;
          }

          if (!chunks.length) {
            setError("Não consegui ouvir o produto. Toque no microfone e tente novamente.");
            setIsListening(false);
            return;
          }

          void (async () => {
            try {
              const audio = new Blob(chunks, { type: recordedType });
              const body = new FormData();
              body.append(
                "file",
                audio,
                recordedType.includes("mp4") ? "busca.m4a" : "busca.webm",
              );

              const { data, error: functionError } =
                await supabase.functions.invoke("transcribe-voice-search", {
                  body,
                });

              if (functionError) throw functionError;

              const transcript = normalizeVoiceSearchTranscript(
                String(data?.transcript ?? ""),
              );

              if (!transcript) {
                setError(
                  "Não consegui identificar o produto. Toque no microfone e tente novamente.",
                );
                return;
              }

              onTranscript(transcript);
            } catch (transcriptionError) {
              console.error("Silent voice search transcription failed", transcriptionError);
              setError(
                "Não consegui transcrever sua voz agora. Tente novamente.",
              );
            } finally {
              setIsListening(false);
            }
          })();
        };

        recorder.start(200);
        startedAtRef.current = performance.now();
        setIsListening(true);

        maxTimerRef.current = window.setTimeout(() => {
          if (recorder.state !== "inactive") {
            recorder.stop();
          }
        }, MAX_LISTENING_MS);

        animationFrameRef.current =
          window.requestAnimationFrame(watchVoiceLevel);

        return true;
      } catch (microphoneError) {
        releaseMicrophone();
        setIsListening(false);
        setError(microphoneErrorMessage(microphoneError));
        return false;
      }
    },
    [releaseMicrophone],
  );

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseMicrophone();
    };
  }, [releaseMicrophone]);

  return {
    isSupported,
    isListening,
    error,
    startListening,
    stopListening,
  };
}
