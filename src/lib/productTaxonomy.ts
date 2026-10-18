/**
 * Shared, conservative merchandise taxonomy for receipt catalog entries and
 * unlinked flyer names. Classification never merges rows, changes prices,
 * reinterprets package quantities, or writes to the database.
 *
 * A null result means "review required" rather than a guessed category.
 */
export type PotatoKind =
  | "potatoFreshCommon"
  | "potatoFreshSweet"
  | "potatoFreshBaroa"
  | "potatoFrozen"
  | "potatoStraw"
  | "potatoSnack"
  | "potatoUnknown";

export type ProductClassification = {
  department: string;
  category: string;
  /** Safe group label, NOT a substitute for brand, package or price matching. */
  kind: string;
  confidence: "high" | "review";
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** Matches only potato as the product head, not meals with potato as an ingredient. */
export function potatoProductKind(value: string): PotatoKind | null {
  const text = normalize(value);
  if (!/^batatas?\b/.test(text)) return null;
  if (/\bpalha\b/.test(text)) return "potatoStraw";
  if (/\b(?:ruffles|lays|lay s|pringles|mister potato|chips|salgadinho|stax)\b/.test(text)) {
    return "potatoSnack";
  }
  if (/\b(?:congelad[ao]s?|pre fritas?|palitos?|rusticas?|smiles|air ?fryer|airfrier|mccain|newbraz|rapmix|delizza|bem brasil)\b/.test(text)) {
    return "potatoFrozen";
  }
  if (/\b(?:baroa|mandioquinha)\b/.test(text)) return "potatoFreshBaroa";
  if (/\bdoce\b/.test(text)) return "potatoFreshSweet";
  if (/\b(?:inglesa|lavada|lavadas|asterix|monalisa|agata|in natura)\b/.test(text) ||
      /^batatas?(?: kg| \d+(?: \d+)?kg)?$/.test(text)) {
    return "potatoFreshCommon";
  }
  // "Batata Uni 130g" and unspecified "batata frita" are not safe to infer.
  return "potatoUnknown";
}

export const potatoCategories: Record<PotatoKind, string> = {
  potatoFreshCommon: "Batata in natura",
  potatoFreshSweet: "Batata-doce in natura",
  potatoFreshBaroa: "Batata-baroa / mandioquinha",
  potatoFrozen: "Batata pré-frita/congelada",
  potatoStraw: "Batata palha",
  potatoSnack: "Salgadinho de batata",
  potatoUnknown: "Batata — tipo a confirmar",
};

export function potatoReferenceKey(value: string): string | null {
  const kind = potatoProductKind(value);
  if (!kind || kind === "potatoUnknown") return null;
  return "batata:" + kind;
}

type Rule = readonly [RegExp, string, string, string];

/**
 * Anchored product-head rules: do not classify "bolo de cenoura" as fresh
 * carrots or "pão de batata" as fresh/frozen potato.
 *
 * New rule families are added from a reviewed inventory, not by guessing
 * based on a keyword appearing anywhere in a description.
 */
const catalogRules: readonly Rule[] = [
  [/^pao de batata\b/, "Padaria", "Pão de batata", "padaria:pao-de-batata"],
  [/^pa(?:o|es)\b/, "Padaria", "Pães", "padaria:paes"],
  [/^bolos?\b/, "Padaria", "Bolos", "padaria:bolos"],
  [/^massa (?:de )?pastel\b/, "Padaria", "Massa para pastel", "padaria:massa-pastel"],
  [/^p(?:ure|urezinho) de batata\b/, "Pratos prontos", "Purê de batata", "prontos:pure-batata"],
  [/^cappucc?inos?\b|^capucinos?\b/, "Mercearia", "Cappuccino", "mercearia:cappuccino"],
  [/^cafe\b/, "Mercearia", "Café", "mercearia:cafe"],
  [/^acucar\b/, "Mercearia", "Açúcar", "mercearia:acucar"],
  [/^arroz\b/, "Mercearia", "Arroz", "mercearia:arroz"],
  [/^feijao\b/, "Mercearia", "Feijão", "mercearia:feijao"],
  [/^far(?:inha|\b)|^fuba\b/, "Mercearia", "Farinhas", "mercearia:farinhas"],
  [/^macarrao\b|^mac(?:\b|\.)/, "Mercearia", "Macarrão", "mercearia:macarrao"],
  [/^milho (?:pipoca|pip)\b/, "Mercearia", "Milho para pipoca", "mercearia:milho-pipoca"],
  [/^milho (?:verde|vd)\b/, "Hortifruti e conservas", "Milho verde — verificar apresentação", "milho:revisar"],
  [/^oleo\b|^azeite\b/, "Mercearia", "Óleos e azeites", "mercearia:oleos"],
  [/^molho\b|^extrato\b|^passata\b/, "Mercearia", "Molhos e extratos", "mercearia:molhos"],
  [/^sal\b|^caldo de\b/, "Mercearia", "Temperos", "mercearia:temperos"],
  [/^biscoito\b|^bisc\b|^bolacha\b|^wafer\b/, "Biscoitos e snacks", "Biscoitos", "snacks:biscoitos"],
  [/^salgadinho\b|^chips\b/, "Biscoitos e snacks", "Salgadinhos", "snacks:salgadinhos"],
  [/^amendoim\b|^castanha\b|^amendoa\b|^macadamia\b/, "Biscoitos e snacks", "Oleaginosas e amendoins", "snacks:oleaginosas"],
  [/^chocolate\b|^bombom\b|^bala\b|^goma\b|^gomets\b|^dori\b/, "Doces", "Doces e chocolates", "doces:geral"],
  [/^leite (?:po|em po)\b/, "Laticínios", "Leite em pó", "laticinio:leite-po"],
  [/^leite (?:cond|condensado)\b/, "Laticínios", "Leite condensado", "laticinio:leite-condensado"],
  [/^leite (?:ferm|fermentado)\b/, "Laticínios", "Leite fermentado", "laticinio:leite-fermentado"],
  [/^leite\b/, "Laticínios", "Leite — verificar apresentação", "laticinio:leite"],
  [/^creme (?:de )?leite\b|^cr leite\b/, "Laticínios", "Creme de leite", "laticinio:creme-leite"],
  [/^queijo\b|^mussarela\b|^mucarela\b|^mozarela\b/, "Laticínios", "Queijos", "laticinio:queijos"],
  [/^manteiga\b|^mant\b/, "Laticínios", "Manteiga", "laticinio:manteiga"],
  [/^margarina\b/, "Laticínios", "Margarina", "laticinio:margarina"],
  [/^iogurte\b|^iog\b/, "Laticínios", "Iogurte", "laticinio:iogurte"],
  [/^ovos?\b/, "Laticínios", "Ovos", "laticinio:ovos"],
  [/^refrigerante\b|^coca cola\b|^fanta\b|^guarana\b/, "Bebidas", "Refrigerantes", "bebida:refrigerante"],
  [/^suco\b|^nectar\b|^bebida de fruta\b/, "Bebidas", "Sucos e néctares", "bebida:suco"],
  [/^agua sanitaria\b/, "Limpeza", "Água sanitária", "limpeza:agua-sanitaria"],
  [/^agua de coco\b/, "Bebidas", "Água de coco", "bebida:agua-coco"],
  [/^agua mineral\b|^agua min\b|^agua\b/, "Bebidas", "Água e bebidas à base de água", "bebida:agua"],
  [/^cerveja\b|^vinho\b/, "Bebidas", "Cervejas e vinhos", "bebida:alcool-e-sem-alcool"],
  [/^energetico\b|^energ\b/, "Bebidas", "Energéticos", "bebida:energetico"],
  [/^bebida lactea\b/, "Laticínios", "Bebida láctea", "laticinio:bebida-lactea"],
  [/^bebida\b/, "Bebidas", "Bebidas — verificar tipo", "bebida:revisar"],
  [/^desinfetante\b|^desinf\b/, "Limpeza", "Desinfetantes", "limpeza:desinfetantes"],
  [/^detergente\b|^lava loucas?\b|^lava louca\b/, "Limpeza", "Detergentes", "limpeza:detergentes"],
  [/^sabao\b|^lava roupas?\b/, "Limpeza", "Lavagem de roupas", "limpeza:lavagem"],
  [/^amaciante\b/, "Limpeza", "Amaciantes", "limpeza:amaciante"],
  [/^limpador\b/, "Limpeza", "Limpadores", "limpeza:limpadores"],
  [/^papel higienico\b/, "Higiene", "Papel higiênico", "higiene:papel-higienico"],
  [/^papel toalha\b/, "Casa e limpeza", "Papel toalha", "casa:papel-toalha"],
  [/^sabonete\b/, "Higiene", "Sabonetes", "higiene:sabonetes"],
  [/^shampoo\b|^xampu\b/, "Higiene", "Shampoo", "higiene:shampoo"],
  [/^condicionador\b/, "Higiene", "Condicionadores", "higiene:condicionador"],
  [/^creme dental\b|^cr d\b/, "Higiene", "Creme dental", "higiene:creme-dental"],
  [/^desodorante\b/, "Higiene", "Desodorantes", "higiene:desodorantes"],
  [/^fralda\b/, "Higiene", "Fraldas", "higiene:fraldas"],
  [/^abacate\b|^abacaxi\b|^banana\b|^maca\b|^laranja\b|^limao\b|^manga\b|^mamao\b|^morango\b|^melancia\b|^melao\b|^goiaba\b|^uva\b/, "Hortifruti", "Frutas", "hortifruti:frutas"],
  [/^cenoura\b|^cebola\b|^alho\b|^chuchu\b|^brocolis\b|^abobora\b|^berinjela\b|^inhame\b|^mandioca\b/, "Hortifruti", "Legumes e verduras", "hortifruti:legumes"],
  [/^coxao\b|^lagarto\b|^ac[eé]m\b|^miolo acem\b|^carne\b|^bife\b/, "Açougue", "Carne bovina — verificar corte", "acougue:bovino"],
  [/^linguica\b|^ling\b|^pernil\b/, "Açougue", "Carnes e embutidos — verificar tipo", "acougue:embutidos"],
  [/^frango\b|^coxa\b|^sobrecoxa\b|^file peito\b|^filez\b/, "Açougue", "Frango — verificar corte", "acougue:frango"],
  [/^file salmao\b|^file tilapia\b|^peixe\b|^sardinha\b|^atum\b/, "Pescados", "Peixes", "pescados:peixes"],
  [/^sorvete\b|^acai\b/, "Congelados", "Sorvetes e sobremesas geladas", "congelados:sobremesas"],
  [/^hamburguer\b|^hamb\b|^kibe\b|^big chicken\b/, "Congelados", "Empanados e preparados", "congelados:preparados"],
  [/^filme pvc\b|^papel aluminio\b|^kit meia\b/, "Casa e utilidades", "Utilidades domésticas", "casa:utilidades"],
  // Families common in imported flyers. Product subtype remains explicit.
  [/^file (?:de )?(?:coxa|sobrecoxa|peito(?: de )?frango|frango)\b/, "Açougue", "Filés de frango", "acougue:file-frango"],
  [/^file (?:de )?(?:tilapia|salmao|merluza|atum|pescada|panga|polaca|peixe)\b/, "Pescados", "Filés de peixe", "pescados:file"],
  [/^file\b/, "Carnes e pescados", "Filés — verificar espécie", "carnes:file-revisar"],
  [/^kit (?:creme dental|escova dental|escovas? de dente)\b/, "Higiene", "Higiene bucal", "higiene:bucal"],
  [/^kit (?:desengordurante|detergente|lava roupas|limpador)\b/, "Limpeza", "Kits de limpeza", "limpeza:kits"],
  [/^maionese\b/, "Mercearia", "Maioneses", "mercearia:maionese"],
  [/^achocolatado (?:em )?capsula\b/, "Mercearia", "Cápsulas de achocolatado", "mercearia:achocolatado-capsula"],
  [/^achocolatado\b/, "Mercearia", "Achocolatado — verificar apresentação", "mercearia:achocolatado-revisar"],
  [/^racao\b/, "Pet", "Ração — verificar animal", "pet:racao-revisar"],
  [/^ketchup\b/, "Mercearia", "Ketchup", "mercearia:ketchup"],
  [/^creme culinario\b/, "Laticínios", "Creme culinário", "laticinio:creme-culinario"],
  [/^creme crocante\b|^creme de avela\b/, "Doces", "Creme doce para passar", "doces:creme"],
  [/^creme hidratante\b|^creme corporal\b/, "Higiene", "Hidratantes", "higiene:hidratante"],
  [/^pizza\b/, "Congelados", "Pizzas", "congelados:pizzas"],
  [/^alimento a base de (?:aveia|soja|arroz|amendoas)\b/, "Bebidas", "Bebidas vegetais", "bebida:vegetal"],
  [/^alimento (?:para|de) (?:caes|gatos|cachorros)\b/, "Pet", "Alimentos pet — verificar animal", "pet:alimento-revisar"],
  [/^costelao? bovin[ao]\b|^costela de boi\b/, "Açougue", "Costela bovina", "acougue:costela-bovina"],
  [/^costelao? suin[ao]\b|^costela de porco\b/, "Açougue", "Costela suína", "acougue:costela-suina"],
  [/^costela\b|^paleta\b|^bisteca\b/, "Açougue", "Cortes de carne — verificar espécie", "acougue:cortes-revisar"],
  [/^toalha (?:de )?(?:banho|rosto|banhao)\b/, "Casa e utilidades", "Toalhas de banho e rosto", "casa:toalhas"],
  [/^pneu\b/, "Automotivo", "Pneus", "auto:pneus"],
  [/^flor\b|^orquidea\b/, "Jardinagem", "Flores e plantas", "jardim:plantas"],
  [/^doce\b/, "Doces", "Doces e sobremesas", "doces:sobremesas"],
  [/^lasanha\b/, "Congelados", "Lasanhas", "congelados:lasanha"],
  [/^whisky\b|^gin\b|^vodka\b|^cachaca\b|^espumante\b|^aperitivo\b/, "Bebidas", "Destilados e outras bebidas alcoólicas", "bebida:alcoolicas"],
  [/^vinagre\b/, "Mercearia", "Vinagres", "mercearia:vinagre"],
  [/^capsulas?\b/, "Bebidas", "Cápsulas — verificar bebida", "bebida:capsulas-revisar"],
  [/^presunto\b/, "Frios e embutidos", "Presunto", "frios:presunto"],
  [/^massa (?:de )?(?:lasanha|macarrao|pizza)\b/, "Mercearia", "Massas", "mercearia:massas"],
  [/^massa (?:de )?modelar\b/, "Brinquedos", "Massinhas de modelar", "brinquedos:massinha"],
  [/^absorvente\b|^protetor diario\b/, "Higiene", "Higiene íntima", "higiene:intima"],
  [/^peito (?:bovin[oa]|de boi)\b|^ponta de peito bovin[oa]\b/, "Açougue", "Peito bovino", "acougue:peito-bovino"],
  [/^peito (?:de )?(?:frango|fgo)\b/, "Açougue", "Peito de frango", "acougue:peito-frango"],
  [/^peito\b/, "Açougue", "Peito — verificar espécie", "acougue:peito-revisar"],
  [/^sandalia\b/, "Vestuário", "Sandálias", "vestuario:sandalias"],
  [/^milho de pipoca\b/, "Mercearia", "Milho para pipoca", "mercearia:milho-pipoca"],
  [/^mistura (?:de )?bolo\b/, "Mercearia", "Mistura para bolo", "mercearia:mistura-bolo"],
  [/^mistura (?:de )?creme de leite\b/, "Laticínios", "Mistura de creme de leite", "laticinio:mistura-creme"],
  [/^empanado\b/, "Congelados", "Empanados", "congelados:empanados"],
  [/^esponja\b/, "Casa e limpeza", "Esponjas", "limpeza:esponjas"],
  [/^copo\b/, "Casa e utilidades", "Copos", "casa:copos"],
  [/^coquetel\b/, "Bebidas", "Coquetéis", "bebida:coquetel"],
  [/^barra (?:de )?cereais?\b/, "Mercearia", "Barras de cereais", "mercearia:barra-cereal"],
  [/^miolo (?:da |de |do )?(?:alcatra|acem|sete)\b/, "Açougue", "Carne bovina — verificar corte", "acougue:bovino"],
  [/^suplemento alimentar\b|^whey protein\b/, "Nutrição", "Suplementos alimentares", "nutricao:suplementos"],
  [/^salame\b/, "Frios e embutidos", "Salames", "frios:salame"],
  [/^coxinha da asa\b|^coxinha (?:de )?frango\b/, "Açougue", "Coxinha da asa ou preparado — verificar", "acougue:coxinha-revisar"],
  [/^gelatina\b/, "Mercearia", "Gelatinas", "mercearia:gelatina"],
  [/^bacon\b/, "Frios e embutidos", "Bacon", "frios:bacon"],
  [/^escova (?:de )?dente\b/, "Higiene", "Escovas de dente", "higiene:escova-dente"],
  [/^escova (?:de )?cabelo\b/, "Higiene", "Escovas de cabelo", "higiene:escova-cabelo"],
  [/^sobremesa\b/, "Doces", "Sobremesas — verificar tipo", "doces:sobremesas-revisar"],
  [/^jerked beef\b/, "Açougue", "Carne bovina curada", "acougue:jerked"],
  [/^pote\b/, "Casa e utilidades", "Potes", "casa:potes"],
  [/^beterraba\b/, "Hortifruti", "Legumes e verduras", "hortifruti:legumes"],
  [/^granola\b/, "Mercearia", "Granolas", "mercearia:granola"],
  [/^locao\b/, "Higiene", "Loções", "higiene:locao"],
  [/^tira manchas?\b/, "Limpeza", "Tira-manchas", "limpeza:tira-manchas"],
  [/^pano\b/, "Casa e limpeza", "Panos de limpeza", "casa:panos"],
  // More product heads found in the remaining unclassified flyer offers.
  [/^toalha umedecida\b|^lenco umedecido\b/, "Higiene", "Lenços umedecidos", "higiene:lencos"],
  [/^toalha (?:de )?(?:mesa|piso|cozinha|praia)\b/, "Casa e utilidades", "Toalhas de uso doméstico", "casa:toalhas-domesticas"],
  [/^toalha\b/, "Casa e utilidades", "Toalhas — verificar tipo", "casa:toalhas-revisar"],
  [/^esfiha\b/, "Padaria", "Esfihas", "padaria:esfihas"],
  [/^licor\b/, "Bebidas", "Licores", "bebida:licores"],
  [/^mirtilo\b|^pera\b|^coco (?:verde|seco|fresco)?\b/, "Hortifruti", "Frutas", "hortifruti:frutas"],
  [/^panceta\b/, "Açougue", "Panceta suína", "acougue:panceta"],
  [/^brinquedo\b|^boneca\b/, "Brinquedos", "Brinquedos e bonecas", "brinquedos:geral"],
  [/^vassoura\b/, "Casa e limpeza", "Vassouras", "limpeza:vassouras"],
  [/^antisseptico\b/, "Higiene", "Antissépticos", "higiene:antissepticos"],
  [/^panela\b/, "Casa e utilidades", "Panelas", "casa:panelas"],
  [/^confeito\b/, "Doces", "Confeitos", "doces:confeitos"],
  [/^saco de lixo\b|^sacos de lixo\b/, "Casa e limpeza", "Sacos de lixo", "casa:saco-lixo"],
  [/^papel alum\b/, "Casa e utilidades", "Papel alumínio", "casa:papel-aluminio"],
  [/^esc d colg\b/, "Higiene", "Escovas de dente", "higiene:escova-dente"],
  [/^elast ricca\b/, "Higiene", "Acessórios para cabelo", "higiene:acessorios-cabelo"],
  [/^disqueti\b/, "Doces", "Confeitos de chocolate", "doces:confeitos"],
  [/^pimenta americana\b/, "Hortifruti", "Pimentas frescas", "hortifruti:pimentas"],
  [/^escova\b/, "Higiene e limpeza", "Escovas — verificar uso", "higiene:escovas-revisar"],
  [/^milho\b/, "Mercearia e hortifruti", "Milho — verificar apresentação", "milho:revisar"],
  // Conservative product-head mappings for recognized NFC-e abbreviations.
  [/^amido (?:de )?milho\b/, "Mercearia", "Amido de milho", "mercearia:amido-milho"],
  [/^azeit\b|^azeitona\b/, "Mercearia", "Azeitonas", "mercearia:azeitonas"],
  [/^broto feijao\b/, "Hortifruti", "Brotos", "hortifruti:brotos"],
  [/^canjica\b/, "Mercearia", "Canjica", "mercearia:canjica"],
  [/^cereal\b/, "Mercearia", "Cereais", "mercearia:cereais"],
  [/^ch nestle kit kat\b/, "Doces", "Chocolates", "doces:chocolate"],
  [/^cha\b/, "Mercearia", "Chás", "mercearia:chas"],
  [/^ervilha\b/, "Hortifruti e conservas", "Ervilhas — verificar apresentação", "hortifruti:ervilha"],
  [/^erva doce\b|^louro\b/, "Mercearia", "Ervas e temperos", "mercearia:ervas"],
  [/^farofa\b/, "Mercearia", "Farofas", "mercearia:farofas"],
  [/^ferm\b|^fermento\b/, "Mercearia", "Fermentos", "mercearia:fermentos"],
  [/^goiabada\b/, "Doces", "Doces de frutas", "doces:frutas"],
  [/^inset\b|^inseticida\b/, "Limpeza", "Inseticidas", "limpeza:inseticidas"],
  [/^jubes\b/, "Doces", "Balas e gomas", "doces:balas"],
  [/^kit elseve\b|^kit shamp\b/, "Higiene", "Kits capilares", "higiene:kit-capilar"],
  [/^maracuja\b|^murcote\b|^tangerina\b/, "Hortifruti", "Frutas", "hortifruti:frutas"],
  [/^miolo sete\b|^patinho\b|^moida\b/, "Açougue", "Carne bovina — verificar corte", "acougue:bovino"],
  [/^mort\b|^mortadela\b/, "Frios e embutidos", "Mortadela", "frios:mortadela"],
  [/^mostarda\b|^pimenta reino\b|^paprica\b|^tempero\b/, "Mercearia", "Temperos e condimentos", "mercearia:condimentos"],
  [/^nozes\b/, "Biscoitos e snacks", "Oleaginosas e amendoins", "snacks:oleaginosas"],
  [/^palmit\b|^palmito\b/, "Mercearia", "Palmitos", "mercearia:palmito"],
  [/^pepino\b|^pimentao\b|^quiabo\b|^repolho\b|^tomate\b/, "Hortifruti", "Legumes e verduras", "hortifruti:legumes"],
  [/^pirulito\b|^trident\b/, "Doces", "Balas e gomas", "doces:balas"],
  [/^qj\b|^qjo\b|^req\b|^requeijao\b/, "Laticínios", "Queijos e requeijões — verificar tipo", "laticinio:queijos-revisar"],
  [/^refresc\b|^refresco\b/, "Bebidas", "Refrescos — verificar apresentação", "bebida:refresco"],
  [/^ref\b|^refrig\b|^sprite\b/, "Bebidas", "Refrigerantes", "bebida:refrigerante"],
  [/^rosca\b/, "Padaria", "Roscas", "padaria:roscas"],
  [/^saco lixo\b|^sc lixo\b|^saco p alim\b/, "Casa e limpeza", "Sacos para casa", "casa:sacos"],
  [/^salg\b|^sn (?:cheetos|doritos)\b/, "Biscoitos e snacks", "Salgadinhos", "snacks:salgadinhos"],
  [/^sals\b|^salsicha\b/, "Frios e embutidos", "Salsichas", "frios:salsichas"],
  [/^sushi\b/, "Pratos prontos", "Sushi", "prontos:sushi"],
  [/^svt kibon\b/, "Congelados", "Sorvetes e sobremesas geladas", "congelados:sobremesas"],
  [/^toalha papel\b/, "Casa e limpeza", "Papel toalha", "casa:papel-toalha"],
  [/^yakult\b/, "Laticínios", "Leite fermentado", "laticinio:leite-fermentado"],
  [/^fgo\b|^file coxa\b|^b chicken\b/, "Açougue", "Frango — verificar corte", "acougue:frango"],
  [/^lg tp calab\b/, "Frios e embutidos", "Linguiças", "frios:linguica"],
];

/** A deliberate null prevents automated incorrect substitutions. */
export function classifyProductName(value: string): ProductClassification | null {
  const text = normalize(value);
  if (!text) return null;
  const potato = potatoProductKind(value);
  if (potato) {
    if (potato === "potatoUnknown") return null;
    return {
      department: potato.startsWith("potatoFresh") ? "Hortifruti" :
        potato === "potatoFrozen" ? "Congelados" : "Biscoitos e snacks",
      category: potatoCategories[potato],
      kind: "batata:" + potato,
      confidence: "high",
    };
  }
  const rule = catalogRules.find(([regex]) => regex.test(text));
  return rule
    ? {
      department: rule[1], category: rule[2], kind: rule[3],
      confidence: /verificar|revisar/.test(normalize(rule[2])) || /revisar/.test(rule[3])
        ? "review" : "high",
    }
    : null;
}
