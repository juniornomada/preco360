import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
} from "react";
import { FlaskConical, Mic, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useVoiceSearchBeta } from "@/hooks/useVoiceSearchBeta";
import type { ProductSearchSource } from "@/components/ProductSearchBar";

type ProductSearchBarBetaProps = {
  value: string;
  onChange: (value: string, source: ProductSearchSource) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
};

const ProductSearchBarBeta = forwardRef<HTMLInputElement, ProductSearchBarBetaProps>(
  function ProductSearchBarBeta(
    {
      value,
      onChange,
      placeholder = "Busque por produto...",
      autoFocus = false,
      className = "",
    },
    forwardedRef,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const {
      isListening,
      error,
      lastTimingMs,
      clearError,
      startListening,
      stopListening,
    } = useVoiceSearchBeta();

    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    const handleTyping = (event: ChangeEvent<HTMLInputElement>) => {
      clearError();
      onChange(event.target.value, "typing");
    };

    return (
      <div className={className}>
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <FlaskConical className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="font-bold">Busca por voz Beta</span>
          <span className="text-muted-foreground">produção não é alterada</span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            className="h-12 pl-10 pr-12 text-base"
            placeholder={isListening ? "Ouvindo o produto..." : placeholder}
            value={value}
            onChange={handleTyping}
            autoFocus={autoFocus}
          />
          <button
            type="button"
            className={`absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors ${
              isListening
                ? "animate-pulse bg-amber-500/15 text-amber-500"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-label={isListening ? "Parar busca por voz beta" : "Buscar produto por voz beta"}
            aria-pressed={isListening}
            title={isListening ? "Parar" : "Buscar por voz Beta"}
            onClick={() => {
              if (isListening) {
                stopListening();
                return;
              }

              inputRef.current?.blur();
              startListening((transcript) => onChange(transcript, "voice"));
            }}
          >
            <Mic className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p
            className="mt-1 px-1 text-[10px] text-destructive"
          >
            {error}
          </p>
        )}

        {!error && lastTimingMs !== null && (
          <p className="mt-1 px-1 text-[10px] text-muted-foreground">
            Beta: resultado em {(lastTimingMs / 1000).toFixed(1)} s
          </p>
        )}
      </div>
    );
  },
);

export default ProductSearchBarBeta;
