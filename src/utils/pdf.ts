import * as pdfjs from 'pdfjs-dist';

// Use a CDN for the worker to ensure it's always accessible in the browser
// The version should match the installed pdfjs-dist version
const PDFJS_VERSION = '5.5.207';
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

export const extractTextFromPdf = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += `\n[PÁGINA ${i}]\n` + pageText + '\n';
  }

  return fullText;
};
