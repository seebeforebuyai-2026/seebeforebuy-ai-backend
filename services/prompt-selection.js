const MAIN_CATEGORY_TO_PROMPT_KEY = {
  default: 'default',
  party_dresses: 'party_dresses',
  cocktail_dress: 'cocktail_dress',
  evening_gown: 'evening_gown',
  indo_western: 'indo_western',
  jacket_kurti: 'jacket_kurti',
  dhoti_pant: 'dhoti_pant',
  winter_wear: 'winter_wear',
  poncho: 'poncho',
  parka_jacket: 'parka_jacket',
};

const PROMPT_RULES = {
  default: ['fashion', 'dress', 'outfit', 'style', 'wear', 'look'],
  party_dresses: ['party dress', 'party dresses', 'formal dress', 'evening wear', 'cocktail', 'gown', 'elegant dress'],
  cocktail_dress: ['cocktail dress', 'cocktail', 'mini dress', 'bodycon', 'wrap dress', 'satin dress'],
  evening_gown: ['evening gown', 'gown', 'ball gown', 'mermaid', 'floor length', 'formal gown', 'black tie'],
  indo_western: ['indo western', 'fusion wear', 'kurti', 'dhoti', 'sherwani', 'ethnic', 'western', 'fusion'],
  jacket_kurti: ['jacket kurti', 'kurti jacket', 'fusion kurti', 'short kurti', 'ethnic jacket'],
  dhoti_pant: ['dhoti pant', 'dhoti', 'dhoti pants', 'fusion pant', 'indian pant'],
  winter_wear: ['winter wear', 'winter', 'coat', 'puffer', 'parka', 'poncho', 'sweater'],
  poncho: ['poncho', 'cape', 'winter poncho', 'shawl'],
  parka_jacket: ['parka jacket', 'parka', 'winter jacket', 'snow jacket', 'cold weather'],
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreText(text, keywords) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return 0;

  return keywords.reduce((score, keyword) => {
    if (!keyword) return score;
    const normalizedKeyword = normalizeText(keyword);
    return normalizedText.includes(normalizedKeyword) ? score + 2 : score;
  }, 0);
}

function buildPromptCandidates(selectedCategories) {
  if (!Array.isArray(selectedCategories)) return [];

  return selectedCategories.reduce((acc, entry) => {
    if (!entry || typeof entry !== 'object') return acc;

    const mainCategory = entry.main_category || entry.mainCategory;
    const subcategories = Array.isArray(entry.subcategories) ? entry.subcategories : [];

    if (!mainCategory && !subcategories.length) return acc;

    const promptKey = MAIN_CATEGORY_TO_PROMPT_KEY[mainCategory] || mainCategory;

    if (promptKey) {
      acc.push({
        promptKey,
        keywords: PROMPT_RULES[promptKey] || [],
        subcategories,
      });
    }

    if (subcategories.length) {
      subcategories.forEach((subcategory) => {
        const subPromptKey = MAIN_CATEGORY_TO_PROMPT_KEY[subcategory] || MAIN_CATEGORY_TO_PROMPT_KEY[mainCategory] || subcategory;
        if (subPromptKey && !acc.some((candidate) => candidate.promptKey === subPromptKey)) {
          acc.push({
            promptKey: subPromptKey,
            keywords: PROMPT_RULES[subPromptKey] || [],
            subcategories: [subcategory],
          });
        }
      });
    }

    return acc;
  }, []);
}

function selectPromptKey({
  productText,
  selectedCategories,
  fallbackCategory = 'default',
}) {
  const candidates = buildPromptCandidates(selectedCategories);
  if (!candidates.length) {
    return fallbackCategory;
  }

  const scored = candidates
    .map((candidate) => {
      const keywordScore = scoreText(productText, candidate.keywords);
      const subcategoryScore = candidate.subcategories.reduce((score, subcategory) => {
        return score + (normalizeText(productText).includes(normalizeText(subcategory)) ? 3 : 0);
      }, 0);

      return {
        ...candidate,
        score: keywordScore + subcategoryScore,
      };
    })
    .sort((a, b) => b.score - a.score);

  const topCandidate = scored[0];
  if (topCandidate?.score > 0) {
    return topCandidate.promptKey;
  }

  return fallbackCategory;
}

module.exports = {
  MAIN_CATEGORY_TO_PROMPT_KEY,
  PROMPT_RULES,
  selectPromptKey,
};
