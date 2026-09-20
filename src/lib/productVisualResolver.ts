import { normalizeSearchText } from "@/lib/flyerAnalysis";

export type ProductVisualDecision = {
  visual: string | null;
  forceIcon: boolean;
  confidence: number;
  reason: "specific" | "category" | "fallback";
};

type Rule = {
  pattern: RegExp;
  visual: string;
  forceIcon?: boolean;
  confidence?: number;
};

const specificRules: Rule[] = [
  // Product type wins over flavors/secondary words.
  { pattern: /barra de proteina|barra de prot\b|barra power proteina|protein bar/, visual: "__proteinbar__", forceIcon: true, confidence: 0.99 },
  { pattern: /100 whey|\bwhey\b|creatina|suplemento|sup bold/, visual: "__supplement__", confidence: 0.98 },
  { pattern: /capsulas?.*dolce gusto|bebida.*dolce gusto|dolce gusto/, visual: "__dolcegusto__", forceIcon: true, confidence: 0.99 },
  { pattern: /toddynho/, visual: "__toddynho__", forceIcon: true, confidence: 0.99 },
  { pattern: /listerine|antisseptico bucal/, visual: "__mouthwash__", forceIcon: true, confidence: 0.99 },
  { pattern: /probio2/, visual: "__yogurt__", forceIcon: true, confidence: 0.99 },
  { pattern: /iog\s*liq|iogurte/, visual: "__yogurt__", confidence: 0.98 },

  // Fish and seafood.
  { pattern: /file de merluza|merluza/, visual: "__fishfillet__", forceIcon: true, confidence: 0.99 },
  { pattern: /bacalhau|peixe|tilapia|pescado|salmao|sardinha|mapara|pangasius|pintado/, visual: "🐟", confidence: 0.97 },
  { pattern: /camarao/, visual: "🍤", confidence: 0.99 },

  // Paper products must stay visually distinct.
  { pattern: /papel toalha|toalha de papel/, visual: "__papertowel__", forceIcon: true, confidence: 0.99 },
  { pattern: /papel higienico|papel hig\b/, visual: "🧻", confidence: 0.99 },
  { pattern: /papel aluminio/, visual: "__wrap__", confidence: 0.97 },

  // Drinks.
  { pattern: /refrigerante|\brefr\b|\bref\b|sukita|guarana|fanta|sprite/, visual: "__soda__", confidence: 0.99 },
  { pattern: /energetico/, visual: "🥤", confidence: 0.98 },
  { pattern: /agua tonica|soda crystal|agua aquamix soda/, visual: "__sparkling__", confidence: 0.97 },
  { pattern: /bebida lactea|beb lactea/, visual: "🥛", confidence: 0.97 },
  { pattern: /composto lacteo/, visual: "__milkpowder__", confidence: 0.97 },
  { pattern: /alim\.?.*soja|alimento de aveia/, visual: "__plantmilk__", confidence: 0.96 },
  { pattern: /vinho|frisante/, visual: "🍷", confidence: 0.99 },
  { pattern: /espumante/, visual: "🥂", confidence: 0.99 },
  { pattern: /aperitivo|campari|aperol/, visual: "🍹", confidence: 0.98 },
  { pattern: /cerveja|\bcerv\b/, visual: "🍺", confidence: 0.99 },
  { pattern: /smirnoff ice|bebida mista.*alcool|cachaca|caipirinha|\bgin\b|licor|coquetel/, visual: "🥃", confidence: 0.97 },
  { pattern: /agua de coco/, visual: "🥥", confidence: 0.99 },
  { pattern: /agua mineral/, visual: "💧", confidence: 0.99 },
  { pattern: /suco|refresco|nectar/, visual: "🧃", confidence: 0.97 },
  { pattern: /achocolatado/, visual: "🍫", confidence: 0.98 },
  // Coffee precedes chocolate: "café sabor chocolate" remains coffee.
  { pattern: /cafe|cappuccino|capsula/, visual: "☕", confidence: 0.97 },
  { pattern: /\bcha\b/, visual: "🍵", confidence: 0.97 },
  { pattern: /xarope/, visual: "🧃", confidence: 0.92 },

  // Biscuits, sweets and baking.
  { pattern: /biscoito|\bbisc\b|choco biscuit|cookie|bolacha|wafer|rosquinha|polvilho|torrada/, visual: "🍪", confidence: 0.98 },
  { pattern: /bala|gelatina|bombom|confeito|goma de mascar|mentos|trident|torrone/, visual: "🍬", confidence: 0.97 },
  { pattern: /creme de avela|nutella/, visual: "🍫", confidence: 0.98 },
  { pattern: /chocolate/, visual: "🍫", confidence: 0.95 },
  { pattern: /acucar/, visual: "__sugarbag__", confidence: 0.99 },
  { pattern: /sal refin|\bsal\b/, visual: "🧂", confidence: 0.98 },
  { pattern: /amendoim/, visual: "🥜", confidence: 0.99 },
  { pattern: /arroz/, visual: "🍚", confidence: 0.99 },
  { pattern: /feijao/, visual: "🫘", confidence: 0.99 },
  { pattern: /farinha de trigo|far venturelli/, visual: "__flourbag__", confidence: 0.99 },
  { pattern: /farinha lactea/, visual: "🥣", confidence: 0.98 },
  { pattern: /farinha de mandioca|far mand|tapioca/, visual: "__tapioca__", confidence: 0.97 },
  { pattern: /fermento|\bferm\b/, visual: "__baking__", confidence: 0.96 },
  { pattern: /fuba|farinha de milho|flocao/, visual: "🌽", confidence: 0.98 },
  { pattern: /azeitona/, visual: "🫒", confidence: 0.99 },
  { pattern: /azeite|oleo/, visual: "🫒", confidence: 0.98 },
  { pattern: /macarrao|nhoque|massa|lasanha/, visual: "🍝", confidence: 0.98 },
  { pattern: /pipoca/, visual: "🍿", confidence: 0.99 },
  { pattern: /farofa/, visual: "🥣", confidence: 0.97 },
  { pattern: /aveia|granola|cereal/, visual: "🥣", confidence: 0.97 },
  { pattern: /bolo|churros|bomba recheada|panettone|torta|waffle/, visual: "🍰", confidence: 0.96 },
  { pattern: /lingua de sogra/, visual: "🥐", confidence: 0.75 },
  { pattern: /mousse de chocolate/, visual: "__mousse__", forceIcon: true, confidence: 0.99 },
  { pattern: /pudim/, visual: "🍮", confidence: 0.99 },
  { pattern: /sorvete|sobremesa/, visual: "🍨", confidence: 0.96 },
  { pattern: /pao/, visual: "🍞", confidence: 0.98 },
  { pattern: /pizza/, visual: "🍕", confidence: 0.99 },
  { pattern: /temaki|sushi|\bmaki\b/, visual: "🍣", confidence: 0.99 },
  { pattern: /sanduiche/, visual: "🥪", confidence: 0.99 },
  { pattern: /kibe/, visual: "🧆", confidence: 0.99 },
  { pattern: /strogonoff/, visual: "🍲", confidence: 0.98 },

  // Condiments and canned vegetables.
  { pattern: /ketchup/, visual: "__ketchup__", forceIcon: true, confidence: 0.99 },
  { pattern: /mostarda/, visual: "__mustard__", confidence: 0.99 },
  { pattern: /molho barbecue|barbecue/, visual: "__bbq__", forceIcon: true, confidence: 0.99 },
  { pattern: /molho de tomate|extrato de tomate|tomate pelado|tomate seco/, visual: "__tomatosauce__", confidence: 0.99 },
  { pattern: /maionese/, visual: "__mayo__", confidence: 0.99 },
  { pattern: /molho de soja|shoyu/, visual: "🥫", confidence: 0.98 },
  { pattern: /molho de pimenta/, visual: "🌶️", confidence: 0.98 },
  { pattern: /caldo sazon/, visual: "🍲", confidence: 0.96 },

  // Potatoes and vegetables.
  { pattern: /batata doce/, visual: "__sweetpotato__", forceIcon: true, confidence: 0.99 },
  { pattern: /batata baroa|mandioquinha/, visual: "__sweetpotato__", confidence: 0.96 },
  { pattern: /aneis de cebola/, visual: "__onionrings__", confidence: 0.98 },
  { pattern: /batata|snacks|petisco/, visual: "__potatosnack__", confidence: 0.92 },
  { pattern: /ervilha/, visual: "__peas__", confidence: 0.99 },
  { pattern: /jardineira de legumes/, visual: "__vegetablemix__", forceIcon: true, confidence: 0.99 },
  { pattern: /palmito/, visual: "🥬", confidence: 0.95 },

  // Meat and deli.
  { pattern: /bacon.*fatias|bacon em fatias/, visual: "__baconslices__", forceIcon: true, confidence: 0.99 },
  { pattern: /bacon/, visual: "__baconchunk__", forceIcon: true, confidence: 0.97 },
  { pattern: /jerked beef|carne seca|charque/, visual: "__jerkedbeef__", forceIcon: true, confidence: 0.99 },
  { pattern: /linguica calabresa|calabresa defumada/, visual: "__calabresa__", forceIcon: true, confidence: 0.99 },
  { pattern: /linguica|\bling\b/, visual: "🌭", confidence: 0.97 },
  { pattern: /salsicha|hot dog/, visual: "🌭", confidence: 0.99 },
  { pattern: /costela suina|costelinha suina|bisteca suina|panceta suina/, visual: "__porkribs__", forceIcon: true, confidence: 0.98 },
  { pattern: /hamburguer/, visual: "🍔", confidence: 0.99 },
  { pattern: /frango|sobrecoxa|\bcoxa\b|coxinha|asas|\basa\b|meio da asa|filezinho|steak/, visual: "🍗", confidence: 0.98 },
  { pattern: /contra file|coxao|patinho|acem|osso buco|miolo do sete|carne moida|bovino|bovina|\bcarne\b|lagarto|pernil|lombo|paleta|ponta de peito/, visual: "🥩", confidence: 0.97 },
  { pattern: /mortadela|presunto|salame/, visual: "🥓", confidence: 0.97 },

  // Dairy.
  { pattern: /manteiga|margarina/, visual: "🧈", confidence: 0.99 },
  { pattern: /queijo|cream cheese|requeijao|ricota|quark/, visual: "🧀", confidence: 0.99 },
  { pattern: /leite longa vida|leite uht|leite integral|leite desnatado|leite semidesnatado|leite zero lactose/, visual: "__milkcarton__", confidence: 0.99 },
  { pattern: /leite|batavinho/, visual: "🥛", confidence: 0.97 },
  { pattern: /ovo/, visual: "🥚", confidence: 0.99 },
  { pattern: /\bmel\b/, visual: "🍯", confidence: 0.99 },

  // Produce.
  { pattern: /champignon|cogumelo|shimeji/, visual: "🍄", confidence: 0.99 },
  { pattern: /pickles|pepino/, visual: "🥒", confidence: 0.99 },
  { pattern: /alho/, visual: "🧄", confidence: 0.99 },
  { pattern: /brocolis/, visual: "🥦", confidence: 0.99 },
  { pattern: /berinjela/, visual: "🍆", confidence: 0.99 },
  { pattern: /tomate/, visual: "🍅", confidence: 0.99 },
  { pattern: /milho/, visual: "🌽", confidence: 0.99 },
  { pattern: /pimenta/, visual: "🌶️", confidence: 0.99 },
  { pattern: /alface|repolho|couve|acelga/, visual: "🥬", confidence: 0.99 },
  { pattern: /cebola/, visual: "🧅", confidence: 0.99 },
  { pattern: /cenoura/, visual: "🥕", confidence: 0.99 },
  { pattern: /chuchu/, visual: "🥒", confidence: 0.92 },
  { pattern: /beterraba/, visual: "__beet__", confidence: 0.99 },
  { pattern: /abobora|moranga/, visual: "🎃", confidence: 0.99 },
  { pattern: /mandioca/, visual: "🍠", confidence: 0.96 },
  { pattern: /uva verde|uva arra/, visual: "__greengrapes__", forceIcon: true, confidence: 0.99 },
  { pattern: /uva/, visual: "🍇", confidence: 0.99 },
  { pattern: /caju/, visual: "__cashew__", forceIcon: true, confidence: 0.99 },
  { pattern: /melao/, visual: "__melon__", forceIcon: true, confidence: 0.99 },
  { pattern: /abacaxi/, visual: "🍍", confidence: 0.99 },
  { pattern: /melancia/, visual: "🍉", confidence: 0.99 },
  { pattern: /manga/, visual: "🥭", confidence: 0.99 },
  { pattern: /banana/, visual: "🍌", confidence: 0.99 },
  { pattern: /kiwi/, visual: "🥝", confidence: 0.99 },
  { pattern: /maca/, visual: "🍎", confidence: 0.99 },
  { pattern: /pera/, visual: "🍐", confidence: 0.99 },
  { pattern: /laranja|tangerina|mexerica|limao/, visual: "🍊", confidence: 0.98 },
  { pattern: /mamao/, visual: "__papaya__", confidence: 0.99 },
  { pattern: /maracuja|goiaba/, visual: "🍈", confidence: 0.96 },
  { pattern: /mirtilo|blueberry/, visual: "🫐", confidence: 0.99 },
  { pattern: /tamara/, visual: "__datefruit__", confidence: 0.98 },
  { pattern: /hortifruti|legume|verdura/, visual: "🥬", confidence: 0.9 },

  // Pet, hygiene and personal care.
  { pattern: /alimento.*cao|alimento.*gato|racao|whiskas|pedigree|qualidy|club pet|tapete higienico/, visual: "🐾", confidence: 0.97 },
  { pattern: /fralda/, visual: "👶", confidence: 0.99 },
  { pattern: /absorvente/, visual: "__sanitary__", confidence: 0.98 },
  { pattern: /prestobarba|barbeador|aparelho gilette|gillette venus|aparelho de barbear/, visual: "🪒", confidence: 0.99 },
  { pattern: /escova dental|creme dental|gel dental/, visual: "🪥", confidence: 0.99 },
  { pattern: /shampoo|condicionador|kit jacques|sabonete|desodorante|higiene|colonia|hidratante|protetor solar|tintura biocolor|creme de tratamento|lenco umedecido|toalha umed/, visual: "🧴", confidence: 0.96 },

  // Cleaning and household.
  { pattern: /essencia concentrada|agua sanitaria|tira manchas|lava roupa|lava louca|deterg|desengordurante|limpador|cif|veja|uau|sabao|amaciante|desinfetante|cloro|antimofo|multinseticida|remov tupi|cera auto|esponja de aco/, visual: "🧼", confidence: 0.96 },
  { pattern: /rodo|pa p lixo/, visual: "🧹", confidence: 0.98 },
  { pattern: /saco p coleta|sacos para lixo/, visual: "🗑️", confidence: 0.97 },
  { pattern: /ducha|chuveiro/, visual: "🚿", confidence: 0.99 },
  { pattern: /talher|jogo de faca/, visual: "🍴", confidence: 0.99 },
  { pattern: /panela|frigideira/, visual: "🍳", confidence: 0.99 },
  { pattern: /sandalia|havaianas/, visual: "🩴", confidence: 0.99 },
  { pattern: /cola|super bonder/, visual: "🛠️", confidence: 0.96 },
  { pattern: /orquidea|astromelia|maco de|\bflor\b|costela de adao|planta palmeira|planta suculenta/, visual: "🪴", confidence: 0.98 },
  { pattern: /vaso/, visual: "🪴", confidence: 0.96 },
  { pattern: /caixa organizadora|porta mantimento|\bpote\b/, visual: "🫙", confidence: 0.95 },
  { pattern: /\bcopo\b|jogo de copo|prato duralex|\btaca\b/, visual: "🍽️", confidence: 0.94 },
  { pattern: /garrafa termica/, visual: "🫖", confidence: 0.95 },
  { pattern: /pulverizador/, visual: "🧴", confidence: 0.9 },
  { pattern: /mini mixer|grelha/, visual: "🍳", confidence: 0.9 },
  { pattern: /carro hot wheels/, visual: "🚗", confidence: 0.99 },
  { pattern: /pilha duracell/, visual: "🔋", confidence: 0.99 },
  { pattern: /carvao/, visual: "🔥", confidence: 0.98 },
  { pattern: /silicone bucas|filme pvc|saco p alim/, visual: "__wrap__", confidence: 0.9 },
];

function normalizedText(name: string, category?: string | null) {
  return normalizeSearchText(`${category ?? ""} ${name}`);
}

export function resolveProductVisual(
  name: string,
  category?: string | null,
): ProductVisualDecision {
  const text = normalizedText(name, category);

  for (const rule of specificRules) {
    if (rule.pattern.test(text)) {
      return {
        visual: rule.visual,
        forceIcon: Boolean(rule.forceIcon),
        confidence: rule.confidence ?? 0.95,
        reason: "specific",
      };
    }
  }

  return {
    visual: null,
    forceIcon: false,
    confidence: 0,
    reason: "fallback",
  };
}

export function productVisual(name: string, category?: string | null) {
  return resolveProductVisual(name, category).visual;
}

export function forceProductVisual(name: string, category?: string | null) {
  return resolveProductVisual(name, category).forceIcon;
}
