import { useCallback, useEffect, useRef, useState } from "react";

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
  onaudiostart: ((event: Event) => void) | null;
  onaudioend: ((event: Event) => void) | null;
  onspeechstart: ((event: Event) => void) | null;
  onspeechend: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const SILENCE_COMMIT_MS = 900;
const SPEECH_END_STOP_MS = 250;
const MAX_LISTENING_MS = 6000;

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

  // On pt-BR speech recognition, the final "l" in a very short utterance can
  // occasionally be emitted phonetically as "u" ("sal" -> "sau").
  if (key === "sau") {
    return "sal";
  }

  // Ponkan/Poncã has several accepted spellings. Keep the browser-native
  // recognizer, but collapse only closely related spellings to one search term.
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

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
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

export function useVoiceSearch() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const pendingTranscriptRef = useRef("");
  const deliveredRef = useRef(false);
  const speechStartedRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const startListening = useCallback(
    (onTranscript: (transcript: string) => void) => {
      const Recognition = getSpeechRecognitionConstructor();
      if (!Recognition) {
        setError("Busca por voz não está disponível neste navegador.");
        return false;
      }

      clearTimers();
      recognitionRef.current?.abort();
      pendingTranscriptRef.current = "";
      deliveredRef.current = false;
      speechStartedRef.current = false;

      const recognition = new Recognition();
      recognition.lang = "pt-BR";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 5;

      const bestTranscript = (result?: SpeechResult) => {
        if (!result?.length) return "";

        const alternatives = Array.from({ length: result.length }, (_, index) =>
          normalizeVoiceSearchTranscript(result[index]?.transcript ?? ""),
        ).filter(Boolean);

        return (
          alternatives.find((candidate) => candidate === "poncã") ??
          alternatives[0] ??
          ""
        );
      };

      const deliverPending = () => {
        const transcript = normalizeVoiceSearchTranscript(
          pendingTranscriptRef.current,
        );
        if (!transcript || deliveredRef.current) return false;

        deliveredRef.current = true;
        onTranscript(transcript);
        return true;
      };

      const scheduleSilenceCommit = () => {
        if (silenceTimerRef.current !== null) {
          window.clearTimeout(silenceTimerRef.current);
        }
        silenceTimerRef.current = window.setTimeout(() => {
          deliverPending();
          recognition.stop();
        }, SILENCE_COMMIT_MS);
      };

      recognition.onstart = () => {
        recognitionRef.current = recognition;
        setError(null);
        setIsListening(true);

        maxTimerRef.current = window.setTimeout(() => {
          const delivered = deliverPending();
          if (!delivered && !pendingTranscriptRef.current) {
            setError(
              "Não consegui ouvir o produto. Toque no microfone e tente novamente.",
            );
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
        // Chrome/Android sometimes keeps very short words such as "sal" in a
        // non-final state. Stopping recognition shortly after speechend forces
        // the browser to flush the final result instead of leaving the mic on.
        silenceTimerRef.current = window.setTimeout(() => {
          recognition.stop();
        }, SPEECH_END_STOP_MS);
      };

      recognition.onresult = (event) => {
        const lastResult = event.results[event.results.length - 1];
        const transcript = bestTranscript(lastResult);

        if (!transcript) return;
        pendingTranscriptRef.current = transcript;

        if (lastResult?.isFinal) {
          deliverPending();
          clearTimers();
          recognition.stop();
          return;
        }

        scheduleSilenceCommit();
      };

      recognition.onerror = (event) => {
        clearTimers();

        const delivered = deliverPending();
        if (!delivered && event.error !== "aborted") {
          setError(voiceErrorMessage(event.error));
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        clearTimers();
        const delivered = deliverPending();
        if (!delivered && speechStartedRef.current) {
          setError(
            "Ouvi sua fala, mas não consegui identificar o produto. Tente falar novamente.",
          );
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
    [clearTimers],
  );

  useEffect(() => {
    return () => {
      clearTimers();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, [clearTimers]);

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
