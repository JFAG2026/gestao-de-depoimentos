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
    
    // Enhance error message if it's an API error
    if (error.message && (error.message.includes("API key not valid") || error.message.includes("401") || error.message.includes("403"))) {
      error.message = `Erro de Autenticação: ${error.message}. Verifique a sua chave API.`;
    } else if (error.message && (error.message.includes("RESOURCE_EXHAUSTED") || error.message.includes("429"))) {
      error.message = "Limite de quota atingido (429). Por favor, aguarde.";
    }
    
    // Handle invalid key error by prompting for a new one
    const isAuthError = 
      errorStr.includes("API key not valid") || 
      errorStr.includes("INVALID_ARGUMENT") ||
      errorStr.includes("401") ||
      errorStr.includes("403") ||
      errorStr.includes("Requested entity was not found");

    if (isAuthError && typeof window !== 'undefined' && (window as any).aistudio) {
      console.warn("Chave API inválida ou não encontrada. A abrir seletor...");
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

export const analyzeDocumentText = async (text: string, fileName: string, folderName: string, file?: File): Promise<{ personName: string; topics: any[] }> => {
  return withRetry(async (ai) => {
    const isPdf = fileName.toLowerCase().endsWith('.pdf');
    const cleanedText = text.replace(/\[PÁGINA \d+\]/g, '').trim();
    const isTextInsufficient = cleanedText.length < 100;
    
    let contents: any;
    
    if (isPdf && isTextInsufficient && file) {
      console.log(`Texto extraído insuficiente para ${fileName}. A enviar PDF diretamente para a IA...`);
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      
      contents = {
        parts: [
          { inlineData: { data: base64Data, mimeType: "application/pdf" } },
          { text: `És um Especialista em Análise de Processos Judiciais. 
          Analise o PDF anexo (${fileName} na pasta ${folderName}) e extraia os principais tópicos, questões e factos discutidos.
          
          INSTRUÇÕES CRÍTICAS PARA OS TÓPICOS:
          1. Identifica o nome da pessoa que está a prestar o depoimento (testemunha, arguido, etc.). Coloca no campo 'personName'.
          2. Identifica os temas centrais do interrogatório/inquirição. 
          3. Para cada tema, cria um título (campo 'topic') que seja OBRIGATORIAMENTE claro, contextual e autoexplicativo (ex: "Contradição sobre a entrega de 50.000€ no Porto" em vez de "Contradição").
          4. No campo 'description', resume o que foi perguntado e o que foi respondido sobre esse tema.
          5. No campo 'quote', extrai uma citação literal (ipsis verbis) que seja a prova mais relevante desse tópico.
          6. Se identificares carimbos de tempo [MM:SS] ou números de página, coloca-os nos campos 'timestamps' e 'pages' respetivamente.
          7. Se o documento for um interrogatório, foca-te nas perguntas incisivas e nas respostas que confirmam ou negam factos da acusação.` }
        ]
      };
    } else {
      contents = `És um Especialista em Análise de Processos Judiciais. 
      Analise o seguinte texto de um documento jurídico (${fileName} na pasta ${folderName}) e extraia os principais tópicos, questões e factos discutidos.
      
      INSTRUÇÕES CRÍTICAS PARA OS TÓPICOS:
      1. Identifica o nome da pessoa que está a prestar o depoimento (testemunha, arguido, etc.). Coloca no campo 'personName'.
      2. Identifica os temas centrais do interrogatório/inquirição. 
      3. Para cada tema, cria um título (campo 'topic') que seja OBRIGATORIAMENTE claro, contextual e autoexplicativo (ex: "Contradição sobre a entrega de 50.000€ no Porto" em vez de "Contradição").
      4. No campo 'description', resume o que foi perguntado e o que foi respondido sobre esse tema.
      5. No campo 'quote', extrai uma citação literal (ipsis verbis) que seja a prova mais relevante desse tópico.
      6. Se o texto contiver carimbos de tempo [MM:SS], extrai-os para o campo 'timestamps'.
      7. Se o texto contiver [PÁGINA X], extrai o número para o campo 'pages'.
      8. Se o documento for um interrogatório, foca-te nas perguntas incisivas e nas respostas que confirmam ou negam factos da acusação.

      Texto:
      ${text.substring(0, 35000)}`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            personName: { type: Type.STRING, description: "Nome completo da testemunha ou arguido identificado no documento." },
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
          required: ["personName", "topics"]
        }
      }
    });

    try {
      return JSON.parse(response.text || '{"personName": "Desconhecido", "topics": []}');
    } catch (e) {
      console.error("Failed to parse Gemini response", e);
      return { personName: "Desconhecido", topics: [] };
    }
  }, fileName);
};
