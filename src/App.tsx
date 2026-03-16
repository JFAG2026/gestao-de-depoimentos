import React, { useState, useMemo } from 'react';
import { FolderUp, Search, FileJson, Save, FileText, Loader2, ChevronRight, Edit3, Eye, Filter, ExternalLink, Link, Sparkles, LayoutList, Gavel, Scale, Music, Mic, Play, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AnalyzedDocument, ProjectData, AudioSegment } from './types';
import { extractTextFromPdf } from './utils/pdf';
import { extractTextFromWord } from './utils/word';
import { extractDataLocally } from './utils/extractor';
import { booleanSearch } from './utils/search';
import { analyzeDocumentText, transcribeAudio } from './services/gemini';
import { generateWordReport } from './utils/wordReport';
import AudioModal from './components/AudioModal';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [documents, setDocuments] = useState<AnalyzedDocument[]>([]);
  const [filesMap, setFilesMap] = useState<Record<string, File>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [currentlyProcessingId, setCurrentlyProcessingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'inquerito' | 'instrucao' | 'julgamento' | 'search' | 'timeline'>('search');
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [selectedDoc, setSelectedDoc] = useState<AnalyzedDocument | null>(null);
  const [modalView, setModalView] = useState<'text' | 'summary' | 'transcript'>('summary');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [backupCode, setBackupCode] = useState('');
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportPhases, setReportPhases] = useState<('inquerito' | 'instrucao' | 'julgamento')[]>(['inquerito', 'instrucao', 'julgamento']);
  const [isAudioModalOpen, setIsAudioModalOpen] = useState(false);
  const [audioModalDoc, setAudioModalDoc] = useState<AnalyzedDocument | null>(null);
  const [audioModalSeek, setAudioModalSeek] = useState<number | null>(null);
  const [timelineFilters, setTimelineFilters] = useState({ 
    topic: '', 
    witness: '', 
    phases: ['inquerito', 'instrucao', 'julgamento'] as ('inquerito' | 'instrucao' | 'julgamento')[]
  });

  // Check for API Key on mount
  React.useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        // Fallback for local development if window.aistudio is not present
        setHasApiKey(true);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      // Assume success and proceed to the app
      setHasApiKey(true);
    }
  };

  const handleGenerateReport = () => {
    const docsToReport = filteredDocs.filter(doc => reportPhases.includes(doc.phase || 'inquerito'));
    if (docsToReport.length === 0) {
      showNotify("Nenhum documento encontrado para as fases e filtros selecionados.", "error");
      return;
    }
    generateWordReport(docsToReport);
    setShowReportModal(false);
  };

  const showNotify = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  // Filters
  const [filters, setFilters] = useState({
    name: '',
    date: '',
    presiding: '',
    topic: '',
    folder: ''
  });

  const extractTextFromDoc = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const response = await fetch('/api/extract-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, fileName: file.name })
          });
          if (!response.ok) throw new Error('Failed to extract text');
          const data = await response.json();
          resolve(data.text);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const processFiles = async (files: File[]) => {
    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: files.length });

    const newDocs: AnalyzedDocument[] = [];
    
    // Determine phase based on active tab
    const currentPhase = activeTab === 'instrucao' ? 'instrucao' : 
                         activeTab === 'julgamento' ? 'julgamento' : 'inquerito';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProcessingProgress({ current: i + 1, total: files.length });

      try {
        let text = '';
        const name = file.name.toLowerCase();
        const isAudio = name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.m4a') || name.endsWith('.aac') || name.endsWith('.ogg');
        
        if (name.endsWith('.pdf')) {
          text = await extractTextFromPdf(file);
        } else if (name.endsWith('.docx')) {
          text = await extractTextFromWord(file);
        } else if (name.endsWith('.doc')) {
          text = await extractTextFromDoc(file);
        } else if (isAudio) {
          text = "[Áudio pendente de transcrição]";
        }

        const fullPath = file.webkitRelativePath || file.name;
        const pathParts = fullPath.split('/');
        
        // Parent folder (top-level uploaded folder)
        const parentFolder = pathParts.length > 1 ? pathParts[0] : 'Raiz';
        
        // Full folder path (excluding filename)
        const folderName = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : 'Raiz';
        
        const analysis = isAudio ? { personName: file.name.split('.')[0], date: '', presidingEntity: 'Desconhecido', topics: [] } : extractDataLocally(text, file.name);
        
        // Person name from subfolder (if audio and in a subfolder)
        let personName = analysis.personName || 'Desconhecido';
        if (isAudio && pathParts.length > 2) {
          const immediateFolder = pathParts[pathParts.length - 2];
          if (immediateFolder !== parentFolder) {
            personName = immediateFolder;
          }
        }

        // Date parsing from filename (e.g. 1.20260128...)
        let extractedDate = analysis.date || 'Desconhecida';
        if (isAudio) {
          const parts = file.name.split('.');
          const nameAfterDot = parts.length > 1 ? parts[1] : parts[0];
          // Look for YYYYMMDD at the start of the part after the dot
          const dateMatch = nameAfterDot.match(/^(\d{4})(\d{2})(\d{2})/);
          if (dateMatch) {
            extractedDate = `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
          }
        }

        newDocs.push({
          id: crypto.randomUUID(),
          fileName: file.name,
          folderName: folderName,
          parentFolder: parentFolder,
          personName: personName,
          date: extractedDate,
          presidingEntity: (analysis.presidingEntity as any) || 'Desconhecido',
          topics: analysis.topics || [],
          rawText: text,
          fileType: isAudio ? 'áudio' : (folderName.toLowerCase().includes('inquirição') ? 'inquirição' : 
                    folderName.toLowerCase().includes('interrogatório') ? 'interrogatório' : 
                    folderName.toLowerCase().includes('transcrição') ? 'transcrição' : 'resumo'),
          phase: currentPhase,
          isAudio: isAudio
        });

        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        console.error(`Erro ao processar ${file.name}:`, error);
      }
    }

    setDocuments(prev => [...prev, ...newDocs]);
    
    // Store files for linking using multiple keys for robustness
    const newFilesMap: Record<string, File> = {};
    files.forEach(f => {
      const fullPath = f.webkitRelativePath || f.name;
      const pathParts = fullPath.split('/');
      const folderName = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : 'Raiz';
      
      const pathKey = `${folderName}/${f.name}`;
      newFilesMap[pathKey] = f;
      
      // Also store by filename as fallback if not already present
      if (!newFilesMap[f.name]) {
        newFilesMap[f.name] = f;
      }
    });
    setFilesMap(prev => ({ ...prev, ...newFilesMap }));
    
    setIsProcessing(false);
    return newDocs.length;
  };

  const handleFolderUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const supportedFiles = (Array.from(files) as File[]).filter(f => {
      const name = f.name.toLowerCase();
      return name.endsWith('.pdf') || name.endsWith('.docx') || name.endsWith('.doc') || 
             name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.m4a') || name.endsWith('.aac') || name.endsWith('.ogg');
    });

    if (supportedFiles.length === 0) {
      showNotify("Nenhum arquivo PDF, Word ou Áudio suportado encontrado na pasta selecionada.", "error");
      return;
    }

    await processFiles(supportedFiles);
    setActiveTab('search');
  };

  const saveProject = () => {
    const project: ProjectData = {
      name: "Projeto JurisAnalyzer",
      lastUpdated: new Date().toISOString(),
      documents
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `projeto-jurisanalyzer-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLinkPdfs = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newFilesMap: Record<string, File> = {};
    const filesToProcess: File[] = [];
    
    Array.from(files).forEach((f: File) => {
      const name = f.name.toLowerCase();
      if (name.endsWith('.pdf') || name.endsWith('.docx') || name.endsWith('.doc') ||
          name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.m4a') || name.endsWith('.aac') || name.endsWith('.ogg')) {
        
        const fullPath = f.webkitRelativePath || f.name;
        const pathParts = fullPath.split('/');
        const folderName = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : 'Raiz';
        
        const pathKey = `${folderName}/${f.name}`;
        newFilesMap[pathKey] = f;
        
        // Fallback by filename
        if (!newFilesMap[f.name]) {
          newFilesMap[f.name] = f;
        }
        
        // Check if this file is already in our documents list
        const exists = documents.some(doc => doc.fileName === f.name && (doc.folderName === folderName || doc.parentFolder === folderName));
        if (!exists) {
          filesToProcess.push(f);
        }
      }
    });

    setFilesMap(prev => ({ ...prev, ...newFilesMap }));
    
    if (filesToProcess.length > 0) {
      const processedCount = await processFiles(filesToProcess);
      showNotify(`${Object.keys(newFilesMap).length} arquivos vinculados. ${processedCount} novos documentos foram processados e adicionados.`, "success");
    } else {
      showNotify(`${Object.keys(newFilesMap).length} arquivos vinculados com sucesso.`, "success");
    }
  };

  const findFile = (fileName: string, folderName?: string) => {
    if (!fileName) return null;

    // 1. Try exact folder/file match
    if (folderName) {
      const exactKey = `${folderName}/${fileName}`;
      if (filesMap[exactKey]) return filesMap[exactKey];
    }
    
    // 2. Try direct filename match
    if (filesMap[fileName]) return filesMap[fileName];
    
    // 3. Try suffix match (any key that ends with /filename)
    const keys = Object.keys(filesMap);
    const suffixMatch = keys.find(key => key.endsWith(`/${fileName}`));
    if (suffixMatch) return filesMap[suffixMatch];

    // 4. Try case-insensitive filename match
    const lowerFileName = fileName.toLowerCase();
    const caseMatch = keys.find(key => key.toLowerCase() === lowerFileName || key.toLowerCase().endsWith(`/${lowerFileName}`));
    if (caseMatch) return filesMap[caseMatch];
    
    return null;
  };

  const openFile = (fileName: string, page?: number) => {
    const doc = documents.find(d => d.fileName === fileName);
    const file = findFile(fileName, doc?.folderName);
    
    if (file) {
      let url = URL.createObjectURL(file);
      if (page && file.name.toLowerCase().endsWith('.pdf')) {
        url += `#page=${page}`;
      }
      window.open(url, '_blank');
    } else {
      showNotify(`Arquivo original "${fileName}" não encontrado. Por favor, use o botão 'Vincular Pastas' para localizar os arquivos originais.`, "error");
    }
  };

  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 });

  const handleOpenAudio = (doc: AnalyzedDocument, seek: number | null = null) => {
    const file = findFile(doc.fileName, doc.folderName);
    if (!file) {
      showNotify(`Ficheiro áudio "${doc.fileName}" não encontrado. Por favor, use o botão 'Vincular Pastas' para localizar o arquivo original.`, "error");
      return;
    }
    setAudioModalDoc(doc);
    setAudioModalSeek(seek);
    setIsAudioModalOpen(true);
  };

  const handleAiSummarize = async (doc: AnalyzedDocument) => {
    if (!(await ensureApiKey())) return;
    
    setIsAiProcessing(true);
    setCurrentlyProcessingId(doc.id);
    setAiProgress({ current: 0, total: 0 });
    
    try {
      let textToAnalyze = doc.rawText;
      let audioSegments = doc.audioSegments || [];

      const file = filesMap[doc.fileName];

      // If it's audio and not yet transcribed
      if (doc.isAudio && (!doc.audioSegments || doc.audioSegments.length === 0)) {
        if (!file) {
          showNotify("Ficheiro áudio não encontrado para transcrição. Vincule o ficheiro primeiro.", "error");
          setIsAiProcessing(false);
          setCurrentlyProcessingId(null);
          return;
        }

        // Check file size. If > 15MB, we split it.
        // Also split if it's likely long (we'll check duration)
        const CHUNK_SIZE_MB = 15;
        const fileSizeMB = file.size / (1024 * 1024);
        
        if (fileSizeMB > CHUNK_SIZE_MB) {
          showNotify("Ficheiro grande detetado. A dividir em partes para transcrição segura...", "info");
          
          // Get duration to estimate chunks
          const duration = await new Promise<number>((resolve) => {
            const audio = new Audio();
            audio.src = URL.createObjectURL(file);
            audio.onloadedmetadata = () => {
              URL.revokeObjectURL(audio.src);
              resolve(audio.duration);
            };
            audio.onerror = () => resolve(0);
          });

          const CHUNK_DURATION = 600; // 10 minutes per chunk
          const numChunks = Math.ceil(duration / CHUNK_DURATION) || Math.ceil(fileSizeMB / CHUNK_SIZE_MB);
          setAiProgress({ current: 0, total: numChunks });

          let combinedText = "";
          let combinedSegments: AudioSegment[] = [];

          for (let i = 0; i < numChunks; i++) {
            setAiProgress(prev => ({ ...prev, current: i + 1 }));
            
            const startByte = Math.floor((i / numChunks) * file.size);
            const endByte = Math.floor(((i + 1) / numChunks) * file.size);
            const chunkBlob = file.slice(startByte, endByte, file.type);
            
            // Estimate offset based on time
            const offsetSeconds = i * (duration / numChunks);
            
            const transcription = await transcribeAudio(chunkBlob, `${file.name} (Parte ${i+1})`, offsetSeconds);
            combinedText += (combinedText ? "\n\n" : "") + transcription.fullText;
            combinedSegments = [...combinedSegments, ...transcription.segments];
          }
          
          textToAnalyze = combinedText;
          audioSegments = combinedSegments;
        } else {
          setAiProgress({ current: 1, total: 1 });
          const transcription = await transcribeAudio(file, file.name);
          textToAnalyze = transcription.fullText;
          audioSegments = transcription.segments;
        }
      } else if (!doc.isAudio && file) {
        // Re-extract text for non-audio if file is available to get page markers
        const name = file.name.toLowerCase();
        if (name.endsWith('.pdf')) {
          textToAnalyze = await extractTextFromPdf(file);
        } else if (name.endsWith('.docx')) {
          textToAnalyze = await extractTextFromWord(file);
        } else if (name.endsWith('.doc')) {
          textToAnalyze = await extractTextFromDoc(file);
        }
      }

      const analysis = await analyzeDocumentText(textToAnalyze, doc.fileName, doc.folderName);
      const updatedDoc = {
        ...doc,
        topics: analysis.topics || [],
        rawText: textToAnalyze,
        audioSegments: audioSegments
      };
      setDocuments(prev => prev.map(d => d.id === doc.id ? updatedDoc : d));
      if (selectedDoc?.id === doc.id) {
        setSelectedDoc(updatedDoc);
      }
      showNotify("Análise IA concluída com sucesso.", "success");
    } catch (error: any) {
      console.error("Erro na análise IA:", error);
      const errorStr = JSON.stringify(error);
      if (errorStr.includes("RESOURCE_EXHAUSTED") || errorStr.includes("429")) {
        showNotify("Limite de quota atingido. Por favor, aguarde alguns minutos antes de tentar novamente.", "error");
      } else {
        showNotify("Erro ao processar com IA. Verifique a sua ligação ou chave API.", "error");
      }
    } finally {
      setIsAiProcessing(false);
      setCurrentlyProcessingId(null);
    }
  };
  const loadProject = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const project = JSON.parse(e.target?.result as string) as ProjectData;
        
        const incomingDocs = project.documents.map(doc => ({
          ...doc,
          phase: doc.phase || 'inquerito'
        }));

        setDocuments(prev => {
          const mergedMap = new Map();
          
          // Add existing docs to map
          prev.forEach(doc => {
            const key = `${doc.folderName}/${doc.fileName}`;
            mergedMap.set(key, doc);
          });

          // Merge incoming docs
          incomingDocs.forEach(doc => {
            const key = `${doc.folderName}/${doc.fileName}`;
            if (mergedMap.has(key)) {
              const existing = mergedMap.get(key);
              // Keep the one with more topics (likely the one analyzed by AI)
              if ((doc.topics?.length || 0) > (existing.topics?.length || 0)) {
                mergedMap.set(key, doc);
              }
            } else {
              mergedMap.set(key, doc);
            }
          });

          return Array.from(mergedMap.values());
        });

        showNotify(`${incomingDocs.length} documentos integrados no projeto atual.`, "success");
        setActiveTab('search');
      } catch (err) {
        showNotify("Erro ao carregar o arquivo de projeto.", "error");
      }
    };
    reader.readAsText(file);
  };

  const uniqueFolders = useMemo(() => {
    const folders = documents.map(doc => doc.parentFolder || doc.folderName);
    return Array.from(new Set(folders)).sort();
  }, [documents]);

  const filteredDocs = useMemo(() => {
    return documents.filter(doc => {
      const matchesName = doc.personName.toLowerCase().includes(filters.name.toLowerCase());
      const matchesDate = doc.date.includes(filters.date);
      const matchesPresiding = doc.presidingEntity.toLowerCase().includes(filters.presiding.toLowerCase());
      const matchesFolder = filters.folder === '' || (doc.parentFolder === filters.folder || doc.folderName === filters.folder);
      const matchesTopic = filters.topic === '' || 
        doc.topics.some(t => 
          booleanSearch(t.topic, filters.topic) || 
          booleanSearch(t.description, filters.topic)
        );
      return matchesName && matchesDate && matchesPresiding && matchesTopic && matchesFolder;
    });
  }, [documents, filters]);

  const getDocsToProcess = () => {
    return filteredDocs.filter(d => {
      // Caso 1: Sem tópicos
      if (d.topics.length === 0) return true;
      
      // Caso 2: É documento (não áudio) mas não tem números de página em nenhum tópico
      // Isto sugere que foi analisado antes da funcionalidade de páginas ser adicionada
      if (!d.isAudio && d.topics.every(t => !t.pages || t.pages.length === 0)) return true;
      
      return false;
    });
  };

  const handleBulkAiSummarize = async () => {
    if (!(await ensureApiKey())) return;

    const docsToProcess = getDocsToProcess();
    if (docsToProcess.length === 0) {
      showNotify("Todos os documentos filtrados já possuem análise IA completa (incluindo páginas).", "info");
      return;
    }

    setShowBulkConfirm(false);
    setIsAiProcessing(true);
    setProcessingProgress({ current: 0, total: docsToProcess.length });

    for (let i = 0; i < docsToProcess.length; i++) {
      const doc = docsToProcess[i];
      setProcessingProgress({ current: i + 1, total: docsToProcess.length });
      setCurrentlyProcessingId(doc.id);
      try {
        const analysis = await analyzeDocumentText(doc.rawText, doc.fileName, doc.folderName);
        setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, topics: analysis.topics || [] } : d));
        
        // Add a small delay between requests to avoid hitting rate limits too fast
        if (i < docsToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`Erro ao processar ${doc.fileName}:`, error);
      }
    }

    setIsAiProcessing(false);
    setCurrentlyProcessingId(null);
    showNotify("Processamento em lote concluído.", "success");
  };

  const handleUpdateDoc = (updatedDoc: AnalyzedDocument) => {
    setDocuments(prev => prev.map(d => d.id === updatedDoc.id ? updatedDoc : d));
    setIsEditModalOpen(false);
    setSelectedDoc(null);
  };

  const ensureApiKey = async () => {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
        return true; // Assume success per instructions
      }
    }
    return true;
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-stone-900 rounded-xl flex items-center justify-center text-white">
            <FileText size={24} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">JurisAnalyzer</h1>
            <p className="text-xs text-stone-500 font-medium uppercase tracking-wider">Gestão Documental Inteligente</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">backup</label>
            <input 
              type="password" 
              value={backupCode}
              onChange={e => setBackupCode(e.target.value)}
              className="w-24 px-2 py-1 bg-stone-50 border border-stone-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-stone-900/10"
              placeholder="••••••••"
            />
          </div>

          <button 
            onClick={() => document.getElementById('link-pdfs')?.click()}
            className="flex items-center gap-2 px-4 py-2 text-stone-600 hover:bg-stone-50 rounded-xl transition-colors text-sm font-medium border border-stone-200"
            title="Vincular ficheiros locais ao projeto carregado"
          >
            <Link size={18} />
            <span>Vincular Ficheiros</span>
          </button>
          <input 
            id="link-pdfs" 
            type="file" 
            multiple 
            accept=".pdf,.docx,.doc" 
            {...{ webkitdirectory: "", directory: "" } as any}
            onChange={handleLinkPdfs} 
            className="hidden" 
          />

          {backupCode === '05031970' && (
            <button 
              onClick={() => setShowReportModal(true)}
              disabled={filteredDocs.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50"
              title="Descarregar relatório Word dos documentos filtrados"
            >
              <FileText size={18} />
              Relatório Word
            </button>
          )}
          <button 
            onClick={saveProject}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
          >
            <Save size={18} />
            Guardar Projeto
          </button>
          <label className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 rounded-lg transition-colors cursor-pointer">
            <FileJson size={18} />
            Carregar Projeto
            <input type="file" accept=".json" onChange={loadProject} className="hidden" />
          </label>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-white border-b border-stone-200 px-8 flex gap-8">
        {backupCode === '05031970' && (
          <>
            <button 
              onClick={() => setActiveTab('inquerito')}
              className={cn(
                "py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                activeTab === 'inquerito' ? "border-stone-900 text-stone-900" : "border-transparent text-stone-400 hover:text-stone-600"
              )}
            >
              <FileText size={18} />
              Inquérito
            </button>
            <button 
              onClick={() => setActiveTab('instrucao')}
              className={cn(
                "py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                activeTab === 'instrucao' ? "border-stone-900 text-stone-900" : "border-transparent text-stone-400 hover:text-stone-600"
              )}
            >
              <Gavel size={18} />
              Instrução
            </button>
            <button 
              onClick={() => setActiveTab('julgamento')}
              className={cn(
                "py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                activeTab === 'julgamento' ? "border-stone-900 text-stone-900" : "border-transparent text-stone-400 hover:text-stone-600"
              )}
            >
              <Scale size={18} />
              Julgamento
            </button>
          </>
        )}
        <button 
          onClick={() => setActiveTab('search')}
          className={cn(
            "py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
            activeTab === 'search' ? "border-stone-900 text-stone-900" : "border-transparent text-stone-400 hover:text-stone-600"
          )}
        >
          <Search size={18} />
          Consulta e Pesquisa
        </button>
        {backupCode === '05031970' && (
          <button 
            onClick={() => setActiveTab('timeline')}
            className={cn(
              "py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
              activeTab === 'timeline' ? "border-stone-900 text-stone-900" : "border-transparent text-stone-400 hover:text-stone-600"
            )}
          >
            <LayoutList size={18} />
            Timeline por Assuntos
          </button>
        )}
      </nav>

      <main className="flex-1 p-8 overflow-auto">
        <AnimatePresence mode="wait">
          {(activeTab === 'inquerito' || activeTab === 'instrucao' || activeTab === 'julgamento') ? (
            <motion.div 
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-4xl mx-auto"
            >
              <div className="glass-card p-12 flex flex-col items-center text-center">
                <div className="w-20 h-20 bg-stone-100 rounded-full flex items-center justify-center text-stone-400 mb-6">
                  {activeTab === 'inquerito' ? <FileText size={40} /> : 
                   activeTab === 'instrucao' ? <Gavel size={40} /> : <Scale size={40} />}
                </div>
                <h2 className="text-2xl font-semibold mb-2">
                  Fase de {activeTab === 'inquerito' ? 'Inquérito' : activeTab === 'instrucao' ? 'Instrução' : 'Julgamento'}
                </h2>
                <p className="text-stone-500 mb-8 max-w-md">
                  Carregue os documentos relativos a esta fase processual para análise e indexação inteligente.
                </p>
                
                {isProcessing ? (
                  <div className="w-full max-w-sm">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-stone-600">Processando documentos...</span>
                      <span className="text-sm font-mono">{processingProgress.current} / {processingProgress.total}</span>
                    </div>
                    <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-stone-900"
                        initial={{ width: 0 }}
                        animate={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                      />
                    </div>
                    <div className="mt-4 flex items-center justify-center gap-2 text-stone-400 text-sm">
                      <Loader2 className="animate-spin" size={16} />
                      <span>A extrair dados localmente...</span>
                    </div>
                  </div>
                ) : (
                  <label className="group relative flex flex-col items-center justify-center w-full max-w-sm h-32 border-2 border-dashed border-stone-200 rounded-2xl hover:border-stone-900 hover:bg-stone-50 transition-all cursor-pointer">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <FolderUp className="w-8 h-8 mb-2 text-stone-400 group-hover:text-stone-900 transition-colors" />
                      <p className="text-sm text-stone-500 group-hover:text-stone-900">Clique para selecionar a pasta</p>
                    </div>
                    {/* @ts-ignore */}
                    <input type="file" webkitdirectory="" directory="" multiple onChange={handleFolderUpload} className="hidden" accept=".pdf,.docx,.doc" />
                  </label>
                )}
              </div>
            </motion.div>
          ) : activeTab === 'timeline' ? (
            <motion.div 
              key="timeline"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-5xl mx-auto space-y-12 pb-20"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-semibold">Timeline de Assuntos Relevantes</h2>
                <p className="text-stone-500 text-sm">Cruzamento de depoimentos por temas centrais da investigação</p>
              </div>

              {/* Timeline Filters */}
              <div className="glass-card p-6 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Filtrar Assunto</label>
                  <input 
                    type="text" 
                    placeholder="Pesquisar assunto..."
                    value={timelineFilters.topic}
                    onChange={e => setTimelineFilters(prev => ({ ...prev, topic: e.target.value }))}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Filtrar Depoente</label>
                  <input 
                    type="text" 
                    placeholder="Pesquisar nome..."
                    value={timelineFilters.witness}
                    onChange={e => setTimelineFilters(prev => ({ ...prev, witness: e.target.value }))}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                  />
                </div>
                <div className="space-y-2 md:col-span-2 pt-2 border-t border-stone-100">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Fases Processuais</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'inquerito', label: 'Inquérito', icon: <FileText size={14} /> },
                      { id: 'instrucao', label: 'Instrução', icon: <Gavel size={14} /> },
                      { id: 'julgamento', label: 'Julgamento', icon: <Scale size={14} /> }
                    ].map(phase => (
                      <button
                        key={phase.id}
                        onClick={() => {
                          setTimelineFilters(prev => ({
                            ...prev,
                            phases: prev.phases.includes(phase.id as any)
                              ? prev.phases.filter(p => p !== phase.id)
                              : [...prev.phases, phase.id as any]
                          }))
                        }}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all border",
                          timelineFilters.phases.includes(phase.id as any)
                            ? "bg-stone-900 text-white border-stone-900 shadow-md"
                            : "bg-white text-stone-500 border-stone-200 hover:border-stone-300"
                        )}
                      >
                        {phase.icon}
                        {phase.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="relative">
                {/* Vertical Line */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-stone-200 -translate-x-1/2 hidden md:block" />

                <div className="space-y-16 relative">
                  {(() => {
                    const timelineMap: Record<string, { topic: string, witnesses: { doc: AnalyzedDocument, description: string }[] }> = {};
                    const excludeKeywords = [
                      'identificação', 'qualificação', 'relação', 'conhece', 'profissão', 
                      'antecedentes', 'residência', 'percurso profissional', 'carreira', 
                      'currículo', 'trajetória profissional', 'percurso académico', 
                      'relacionamento', 'desconhecimento', 'relações pessoais', 
                      'relações profissionais', 'relações com os arguidos', 
                      'relações de parentesco', 'percurso político', 'recrutamento',
                      'condições contratuais', 'remuneração'
                    ];

                    documents.forEach(doc => {
                      // Filter by phase (with fallback for safety)
                      const docPhase = doc.phase || 'inquerito';
                      if (!timelineFilters.phases.includes(docPhase)) {
                        return;
                      }

                      // Filter by witness name if filter is active
                      if (timelineFilters.witness && !doc.personName.toLowerCase().includes(timelineFilters.witness.toLowerCase())) {
                        return;
                      }

                      doc.topics.forEach(t => {
                        const lowerTopic = t.topic.toLowerCase();
                        
                        // Filter by topic name if filter is active
                        if (timelineFilters.topic && !lowerTopic.includes(timelineFilters.topic.toLowerCase())) {
                          return;
                        }

                        const isExcluded = excludeKeywords.some(key => lowerTopic.includes(key));
                        
                        if (!isExcluded) {
                          if (!timelineMap[t.topic]) {
                            timelineMap[t.topic] = { topic: t.topic, witnesses: [] };
                          }
                          timelineMap[t.topic].witnesses.push({ doc, description: t.description });
                        }
                      });
                    });

                    const sortedTopics = Object.values(timelineMap).sort((a, b) => b.witnesses.length - a.witnesses.length);

                    if (sortedTopics.length === 0) {
                      return (
                        <div className="text-center py-20 bg-stone-50 rounded-3xl border border-dashed border-stone-200">
                          <p className="text-stone-400 italic">Nenhum assunto relevante processado pela IA ainda.</p>
                        </div>
                      );
                    }

                    return sortedTopics.map((item, idx) => (
                      <div key={idx} className="relative grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16">
                        {/* Left Side: Topic */}
                        <div className="md:text-right flex flex-col justify-center">
                          <div className="inline-block">
                            <h3 className="text-lg font-bold text-stone-900 mb-2">{item.topic}</h3>
                            <div className="h-1 w-12 bg-stone-900 md:ml-auto rounded-full" />
                          </div>
                        </div>

                        {/* Center Dot */}
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-white border-4 border-stone-900 rounded-full z-10 hidden md:block" />

                        {/* Right Side: Witnesses */}
                        <div className="flex flex-wrap gap-3 items-center">
                          {item.witnesses.map((w, wIdx) => (
                            <button
                              key={wIdx}
                              onClick={() => {
                                setSelectedDoc(w.doc);
                                setModalView('summary');
                              }}
                              className="group relative px-4 py-2 bg-white border border-stone-200 rounded-xl text-sm hover:border-stone-900 hover:shadow-md transition-all flex items-center gap-2"
                            >
                              <span className="font-medium text-stone-700 group-hover:text-stone-900">{w.doc.personName}</span>
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 opacity-50 group-hover:opacity-100" />
                              
                              {/* Tooltip with description snippet */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-stone-900 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-20 leading-relaxed shadow-xl">
                                {w.description.substring(0, 150)}...
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-stone-900" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="search"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Filters */}
              <div className="glass-card p-6 grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Nome</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={16} />
                    <input 
                      type="text" 
                      placeholder="Filtrar por nome..."
                      value={filters.name}
                      onChange={e => setFilters(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Pasta</label>
                  <select 
                    value={filters.folder}
                    onChange={e => setFilters(prev => ({ ...prev, folder: e.target.value }))}
                    className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                  >
                    <option value="">Todas as Pastas</option>
                    {uniqueFolders.map(folder => (
                      <option key={folder} value={folder}>{folder}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Data</label>
                  <input 
                    type="date" 
                    value={filters.date}
                    onChange={e => setFilters(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Presidência</label>
                  <select 
                    value={filters.presiding}
                    onChange={e => setFilters(prev => ({ ...prev, presiding: e.target.value }))}
                    className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                  >
                    <option value="">Todos</option>
                    <option value="Juiz">Juiz</option>
                    <option value="Procurador">Procurador</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Assuntos / Texto</label>
                    <span className="text-[9px] text-stone-400 cursor-help" title="Use + para obrigatório, - para excluir, OR para alternativas">Booleano (?)</span>
                  </div>
                  <input 
                    type="text" 
                    placeholder="Ex: +corrupção -suborno OR luvas"
                    value={filters.topic}
                    onChange={e => setFilters(prev => ({ ...prev, topic: e.target.value }))}
                    className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10"
                  />
                </div>
              </div>

              {/* Results Table */}
              <div className="glass-card overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200">
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-400">Nome da Testemunha/Arguido</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-400">Data</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-400">Presidência</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-400">Pasta</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-400 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span>Ações</span>
                          {backupCode === '05031970' && (
                            <button 
                              onClick={() => setShowBulkConfirm(true)}
                              disabled={isAiProcessing || filteredDocs.filter(d => d.topics.length === 0).length === 0}
                              className="p-1.5 bg-stone-900 text-white rounded-md hover:bg-stone-800 transition-colors disabled:opacity-50"
                              title="Analisar todos os documentos filtrados com IA"
                            >
                              {isAiProcessing ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />}
                            </button>
                          )}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocs.length > 0 ? (
                      filteredDocs.map(doc => (
                        <tr key={doc.id} className="data-row">
                          <td className="px-6 py-4">
                            <div className="font-medium text-stone-900">{doc.personName}</div>
                            <div className="text-xs text-stone-400 font-mono">{doc.fileName}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-stone-600">{doc.date}</td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                              doc.presidingEntity === 'Juiz' ? "bg-indigo-50 text-indigo-700" : 
                              doc.presidingEntity === 'Procurador' ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600"
                            )}>
                              {doc.presidingEntity}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs text-stone-500 italic">{doc.folderName}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2">
                              {backupCode === '05031970' && (
                                <button 
                                  onClick={() => {
                                    setSelectedDoc(doc);
                                    setModalView('summary');
                                  }}
                                  className={cn(
                                    "p-2 rounded-lg transition-all",
                                    doc.topics.length > 0 ? "text-emerald-500 hover:bg-emerald-50" : "text-stone-300 cursor-not-allowed"
                                  )}
                                  disabled={doc.topics.length === 0}
                                  title={doc.topics.length > 0 ? "Ver Resumo IA" : "Sem análise IA disponível"}
                                >
                                  <LayoutList size={18} />
                                </button>
                              )}
                              {!doc.isAudio ? (
                                <button 
                                  onClick={() => {
                                    setSelectedDoc(doc);
                                    setModalView('text');
                                  }}
                                  className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-all"
                                  title="Ver Texto Integral"
                                >
                                  <Eye size={18} />
                                </button>
                              ) : (
                                filesMap[doc.fileName] && (
                                  <button 
                                    onClick={() => handleOpenAudio(doc)}
                                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all flex items-center gap-1"
                                    title="Ouvir e Transcrever"
                                  >
                                    <Play size={16} fill="currentColor" />
                                    <span className="text-[10px] font-bold uppercase">Ouvir</span>
                                  </button>
                                )
                              )}
                              {backupCode === '05031970' && (
                                <button 
                                  onClick={() => handleAiSummarize(doc)}
                                  disabled={isAiProcessing}
                                  className={cn(
                                    "p-2 rounded-lg transition-all",
                                    doc.topics.length > 0 ? "text-emerald-500/50 hover:bg-emerald-50" : "text-stone-400 hover:text-stone-900 hover:bg-stone-100"
                                  )}
                                  title={doc.topics.length > 0 ? "Refazer Análise IA" : "Analisar com IA"}
                                >
                                  {currentlyProcessingId === doc.id ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                                </button>
                              )}
                              <button 
                                onClick={() => openFile(doc.fileName)}
                                className={cn(
                                  "p-2 rounded-lg transition-all",
                                  filesMap[doc.fileName] 
                                    ? "text-blue-500 hover:text-blue-700 hover:bg-blue-50" 
                                    : "text-stone-300 cursor-not-allowed"
                                )}
                                title={filesMap[doc.fileName] ? "Abrir Ficheiro" : "Ficheiro não vinculado"}
                              >
                                <ExternalLink size={18} />
                              </button>
                              {backupCode === '05031970' && (
                                <button 
                                  onClick={() => {
                                    setSelectedDoc(doc);
                                    setIsEditModalOpen(true);
                                  }}
                                  className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-all"
                                  title="Editar"
                                >
                                  <Edit3 size={18} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-stone-400 italic">
                          Nenhum documento encontrado com os filtros selecionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Document Detail Modal */}
      {selectedDoc && !isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-stone-900/20 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-4xl max-h-full overflow-hidden rounded-3xl shadow-2xl flex flex-col"
          >
            <div className="p-8 border-b border-stone-100 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-semibold">{selectedDoc.personName}</h3>
                <p className="text-stone-500">{selectedDoc.date} • Presidido por {selectedDoc.presidingEntity}</p>
              </div>
              <div className="flex items-center gap-3">
                {backupCode === '05031970' && (
                  <button 
                    onClick={() => handleAiSummarize(selectedDoc)}
                    disabled={isAiProcessing}
                    className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-white rounded-xl text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-50"
                    title="Analisar texto com IA para extrair tópicos"
                  >
                    {currentlyProcessingId === selectedDoc.id ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                    <span>{selectedDoc.topics.length > 0 ? 'Refazer Análise IA' : 'Analisar com IA'}</span>
                  </button>
                )}
                <button 
                  onClick={() => openFile(selectedDoc.fileName)}
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    filesMap[selectedDoc.fileName] ? "text-blue-600 hover:bg-blue-50" : "text-stone-300 cursor-not-allowed"
                  )}
                  title={filesMap[selectedDoc.fileName] ? "Abrir ficheiro original" : "Ficheiro não vinculado"}
                >
                  <ExternalLink size={20} />
                </button>
                <button 
                  onClick={() => setSelectedDoc(null)}
                  className="p-2 hover:bg-stone-100 rounded-full transition-colors"
                >
                  <ChevronRight className="rotate-90" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-auto p-8">
              {(modalView === 'summary' && backupCode === '05031970') ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Resumo Estruturado (IA)</h4>
                    <div className="flex items-center gap-4">
                      {isAiProcessing && currentlyProcessingId === selectedDoc.id && (
                        <div className="flex items-center gap-3 bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-200">
                          <div className="flex flex-col items-end">
                            <span className="text-[9px] font-bold text-stone-900 uppercase">
                              {aiProgress.total > 1 ? `Parte ${aiProgress.current}/${aiProgress.total}` : 'A analisar'}
                            </span>
                            <div className="w-24 h-1 bg-stone-200 rounded-full mt-1 overflow-hidden">
                              <motion.div 
                                className="h-full bg-stone-900"
                                initial={{ width: 0 }}
                                animate={{ width: aiProgress.total > 0 ? `${(aiProgress.current / aiProgress.total) * 100}%` : '50%' }}
                              />
                            </div>
                          </div>
                          <Loader2 className="animate-spin text-stone-900" size={14} />
                        </div>
                      )}
                      {selectedDoc.topics.length > 0 && (
                        <button 
                          onClick={() => handleAiSummarize(selectedDoc)}
                          disabled={isAiProcessing}
                          className="text-xs text-blue-600 hover:text-blue-800 underline flex items-center gap-1 disabled:opacity-50"
                        >
                          {isAiProcessing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                          Refazer Análise IA
                        </button>
                      )}
                      {selectedDoc.isAudio && (
                        <button 
                          onClick={() => handleOpenAudio(selectedDoc)}
                          className="text-xs text-stone-500 hover:text-stone-900 underline"
                        >
                          Ouvir e Transcrever
                        </button>
                      )}
                      <button 
                        onClick={() => setModalView('text')}
                        className="text-xs text-stone-500 hover:text-stone-900 underline"
                      >
                        Ver Texto Integral
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {selectedDoc.topics.length > 0 ? (
                      selectedDoc.topics.map((topic, idx) => (
                        <div key={idx} className="p-5 bg-stone-50 rounded-2xl border border-stone-100 hover:border-stone-200 transition-colors group">
                          <div className="flex items-start justify-between mb-2">
                            <div className="font-semibold text-stone-900 flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              {topic.topic}
                            </div>
                            <div className="flex items-center gap-2">
                              {topic.timestamps?.map((ts, tIdx) => (
                                <button
                                  key={tIdx}
                                  onClick={() => {
                                    const [m, s] = ts.replace(/[\[\]]/g, '').split(':').map(Number);
                                    const seconds = (m * 60) + s;
                                    handleOpenAudio(selectedDoc, seconds);
                                  }}
                                  className="px-2 py-1 bg-blue-600 text-white text-[9px] font-bold rounded flex items-center gap-1 hover:bg-blue-500 transition-colors"
                                >
                                  <Play size={8} fill="currentColor" />
                                  {ts}
                                </button>
                              ))}
                              {topic.pages?.map((pg, pIdx) => (
                                <button
                                  key={pIdx}
                                  onClick={() => {
                                    openFile(selectedDoc.fileName, pg);
                                    showNotify(`A abrir documento na página ${pg}.`, "info");
                                  }}
                                  className="px-2 py-1 bg-stone-900 text-white text-[9px] font-bold rounded flex items-center gap-1 hover:bg-stone-800 transition-colors"
                                >
                                  <FileText size={8} />
                                  Pág. {pg}
                                </button>
                              ))}
                              {topic.quote && (
                                <button 
                                  onClick={() => {
                                    openFile(selectedDoc.fileName);
                                    showNotify("A abrir o documento. Use Ctrl+F para localizar o trecho citado.", "info");
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                  title="Ver no documento original"
                                >
                                  <ExternalLink size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-stone-600 leading-relaxed">{topic.description}</p>
                          {topic.quote && (
                            <div className="mt-3 pt-3 border-t border-stone-200/50">
                              <p className="text-[11px] italic text-stone-400 line-clamp-2">"{topic.quote}"</p>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 p-12 bg-stone-50 rounded-3xl border border-dashed border-stone-200 text-center">
                        <Sparkles className="mx-auto mb-4 text-stone-300" size={32} />
                        <p className="text-stone-500 italic">
                          Ainda não foi realizada a análise IA para este documento.
                        </p>
                        <button 
                          onClick={() => handleAiSummarize(selectedDoc)}
                          className="mt-4 px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-medium hover:bg-stone-800 transition-colors"
                        >
                          Analisar Agora
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Texto Integral</h4>
                    <div className="flex items-center gap-4">
                      {selectedDoc.isAudio && (
                        <button 
                          onClick={() => handleOpenAudio(selectedDoc)}
                          className="text-xs text-stone-500 hover:text-stone-900 underline"
                        >
                          Ouvir e Transcrever
                        </button>
                      )}
                      {backupCode === '05031970' && (
                        <button 
                          onClick={() => setModalView('summary')}
                          className="text-xs text-stone-500 hover:text-stone-900 underline"
                        >
                          Ver Resumo IA
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="bg-stone-50 rounded-3xl p-8 border border-stone-100 font-serif leading-relaxed text-stone-800 whitespace-pre-wrap">
                    {selectedDoc.rawText}
                  </div>
                </div>
              )}
              
              <div className="mt-8 pt-8 border-t border-stone-100">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-4">Metadados do Arquivo</div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="p-3 bg-stone-50 rounded-xl">
                    <span className="block text-[10px] text-stone-400 uppercase font-bold mb-1">Ficheiro</span>
                    <span className="text-stone-900 truncate block" title={selectedDoc.fileName}>{selectedDoc.fileName}</span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl">
                    <span className="block text-[10px] text-stone-400 uppercase font-bold mb-1">Pasta</span>
                    <span className="text-stone-900 truncate block" title={selectedDoc.folderName}>{selectedDoc.folderName}</span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl">
                    <span className="block text-[10px] text-stone-400 uppercase font-bold mb-1">Tipo</span>
                    <span className="text-stone-900 capitalize">{selectedDoc.fileType}</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit Modal */}
      {selectedDoc && isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-stone-900/20 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-8"
          >
            <h3 className="text-xl font-semibold mb-6">Editar Documento</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Nome</label>
                  <input 
                    type="text" 
                    value={selectedDoc.personName}
                    onChange={e => setSelectedDoc({ ...selectedDoc, personName: e.target.value })}
                    className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Data</label>
                  <input 
                    type="date" 
                    value={selectedDoc.date}
                    onChange={e => setSelectedDoc({ ...selectedDoc, date: e.target.value })}
                    className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Presidência</label>
                <select 
                  value={selectedDoc.presidingEntity}
                  onChange={e => setSelectedDoc({ ...selectedDoc, presidingEntity: e.target.value as any })}
                  className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                >
                  <option value="Juiz">Juiz</option>
                  <option value="Procurador">Procurador</option>
                  <option value="Desconhecido">Desconhecido</option>
                </select>
              </div>
            </div>
            
            <div className="mt-8 flex justify-end gap-3">
              <button 
                onClick={() => {
                  setIsEditModalOpen(false);
                  setSelectedDoc(null);
                }}
                className="px-6 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={() => handleUpdateDoc(selectedDoc)}
                className="px-6 py-2 text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 rounded-lg transition-colors"
              >
                Guardar Alterações
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Bulk AI Confirm Modal */}
      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-stone-900/20 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 text-center"
          >
            <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center text-stone-900 mx-auto mb-4">
              <Sparkles size={32} />
            </div>
            <h3 className="text-xl font-semibold mb-2">Processamento em Lote</h3>
            <p className="text-stone-500 mb-8">
              Deseja processar {getDocsToProcess().length} documentos com IA? 
              <br />
              <span className="text-xs text-stone-400 mt-2 block italic">
                (Inclui documentos sem análise e documentos antigos que precisam de atualização para suporte a páginas PDF)
              </span>
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowBulkConfirm(false)}
                className="flex-1 px-6 py-3 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleBulkAiSummarize}
                className="flex-1 px-6 py-3 text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 rounded-xl transition-colors"
              >
                Confirmar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Report Options Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-stone-900/20 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8"
          >
            <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center text-stone-900 mx-auto mb-4">
              <FileText size={32} />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-center">Opções do Relatório</h3>
            <p className="text-stone-500 mb-6 text-center text-sm">
              Selecione as fases processuais que deseja incluir no relatório Word.
            </p>
            
            <div className="space-y-3 mb-8">
              {[
                { id: 'inquerito', label: 'Inquérito', icon: <FileText size={16} /> },
                { id: 'instrucao', label: 'Instrução', icon: <Gavel size={16} /> },
                { id: 'julgamento', label: 'Julgamento', icon: <Scale size={16} /> }
              ].map(phase => (
                <button
                  key={phase.id}
                  onClick={() => {
                    setReportPhases(prev => 
                      prev.includes(phase.id as any)
                        ? prev.filter(p => p !== phase.id)
                        : [...prev, phase.id as any]
                    )
                  }}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-2xl border transition-all",
                    reportPhases.includes(phase.id as any)
                      ? "bg-stone-900 text-white border-stone-900 shadow-md"
                      : "bg-stone-50 text-stone-600 border-stone-200 hover:border-stone-300"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {phase.icon}
                    <span className="font-medium">{phase.label}</span>
                  </div>
                  {reportPhases.includes(phase.id as any) && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setShowReportModal(false)}
                className="flex-1 px-6 py-3 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleGenerateReport}
                disabled={reportPhases.length === 0}
                className="flex-1 px-6 py-3 text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 rounded-xl transition-colors disabled:opacity-50"
              >
                Gerar Relatório
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Audio Modal */}
      {isAudioModalOpen && audioModalDoc && (
        (() => {
          const file = findFile(audioModalDoc.fileName, audioModalDoc.folderName);
          if (!file) return null;
          return (
            <AudioModal 
              key={audioModalDoc.id}
              doc={audioModalDoc}
              audioFile={file}
              initialSeek={audioModalSeek}
              onClose={() => {
                setIsAudioModalOpen(false);
                setAudioModalSeek(null);
              }}
              onOpenFile={(name) => openFile(name)}
              onUpdateDoc={(updatedDoc) => {
                setDocuments(prev => prev.map(d => d.id === updatedDoc.id ? updatedDoc : d));
                setAudioModalDoc(updatedDoc);
              }}
            />
          );
        })()
      )}

      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn(
              "fixed bottom-8 right-8 z-[100] px-6 py-4 rounded-2xl shadow-xl flex items-center gap-3 border",
              notification.type === 'success' ? "bg-emerald-900 text-emerald-50 border-emerald-800" :
              notification.type === 'error' ? "bg-red-900 text-red-50 border-red-800" :
              "bg-stone-900 text-stone-50 border-stone-800"
            )}
          >
            {notification.type === 'success' && <div className="w-2 h-2 rounded-full bg-emerald-400" />}
            {notification.type === 'error' && <div className="w-2 h-2 rounded-full bg-red-400" />}
            <span className="text-sm font-medium">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
