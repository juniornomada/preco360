import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type SpeechAlternative = {
  transcript: string;
};

type SpeechResult = {
  [index: number]: SpeechAlternative | undefined;
  length: number;
  isFinal?: boolean;
};

type SpeechResultList = {
  [index: number]: SpeechResult;
  length: number;
};

type SpeechRecognitionEventLike = Event & {
  results: SpeechResultList;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const MAX_RECORDING_MS = 3200;
const NATIVE_MAX_MS = 6000;

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

  if (key === "sau") return "sal";
  if (PONCAN_ALIASES.has(key)) return "poncan";

  return normalized;
}

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  );
}

function canRecordAudio() {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function voiceErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Permita o acesso ao microfone para buscar por voz.";
  }
  if (error === "audio-capture") {
    return "Não foi possível acessar o microfone.";
  }
  if (error === "no-speech") {
    return "Não consegui ouvir o produto. Toque no microfone e tente novamente.";
  }
  return "Não consegui reconhecer o produto. Tente novamente.";
}

function preferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function useVoiceSearchProduction() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const deliveredRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupported =
    canRecordAudio() || getSpeechRecognitionConstructor() !== null;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    clearTimer();

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    recognitionRef.current?.stop();
  }, [clearTimer]);

  const startNativeRecognition = useCallback(
    (onTranscript: (transcript: string) => void) => {
      const Recognition = getSpeechRecognitionConstructor();
      if (!Recognition) {
        setError("Busca por voz não está disponível neste navegador.");
        return false;
      }

      recognitionRef.current?.abort();
      deliveredRef.current = false;

      const recognition = new Recognition();
      recognition.lang = "pt-BR";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 5;
      recognitionRef.current = recognition;

      const bestTranscript = (result?: SpeechResult) => {
        if (!result?.length) return "";

        const alternatives = Array.from({ length: result.length }, (_, index) =>
          normalizeVoiceSearchTranscript(result[index]?.transcript ?? ""),
        ).filter(Boolean);

        return (
          alternatives.find((candidate) => candidate === "poncan") ??
          alternatives[0] ??
          ""
        );
      };

      recognition.onstart = () => {
        setError(null);
        setIsListening(true);
        clearTimer();
        timerRef.current = window.setTimeout(() => recognition.stop(), NATIVE_MAX_MS);
      };

      recognition.onresult = (event) => {
        const transcripts = Array.from(
          { length: event.results.length },
          (_, offset) =>
            bestTranscript(event.results[event.results.length - 1 - offset]),
        ).filter(Boolean);

        const transcript =
          transcripts.find((candidate) => candidate === "poncan") ??
          transcripts[0] ??
          "";

        if (!transcript || deliveredRef.current) return;

        deliveredRef.current = true;
        onTranscript(transcript);
        recognition.stop();
      };

      recognition.onerror = (event) => {
        clearTimer();
        if (!deliveredRef.current && event.error !== "aborted") {
          setError(voiceErrorMessage(event.error));
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        clearTimer();
        recognitionRef.current = null;
        setIsListening(false);
        if (!deliveredRef.current) {
          setError(
            "Ouvi sua fala, mas não consegui identificar o produto. Tente falar novamente.",
          );
        }
      };

      try {
        recognition.start();
        return true;
      } catch {
        clearTimer();
        setError("Não foi possível iniciar o microfone. Tente novamente.");
        setIsListening(false);
        return false;
      }
    },
    [clearTimer],
  );

  const startRecordedTranscription = useCallback(
    (onTranscript: (transcript: string) => void) => {
      deliveredRef.current = false;
      chunksRef.current = [];
      setError(null);

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

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunksRef.current.push(event.data);
          };

          recorder.onerror = () => {
            clearTimer();
            recorderRef.current = null;
            releaseStream();
            setIsListening(false);
            setError("Não foi possível gravar o áudio. Tente novamente.");
          };

          recorder.onstop = async () => {
            clearTimer();
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
              const {
                data: { session },
              } = await supabase.auth.getSession();

              if (!session?.access_token) {
                setError("Sua sessão expirou. Entre novamente para usar a busca por voz.");
                return;
              }

              const form = new FormData();
              const extension = recordedType.includes("mp4")
                ? "m4a"
                : recordedType.includes("ogg")
                  ? "ogg"
                  : "webm";
              form.append(
                "file",
                new File([blob], `voice-search.${extension}`, {
                  type: recordedType,
                }),
              );
              form.append("access_token", session.access_token);

              const { data, error: invokeError } = await supabase.functions.invoke(
                "transcribe-radar-voice",
                { body: form },
              );

              if (invokeError) throw invokeError;

              const transcript = normalizeVoiceSearchTranscript(
                String(data?.transcript ?? ""),
              );

              if (!transcript) {
                setError(
                  "Ouvi sua fala, mas não consegui identificar o produto. Tente novamente.",
                );
                return;
              }

              deliveredRef.current = true;
              onTranscript(transcript);
            } catch (transcriptionError) {
              console.error("Voice transcription failed", transcriptionError);
              setError(
                "Não consegui transcrever o áudio agora. Tente novamente.",
              );
            }
          };

          recorder.start(200);
          setIsListening(true);

          clearTimer();
          timerRef.current = window.setTimeout(() => {
            if (recorder.state !== "inactive") recorder.stop();
          }, MAX_RECORDING_MS);
        })
        .catch((captureError) => {
          console.error("Microphone capture failed", captureError);
          releaseStream();

          // Keep the browser-native recognizer as a compatibility fallback
          // when MediaRecorder/getUserMedia cannot be used by the device.
          startNativeRecognition(onTranscript);
        });

      return true;
    },
    [clearTimer, releaseStream, startNativeRecognition],
  );

  const startListening = useCallback(
    (onTranscript: (transcript: string) => void) => {
      clearTimer();
      recognitionRef.current?.abort();

      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();

      if (canRecordAudio()) {
        return startRecordedTranscription(onTranscript);
      }

      return startNativeRecognition(onTranscript);
    },
    [clearTimer, startNativeRecognition, startRecordedTranscription],
  );

  useEffect(() => {
    return () => {
      clearTimer();
      recognitionRef.current?.abort();
      recognitionRef.current = null;

      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null;

      releaseStream();
    };
  }, [clearTimer, releaseStream]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isSupported,
    isListening,
    error,
    clearError,
    startListening,
    stopListening,
  };
}
