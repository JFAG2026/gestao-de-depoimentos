import * as pdfjs from 'pdfjs-dist';

// Use a CDN for the worker to ensure it's always accessible in the browser
// The version should match the installed pdfjs-dist version
const PDFJS_VERSION = '5.5.207';
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

export const extractTextFromPdf = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  const numPages = pdf.numPages;
  const pages: { index: number, text: string }[] = [];

  // Process pages in smaller chunks to avoid overwhelming memory/CPU
  const PAGE_BATCH_SIZE = 10;
  for (let i = 1; i <= numPages; i += PAGE_BATCH_SIZE) {
    const end = Math.min(i + PAGE_BATCH_SIZE, numPages + 1);
    const batchPromises = [];
    
    for (let j = i; j < end; j++) {
      batchPromises.push((async (pageNum) => {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => 'str' in item ? item.str : '')
            .join(' ');
          
          if (pageText.trim().length === 0) {
            console.warn(`Página ${pageNum} do PDF parece estar vazia ou é uma imagem (sem texto extraível).`);
          }
          
          // Cleanup page object to free memory
          // @ts-ignore
          if (page.cleanup) page.cleanup();
          
          return { index: pageNum, text: `\n[PÁGINA ${pageNum}]\n` + pageText + '\n' };
        } catch (err) {
          console.warn(`Erro na página ${pageNum}:`, err);
          return { index: pageNum, text: `\n[ERRO NA PÁGINA ${pageNum}]\n` };
        }
      })(j));
    }
    
    const batchResults = await Promise.all(batchPromises);
    pages.push(...batchResults);
  }

  // Sort pages to ensure correct order
  pages.sort((a, b) => a.index - b.index);
  fullText = pages.map(p => p.text).join('');

  // Cleanup PDF document
  await pdf.destroy();

  return fullText;
};
