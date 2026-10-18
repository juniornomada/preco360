/** Browser-local purchase date; UTC midnight is tomorrow in Brazil after 21:00. */
export function currentLocalReceiptDate(now = new Date()) {
  const year=now.getFullYear();
  const month=String(now.getMonth()+1).padStart(2,"0");
  const day=String(now.getDate()).padStart(2,"0");
  return year+"-"+month+"-"+day;
}

type PreviousReceipt = {
  supermarket: string | null;
  receipt_date: string | null;
  imported_at: string | null;
  original_line_count: number | null;
  saved_price_count: number | null;
};

const genericStoreWords = new Set([
  "supermercado","supermercados","mercado","mercados","loja","lojas","ltda",
  "comercio","cia","empresa","alimentos","me","sa","s","a","e","de","da","do",
]);

function storeTokens(value: string) {
  return new Set(value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
    .split(/\s+/).filter(token=>token.length>=4&&!genericStoreWords.has(token)));
}

export function possibleRecentReceiptDuplicate(
  previous:PreviousReceipt[],
  current:{supermarket:string;receiptDate:string;originalLineCount:number;savedProductCount:number},
  now=new Date(),
) {
  if(current.originalLineCount<8 ||current.savedProductCount<5) return null;
  const currentStore=storeTokens(current.supermarket);
  if(!currentStore.size) return null;
  for(const receipt of previous){
    const importedAt=Date.parse(String(receipt.imported_at||""));
    if(!Number.isFinite(importedAt) || importedAt>now.getTime() ||
       now.getTime()-importedAt>72*60*60*1000) continue;
    const earlierCount=Number(receipt.original_line_count);
    if(!Number.isFinite(earlierCount)||
       Math.abs(earlierCount-current.originalLineCount)>1) continue;
    const earlierSaved=Number(receipt.saved_price_count);
    if(!Number.isFinite(earlierSaved)||earlierSaved<5 ||
       Math.abs(earlierSaved-current.savedProductCount)>Math.max(2,Math.ceil(current.savedProductCount*.2))) continue;
    const matchedTokens=storeTokens(receipt.supermarket??"");
    if(![...currentStore].some(token=>matchedTokens.has(token))) continue;
    // A photograph may be dated today because the date was not visible;
    // the official receipt may have the previous day. Warn, do not block.
    const earlierDate=Date.parse((receipt.receipt_date??"")+"T12:00:00Z");
    const currentDate=Date.parse(current.receiptDate+"T12:00:00Z");
    if(!Number.isFinite(earlierDate)||!Number.isFinite(currentDate) ||
       Math.abs(earlierDate-currentDate)>48*60*60*1000) continue;
    return receipt;
  }
  return null;
}
