import { useEffect, useState, type ReactNode } from "react";
import { Tags } from "lucide-react";
import { productVisual } from "@/lib/productVisualResolver";

function ProductVisualIcon({
  visual,
}: {
  visual: string | null;
}) {
  if (visual === "__beet__") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-9 w-9">
        <path d="M24 16c-8.2 0-14 5.7-14 13 0 8.8 9.1 14.1 14 17 4.9-2.9 14-8.2 14-17 0-7.3-5.8-13-14-13Z" fill="#8b3f8f" />
        <path d="M23 17c-5.5-7-3.9-12.2 1.1-15.2 2.3 5.2 2.1 10.2-1.1 15.2Z" fill="#4f9d55" />
        <path d="M27 17c2.3-7.1 7.1-9.6 12.6-8-2.3 5.3-6.4 8.1-12.6 8Z" fill="#68b66b" />
      </svg>
    );
  }

  const simple = (children: ReactNode) => (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-9 w-9">
      {children}
    </svg>
  );

  if (visual === "__zucchini__" || visual === "__zucchini_italiana__" || visual === "__zucchini_paulista__") return simple(<>
    {visual === "__zucchini_paulista__" ? (
      <>
        <path d="M7 29c5-9 15-15 27-14 5 0 8 3 7 7-1 5-8 10-17 12-8 2-15 1-17-5Z" fill="#6fae55" />
        <path d="M12 28c6-5 14-8 23-8" stroke="#a7d482" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        <path d="M35 16c2-4 5-6 8-5-1 4-4 7-8 8Z" fill="#4e8f3d" />
      </>
    ) : (
      <>
        <path d="M9 31c4-10 13-19 24-21 5-1 8 2 7 6-2 8-11 17-21 21-6 2-11 0-10-6Z" fill="#4f9f4b" />
        <path d="M15 31c5-7 11-12 19-15" stroke="#9fd37b" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        <path d="M35 12c1-4 4-7 7-7 0 4-2 7-6 9Z" fill="#3f7f39" />
      </>
    )}
  </>);

  if (visual === "__mayo__") return simple(<>
    <path d="M13 12h22l-2 30H15L13 12Z" fill="#f6f0cf" />
    <path d="M12 8h24v7H12V8Z" fill="#f2c84b" />
    <rect x="17" y="20" width="14" height="12" rx="3" fill="#fff" />
  </>);
  if (visual === "__papaya__") return simple(<>
    <path d="M10 26c2-10 12-18 23-15 8 2 9 10 4 17-7 10-21 11-27 4-2-2-2-4 0-6Z" fill="#f39a32" />
    <path d="M15 27c4-7 11-10 18-9-2 7-8 12-17 13Z" fill="#ffbd4a" />
    <circle cx="26" cy="24" r="1.7" fill="#3e2c22" /><circle cx="30" cy="22" r="1.7" fill="#3e2c22" />
  </>);
  if (visual === "__mouthwash__") return simple(<>
    <rect x="18" y="4" width="12" height="7" rx="2" fill="#d7e8f7" />
    <rect x="13" y="10" width="22" height="33" rx="5" fill="#38a9d6" />
    <rect x="17" y="22" width="14" height="10" rx="2" fill="#eef7fb" />
  </>);
  if (visual === "__proteinbar__") return simple(<>
    <rect x="7" y="14" width="34" height="20" rx="5" fill="#713d24" />
    <rect x="11" y="18" width="26" height="12" rx="3" fill="#b76b3f" />
    <path d="M15 21h18" stroke="#f5d8a8" strokeWidth="3" strokeLinecap="round" />
  </>);
  if (visual === "__yogurt__") return simple(<>
    <path d="M14 14h20l-2.5 26h-15L14 14Z" fill="#f5f7fb" />
    <ellipse cx="24" cy="14" rx="11" ry="4" fill="#dce7f2" />
    <rect x="17" y="21" width="14" height="10" rx="3" fill="#f09ab3" />
  </>);
  if (visual === "__fishfillet__") return simple(<>
    <path d="M8 25c7-10 21-13 31-5-4 12-20 18-31 9l-3 4v-12l3 4Z" fill="#8ecae6" />
    <path d="M15 25c7-5 14-6 20-3-4 6-12 9-20 6Z" fill="#e8f5fb" />
  </>);
  if (visual === "__papertowel__") return simple(<>
    <ellipse cx="24" cy="9" rx="11" ry="4" fill="#f5f5f5" />
    <rect x="13" y="9" width="22" height="31" rx="4" fill="#fff" />
    <ellipse cx="24" cy="40" rx="11" ry="4" fill="#e7e7e7" />
    <ellipse cx="24" cy="9" rx="4" ry="2" fill="#b9a98f" />
  </>);
  if (visual === "__soda__") return simple(<>
    <path d="M18 5h12v7l3 5v25H15V17l3-5V5Z" fill="#d94b4b" />
    <rect x="17" y="21" width="14" height="10" rx="2" fill="#fff" />
    <path d="M20 26h8" stroke="#d94b4b" strokeWidth="2" />
  </>);
  if (visual === "__dolcegusto__") return simple(<>
    <path d="M10 16c2-7 8-11 14-11s12 4 14 11l-4 22H14L10 16Z" fill="#5c3b2e" />
    <ellipse cx="24" cy="16" rx="14" ry="7" fill="#2f211b" />
    <ellipse cx="24" cy="16" rx="9" ry="4" fill="#8c684f" />
  </>);
  if (visual === "__toddynho__") return simple(<>
    <rect x="12" y="7" width="24" height="34" rx="3" fill="#7b3f20" />
    <rect x="16" y="14" width="16" height="15" rx="2" fill="#f2d39a" />
    <path d="M31 7l6-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
  </>);
  if (visual === "__flourbag__") return simple(<>
    <path d="M12 8h24l-2 34H14L12 8Z" fill="#f4e6c8" />
    <rect x="16" y="17" width="16" height="13" rx="2" fill="#fff" />
    <path d="M20 26l4-8 4 8" stroke="#c79a4a" strokeWidth="2" />
  </>);
  if (visual === "__ketchup__") return simple(<>
    <path d="M18 6h12v7l4 8-3 21H17l-3-21 4-8V6Z" fill="#d92727" />
    <rect x="17" y="23" width="14" height="8" rx="2" fill="#fff" />
  </>);
  if (visual === "__bbq__") return simple(<>
    <path d="M17 6h14v5l4 7-4 24H17l-4-24 4-7V6Z" fill="#6f351e" />
    <rect x="16" y="21" width="16" height="10" rx="2" fill="#f5d7a1" />
    <text x="24" y="28" textAnchor="middle" fontSize="6" fontWeight="700" fill="#5a2b18">BBQ</text>
  </>);
  if (visual === "__tomatosauce__") return simple(<>
    <path d="M12 8h24l-3 32H15L12 8Z" fill="#d73b32" />
    <rect x="16" y="17" width="16" height="14" rx="3" fill="#fff" />
    <circle cx="24" cy="24" r="5" fill="#e9453b" />
  </>);
  if (visual === "__sweetpotato__") return simple(<>
    <path d="M8 29c4-13 18-21 31-11 2 11-9 20-23 20-7 0-11-4-8-9Z" fill="#a43d78" />
    <path d="M14 29c5-6 12-10 19-9-2 6-9 12-17 13Z" fill="#f3c050" />
  </>);
  if (visual === "__peas__") return simple(<>
    <path d="M7 27c8-13 25-15 35-5-8 14-25 17-35 5Z" fill="#61a744" />
    {[14,20,26,32].map((x)=><circle key={x} cx={x} cy="26" r="4" fill="#9bd36a" />)}
  </>);
  if (visual === "__vegetablemix__") return simple(<>
    <circle cx="15" cy="17" r="6" fill="#ef8c32" /><circle cx="29" cy="16" r="6" fill="#77b255" />
    <rect x="13" y="27" width="8" height="13" rx="3" fill="#e8b04a" />
    <circle cx="31" cy="31" r="5" fill="#7bbd50" /><circle cx="38" cy="35" r="4" fill="#8bd05d" />
  </>);
  if (visual === "__greengrapes__") return simple(<>
    {[20,27,34,16,24,31,21,28].map((x,i)=><circle key={i} cx={x} cy={18+i*2.4} r="5" fill={i%2?"#a8cf45":"#8fbd35"} />)}
    <path d="M25 10c5-6 10-7 15-4-3 5-8 8-15 8Z" fill="#4d9b45" />
  </>);
  if (visual === "__cashew__") return simple(<>
    <path d="M12 23c3-11 15-16 24-9 7 6 4 17-5 22-9 5-22 0-19-13Z" fill="#e7a23b" />
    <path d="M29 34c4 0 8 3 8 7-5 3-11 0-11-5 0-1 1-2 3-2Z" fill="#8a5b35" />
  </>);
  if (visual === "__melon__") return simple(<>
    <circle cx="24" cy="25" r="16" fill="#c8d96b" />
    <path d="M24 9v32M14 13c7 8 7 17 0 25M34 13c-7 8-7 17 0 25" stroke="#8a9e4e" strokeWidth="2" fill="none" />
  </>);
  if (visual === "__baconslices__") return simple(<>
    <path d="M7 15c8-5 14 4 22-1 5-3 9-1 12 2l-4 8c-7-5-13 3-21 0-5-2-8-1-12 1Z" fill="#e4776f" />
    <path d="M8 29c8-5 14 4 22-1 5-3 9-1 12 2l-4 8c-7-5-13 3-21 0-5-2-8-1-12 1Z" fill="#f09b8f" />
  </>);
  if (visual === "__baconchunk__") return simple(<>
    <path d="M8 17l24-8 9 12-24 18L7 31Z" fill="#db6e63" />
    <path d="M12 20l22-7 3 4-22 9Z" fill="#f1b09d" />
  </>);
  if (visual === "__porkribs__") return simple(<>
    <path d="M7 29c5-12 21-20 34-8-3 13-19 20-31 13Z" fill="#df8f8c" />
    <path d="M15 19l5 16M22 16l5 17M29 16l5 14" stroke="#f7ddd3" strokeWidth="3" />
  </>);
  if (visual === "__jerkedbeef__") return simple(<>
    <rect x="8" y="12" width="14" height="13" rx="4" fill="#8e4e2d" />
    <rect x="24" y="9" width="16" height="14" rx="4" fill="#9d5a35" />
    <rect x="15" y="27" width="18" height="13" rx="4" fill="#7c4328" />
  </>);
  if (visual === "__calabresa__") return simple(<>
    <path d="M8 28c8-15 24-17 33-4-6 10-16 15-28 12" stroke="#b84b3d" strokeWidth="8" strokeLinecap="round" fill="none" />
    <path d="M12 30c8-10 18-11 25-4" stroke="#e17b63" strokeWidth="2" fill="none" />
  </>);
  if (visual === "__mousse__") return simple(<>
    <path d="M11 18h26l-4 23H15L11 18Z" fill="#f2e7dc" />
    <path d="M14 18c3-10 17-12 20 0Z" fill="#69402f" />
    <path d="M18 16c2-5 10-6 13 0Z" fill="#8a5a44" />
  </>);
  if (visual === "__supplement__") return simple(<>
    <ellipse cx="24" cy="10" rx="13" ry="5" fill="#252a31" />
    <path d="M11 10h26l-2 31H13L11 10Z" fill="#3d4652" />
    <rect x="15" y="19" width="18" height="12" rx="3" fill="#eef1f5" />
    <path d="M18 25h12" stroke="#3d4652" strokeWidth="2.5" strokeLinecap="round" />
  </>);
  if (visual === "__sugarbag__") return simple(<>
    <path d="M13 8h22l3 33H10L13 8Z" fill="#f7f4e8" />
    <path d="M15 12h18" stroke="#d9caa1" strokeWidth="2" />
    <rect x="15" y="19" width="18" height="13" rx="3" fill="#fff" />
    <circle cx="24" cy="25.5" r="4" fill="#d8e9f5" />
  </>);
  if (visual === "__milkpowder__") return simple(<>
    <rect x="11" y="8" width="26" height="33" rx="5" fill="#f2f4f7" />
    <rect x="14" y="14" width="20" height="16" rx="3" fill="#d7e8ff" />
    <path d="M19 25c4-7 8-7 12 0" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" />
  </>);
  if (visual === "__plantmilk__") return simple(<>
    <path d="M13 8h19l4 6v28H13V8Z" fill="#edf3e6" />
    <path d="M32 8v7h4" fill="#d1e5c3" />
    <path d="M19 27c5-9 10-10 14-5-3 7-8 10-14 5Z" fill="#6fa95e" />
  </>);
  if (visual === "__milkcarton__") return simple(<>
    <path d="M13 10h18l5 7v25H13V10Z" fill="#f4f7fb" />
    <path d="M31 10v8h5" fill="#dce7f5" />
    <path d="M13 17h23" stroke="#8bb6df" strokeWidth="3" />
    <rect x="17" y="23" width="15" height="11" rx="3" fill="#d7eaff" />
    <path d="M21 30c2-5 5-6 8-1" stroke="#ffffff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
  </>);
  if (visual === "__wrap__") return simple(<>
    <rect x="8" y="13" width="32" height="22" rx="4" fill="#cbd2d9" />
    <ellipse cx="12" cy="24" rx="4" ry="9" fill="#eef1f4" />
    <path d="M16 17h20M16 22h20M16 27h20M16 32h20" stroke="#aeb7c1" strokeWidth="1.5" />
  </>);
  if (visual === "__sparkling__") return simple(<>
    <path d="M18 6h12v7l3 5v24H15V18l3-5V6Z" fill="#7fc8e8" />
    <circle cx="21" cy="25" r="2" fill="#fff" /><circle cx="27" cy="20" r="1.6" fill="#fff" /><circle cx="29" cy="30" r="2.2" fill="#fff" />
  </>);
  if (visual === "__tapioca__") return simple(<>
    <path d="M8 22h32c-1 12-7 19-16 19S9 34 8 22Z" fill="#f1e4c8" />
    <ellipse cx="24" cy="22" rx="16" ry="6" fill="#fafafa" />
    <circle cx="19" cy="21" r="2" fill="#e7e7e7" /><circle cx="26" cy="23" r="2" fill="#e7e7e7" /><circle cx="31" cy="20" r="1.5" fill="#e7e7e7" />
  </>);
  if (visual === "__baking__") return simple(<>
    <rect x="12" y="9" width="24" height="32" rx="4" fill="#f5efe6" />
    <rect x="16" y="17" width="16" height="13" rx="3" fill="#fff" />
    <path d="M20 28c1-6 7-6 8 0" stroke="#d8a85b" strokeWidth="2.5" fill="none" />
  </>);
  if (visual === "__mustard__") return simple(<>
    <path d="M18 6h12v7l4 8-3 21H17l-3-21 4-8V6Z" fill="#e4b927" />
    <rect x="17" y="23" width="14" height="8" rx="2" fill="#fff7cf" />
  </>);
  if (visual === "__onionrings__") return simple(<>
    <ellipse cx="17" cy="23" rx="9" ry="7" fill="none" stroke="#d8a348" strokeWidth="5" />
    <ellipse cx="31" cy="27" rx="9" ry="7" fill="none" stroke="#e3b45d" strokeWidth="5" />
  </>);
  if (visual === "__potatosnack__") return simple(<>
    <path d="M11 8h26l-3 34H14L11 8Z" fill="#d6b246" />
    <path d="M16 18h16v14H16Z" fill="#f6e0a0" />
    <path d="M19 28c3-7 7-9 11-6-2 6-6 9-11 6Z" fill="#c79631" />
  </>);
  if (visual === "__sanitary__") return simple(<>
    <rect x="8" y="19" width="32" height="11" rx="5.5" fill="#f8f8fb" />
    <rect x="14" y="15" width="20" height="19" rx="9" fill="#e7edf6" />
    <rect x="18" y="18" width="12" height="13" rx="6" fill="#ffffff" />
  </>);
  if (visual === "__soapbar__") return simple(<>
    <rect x="8" y="17" width="31" height="20" rx="8" fill="#82d6c9" />
    <rect x="11" y="20" width="25" height="14" rx="6" fill="#b9efe7" />
    <path d="M17 28c4-3 9-4 14-2" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity=".9" />
    <circle cx="34" cy="11" r="4" fill="#dff8f4" stroke="#8fd8cf" strokeWidth="1.2" />
    <circle cx="40" cy="16" r="2.7" fill="#eefcf9" stroke="#8fd8cf" strokeWidth="1.1" />
    <circle cx="27" cy="9" r="2.5" fill="#eefcf9" stroke="#8fd8cf" strokeWidth="1.1" />
  </>);
  if (visual === "__datefruit__") return simple(<>
    <ellipse cx="19" cy="27" rx="7" ry="12" transform="rotate(-18 19 27)" fill="#8a552e" />
    <ellipse cx="31" cy="24" rx="7" ry="12" transform="rotate(18 31 24)" fill="#9a6438" />
    <path d="M24 10c4-5 9-6 13-3-3 5-8 7-13 6Z" fill="#5f9f55" />
  </>);

  return visual ? <span className="text-3xl">{visual}</span> : <Tags className="h-7 w-7 text-primary/70" />;
}

export default function ProductVisual({
  name,
  category,
  imageUrl,
  compact = false,
}: {
  name: string;
  category?: string | null;
  imageUrl?: string | null;
  compact?: boolean;
}) {
  const visual = productVisual(name, category);
  // A valid product image always wins. Visual rules are fallback-only.
  // This prevents manually verified photos from being replaced by generic icons.
  const safeImageUrl = imageUrl;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [safeImageUrl]);

  const showImage = Boolean(safeImageUrl) && !imageFailed;

  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-muted/50 ${compact ? "h-[52px] w-[52px] sm:h-14 sm:w-14" : "h-14 w-14"}`}>
      {safeImageUrl ? (
        <img
          key={safeImageUrl}
          src={safeImageUrl}
          alt=""
          loading="lazy"
          className={`${showImage ? "block" : "hidden"} h-full w-full object-contain p-1`}
          onLoad={() => setImageFailed(false)}
          onError={() => setImageFailed(true)}
        />
      ) : null}
      <span
        aria-hidden="true"
        className={`${showImage ? "hidden" : "flex"} h-full w-full items-center justify-center`}
      >
        <ProductVisualIcon visual={visual} />
      </span>
    </div>
  );
}
