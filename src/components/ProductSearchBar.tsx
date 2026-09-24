import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
} from "react";
import { Mic, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useVoiceSearch } from "@/hooks/useVoiceSearch";

export type ProductSearchSource = "typing" | "voice";

type ProductSearchBarProps = {
  value: string;
  onChange: (value: string, source: ProductSearchSource) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
};

const ProductSearchBar = forwardRef<HTMLInputElement, ProductSearchBarProps>(
  function ProductSearchBar(
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
      error: voiceSearchError,
      startListening,
      stopListening,
    } = useVoiceSearch();

    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    const handleTyping = (event: ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value, "typing");
    };

    return (
      <div className={className}>
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
                ? "animate-pulse bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-label={
              isListening ? "Parar busca por voz" : "Buscar produto por voz"
            }
            aria-pressed={isListening}
            title={isListening ? "Parar" : "Buscar por voz"}
            onClick={() => {
              if (isListening) {
                stopListening();
                return;
              }

              inputRef.current?.blur();
              startListening((transcript) => {
                onChange(transcript, "voice");
              });
            }}
          >
            <Mic className="h-4 w-4" />
          </button>
        </div>

        {voiceSearchError && (
          <p className="mt-1 px-1 text-[10px] text-destructive">
            {voiceSearchError}
          </p>
        )}
      </div>
    );
  },
);

export default ProductSearchBar;
