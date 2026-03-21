import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';

// Use a CDN for the worker to ensure it's always accessible in the browser
const PDFJS_VERSION = '5.5.207';
// @ts-ignore
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

self.onmessage = async (e: MessageEvent) => {
  const { file, type, id } = e.data;

  try {
    let text = '';
    const arrayBuffer = file instanceof File ? await file.arrayBuffer() : file;

    if (type === 'pdf') {
      text = await extractTextFromPdf(arrayBuffer);
    } else if (type === 'docx') {
      text = await extractTextFromDocx(arrayBuffer);
    }

    self.postMessage({ id, text, success: true });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error), success: false });
  }
};

async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => 'str' in item ? item.str : '')
      .join(' ');
    pages.push(`\n[PÁGINA ${i}]\n` + pageText + '\n');
    // @ts-ignore
    if (page.cleanup) page.cleanup();
  }

  await pdf.destroy();
  return pages.join('');
}

async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}
