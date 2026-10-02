import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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

type SpeechRecognitionPhraseLike = { phrase: string; boost: number };
type SpeechRecognitionPhraseConstructor = new (phrase: string, boost?: number) => SpeechRecognitionPhraseLike;

type SpeechRecognitionLike = {
  lang: string;
  phrases?: SpeechRecognitionPhraseLike[];
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onspeechstart: ((event: Event) => void) | null;
  onspeechend: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  SpeechRecognitionPhrase?: SpeechRecognitionPhraseConstructor;
};

const SILENCE_COMMIT_MS = 500;
const SHORT_TERM_COMMIT_MS = 650;
const SPEECH_END_STOP_MS = 180;
const MAX_LISTENING_MS = 4500;
const PONCAN_FALLBACK_RECORDING_MS = 1100;

const PONCAN_CONTEXT_PHRASES = [
  "poncã",
  "poncan",
  "ponkan",
  "pocan",
  "pokan",
] as const;

const PONCAN_HELPER_SUFFIXES = new Set(["fruta"]);

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
  const words = key.split(/[\s-]+/).filter(Boolean);

  if (key === "sau") return "sal";
  if (key === "sao refinado") return "sal refinado";

  // Android/Chrome often recognizes the difficult short term when the user
  // supplies a harmless second word ("poncan fruta") or repeats it
  // ("poncan poncan"). Only collapse combinations whose parts are already
  // known Poncan aliases, avoiding broad matches such as "com" / "pão com".
  if (words.length === 2) {
    const [first, second] = words;
    const repeatedAlias =
      PONCAN_ALIASES.has(first) && PONCAN_ALIASES.has(second);
    const aliasWithHelper =
      PONCAN_ALIASES.has(first) && PONCAN_HELPER_SUFFIXES.has(second);

    if (repeatedAlias || aliasWithHelper) return "poncan";
  }
  if (PONCAN_ALIASES.has(key) || PONCAN_ALIASES.has(compactKey)) {
    return "poncan";
  }

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

type NativeVoiceTelemetry = {
  event: "start" | "result" | "error" | "end_no_text";
  session_id: string;
  alternatives?: string[];
  normalized?: string;
  is_final?: boolean;
  speech_started?: boolean;
  error?: string;
  elapsed_ms?: number;
  phrase_bias_supported?: boolean;
};

function logNativeVoiceBeta(payload: NativeVoiceTelemetry) {
  // Diagnostic-only and intentionally fire-and-forget so telemetry never
  // delays or blocks the native voice-search path.
  void supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) return;

    void fetch(
      `${SUPABASE_URL}/functions/v1/log-native-voice-beta`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    ).catch(() => undefined);
  }).catch(() => undefined);
}

function voiceErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Permita o acesso ao microfone para buscar por voz.";
  }

  if (error === "audio-capture") {
    return "Não foi possível acessar o microfone.";
  }

  return "Não consegui reconhecer o produto. Tente novamente.";
}

export function useVoiceSearchBeta() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const pendingTranscriptRef = useRef("");
  const deliveredRef = useRef(false);
  const speechStartedRef = useRef(false);
  const poncanFallbackArmedRef = useRef(false);

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTimingMs, setLastTimingMs] = useState<number | null>(null);
  const [poncanFallbackArmed, setPoncanFallbackArmed] = useState(false);

  const isSupported = getSpeechRecognitionConstructor() !== null;

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }

    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const setFallbackArmed = useCallback((armed: boolean) => {
    poncanFallbackArmedRef.current = armed;
    setPoncanFallbackArmed(armed);
  }, []);

  const stopListening = useCallback(() => {
    clearTimers();

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    recognitionRef.current?.stop();
  }, [clearTimers]);

  const startPoncanFallback = useCallback(
    (onTranscript: (transcript: string) => void) => {
      if (!canRecordAudio()) {
        setFallbackArmed(false);
        setError("O modo especial de poncã não está disponível neste navegador.");
        return false;
      }

      clearTimers();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setFallbackArmed(false);
      setError(null);
      setLastTimingMs(null);
      chunksRef.current = [];

      const startedAt = performance.now();
      const sessionPromise = supabase.auth.getSession();

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
            clearTimers();
            recorderRef.current = null;
            releaseStream();
            setIsListening(false);
            setError("Não foi possível gravar a tentativa de poncã.");
          };

          recorder.onstop = async () => {
            clearTimers();
            recorderRef.current = null;
            setIsListening(false);

            const chunks = chunksRef.current;
            chunksRef.current = [];

            const recordedType =
              recorder.mimeType || chunks[0]?.type || "audio/webm";
            const blob = new Blob(chunks, { type: recordedType });
            releaseStream();

            if (!blob.size) {
              setError("Não consegui ouvir a tentativa de poncã.");
              return;
            }

            try {
              const {
                data: { session },
              } = await sessionPromise;

              if (!session?.access_token) {
                setError("Sua sessão expirou. Entre novamente para usar a busca por voz.");
                return;
              }

              const extension = recordedType.includes("mp4")
                ? "m4a"
                : recordedType.includes("ogg")
                  ? "ogg"
                  : "webm";

              const form = new FormData();
              form.append(
                "file",
                new File([blob], `poncan-beta.${extension}`, {
                  type: recordedType,
                }),
              );

              const response = await fetch(
                `${SUPABASE_URL}/functions/v1/detect-poncan-voice-beta`,
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
                  String(data?.error ?? `Falha no modo poncã (${response.status})`),
                );
              }

              setLastTimingMs(Math.round(performance.now() - startedAt));

              if (data?.is_poncan === true) {
                setError(null);
                onTranscript("poncan");
                return;
              }

              setError(
                "Não confirmei poncã nessa tentativa. O próximo toque volta ao reconhecimento normal.",
              );
            } catch (fallbackError) {
              console.error("Poncan beta fallback failed", fallbackError);
              setError(
                "O modo especial de poncã falhou. O próximo toque volta ao reconhecimento normal.",
              );
            }
          };

          recorder.start(100);
          setIsListening(true);

          recordingTimerRef.current = window.setTimeout(() => {
            if (recorder.state !== "inactive") recorder.stop();
          }, PONCAN_FALLBACK_RECORDING_MS);
        })
        .catch((captureError) => {
          console.error("Poncan beta microphone capture failed", captureError);
          releaseStream();
          setIsListening(false);
          setError("Não foi possível acessar o microfone para a tentativa de poncã.");
        });

      return true;
    },
    [clearTimers, releaseStream, setFallbackArmed],
  );

  const startNativeRecognition = useCallback(
    (onTranscript: (transcript: string) => void) => {
      const Recognition = getSpeechRecognitionConstructor();

      if (!Recognition) {
        setError("Busca por voz nativa não está disponível neste navegador.");
        return false;
      }

      clearTimers();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      pendingTranscriptRef.current = "";
      deliveredRef.current = false;
      speechStartedRef.current = false;
      setFallbackArmed(false);
      setError(null);
      setLastTimingMs(null);

      const startedAt = performance.now();
      const nativeSessionId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const recognition = new Recognition();

      recognition.lang = "pt-BR";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 5;

      // Progressive enhancement: newer Web Speech implementations can bias
      // recognition toward troublesome vocabulary. Unsupported browsers keep
      // the exact native path below. A moderate boost limits false positives.
      const speechWindow = window as SpeechWindow;
      const Phrase = speechWindow.SpeechRecognitionPhrase;
      const phraseBiasSupported = Boolean(Phrase && "phrases" in recognition);
      if (Phrase && "phrases" in recognition) {
        try {
          recognition.phrases = PONCAN_CONTEXT_PHRASES.map(
            (phrase) => new Phrase(phrase, 3),
          );
        } catch (phraseError) {
          console.debug("Poncan contextual bias unavailable", phraseError);
        }
      }

      logNativeVoiceBeta({
        event: "start",
        session_id: nativeSessionId,
        elapsed_ms: 0,
        phrase_bias_supported: phraseBiasSupported,
      });

      const rawAlternatives = (result?: SpeechResult) =>
        result?.length
          ? Array.from({ length: result.length }, (_, index) =>
              result[index]?.transcript?.trim() ?? "",
            ).filter(Boolean)
          : [];

      const bestTranscript = (result?: SpeechResult) => {
        if (!result?.length) return "";

        const alternatives = Array.from({ length: result.length }, (_, index) =>
          normalizeVoiceSearchBetaTranscript(
            result[index]?.transcript ?? "",
          ),
        ).filter(Boolean);

        return (
          alternatives.find((candidate) => candidate === "poncan") ??
          alternatives[0] ??
          ""
        );
      };

      const deliverPending = () => {
        const transcript = normalizeVoiceSearchBetaTranscript(
          pendingTranscriptRef.current,
        );

        if (!transcript || deliveredRef.current) return false;

        deliveredRef.current = true;
        setFallbackArmed(false);
        setError(null);
        setLastTimingMs(Math.round(performance.now() - startedAt));
        onTranscript(transcript);
        return true;
      };

      const armPoncanFallback = () => {
        if (deliveredRef.current) return;

        setFallbackArmed(true);
        setError(
          "O reconhecimento nativo não gerou texto. Toque novamente e fale “poncã” normalmente.",
        );
      };

      const commitDelayFor = (transcript: string) => {
        const wordCount = transcript.trim().split(/\\s+/).filter(Boolean).length;
        // A short single word gets a little more time to become e.g.
        // "pão francês" / "sal refinado"; longer phrases can commit sooner.
        return wordCount <= 1 ? SHORT_TERM_COMMIT_MS : SILENCE_COMMIT_MS;
      };

      const scheduleSilenceCommit = (transcript: string) => {
        if (silenceTimerRef.current !== null) {
          window.clearTimeout(silenceTimerRef.current);
        }

        silenceTimerRef.current = window.setTimeout(() => {
          deliverPending();
          recognition.stop();
        }, commitDelayFor(transcript));
      };

      recognition.onstart = () => {
        recognitionRef.current = recognition;
        setIsListening(true);

        maxTimerRef.current = window.setTimeout(() => {
          const delivered = deliverPending();
          if (!delivered) {
            armPoncanFallback();
          }
          recognition.stop();
        }, MAX_LISTENING_MS);
      };

      recognition.onspeechstart = () => {
        speechStartedRef.current = true;

        if (silenceTimerRef.current !== null) {
          window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      };

      recognition.onspeechend = () => {
        if (silenceTimerRef.current !== null) {
          window.clearTimeout(silenceTimerRef.current);
        }

        silenceTimerRef.current = window.setTimeout(() => {
          recognition.stop();
        }, SPEECH_END_STOP_MS);
      };

      recognition.onresult = (event) => {
        const lastResult = event.results[event.results.length - 1];
        const transcript = bestTranscript(lastResult);
        const alternatives = rawAlternatives(lastResult);

        logNativeVoiceBeta({
          event: "result",
          session_id: nativeSessionId,
          alternatives,
          normalized: transcript,
          is_final: Boolean(lastResult?.isFinal),
          speech_started: speechStartedRef.current,
          elapsed_ms: Math.round(performance.now() - startedAt),
          phrase_bias_supported: phraseBiasSupported,
        });

        if (!transcript) return;

        pendingTranscriptRef.current = transcript;

        if (lastResult?.isFinal) {
          deliverPending();
          clearTimers();
          recognition.stop();
          return;
        }

        scheduleSilenceCommit(transcript);
      };

      recognition.onerror = (event) => {
        clearTimers();

        logNativeVoiceBeta({
          event: "error",
          session_id: nativeSessionId,
          normalized: pendingTranscriptRef.current,
          speech_started: speechStartedRef.current,
          error: event.error ?? "unknown",
          elapsed_ms: Math.round(performance.now() - startedAt),
          phrase_bias_supported: phraseBiasSupported,
        });

        const delivered = deliverPending();

        if (!delivered && event.error !== "aborted") {
          if (event.error === "no-speech" || speechStartedRef.current) {
            armPoncanFallback();
          } else {
            setError(voiceErrorMessage(event.error));
          }
        }

        setIsListening(false);
      };

      recognition.onend = () => {
        clearTimers();

        // If onresult already produced usable text, deliverPending marks this
        // session before onend can classify it as an empty recognition.
        const hadPendingText = Boolean(pendingTranscriptRef.current.trim());
        const delivered = deliverPending();

        if (!delivered && !hadPendingText && !deliveredRef.current && speechStartedRef.current) {
          logNativeVoiceBeta({
            event: "end_no_text",
            session_id: nativeSessionId,
            speech_started: true,
            elapsed_ms: Math.round(performance.now() - startedAt),
            phrase_bias_supported: phraseBiasSupported,
          });
          armPoncanFallback();
        }

        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }

        setIsListening(false);
      };

      try {
        recognition.start();
        return true;
      } catch {
        clearTimers();
        setError("Não foi possível iniciar o microfone. Tente novamente.");
        setIsListening(false);
        return false;
      }
    },
    [clearTimers, setFallbackArmed],
  );

  const startListening = useCallback(
    (onTranscript: (transcript: string) => void) => {
      if (poncanFallbackArmedRef.current) {
        return startPoncanFallback(onTranscript);
      }

      return startNativeRecognition(onTranscript);
    },
    [startNativeRecognition, startPoncanFallback],
  );

  useEffect(() => {
    return () => {
      clearTimers();

      recognitionRef.current?.abort();
      recognitionRef.current = null;

      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null;

      releaseStream();
    };
  }, [clearTimers, releaseStream]);

  const clearError = useCallback(() => {
    setError(null);
    setFallbackArmed(false);
  }, [setFallbackArmed]);

  return {
    isSupported,
    isListening,
    error,
    lastTimingMs,
    poncanFallbackArmed,
    clearError,
    startListening,
    stopListening,
  };
}
