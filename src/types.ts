export interface Topic {
  topic: string;
  description: string;
  quote?: string;
  timestamps?: string[];
  pages?: number[];
}

export interface AudioSegment {
  timestamp: string;
  seconds: number;
  text: string;
  speaker?: string;
}

export interface AnalyzedDocument {
  id: string;
  fileName: string;
  folderName: string;
  personName: string;
  date: string;
  presidingEntity: 'Juiz' | 'Procurador' | 'Desconhecido';
  topics: Topic[];
  rawText: string;
  fileType: 'inquirição' | 'interrogatório' | 'transcrição' | 'resumo' | 'áudio';
  phase: 'inquerito' | 'instrucao' | 'julgamento';
  parentFolder?: string;
  audioSegments?: AudioSegment[];
  isAudio?: boolean;
  speakerAliases?: Record<string, string>;
}

export interface ProjectData {
  name: string;
  lastUpdated: string;
  documents: AnalyzedDocument[];
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
