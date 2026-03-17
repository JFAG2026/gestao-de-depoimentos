export const extractTextFromDoc = async (file: File): Promise<string> => {
  try {
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve) => {
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.readAsDataURL(file);
    });

    const base64 = await base64Promise;
    const response = await fetch('/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, fileName: file.name })
    });

    if (!response.ok) throw new Error('Failed to extract text from .doc');
    const data = await response.json();
    return data.text || '';
  } catch (error) {
    console.error('Error extracting .doc:', error);
    return '[Erro ao extrair texto do ficheiro .doc]';
  }
};
