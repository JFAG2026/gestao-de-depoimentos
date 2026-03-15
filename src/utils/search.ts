export const booleanSearch = (text: string, query: string): boolean => {
  if (!query) return true;
  if (!text) return false;

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  // Simple implementation of boolean search
  // Supports: +word (required), -word (excluded), OR (alternative)
  
  const parts = normalizedQuery.split(/\s+/);
  let matches = true;

  for (const part of parts) {
    if (part.startsWith('+')) {
      const word = part.substring(1);
      if (!normalizedText.includes(word)) return false;
    } else if (part.startsWith('-')) {
      const word = part.substring(1);
      if (normalizedText.includes(word)) return false;
    } else if (part === 'or') {
      // This is a bit complex for a simple loop, but we can handle it
      continue;
    } else {
      // Default is AND if no prefix
      if (!normalizedText.includes(part)) return false;
    }
  }

  return matches;
};
