import { useCallback, useEffect, useRef, useState } from "react";
import { accessKeyDigitsFromTranscript, sanitizeAccessKeyDigits } from "@/lib/accessKeyVoice";

type SpeechAlternative = { transcript: string };

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
  resultIndex?: number;
  results: SpeechResultList;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

type SpeechRecognitionPhraseLike = { phrase: string; boost: number };
type SpeechRecognitionPhraseConstructor = new (
  phrase: string,
  boost?: number,
) => SpeechRecognitionPhraseLike;

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
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  SpeechRecognitionPhrase?: SpeechRecognitionPhraseConstructor;
};

const MAX_LISTENING_MS = 60_000;
const RESTART_DELAY_MS = 180;
const DIGIT_WORDS = [
  "zero",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
];

function getSpeechWindow() {
  return typeof window === "undefined" ? null : (window as SpeechWindow);
}

function getRecognitionConstructor() {
  const speechWindow = getSpeechWindow();
  return (
    speechWindow?.SpeechRecognition ??
    speechWindow?.webkitSpeechRecognition ??
    null
  );
}

function voiceErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Permita o acesso ao microfone para ditar a chave.";
  }
  if (error === "audio-capture") {
    return "Não foi possível acessar o microfone.";
  }
  if (error === "no-speech") {
    return "Não ouvi números. Toque no microfone e tente novamente.";
  }
  return "Não consegui reconhecer os números. Tente novamente.";
}

export function useAccessKeyVoice() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const committedDigitsRef = useRef("");
  const listeningRequestedRef = useRef(false);
  const onDigitsRef = useRef<((digits: string, complete: boolean) => void) | null>(
    null,
  );

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSupported = getRecognitionConstructor() !== null;

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    listeningRequestedRef.current = false;
    clearTimers();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, [clearTimers]);

  const startRecognition = useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition || !listeningRequestedRef.current) return false;

    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 5;

    const speechWindow = getSpeechWindow();
    if (speechWindow?.SpeechRecognitionPhrase) {
      try {
        recognition.phrases = DIGIT_WORDS.map(
          (phrase) => new speechWindow.SpeechRecognitionPhrase!(phrase, 6),
        );
      } catch {
        // Phrase bias is optional and not supported consistently across browsers.
      }
    }

    const digitsForResult = (result?: SpeechResult) => {
      if (!result?.length) return "";

      const candidates = Array.from({ length: result.length }, (_, index) =>
        accessKeyDigitsFromTranscript(result[index]?.transcript ?? ""),
      ).filter(Boolean);

      const remaining = Math.max(0, 44 - committedDigitsRef.current.length);
      const fitting =
        candidates
          .filter((digits) => digits.length <= remaining)
          .sort((a, b) => b.length - a.length)[0] ??
        candidates.sort((a, b) => b.length - a.length)[0] ??
        "";

      return fitting.slice(0, remaining);
    };

    recognition.onstart = () => {
      recognitionRef.current = recognition;
      setError(null);
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      const start = Math.max(0, event.resultIndex ?? 0);
      let interim = "";

      for (let index = start; index < event.results.length; index += 1) {
        const result = event.results[index];
        const digits = digitsForResult(result);
        if (!digits) continue;

        if (result?.isFinal) {
          committedDigitsRef.current = sanitizeAccessKeyDigits(
            committedDigitsRef.current + digits,
          );
        } else {
          interim += digits;
        }
      }

      const displayed = sanitizeAccessKeyDigits(
        committedDigitsRef.current + interim,
      );
      const complete = displayed.length >= 44;
      onDigitsRef.current?.(displayed, complete);

      if (complete) {
        committedDigitsRef.current = displayed.slice(0, 44);
        listeningRequestedRef.current = false;
        clearTimers();
        recognition.stop();
      }
    };

    recognition.onerror = (event) => {
      if (
        event.error !== "aborted" &&
        event.error !== "no-speech" &&
        listeningRequestedRef.current
      ) {
        setError(voiceErrorMessage(event.error));
        listeningRequestedRef.current = false;
      }

      if (event.error === "no-speech" && listeningRequestedRef.current) {
        setError("Faça uma pausa curta entre os números e tente novamente.");
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }

      if (
        listeningRequestedRef.current &&
        committedDigitsRef.current.length < 44
      ) {
        restartTimerRef.current = window.setTimeout(() => {
          startRecognition();
        }, RESTART_DELAY_MS);
        return;
      }

      setIsListening(false);
    };

    try {
      recognition.start();
      return true;
    } catch {
      setError("Não foi possível iniciar o microfone. Tente novamente.");
      listeningRequestedRef.current = false;
      setIsListening(false);
      return false;
    }
  }, [clearTimers]);

  const startListening = useCallback(
    (
      initialDigits: string,
      onDigits: (digits: string, complete: boolean) => void,
    ) => {
      if (!isSupported) {
        setError("Ditado por voz não está disponível neste navegador.");
        return false;
      }

      clearTimers();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      committedDigitsRef.current = sanitizeAccessKeyDigits(initialDigits);
      onDigitsRef.current = onDigits;
      listeningRequestedRef.current = true;
      setError(null);

      timerRef.current = window.setTimeout(() => {
        listeningRequestedRef.current = false;
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        setIsListening(false);

        if (committedDigitsRef.current.length < 44) {
          setError(
            `Ditado encerrado com ${committedDigitsRef.current.length}/44 dígitos. Toque no microfone para continuar.`,
          );
        }
      }, MAX_LISTENING_MS);

      return startRecognition();
    },
    [clearTimers, isSupported, startRecognition],
  );

  useEffect(() => {
    return () => {
      listeningRequestedRef.current = false;
      clearTimers();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, [clearTimers]);

  const clearError = useCallback(() => setError(null), []);

  return {
    isSupported,
    isListening,
    error,
    clearError,
    startListening,
    stopListening,
  };
}
