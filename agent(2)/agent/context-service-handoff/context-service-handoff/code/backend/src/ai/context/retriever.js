function retrieveContext({ query, index, contextHints = [], limit = 8 }) {
  const terms = tokenize([query, ...contextHints].join(" "));

  return index
    .map((entry) => ({ ...entry, score: scoreEntry(entry, terms, contextHints) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
    .slice(0, limit)
    .map((entry) => ({
      relativePath: entry.relativePath,
      layer: entry.layer,
      moduleType: entry.moduleType,
      score: entry.score,
      snippet: createSnippet(entry.content, terms),
    }));
}

function scoreEntry(entry, terms, contextHints) {
  const haystack = `${entry.relativePath}\n${entry.content}`.toLowerCase();
  const hintScore = contextHints.reduce((score, hint) => {
    const normalizedHint = String(hint).toLowerCase();
    if (!normalizedHint) return score;
    if (entry.relativePath.toLowerCase() === normalizedHint) return score + 80;
    if (entry.relativePath.toLowerCase().includes(normalizedHint)) return score + 30;
    if (haystack.includes(normalizedHint)) return score + 8;
    return score;
  }, 0);

  const termScore = terms.reduce((score, term) => {
    if (!term) return score;
    if (entry.relativePath.toLowerCase().includes(term)) return score + 10;
    if (haystack.includes(term)) return score + 2;
    return score;
  }, 0);

  return hintScore + termScore;
}

function createSnippet(content, terms) {
  const firstHit = terms
    .map((term) => content.toLowerCase().indexOf(term))
    .filter((position) => position >= 0)
    .sort((left, right) => left - right)[0];
  const start = Math.max(0, (firstHit || 0) - 160);
  return content.slice(start, start + 700);
}

function tokenize(text) {
  const asciiTerms = String(text).toLowerCase().match(/[a-z0-9_.\-/]+/g) || [];
  const chineseTerms = String(text).match(/[一-鿿]{2,}/g) || [];
  const splitChinese = chineseTerms.flatMap((term) => {
    const chunks = [];
    for (let index = 0; index < term.length - 1; index += 1) {
      chunks.push(term.slice(index, index + 2));
    }
    return [term, ...chunks];
  });

  return [...new Set([...asciiTerms, ...splitChinese])];
}

module.exports = { retrieveContext, tokenize };
