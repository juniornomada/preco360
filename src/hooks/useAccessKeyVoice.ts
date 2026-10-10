import { useCallback, useEffect, useRef, useState } from "react";
import {
  accessKeyDigitsFromTranscript,
  sanitizeAccessKeyDigits,
  removeInterimEcho,
  speechReplayOverlap,
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
  const generationRef = useRef(0);
  const replayGuardRef = useRef<{ digits: string; savedAt: number } | null>(null);
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
    generationRef.current += 1;
    replayGuardRef.current = null;
    clearRestartTimer();
    // Aborting ignores stale interim callbacks after the user presses Parar.
    recognitionRef.current?.abort();
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

    const generation = generationRef.current;
    const sessionBaseDigits = committedDigitsRef.current;
    let lastSessionDigits = "";
    let lastInterimDigits = "";
    // The browser may echo the final interim hypothesis after auto-restart.
    // Only reconcile this immediately following session, never historical digits.
    const replayGuard = replayGuardRef.current;
    replayGuardRef.current = null;

    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.interimResults = true;
    recognition.continuous = true;
    // First alternative is the recognizer's preferred hypothesis. Selecting
    // the longest of several alternatives can introduce repeated words.
    recognition.maxAlternatives = 1;

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

    const digitsForResult = (result?: SpeechResult) =>
      accessKeyDigitsFromTranscript(result?.[0]?.transcript ?? "");

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
      if (generation !== generationRef.current) {
        recognition.abort();
        return;
      }
      recognitionRef.current = recognition;
      setError(null);
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      if (generation !== generationRef.current) return;
      let finalDigits = "";
      let interimDigits = "";

      // Results is a snapshot: intermediate hypotheses replace their prior
      // text. Never append each onresult event to the access key.
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

      // A final segment followed by the same interim text is an echo from
      // Chrome's streaming recognizer, not a new 4-digit group.
      interimDigits = removeInterimEcho(finalDigits, interimDigits);

      // On Android, speech from a provisional segment retained at onend may
      // reappear after the browser starts a fresh recognition instance.
      // Reconcile only that one fragment within a short replay window.
      const candidate = finalDigits + interimDigits;
      let overlap = 0;
      if (replayGuard && performance.now() - replayGuard.savedAt <= 3500) {
        overlap = speechReplayOverlap(replayGuard.digits, candidate);
      }
      if (overlap > 0) {
        const removedFromFinal = Math.min(overlap, finalDigits.length);
        const removedFromInterim = Math.max(0, overlap - removedFromFinal);
        finalDigits = finalDigits.slice(removedFromFinal);
        interimDigits = interimDigits.slice(removedFromInterim);
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
      lastInterimDigits = interimWithinLimit;

      // Final recognition is persisted immediately. Interim text stays
      // provisional until onend, so revised hypotheses cannot duplicate it.
      committedDigitsRef.current = sanitizeAccessKeyDigits(
        sessionBaseDigits + finalWithinLimit,
      );

      publishDigits(finalWithinLimit + interimWithinLimit);
    };

    recognition.onerror = (event) => {
      if (generation !== generationRef.current || event.error === "aborted") return;

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
      if (generation !== generationRef.current) return;
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }

      // A session can end before Chrome promotes its last hypothesis.
      // Preserve the visible digits, but protect them from being replayed by
      // the next native session.
      if (listeningRequestedRef.current && lastSessionDigits) {
        committedDigitsRef.current = sanitizeAccessKeyDigits(
          sessionBaseDigits + lastSessionDigits,
        );
        onDigitsRef.current?.(
          committedDigitsRef.current,
          committedDigitsRef.current.length >= ACCESS_KEY_LENGTH,
        );
        if (lastInterimDigits.length >= 3) {
          replayGuardRef.current = {
            digits: lastInterimDigits.slice(-16),
            savedAt: performance.now(),
          };
        }
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
      generationRef.current += 1;
      replayGuardRef.current = null;
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
      generationRef.current += 1;
      replayGuardRef.current = null;
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
