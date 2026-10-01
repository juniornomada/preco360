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

const FALLBACK_RECORDING_MAX_MS = 2200;
const NATIVE_MAX_MS = 4200;

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

export function useVoiceSearch() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const nativeTimerRef = useRef<number | null>(null);
  const recorderTimerRef = useRef<number | null>(null);
  const deliveredRef = useRef(false);
  const fallbackRequestedRef = useRef(false);
  const suppressRecorderUploadRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupported =
    canRecordAudio() || getSpeechRecognitionConstructor() !== null;

  const clearTimers = useCallback(() => {
    if (nativeTimerRef.current !== null) {
      window.clearTimeout(nativeTimerRef.current);
      nativeTimerRef.current = null;
    }
    if (recorderTimerRef.current !== null) {
      window.clearTimeout(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopRecorder = useCallback((skipUpload = false) => {
    if (skipUpload) suppressRecorderUploadRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const stopListening = useCallback(() => {
    clearTimers();
    fallbackRequestedRef.current = true;
    recognitionRef.current?.stop();
    stopRecorder(false);
  }, [clearTimers, stopRecorder]);

  const transcribeRecordedAudio = useCallback(
    async (
      blob: Blob,
      recordedType: string,
      onTranscript: (transcript: string) => void,
    ) => {
      if (deliveredRef.current || !blob.size) return;

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
        if (deliveredRef.current) return;

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
        setError(null);
        onTranscript(transcript);
      } catch (transcriptionError) {
        console.error("Voice transcription failed", transcriptionError);
        if (!deliveredRef.current) {
          setError("Não consegui transcrever o áudio agora. Tente novamente.");
        }
      }
    },
    [],
  );

  const startNativeOnly = useCallback(
    (onTranscript: (transcript: string) => void) => {
      const Recognition = getSpeechRecognitionConstructor();
      if (!Recognition) {
        setError("Busca por voz não está disponível neste navegador.");
        return false;
      }

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
        nativeTimerRef.current = window.setTimeout(
          () => recognition.stop(),
          NATIVE_MAX_MS,
        );
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
        setError(null);
        onTranscript(transcript);
        recognition.stop();
      };

      recognition.onerror = (event) => {
        if (!deliveredRef.current && event.error !== "aborted") {
          setError(voiceErrorMessage(event.error));
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        if (nativeTimerRef.current !== null) {
          window.clearTimeout(nativeTimerRef.current);
          nativeTimerRef.current = null;
        }
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
        setError("Não foi possível iniciar o microfone. Tente novamente.");
        setIsListening(false);
        return false;
      }
    },
    [],
  );

  const startHybridRecognition = useCallback(
    (onTranscript: (transcript: string) => void) => {
      const Recognition = getSpeechRecognitionConstructor();
      if (!Recognition || !canRecordAudio()) {
        return startNativeOnly(onTranscript);
      }

      deliveredRef.current = false;
      fallbackRequestedRef.current = false;
      suppressRecorderUploadRef.current = false;
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
          if (deliveredRef.current) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

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
            recorderRef.current = null;
            releaseStream();
            if (!deliveredRef.current) {
              setError("Não foi possível gravar o áudio. Tente novamente.");
            }
          };

          recorder.onstop = () => {
            if (recorderTimerRef.current !== null) {
              window.clearTimeout(recorderTimerRef.current);
              recorderTimerRef.current = null;
            }

            recorderRef.current = null;
            const chunks = chunksRef.current;
            chunksRef.current = [];
            const recordedType =
              recorder.mimeType || chunks[0]?.type || "audio/webm";
            const blob = new Blob(chunks, { type: recordedType });
            releaseStream();

            const skipUpload = suppressRecorderUploadRef.current;
            suppressRecorderUploadRef.current = false;

            if (
              skipUpload ||
              deliveredRef.current ||
              (!fallbackRequestedRef.current && recognitionRef.current)
            ) {
              return;
            }

            void transcribeRecordedAudio(blob, recordedType, onTranscript);
          };

          recorder.start(120);
          setIsListening(true);

          recorderTimerRef.current = window.setTimeout(() => {
            fallbackRequestedRef.current = true;
            if (recorder.state !== "inactive") recorder.stop();
          }, FALLBACK_RECORDING_MAX_MS);

          const recognition = new Recognition();
          recognition.lang = "pt-BR";
          recognition.interimResults = true;
          recognition.continuous = false;
          recognition.maxAlternatives = 5;
          recognitionRef.current = recognition;

          const bestTranscript = (result?: SpeechResult) => {
            if (!result?.length) return "";
            const alternatives = Array.from(
              { length: result.length },
              (_, index) =>
                normalizeVoiceSearchTranscript(
                  result[index]?.transcript ?? "",
                ),
            ).filter(Boolean);

            return (
              alternatives.find((candidate) => candidate === "poncan") ??
              alternatives[0] ??
              ""
            );
          };

          recognition.onstart = () => {
            nativeTimerRef.current = window.setTimeout(() => {
              fallbackRequestedRef.current = true;
              recognition.stop();
              stopRecorder(false);
            }, NATIVE_MAX_MS);
          };

          recognition.onresult = (event) => {
            const transcripts = Array.from(
              { length: event.results.length },
              (_, offset) =>
                bestTranscript(
                  event.results[event.results.length - 1 - offset],
                ),
            ).filter(Boolean);

            const transcript =
              transcripts.find((candidate) => candidate === "poncan") ??
              transcripts[0] ??
              "";

            if (!transcript || deliveredRef.current) return;

            deliveredRef.current = true;
            setError(null);
            onTranscript(transcript);

            suppressRecorderUploadRef.current = true;
            if (recorder.state !== "inactive") recorder.stop();
            recognition.stop();
          };

          recognition.onerror = (event) => {
            if (deliveredRef.current || event.error === "aborted") return;

            fallbackRequestedRef.current = true;
            if (nativeTimerRef.current !== null) {
              window.clearTimeout(nativeTimerRef.current);
              nativeTimerRef.current = null;
            }

            // The native recognizer often fails on short grocery terms such as
            // "poncan". The audio has already been recorded in parallel, so
            // trigger the server fallback immediately instead of showing an
            // error or asking the user to speak again.
            if (recorder.state !== "inactive") {
              recorder.stop();
            } else if (!chunksRef.current.length) {
              setError(voiceErrorMessage(event.error));
            }
          };

          recognition.onend = () => {
            if (nativeTimerRef.current !== null) {
              window.clearTimeout(nativeTimerRef.current);
              nativeTimerRef.current = null;
            }
            recognitionRef.current = null;

            if (deliveredRef.current) {
              setIsListening(false);
              return;
            }

            fallbackRequestedRef.current = true;
            if (recorder.state !== "inactive") {
              recorder.stop();
            }
          };

          try {
            recognition.start();
          } catch {
            fallbackRequestedRef.current = true;
            recognitionRef.current = null;
            if (recorder.state !== "inactive") recorder.stop();
          }
        })
        .catch((captureError) => {
          console.error("Microphone capture failed", captureError);
          releaseStream();
          startNativeOnly(onTranscript);
        });

      return true;
    },
    [releaseStream, startNativeOnly, stopRecorder, transcribeRecordedAudio],
  );

  const startListening = useCallback(
    (onTranscript: (transcript: string) => void) => {
      clearTimers();
      recognitionRef.current?.abort();

      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        suppressRecorderUploadRef.current = true;
        recorder.stop();
      }

      if (canRecordAudio() && getSpeechRecognitionConstructor()) {
        return startHybridRecognition(onTranscript);
      }

      return startNativeOnly(onTranscript);
    },
    [clearTimers, startHybridRecognition, startNativeOnly],
  );

  useEffect(() => {
    return () => {
      clearTimers();
      recognitionRef.current?.abort();
      recognitionRef.current = null;

      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        suppressRecorderUploadRef.current = true;
        recorder.stop();
      }
      recorderRef.current = null;
      releaseStream();
    };
  }, [clearTimers, releaseStream]);

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
