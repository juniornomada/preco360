import { cn } from "@/lib/utils";
import {
  canonicalRetailerName,
  retailerLogoPath,
} from "@/lib/retailerNames";

type RetailerLogoProps = {
  retailer?: string | null;
  className?: string;
  imageClassName?: string;
  nameClassName?: string;
  showName?: boolean;
};

export default function RetailerLogo({
  retailer,
  className,
  imageClassName,
  nameClassName,
  showName = false,
}: RetailerLogoProps) {
  const name = canonicalRetailerName(retailer);
  const logo = retailerLogoPath(retailer);

  if (!name) return null;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span
        className={cn(
          "flex h-7 w-12 shrink-0 items-center justify-center overflow-visible bg-transparent px-1 py-0.5",
          imageClassName,
        )}
        aria-hidden="true"
      >
        {logo ? (
          <img
            src={logo}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <span className="text-[10px] font-extrabold text-slate-700">
            {name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </span>
      {showName && (
        <span
          className={cn(
            "min-w-0 truncate text-[11px] text-muted-foreground",
            nameClassName,
          )}
        >
          {name}
        </span>
      )}
    </span>
  );
}
