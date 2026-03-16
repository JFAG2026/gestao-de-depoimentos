import { GoogleGenAI, Type } from "@google/genai";
import { AudioSegment } from "../types";

// Helper to convert audio to base64
const fileToGenerativePart = async (file: File) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve({
      inlineData: { data: (reader.result as string).split(',')[1], mimeType: file.type }
    });
    reader.readAsDataURL(file);
  });
};

// Clean repetitive loops (hallucinations)
export const cleanRepetitiveLoops = (text: string) => {
    return text.replace(/\b(\w+)(?:[\s,.]+\1\b){3,}/gi, '$1');
};

// Sanitize transcript into segments with global offset
export const sanitizeTranscript = (rawText: string, offsetSeconds = 0) => {
    const segments: AudioSegment[] = [];
    const lines = rawText.split('\n');
    const timestampRegex = /\[(\d{1,2}):(\d{2})\]\s*(.*)/i;

    for (const line of lines) {
        const match = line.match(timestampRegex);
        if (match) {
            const mins = parseInt(match[1]);
            const secs = parseInt(match[2]);
            const totalSeconds = (mins * 60) + secs + offsetSeconds;
            
            const globalMins = Math.floor(totalSeconds / 60);
            const globalSecs = totalSeconds % 60;
            const globalTimestamp = `${String(globalMins).padStart(2, '0')}:${String(globalSecs).padStart(2, '0')}`;

            let text = cleanRepetitiveLoops(match[3]);
            let speaker = undefined;
            
            // Extract speaker if present in **Speaker:** format
            const speakerMatch = text.match(/^\*\*(.*?)\*\*:\s*(.*)/);
            if (speakerMatch) {
                speaker = speakerMatch[1];
                text = speakerMatch[2];
            }

            segments.push({
                timestamp: globalTimestamp,
                seconds: totalSeconds,
                text: text,
                speaker: speaker
            });
        }
    }
    return segments;
};

// Helper to handle retries for Gemini API calls
const withRetry = async <T>(
  fn: (ai: GoogleGenAI) => Promise<T>,
  fileName: string,
  retryCount = 0,
  maxRetries = 8
): Promise<T> => {
  try {
    // Priority: 1. LocalStorage (user provided), 2. window.aistudio (if available), 3. Env vars
    let apiKey = "";
    
    if (typeof window !== 'undefined') {
      apiKey = localStorage.getItem('GEMINI_API_KEY') || "";
    }
    
    if (!apiKey) {
      apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || "";
    }

    const ai = new GoogleGenAI({ apiKey });
    return await fn(ai);
  } catch (error: any) {
    const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
    
    // Robust detection of rate limits (429 / RESOURCE_EXHAUSTED)
    const isRateLimit = 
      error?.status === "RESOURCE_EXHAUSTED" || 
      error?.error?.status === "RESOURCE_EXHAUSTED" ||
      error?.error?.code === 429 ||
      error?.code === 429 ||
      error?.message?.includes("429") || 
      error?.message?.includes("quota") ||
      error?.message?.includes("RESOURCE_EXHAUSTED") ||
      errorStr.includes("RESOURCE_EXHAUSTED") ||
      errorStr.includes("429") ||
      errorStr.includes("quota");

    if (isRateLimit && retryCount < maxRetries) {
      // Exponential backoff: 5s, 10s, 20s, 40s, 80s, 160s... + jitter
      const baseDelay = Math.pow(2, retryCount) * 5000;
      const jitter = Math.random() * 2000; // Add up to 2s of random jitter
      const delay = baseDelay + jitter;
      
      console.warn(`Limite de quota atingido para ${fileName}. A aguardar ${Math.round(delay/1000)}s para tentar novamente... (Tentativa ${retryCount + 1}/${maxRetries})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, fileName, retryCount + 1, maxRetries);
    }
    
    console.error(`Erro final após ${retryCount} tentativas para ${fileName}:`, error);
    
    // Handle invalid key error by prompting for a new one
    if (errorStr.includes("Requested entity was not found") && typeof window !== 'undefined' && (window as any).aistudio) {
      (window as any).aistudio.openSelectKey();
    }
    
    throw error;
  }
};

export const transcribeAudio = async (file: Blob | File, fileName: string, offsetSeconds = 0): Promise<{ fullText: string; segments: AudioSegment[] }> => {
  return withRetry(async (ai) => {
    const systemInstruction = `És um Transcritor Forense Profissional. 
    Transcreve com rigor absoluto. 
    Diarização: Identifica as vozes e usa SEMPRE o formato [MM:SS] **Interlocutor:** Texto.
    Se não souberes o nome, usa Voz 1, Voz 2. 
    Não resumas, transcreve cada palavra. 
    IMPORTANTE: O áudio que vais receber é uma parte de um ficheiro maior. Começa a transcrição do início deste clip como se fosse o tempo 00:00.`;

    // Convert Blob/File to generative part
    const base64Data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });

    const filePart = {
      inlineData: { data: base64Data, mimeType: file.type || "audio/mpeg" }
    };

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [filePart as any, { text: "Transcreve este áudio na íntegra." }] },
      config: { systemInstruction, temperature: 0.1 }
    });

    const rawText = response.text || "";
    const segments = sanitizeTranscript(rawText, offsetSeconds);

    return {
      fullText: rawText,
      segments: segments
    };
  }, fileName);
};

export const analyzeDocumentText = async (text: string, fileName: string, folderName: string): Promise<{ topics: any[] }> => {
  return withRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analise o seguinte texto de um documento jurídico (${fileName} na pasta ${folderName}) e extraia os principais tópicos discutidos. 
      
      INSTRUÇÕES CRÍTICAS PARA OS TÓPICOS:
      1. O título do tópico (campo 'topic') deve ser OBRIGATORIAMENTE claro, contextual e autoexplicativo. 
      2. NUNCA use títulos genéricos como "Entregas de Numerário" ou "Contas Bancárias". 
      3. Use o formato "Contexto/Objeto: Ação/Facto". 
      4. Se o texto contiver carimbos de tempo no formato [MM:SS], identifique os carimbos exatos onde este assunto é discutido e coloque-os no campo 'timestamps'.
      5. Se o texto contiver marcadores de página no formato [PÁGINA X], identifique em que página ou páginas este assunto é abordado e coloque os números das páginas no campo 'pages' (apenas os números).
      6. Foque no "coração" do interrogatório/inquirição. Ignore ou minimize detalhes puramente biográficos ou de identificação, a menos que sejam cruciais para o contexto dos factos.
      7. A descrição deve ser um resumo conciso mas completo do que foi dito sobre esse assunto.
      8. O campo 'quote' deve conter uma citação curta e literal (ipsis verbis) do texto original que fundamente este tópico.

      Texto:
      ${text.substring(0, 30000)}`, // Limit text size for safety
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            topics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  topic: { type: Type.STRING },
                  description: { type: Type.STRING },
                  quote: { type: Type.STRING, description: "A short verbatim quote from the text that supports this topic." },
                  timestamps: { 
                    type: Type.ARRAY, 
                    items: { type: Type.STRING },
                    description: "Lista de carimbos de tempo [MM:SS] onde o assunto é abordado"
                  },
                  pages: {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER },
                    description: "Lista de números de página onde o assunto é abordado"
                  }
                },
                required: ["topic", "description", "quote"]
              }
            }
          },
          required: ["topics"]
        }
      }
    });

    try {
      return JSON.parse(response.text || '{"topics": []}');
    } catch (e) {
      console.error("Failed to parse Gemini response", e);
      return { topics: [] };
    }
  }, fileName);
};
