import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MAX_RECORDING_MS = 1800;
const MIN_RECORDING_MS = 520;
const SILENCE_AFTER_SPEECH_MS = 320;
const MIN_SPEECH_START_RMS = 0.008;
const MIN_SPEECH_CONTINUE_RMS = 0.0055;

const PONCAN_ALIASES = new Set([
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

export function normalizeVoiceSearchBetaTranscript(value: string) {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "")
    .trim();

  const key = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

  const compactKey = key.replace(/[\s-]+/g, "");

  if (key === "sau") return "sal";
  if (PONCAN_ALIASES.has(key) || PONCAN_ALIASES.has(compactKey)) return "poncan";
  return normalized;
}

function preferredAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function useVoiceSearchBeta() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTimingMs, setLastTimingMs] = useState<number | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const cleanupAudioAnalysis = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }
  }, []);

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    clearTimeoutRef();
    cleanupAudioAnalysis();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, [clearTimeoutRef, cleanupAudioAnalysis]);

  const startListening = useCallback(
    (onTranscript: (transcript: string) => void) => {
      if (!isSupported) {
        setError("Busca por voz beta não está disponível neste navegador.");
        return false;
      }

      setError(null);
      setLastTimingMs(null);
      chunksRef.current = [];
      const requestStartedAt = performance.now();
      const sessionPromise = supabase.auth.getSession();

      const AudioContextCtor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      let preparedAudioContext: AudioContext | null = null;
      if (AudioContextCtor) {
        try {
          preparedAudioContext = new AudioContextCtor();
          audioContextRef.current = preparedAudioContext;
          if (preparedAudioContext.state === "suspended") {
            void preparedAudioContext.resume().catch(() => {});
          }
        } catch (audioContextError) {
          console.warn("Beta audio analysis could not start", audioContextError);
        }
      }

      void navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        .then((stream) => {
          streamRef.current = stream;
          const mimeType = preferredAudioMimeType();
          const recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);

          recorderRef.current = recorder;
          const startedAt = performance.now();
          let heardSpeech = false;
          let speechFrames = 0;
          let lastSpeechAt = 0;
          let noiseFloor = 0.003;

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunksRef.current.push(event.data);
          };

          recorder.onerror = () => {
            clearTimeoutRef();
            cleanupAudioAnalysis();
            recorderRef.current = null;
            releaseStream();
            setIsListening(false);
            setError("Não foi possível gravar o áudio na beta.");
          };

          recorder.onstop = async () => {
            clearTimeoutRef();
            cleanupAudioAnalysis();
            recorderRef.current = null;
            setIsListening(false);

            const chunks = chunksRef.current;
            chunksRef.current = [];
            const recordedType =
              recorder.mimeType || chunks[0]?.type || "audio/webm";
            const blob = new Blob(chunks, { type: recordedType });
            releaseStream();

            if (!blob.size) {
              setError("Não consegui ouvir o produto. Tente novamente.");
              return;
            }

            try {
              const form = new FormData();
              const extension = recordedType.includes("mp4")
                ? "m4a"
                : recordedType.includes("ogg")
                  ? "ogg"
                  : "webm";

              form.append(
                "file",
                new File([blob], `voice-search-beta.${extension}`, {
                  type: recordedType,
                }),
              );
              const {
                data: { session },
              } = await sessionPromise;

              if (!session?.access_token) {
                setError("Sua sessão expirou. Entre novamente para usar a busca por voz.");
                return;
              }

              const response = await fetch(
                `${SUPABASE_URL}/functions/v1/transcribe-radar-voice-beta-fast`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    apikey: SUPABASE_PUBLISHABLE_KEY,
                  },
                  body: form,
                },
              );

              const data = await response.json().catch(() => ({}));

              if (!response.ok) {
                throw new Error(
                  String(data?.error ?? `Falha na transcrição (${response.status})`),
                );
              }

              const transcript = normalizeVoiceSearchBetaTranscript(
                String(data?.transcript ?? ""),
              );

              if (!transcript) {
                setError(
                  "Ouvi sua fala, mas não consegui identificar o produto.",
                );
                return;
              }

              setLastTimingMs(Math.round(performance.now() - requestStartedAt));
              onTranscript(transcript);
            } catch (transcriptionError) {
              console.error("Beta voice transcription failed", transcriptionError);
              setError("Não consegui transcrever o áudio beta agora.");
            }
          };

          recorder.start(80);
          setIsListening(true);

          try {
            const context = preparedAudioContext;

            if (context) {
              if (context.state === "suspended") {
                void context.resume().catch(() => {});
              }

              const source = context.createMediaStreamSource(stream);
              const analyser = context.createAnalyser();
              analyser.fftSize = 1024;
              analyser.smoothingTimeConstant = 0.08;
              source.connect(analyser);

              const samples = new Float32Array(analyser.fftSize);

              const inspect = () => {
                if (recorder.state === "inactive") return;

                analyser.getFloatTimeDomainData(samples);
                let sum = 0;
                for (let i = 0; i < samples.length; i += 1) {
                  sum += samples[i] * samples[i];
                }

                const rms = Math.sqrt(sum / samples.length);
                const now = performance.now();
                const elapsed = now - startedAt;

                if (!heardSpeech) {
                  if (elapsed < 260) {
                    noiseFloor = Math.min(
                      0.006,
                      noiseFloor * 0.88 + rms * 0.12,
                    );
                  }

                  const startThreshold = Math.max(
                    MIN_SPEECH_START_RMS,
                    noiseFloor * 2.2,
                  );

                  if (rms >= startThreshold) {
                    speechFrames += 1;
                    if (speechFrames >= 2) {
                      heardSpeech = true;
                      lastSpeechAt = now;
                    }
                  } else {
                    speechFrames = 0;
                  }
                } else {
                  const continueThreshold = Math.max(
                    MIN_SPEECH_CONTINUE_RMS,
                    noiseFloor * 1.55,
                  );

                  if (rms >= continueThreshold) {
                    lastSpeechAt = now;
                  } else if (
                    elapsed >= MIN_RECORDING_MS &&
                    now - lastSpeechAt >= SILENCE_AFTER_SPEECH_MS
                  ) {
                    recorder.stop();
                    return;
                  }
                }

                animationRef.current = requestAnimationFrame(inspect);
              };

              animationRef.current = requestAnimationFrame(inspect);
            }
          } catch (analysisError) {
            console.warn("Beta silence detection unavailable", analysisError);
          }

          timeoutRef.current = window.setTimeout(() => {
            if (recorder.state !== "inactive") recorder.stop();
          }, MAX_RECORDING_MS);
        })
        .catch((captureError) => {
          console.error("Beta microphone capture failed", captureError);
          cleanupAudioAnalysis();
          releaseStream();
          setIsListening(false);
          setError("Não foi possível acessar o microfone na beta.");
        });

      return true;
    },
    [
      cleanupAudioAnalysis,
      clearTimeoutRef,
      isSupported,
      releaseStream,
    ],
  );

  useEffect(() => {
    return () => {
      clearTimeoutRef();
      cleanupAudioAnalysis();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null;
      releaseStream();
    };
  }, [cleanupAudioAnalysis, clearTimeoutRef, releaseStream]);

  const clearError = useCallback(() => setError(null), []);

  return {
    isSupported,
    isListening,
    error,
    lastTimingMs,
    clearError,
    startListening,
    stopListening,
  };
}
