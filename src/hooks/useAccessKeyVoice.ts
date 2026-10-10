import { useCallback, useEffect, useRef, useState } from "react";
import {
  accessKeyDigitsFromTranscript,
  sanitizeAccessKeyDigits,
} from "@/lib/accessKeyVoice";

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

const ACCESS_KEY_LENGTH = 44;
const RESTART_DELAY_MS = 120;
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
  return "A escuta foi interrompida pelo navegador. Tentando continuar…";
}

function isFatalRecognitionError(error?: string) {
  return (
    error === "not-allowed" ||
    error === "service-not-allowed" ||
    error === "audio-capture"
  );
}

export function useAccessKeyVoice() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const committedDigitsRef = useRef("");
  const listeningRequestedRef = useRef(false);
  const onDigitsRef = useRef<
    ((digits: string, complete: boolean) => void) | null
  >(null);

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSupported = getRecognitionConstructor() !== null;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    listeningRequestedRef.current = false;
    clearRestartTimer();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, [clearRestartTimer]);

  const startRecognition = useCallback(() => {
    const Recognition = getRecognitionConstructor();

    if (
      !Recognition ||
      !listeningRequestedRef.current ||
      committedDigitsRef.current.length >= ACCESS_KEY_LENGTH
    ) {
      return false;
    }

    clearRestartTimer();

    const sessionBaseDigits = committedDigitsRef.current;
    let lastSessionDigits = "";

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
        // Phrase bias is optional and varies by browser.
      }
    }

    const digitsForResult = (result?: SpeechResult) => {
      if (!result?.length) return "";

      const candidates = Array.from({ length: result.length }, (_, index) =>
        accessKeyDigitsFromTranscript(result[index]?.transcript ?? ""),
      ).filter(Boolean);

      return (
        candidates.sort((a, b) => b.length - a.length)[0] ??
        ""
      );
    };

    const publishDigits = (sessionDigits: string) => {
      const displayed = sanitizeAccessKeyDigits(
        sessionBaseDigits + sessionDigits,
      );
      const complete = displayed.length >= ACCESS_KEY_LENGTH;

      lastSessionDigits = displayed.slice(sessionBaseDigits.length);
      onDigitsRef.current?.(displayed, complete);

      if (complete) {
        committedDigitsRef.current = displayed.slice(0, ACCESS_KEY_LENGTH);
        listeningRequestedRef.current = false;
        setError(null);
        recognition.stop();
      }

      return complete;
    };

    recognition.onstart = () => {
      recognitionRef.current = recognition;
      setError(null);
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let finalDigits = "";
      let interimDigits = "";

      // Rebuild the complete current recognition session every time.
      // This avoids duplicating final hypotheses and preserves the latest
      // interim hypothesis if Android/Chrome closes the native session.
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const digits = digitsForResult(result);
        if (!digits) continue;

        if (result?.isFinal) {
          finalDigits += digits;
        } else {
          interimDigits += digits;
        }
      }

      const remaining = Math.max(
        0,
        ACCESS_KEY_LENGTH - sessionBaseDigits.length,
      );
      const finalWithinLimit = finalDigits.slice(0, remaining);
      const interimWithinLimit = interimDigits.slice(
        0,
        Math.max(0, remaining - finalWithinLimit.length),
      );

      // Final recognition is safe to persist immediately. Interim recognition
      // is displayed live and is committed in onend if the browser ends the
      // session before promoting it to final.
      committedDigitsRef.current = sanitizeAccessKeyDigits(
        sessionBaseDigits + finalWithinLimit,
      );

      publishDigits(finalWithinLimit + interimWithinLimit);
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted") return;

      if (isFatalRecognitionError(event.error)) {
        listeningRequestedRef.current = false;
        setError(voiceErrorMessage(event.error));
        setIsListening(false);
        return;
      }

      // no-speech/network and other transient native recognizer failures
      // must not end a 44-digit dictation. onend will restart the session.
      if (event.error !== "no-speech") {
        setError(voiceErrorMessage(event.error));
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }

      // Chrome/Android may finish a recognition session while its latest
      // hypothesis is still interim. Preserve it before restarting so the
      // user never loses the digits already visible in the field.
      if (lastSessionDigits) {
        committedDigitsRef.current = sanitizeAccessKeyDigits(
          sessionBaseDigits + lastSessionDigits,
        );
        onDigitsRef.current?.(
          committedDigitsRef.current,
          committedDigitsRef.current.length >= ACCESS_KEY_LENGTH,
        );
      }

      const complete =
        committedDigitsRef.current.length >= ACCESS_KEY_LENGTH;

      if (complete) {
        listeningRequestedRef.current = false;
        setError(null);
        setIsListening(false);
        return;
      }

      if (listeningRequestedRef.current) {
        setIsListening(true);
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
      if (listeningRequestedRef.current) {
        setError("Reiniciando a escuta…");
        restartTimerRef.current = window.setTimeout(() => {
          startRecognition();
        }, RESTART_DELAY_MS * 2);
        return true;
      }

      setIsListening(false);
      return false;
    }
  }, [clearRestartTimer]);

  const startListening = useCallback(
    (
      initialDigits: string,
      onDigits: (digits: string, complete: boolean) => void,
    ) => {
      if (!isSupported) {
        setError("Ditado por voz não está disponível neste navegador.");
        return false;
      }

      clearRestartTimer();
      recognitionRef.current?.abort();
      recognitionRef.current = null;

      committedDigitsRef.current = sanitizeAccessKeyDigits(initialDigits);
      onDigitsRef.current = onDigits;

      if (committedDigitsRef.current.length >= ACCESS_KEY_LENGTH) {
        onDigitsRef.current(
          committedDigitsRef.current.slice(0, ACCESS_KEY_LENGTH),
          true,
        );
        setIsListening(false);
        return false;
      }

      listeningRequestedRef.current = true;
      setError(null);
      setIsListening(true);

      return startRecognition();
    },
    [clearRestartTimer, isSupported, startRecognition],
  );

  useEffect(() => {
    return () => {
      listeningRequestedRef.current = false;
      clearRestartTimer();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, [clearRestartTimer]);

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
