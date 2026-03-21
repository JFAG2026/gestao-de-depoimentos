import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, User, Loader2, FileText, Play, ExternalLink, Sparkles, Trash2 } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { AnalyzedDocument } from '../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: {
    type: 'doc' | 'audio';
    fileName: string;
    page?: number;
    seconds?: number;
    timestamp?: string;
    personName: string;
  }[];
}

interface ChatbotProps {
  documents: AnalyzedDocument[];
  onOpenDoc: (doc: AnalyzedDocument, page?: number) => void;
  onOpenAudio: (doc: AnalyzedDocument, seconds?: number) => void;
}

const Chatbot: React.FC<ChatbotProps> = ({ documents, onOpenDoc, onOpenAudio }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // 1. Prepare context
      // We'll provide a summary of all documents to the model
      const context = documents.map(doc => {
        const topics = doc.topics.map(t => `- ${t.topic}: ${t.description}`).join('\n');
        return `DOCUMENTO: ${doc.fileName}
PESSOA: ${doc.personName}
DATA: ${doc.date}
FASE: ${doc.phase}
TIPO: ${doc.fileType}
TÓPICOS:\n${topics}
---`;
      }).join('\n\n');

      // 2. Call Gemini
      const apiKey = localStorage.getItem('GEMINI_API_KEY') || process.env.API_KEY || process.env.GEMINI_API_KEY || "";
      const ai = new GoogleGenAI({ apiKey });
      
      const systemInstruction = `És o JurisAnalyzer AI, um assistente jurídico especializado em análise de processos.
      O teu objetivo é responder a perguntas sobre os conteúdos dos documentos fornecidos no contexto.
      
      REGRAS CRÍTICAS:
      1. Baseia as tuas respostas APENAS nos documentos fornecidos. Se não souberes, diz que não encontraste informação.
      2. Indica SEMPRE a origem dos dados.
      3. Para cada afirmação importante, cita o documento e a página/timestamp.
      4. Formata as fontes no final da resposta usando a seguinte sintaxe especial:
         [FONTE: NomeDoFicheiro | Página: X | Pessoa: Nome]
         [FONTE: NomeDoFicheiro | Tempo: MM:SS | Pessoa: Nome]
      5. Sê conciso e profissional.
      
      CONTEXTO DOS DOCUMENTOS:
      ${context}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: input }] }],
        config: { systemInstruction, temperature: 0.2 }
      });

      const aiResponse = response.text || "Desculpe, não consegui processar a sua pergunta.";
      
      // 3. Parse sources from AI response
      const sources: Message['sources'] = [];
      const sourceRegex = /\[FONTE:\s*(.*?)\s*\|\s*(Página|Tempo):\s*(.*?)\s*\|\s*Pessoa:\s*(.*?)\s*\]/g;
      let match;
      
      while ((match = sourceRegex.exec(aiResponse)) !== null) {
        const fileName = match[1];
        const type = match[2] === 'Página' ? 'doc' : 'audio';
        const value = match[3];
        const personName = match[4];
        
        const doc = documents.find(d => d.fileName === fileName);
        if (doc) {
          if (type === 'doc') {
            sources.push({ type, fileName, page: parseInt(value), personName });
          } else {
            const [m, s] = value.split(':').map(Number);
            const seconds = (m * 60) + s;
            sources.push({ type, fileName, seconds, timestamp: value, personName });
          }
        }
      }

      // Clean up the text response (remove the source tags if you want, or keep them)
      // For now, let's keep them but also show the buttons
      const cleanResponse = aiResponse.replace(sourceRegex, '').trim();

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: cleanResponse,
        sources: sources.filter((v, i, a) => a.findIndex(t => (t.fileName === v.fileName && t.page === v.page && t.seconds === v.seconds)) === i)
      }]);

    } catch (error) {
      console.error("Chatbot error:", error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "Ocorreu um erro ao processar a sua pergunta. Verifique a sua ligação e a chave API." 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-stone-900 rounded-xl flex items-center justify-center text-white">
            <Bot size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-stone-900">JurisAnalyzer AI</h3>
            <p className="text-[10px] text-stone-400 uppercase font-bold tracking-wider">Assistente de Processo</p>
          </div>
        </div>
        <button 
          onClick={() => setMessages([])}
          className="p-2 text-stone-400 hover:text-red-500 transition-colors"
          title="Limpar conversa"
        >
          <Trash2 size={18} />
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center text-stone-300">
              <Sparkles size={32} />
            </div>
            <div className="max-w-xs">
              <p className="text-stone-500 font-medium">Olá! Eu sou o assistente IA do JurisAnalyzer.</p>
              <p className="text-stone-400 text-sm mt-1">Faça perguntas sobre os depoimentos, contradições ou factos do processo.</p>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-stone-900 text-white'
              }`}>
                {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
              </div>
              <div className="space-y-3">
                <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user' 
                    ? 'bg-blue-600 text-white rounded-tr-none' 
                    : 'bg-stone-100 text-stone-800 rounded-tl-none'
                }`}>
                  {msg.content}
                </div>
                
                {msg.sources && msg.sources.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {msg.sources.map((src, sIdx) => {
                      const doc = documents.find(d => d.fileName === src.fileName);
                      if (!doc) return null;
                      
                      return (
                        <button
                          key={sIdx}
                          onClick={() => src.type === 'doc' ? onOpenDoc(doc, src.page) : onOpenAudio(doc, src.seconds)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-[10px] font-medium text-stone-600 hover:border-stone-900 hover:text-stone-900 transition-all shadow-sm"
                        >
                          {src.type === 'doc' ? <FileText size={12} /> : <Play size={12} />}
                          <span>{src.personName}</span>
                          <span className="text-stone-400">•</span>
                          <span className="font-bold">{src.type === 'doc' ? `Pág. ${src.page}` : src.timestamp}</span>
                          <ExternalLink size={10} className="ml-1 opacity-50" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-stone-900 text-white flex items-center justify-center">
                <Bot size={16} />
              </div>
              <div className="bg-stone-100 px-4 py-3 rounded-2xl rounded-tl-none flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-stone-400" />
                <span className="text-sm text-stone-400 italic">A analisar documentos...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-stone-50 border-t border-stone-100">
        <div className="relative">
          <input 
            type="text"
            placeholder="Pergunte algo sobre o processo..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            disabled={isLoading}
            className="w-full pl-4 pr-12 py-3 bg-white border border-stone-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:opacity-50"
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-stone-900 text-white rounded-xl hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:bg-stone-300"
          >
            <Send size={18} />
          </button>
        </div>
        <p className="text-center text-[9px] text-stone-400 mt-2">
          JurisAnalyzer AI pode cometer erros. Valide sempre as informações nos documentos originais através dos links fornecidos.
        </p>
      </div>
    </div>
  );
};

export default Chatbot;
