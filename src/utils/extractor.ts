export const extractDataLocally = (text: string, fileName: string) => {
  const result: {
    personName?: string;
    date?: string;
    presidingEntity?: 'Juiz' | 'Procurador' | 'Desconhecido';
    topics?: any[];
  } = {};

  // Try to extract name from filename or text
  // Filenames often look like "Inquirição - Nome.pdf"
  const nameMatch = fileName.match(/(?:Inquirição|Interrogatório|Transcrição)\s*-\s*([^.]+)/i);
  if (nameMatch) {
    result.personName = nameMatch[1].trim();
  }

  // Try to find date in text (DD/MM/YYYY or DD de Mês de YYYY)
  const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})|(\d{1,2}\s+de\s+[a-zA-Zç]+\s+de\s+\d{4})/i);
  if (dateMatch) {
    result.date = dateMatch[0];
  }

  // Try to find presiding entity
  if (text.toLowerCase().includes('juiz') || text.toLowerCase().includes('meritíssimo')) {
    result.presidingEntity = 'Juiz';
  } else if (text.toLowerCase().includes('procurador') || text.toLowerCase().includes('ministério público')) {
    result.presidingEntity = 'Procurador';
  } else {
    result.presidingEntity = 'Desconhecido';
  }

  return result;
};
