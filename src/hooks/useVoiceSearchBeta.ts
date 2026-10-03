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
const EMPTY_SPEECH_END_GRACE_MS = 900;
const MAX_LISTENING_MS = 4500;
const GROQ_CAPTURE_MS = 3200;
const MIN_GROQ_AUDIO_BYTES = 4_000;
const GROQ_VAD_MIN_CAPTURE_MS = 1_300;
const GROQ_VAD_SILENCE_MS = 900;
const GROQ_VAD_SAMPLE_MS = 50;
const GROQ_VAD_MIN_RMS = 0.008;
const GROQ_VAD_SPEECH_FRAMES = 3;
const GROQ_VAD_MIN_AUDIO_BYTES = 16_000;

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

  const knownAsrCorrections = new Map<string, string>([
    ["sa", "sal"],
    ["sau", "sal"],
    ["so", "sal"],
    ["sao refinado", "sal refinado"],
    ["a horse", "arroz"],
    ["pao ca", "poncan"],
    ["pao can", "poncan"],
    ["entrecô", "Entrecot"],
    ["entreco", "Entrecot"],
    ["novax", "Noix"],
    ["noax", "Noix"],
  ]);

  const knownCorrection = knownAsrCorrections.get(key);
  if (knownCorrection) return knownCorrection;

  // Whisper can confuse the supermarket cut "coxão duro" with acoustically
  // similar phrases. Keep this correction intentionally narrow so a genuine
  // search for "colchão" by itself is not rewritten.
  if (key === "colchao duro" || key === "cochao duro" || key === "poxao duro") return "coxão duro";
  if (key === "colchao mole" || key === "cochao mole" || key === "poxao mole") return "coxão mole";

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
  const silenceTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const pendingTranscriptRef = useRef("");
  const deliveredRef = useRef(false);
  const speechStartedRef = useRef(false);
  const groqCaptureInFlightRef = useRef(false);

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTimingMs, setLastTimingMs] = useState<number | null>(null);

  const isSupported =
    getSpeechRecognitionConstructor() !== null ||
    (typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined");

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
    clearTimers();
    recognitionRef.current?.stop();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, [clearTimers]);

  const startGroqCapture = useCallback(
    async (onTranscript: (transcript: string) => void) => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return false;
      // Synchronous guard: React state updates are not immediate, so rapid taps
      // could otherwise start multiple MediaRecorders before isListening renders.
      if (groqCaptureInFlightRef.current) return true;
      groqCaptureInFlightRef.current = true;

      setError(null);
      setLastTimingMs(null);
      const startedAt = performance.now();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        const recorder = new MediaRecorder(stream, { mimeType });
        recorderRef.current = recorder;
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };

        recorder.onerror = () => {
          groqCaptureInFlightRef.current = false;
          setError("Não foi possível gravar o áudio. Tente novamente.");
          setIsListening(false);
          stream.getTracks().forEach((track) => track.stop());
        };

        recorder.onstop = async () => {
          setIsListening(false);
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          recorderRef.current = null;

          const blob = new Blob(chunks, { type: mimeType });
          if (blob.size < MIN_GROQ_AUDIO_BYTES) {
            groqCaptureInFlightRef.current = false;
            setError("Não consegui capturar fala suficiente. Toque novamente e tente outra vez.");
            return;
          }

          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
              setError("Sua sessão expirou. Entre novamente para usar a busca por voz.");
              return;
            }

            const form = new FormData();
            form.append("file", blob, "voice-search.webm");
            const response = await fetch(
              `${SUPABASE_URL}/functions/v1/transcribe-beta-voice-groq`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                  apikey: SUPABASE_PUBLISHABLE_KEY,
                },
                body: form,
              },
            );
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload?.error ?? "TRANSCRIPTION_FAILED");

            const transcript = normalizeVoiceSearchBetaTranscript(String(payload?.transcript ?? ""));
            if (!transcript) {
              setError("Não consegui reconhecer o produto. Toque novamente e tente outra vez.");
              return;
            }

            setLastTimingMs(Math.round(performance.now() - startedAt));
            onTranscript(transcript);
          } catch (captureError) {
            console.error("Beta Groq transcription error", captureError);
            setError("Não consegui reconhecer o produto. Tente novamente.");
          } finally {
            groqCaptureInFlightRef.current = false;
          }
        };

        recorder.start();
        setIsListening(true);

        // Keep the proven 3.2 s window as a hard fallback, but finish sooner
        // after confidently detected speech followed by sustained silence.
        // This deliberately uses a more conservative VAD than the previous
        // experiment: speech must persist across multiple samples and silence
        // must remain stable for 700 ms before the recorder is stopped.
        let audioContext: AudioContext | null = null;
        let vadTimer: number | null = null;
        let hardStopTimer: number | null = null;

        const cleanupVad = () => {
          if (vadTimer !== null) window.clearInterval(vadTimer);
          if (hardStopTimer !== null) window.clearTimeout(hardStopTimer);
          vadTimer = null;
          hardStopTimer = null;
          void audioContext?.close().catch(() => undefined);
          audioContext = null;
        };

        recorder.addEventListener("stop", cleanupVad, { once: true });

        try {
          const AudioContextCtor = window.AudioContext;
          if (AudioContextCtor) {
            audioContext = new AudioContextCtor();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);

            const samples = new Float32Array(analyser.fftSize);
            let noiseFloor = 0.01;
            let speechFrames = 0;
            let speechDetected = false;
            let lastSpeechAt = startedAt;

            vadTimer = window.setInterval(() => {
              if (recorder.state !== "recording") return;

              analyser.getFloatTimeDomainData(samples);
              let sumSquares = 0;
              for (const sample of samples) sumSquares += sample * sample;
              const rms = Math.sqrt(sumSquares / samples.length);

              // Learn only quieter observations as ambient noise. This avoids
              // treating the user's first syllable as the noise baseline.
              if (rms < noiseFloor) {
                noiseFloor = noiseFloor * 0.8 + rms * 0.2;
              }

              const speechThreshold = Math.max(
                GROQ_VAD_MIN_RMS,
                noiseFloor * 2.8,
              );

              if (rms >= speechThreshold) {
                speechFrames += 1;
                if (speechFrames >= GROQ_VAD_SPEECH_FRAMES) {
                  speechDetected = true;
                  lastSpeechAt = performance.now();
                }
              } else {
                speechFrames = 0;
              }

              const now = performance.now();
              if (
                speechDetected &&
                now - startedAt >= GROQ_VAD_MIN_CAPTURE_MS &&
                now - lastSpeechAt >= GROQ_VAD_SILENCE_MS
              ) {
                // Flush the current MediaRecorder segment before deciding.
                // Very short captures (~13 KB) correlated with clipped short
                // words such as "peixe" -> "beijo" in real beta logs.
                recorder.requestData();
                window.setTimeout(() => {
                  if (recorder.state !== "recording") return;
                  const capturedBytes = chunks.reduce(
                    (total, chunk) =>
                      total + (chunk instanceof Blob ? chunk.size : 0),
                    0,
                  );
                  if (capturedBytes >= GROQ_VAD_MIN_AUDIO_BYTES) recorder.stop();
                }, 80);
              }
            }, GROQ_VAD_SAMPLE_MS);
          }
        } catch (vadError) {
          // VAD is only a latency optimization. Any unsupported/failed Web
          // Audio path falls back to the exact reliable 3.2 s capture.
          console.debug("Beta voice VAD unavailable; using fixed capture", vadError);
        }

        hardStopTimer = window.setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, GROQ_CAPTURE_MS);
        return true;
      } catch (captureError) {
        console.debug("Groq beta capture unavailable", captureError);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        groqCaptureInFlightRef.current = false;
        return false;
      }
    },
    [],
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
        setError(null);
        setLastTimingMs(Math.round(performance.now() - startedAt));
        onTranscript(transcript);
        return true;
      };

      const reportNoText = () => {
        if (deliveredRef.current) return;
        setError("Não consegui reconhecer o produto. Toque novamente e tente outra vez.");
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
            reportNoText();
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

        // Short terms such as "poncã" can trigger speechend before Android/Chrome
        // emits its first transcript. Keep the fast path when text already exists,
        // but give detected speech with no text a brief grace period.
        const stopDelay = pendingTranscriptRef.current.trim()
          ? SPEECH_END_STOP_MS
          : EMPTY_SPEECH_END_GRACE_MS;

        silenceTimerRef.current = window.setTimeout(() => {
          recognition.stop();
        }, stopDelay);
      };

      recognition.onresult = (event) => {
        // Android/Chrome can append an empty result while an earlier entry in
        // the same event still contains the usable hypothesis. Walk backwards
        // instead of trusting only the last slot.
        const results = Array.from(
          { length: event.results.length },
          (_, index) => event.results[index],
        );
        const usableResult =
          [...results].reverse().find((result) => rawAlternatives(result).length > 0) ??
          results[results.length - 1];
        const alternatives = rawAlternatives(usableResult);
        const transcript = bestTranscript(usableResult);

        logNativeVoiceBeta({
          event: "result",
          session_id: nativeSessionId,
          alternatives,
          normalized: transcript,
          is_final: Boolean(usableResult?.isFinal),
          speech_started: speechStartedRef.current,
          elapsed_ms: Math.round(performance.now() - startedAt),
          phrase_bias_supported: phraseBiasSupported,
        });

        if (!transcript) return;

        pendingTranscriptRef.current = transcript;

        if (usableResult?.isFinal) {
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
            reportNoText();
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
          reportNoText();
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

  const startListening = useCallback(
    (onTranscript: (transcript: string) => void) => {
      if (navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined") {
        void startGroqCapture(onTranscript).then((started) => {
          if (!started) startNativeRecognition(onTranscript);
        });
        return true;
      }
      return startNativeRecognition(onTranscript);
    },
    [startGroqCapture, startNativeRecognition],
  );

  useEffect(() => {
    return () => {
      clearTimers();

      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      streamRef.current = null;
      groqCaptureInFlightRef.current = false;

    };
  }, [clearTimers]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

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
