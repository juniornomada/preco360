import { useCallback, useEffect, useRef, useState } from "react";

type SpeechAlternative = {
  transcript: string;
};

type SpeechResult = {
  0?: SpeechAlternative;
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

export function normalizeVoiceSearchTranscript(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "")
    .trim();
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
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSupported = getSpeechRecognitionConstructor() !== null;

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

      recognitionRef.current?.abort();

      const recognition = new Recognition();
      recognition.lang = "pt-BR";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        recognitionRef.current = recognition;
        setError(null);
        setIsListening(true);
      };

      recognition.onresult = (event) => {
        const lastResult = event.results[event.results.length - 1];
        const transcript = normalizeVoiceSearchTranscript(
          lastResult?.[0]?.transcript ?? "",
        );
        if (transcript) {
          onTranscript(transcript);
        }
      };

      recognition.onerror = (event) => {
        setError(voiceErrorMessage(event.error));
        setIsListening(false);
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
        setIsListening(false);
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

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return {
    isSupported,
    isListening,
    error,
    startListening,
    stopListening,
  };
}
