import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const MAX_RECORDING_MS = 5500;
const TRANSCRIPTION_TIMEOUT_MS = 8000;
const SILENCE_AFTER_SPEECH_MS = 750;
const MIN_RECORDING_MS = 450;
const SPEECH_RMS_THRESHOLD = 0.018;

function preferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function normalizeVoiceSearchTranscript(value: string) {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\"'“”‘’]+|[\"'“”‘’.,;:!?]+$/g, "")
    .trim();

  const key = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

  if (key === "sau") return "sal";

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

function recorderSupported() {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export function useVoiceSearch() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const transcriptCallbackRef = useRef<((transcript: string) => void) | null>(
    null,
  );

  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const releaseAudio = useCallback(() => {
    clearTimers();

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
  }, [clearTimers]);

  const transcribeRecording = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);
    setError(null);

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError || !sessionData.session?.access_token) {
        throw new Error("VOICE_SESSION_UNAVAILABLE");
      }

      const form = new FormData();
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      form.append(
        "file",
        new File([blob], `radar-voice.${extension}`, {
          type: blob.type || "audio/webm",
        }),
      );
      form.append("access_token", sessionData.session.access_token);

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, TRANSCRIPTION_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-radar-voice`,
          {
            method: "POST",
            body: form,
            signal: controller.signal,
          },
        );
      } finally {
        window.clearTimeout(timeoutId);
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `VOICE_HTTP_${response.status}`));
      }

      const transcript = normalizeVoiceSearchTranscript(
        String(data?.transcript ?? ""),
      );

      if (!transcript) {
        setError(
          "Não consegui identificar o produto. Tente falar novamente, sem precisar completar com outra palavra.",
        );
        return;
      }

      transcriptCallbackRef.current?.(transcript);
    } catch (transcriptionError) {
      console.error("Falha ao transcrever busca por voz:", transcriptionError);

      const timedOut =
        transcriptionError instanceof DOMException &&
        transcriptionError.name === "AbortError";

      setError(
        timedOut
          ? "A transcrição demorou demais. Tente novamente."
          : "Não consegui transcrever o áudio agora. Toque no microfone e tente novamente.",
      );
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    releaseAudio();
    setIsListening(false);
  }, [releaseAudio]);

  const startListening = useCallback(
    async (onTranscript: (transcript: string) => void) => {
      if (!recorderSupported()) {
        setError("Busca por voz não está disponível neste navegador.");
        return false;
      }

      if (isListening || isTranscribing) return false;

      setError(null);
      chunksRef.current = [];
      transcriptCallbackRef.current = onTranscript;

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

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };

        recorder.onerror = () => {
          setError("Não foi possível gravar o áudio. Tente novamente.");
          setIsListening(false);
          releaseAudio();
        };

        recorder.onstop = () => {
          const recordedType = recorder.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: recordedType });
          chunksRef.current = [];
          recorderRef.current = null;
          setIsListening(false);
          releaseAudio();

          if (blob.size < 400) {
            setError(
              "O áudio ficou muito curto. Toque no microfone e fale o nome do produto.",
            );
            return;
          }

          void transcribeRecording(blob);
        };

        recorder.start(100);
        setIsListening(true);

        const AudioContextClass =
          window.AudioContext ??
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (AudioContextClass) {
          const audioContext = new AudioContextClass();
          audioContextRef.current = audioContext;
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.25;
          source.connect(analyser);

          const samples = new Uint8Array(analyser.fftSize);
          const startedAt = performance.now();
          let speechStarted = false;
          let lastSpeechAt = startedAt;

          const monitor = () => {
            if (recorder.state === "inactive") return;

            analyser.getByteTimeDomainData(samples);
            let sumSquares = 0;
            for (const sample of samples) {
              const normalized = (sample - 128) / 128;
              sumSquares += normalized * normalized;
            }
            const rms = Math.sqrt(sumSquares / samples.length);
            const now = performance.now();

            if (rms >= SPEECH_RMS_THRESHOLD) {
              speechStarted = true;
              lastSpeechAt = now;
            }

            if (
              speechStarted &&
              now - startedAt >= MIN_RECORDING_MS &&
              now - lastSpeechAt >= SILENCE_AFTER_SPEECH_MS
            ) {
              recorder.stop();
              return;
            }

            animationFrameRef.current = window.requestAnimationFrame(monitor);
          };

          animationFrameRef.current = window.requestAnimationFrame(monitor);
        }

        maxTimerRef.current = window.setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, MAX_RECORDING_MS);

        return true;
      } catch (microphoneError) {
        console.error("Falha ao abrir microfone:", microphoneError);
        releaseAudio();
        setIsListening(false);

        if (
          microphoneError instanceof DOMException &&
          (microphoneError.name === "NotAllowedError" ||
            microphoneError.name === "SecurityError")
        ) {
          setError("Permita o acesso ao microfone para buscar por voz.");
        } else {
          setError("Não foi possível acessar o microfone.");
        }

        return false;
      }
    },
    [
      isListening,
      isTranscribing,
      releaseAudio,
      transcribeRecording,
    ],
  );

  useEffect(() => {
    return () => {
      clearTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      recorderRef.current = null;
      releaseAudio();
    };
  }, [clearTimers, releaseAudio]);

  return {
    isSupported: recorderSupported(),
    isListening,
    isTranscribing,
    error,
    startListening,
    stopListening,
  };
}
