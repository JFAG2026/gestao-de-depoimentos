import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, X, Search, ChevronLeft, ChevronRight, ExternalLink, Volume2, Mic, Clock, User } from 'lucide-react';
import { AnalyzedDocument, AudioSegment } from '../types';

interface AudioModalProps {
  doc: AnalyzedDocument;
  audioFile: File;
  initialSeek?: number | null;
  onClose: () => void;
  onOpenFile: (fileName: string) => void;
  onUpdateDoc: (doc: AnalyzedDocument) => void;
}

const AudioModal: React.FC<AudioModalProps> = ({ doc, audioFile, initialSeek, onClose, onOpenFile, onUpdateDoc }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState('');
  
  const [retryCount, setRetryCount] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hasAppliedInitialSeek = useRef(false);

  const audioUrl = useMemo(() => {
    if (!audioFile || !(audioFile instanceof Blob)) {
      console.error("Invalid audio file provided to AudioModal");
      return "";
    }
    hasAppliedInitialSeek.current = false;
    try {
      return URL.createObjectURL(audioFile);
    } catch (err) {
      console.error("Failed to create object URL for audio file:", err);
      return "";
    }
  }, [audioFile, retryCount]);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const audioMimeType = useMemo(() => {
    if (audioFile.type) return audioFile.type;
    if (audioFile.name.toLowerCase().endsWith('.mp3')) return 'audio/mpeg';
    if (audioFile.name.toLowerCase().endsWith('.wav')) return 'audio/wav';
    if (audioFile.name.toLowerCase().endsWith('.m4a')) return 'audio/mp4';
    if (audioFile.name.toLowerCase().endsWith('.aac')) return 'audio/aac';
    if (audioFile.name.toLowerCase().endsWith('.ogg')) return 'audio/ogg';
    return 'audio/mpeg'; // Default fallback
  }, [audioFile]);

  useEffect(() => {
    console.log("AudioModal initialized with:", {
      fileName: audioFile.name,
      fileSize: audioFile.size,
      fileType: audioFile.type,
      detectedMime: audioMimeType,
      url: audioUrl
    });
  }, [audioFile, audioUrl, audioMimeType]);

  useEffect(() => {
    if (audioRef.current && audioUrl) {
      audioRef.current.load();
    }
    setAudioError(null);
  }, [audioUrl]);

  // Scroll to the segment when initialSeek changes
  useEffect(() => {
    if (initialSeek !== null && initialSeek !== undefined && doc.audioSegments) {
      const segments = doc.audioSegments;
      let segmentIndex = -1;
      
      // Find the last segment that starts before or at initialSeek
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i].seconds <= initialSeek) {
          segmentIndex = i;
          break;
        }
      }

      if (segmentIndex !== -1) {
        // Use a slightly longer timeout to ensure the modal is fully rendered
        setTimeout(() => {
          segmentRefs.current[segmentIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    }
  }, [initialSeek, doc.audioSegments]);

  useEffect(() => {
    if (audioRef.current && initialSeek !== null && initialSeek !== undefined) {
      const audio = audioRef.current;
      
      const applySeek = () => {
        audio.currentTime = initialSeek;
        audio.play().then(() => {
          setIsPlaying(true);
        }).catch(err => {
          console.warn("Auto-play failed:", err);
          // If auto-play fails, we still want to seek
          audio.currentTime = initialSeek;
        });
        hasAppliedInitialSeek.current = true;
      };

      if (audio.readyState >= 1) {
        applySeek();
      } else {
        hasAppliedInitialSeek.current = false;
        audio.load(); // Force load if not ready
      }
    }
  }, [initialSeek]);

  // Auto-scroll transcript to active segment during playback
  const lastActiveIndex = useRef<number>(-1);
  useEffect(() => {
    if (!isPlaying || !doc.audioSegments) return;
    
    const segments = doc.audioSegments;
    let activeIndex = -1;
    
    // Find current active segment
    for (let i = segments.length - 1; i >= 0; i--) {
      if (currentTime >= segments[i].seconds) {
        activeIndex = i;
        break;
      }
    }
    
    if (activeIndex !== -1 && activeIndex !== lastActiveIndex.current) {
      lastActiveIndex.current = activeIndex;
      segmentRefs.current[activeIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime, isPlaying, doc.audioSegments]);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    setDuration(audio.duration);
    
    if (initialSeek !== null && initialSeek !== undefined && !hasAppliedInitialSeek.current) {
      audio.currentTime = initialSeek;
      audio.play().catch(err => console.warn("Auto-play failed:", err));
      hasAppliedInitialSeek.current = true;
    }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleUpdateSpeaker = (oldName: string, newName: string) => {
    if (!newName.trim()) {
      setEditingSpeaker(null);
      return;
    }
    const updatedAliases = { ...(doc.speakerAliases || {}), [oldName]: newName.trim() };
    onUpdateDoc({ ...doc, speakerAliases: updatedAliases });
    setEditingSpeaker(null);
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const filteredSegments = useMemo(() => {
    if (!searchTerm) return [];
    return (doc.audioSegments || []).filter(s => 
      s.text.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [doc.audioSegments, searchTerm]);

  const handleSearchNavigate = (direction: 'next' | 'prev') => {
    if (filteredSegments.length === 0) return;
    
    let nextIndex = direction === 'next' ? currentSearchIndex + 1 : currentSearchIndex - 1;
    if (nextIndex >= filteredSegments.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = filteredSegments.length - 1;
    
    setCurrentSearchIndex(nextIndex);
    const targetSegment = filteredSegments[nextIndex];
    
    if (audioRef.current) {
      audioRef.current.currentTime = targetSegment.seconds;
      audioRef.current.play();
      setIsPlaying(true);
    }
    
    const originalIndex = doc.audioSegments?.findIndex(s => s.seconds === targetSegment.seconds) ?? -1;
    if (originalIndex !== -1) {
      segmentRefs.current[originalIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-stone-950/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[#0F172A] w-full max-w-6xl h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-800"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-500 shrink-0">
              <Play size={20} fill="currentColor" />
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-semibold truncate">{doc.fileName}</h3>
              <p className="text-slate-400 text-xs">{doc.personName} • {doc.date}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => onOpenFile(doc.fileName)}
              className="flex items-center gap-2 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl text-xs font-medium transition-all"
            >
              <ExternalLink size={14} />
              <span>Abrir Original</span>
            </button>
            <div className="w-px h-6 bg-slate-800 mx-2" />
            <button 
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-all"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Side: Player */}
          <div className="w-1/3 border-r border-slate-800 flex flex-col p-8 bg-slate-900/30">
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="w-full aspect-video bg-slate-800/50 rounded-2xl border border-slate-700 flex items-center justify-center relative group overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-transparent opacity-50" />
                {audioError ? (
                  <div className="flex flex-col items-center gap-4 p-6 text-center">
                    <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center text-red-500">
                      <X size={32} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-red-400 font-medium text-sm">Erro ao carregar áudio</p>
                      <p className="text-slate-500 text-[10px] max-w-[200px]">{audioError}</p>
                    </div>
                    <button 
                      onClick={() => {
                        setAudioError(null);
                        setRetryCount(prev => prev + 1);
                      }}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg transition-colors"
                    >
                      Tentar Novamente
                    </button>
                  </div>
                ) : (
                  <>
                    <Play size={64} className="text-slate-700 group-hover:text-slate-600 transition-colors" />
                    
                    {/* Visualizer placeholder */}
                    <div className="absolute bottom-0 left-0 right-0 h-16 flex items-end justify-center gap-1 p-4">
                      {[...Array(20)].map((_, i) => (
                        <motion.div 
                          key={i}
                          animate={isPlaying ? { height: [10, Math.random() * 40 + 10, 10] } : { height: 10 }}
                          transition={{ repeat: Infinity, duration: 0.5 + Math.random() }}
                          className="w-1 bg-blue-500/40 rounded-full"
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
              
              <div className="w-full mt-12 space-y-8">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono text-slate-500">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <div className="relative h-1.5 bg-slate-800 rounded-full cursor-pointer group">
                    <input 
                      type="range"
                      min={0}
                      max={duration || 0}
                      value={currentTime}
                      onChange={(e) => {
                        const time = parseFloat(e.target.value);
                        if (audioRef.current) audioRef.current.currentTime = time;
                        setCurrentTime(time);
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div 
                      className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${(currentTime / duration) * 100}%` }}
                    />
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ left: `calc(${(currentTime / duration) * 100}% - 6px)` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-center gap-8">
                  <button className="text-slate-400 hover:text-white transition-colors">
                    <ChevronLeft size={32} />
                  </button>
                  <button 
                    onClick={togglePlay}
                    className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/20 active:scale-95"
                  >
                    {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
                  </button>
                  <button className="text-slate-400 hover:text-white transition-colors">
                    <ChevronRight size={32} />
                  </button>
                </div>
                
                <div className="pt-8 border-t border-slate-800">
                  <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-2xl border border-slate-700/50">
                    <div className="flex items-center gap-3">
                      <Mic size={16} className="text-slate-400" />
                      <span className="text-xs text-slate-300 font-medium">Interlocutores Detectados</span>
                    </div>
                    <ChevronRight size={16} className="text-slate-500 rotate-90" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Transcript */}
          <div className="flex-1 flex flex-col bg-slate-950/50">
            {/* Search Bar */}
            <div className="p-4 border-b border-slate-800 flex items-center gap-4 bg-slate-900/20">
              <div className="flex-1 relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  type="text"
                  placeholder="Pesquisar na transcrição..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentSearchIndex(0);
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2.5 pl-11 pr-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
                />
              </div>
              
              {searchTerm && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                    {filteredSegments.length > 0 ? `${currentSearchIndex + 1} de ${filteredSegments.length}` : '0 resultados'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => handleSearchNavigate('prev')}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button 
                      onClick={() => handleSearchNavigate('next')}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Transcript Area */}
            <div 
              ref={transcriptRef}
              className="flex-1 overflow-y-auto p-8 space-y-6 scroll-smooth"
            >
              {doc.audioSegments?.map((segment, idx) => {
                const isActive = currentTime >= segment.seconds && (idx === doc.audioSegments!.length - 1 || currentTime < doc.audioSegments![idx + 1].seconds);
                const isMatch = searchTerm && segment.text.toLowerCase().includes(searchTerm.toLowerCase());
                
                return (
                  <div 
                    key={idx}
                    ref={el => segmentRefs.current[idx] = el}
                    className={`flex gap-6 group transition-all duration-300 p-3 rounded-2xl ${isActive ? 'opacity-100 bg-blue-500/5 border-l-2 border-blue-500' : 'opacity-60 hover:opacity-100 border-l-2 border-transparent'}`}
                  >
                    <button 
                      onClick={() => {
                        if (audioRef.current) {
                          audioRef.current.currentTime = segment.seconds;
                          audioRef.current.play();
                          setIsPlaying(true);
                        }
                      }}
                      className={`text-[11px] font-mono font-bold pt-1 shrink-0 transition-colors ${isActive ? 'text-blue-500' : 'text-slate-600 hover:text-slate-400'}`}
                    >
                      {segment.timestamp}
                    </button>
                    <div className="flex-1 space-y-1">
                      {segment.speaker && (
                        <div className="flex items-center gap-2 mb-1">
                          {editingSpeaker === segment.speaker ? (
                            <div className="flex items-center gap-2">
                              <input 
                                autoFocus
                                type="text"
                                value={newSpeakerName}
                                onChange={(e) => setNewSpeakerName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleUpdateSpeaker(segment.speaker!, newSpeakerName);
                                  if (e.key === 'Escape') setEditingSpeaker(null);
                                }}
                                onBlur={() => handleUpdateSpeaker(segment.speaker!, newSpeakerName)}
                                className="bg-slate-800 border border-blue-500 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none"
                              />
                            </div>
                          ) : (
                            <button 
                              onClick={() => {
                                setEditingSpeaker(segment.speaker!);
                                setNewSpeakerName(doc.speakerAliases?.[segment.speaker!] || segment.speaker!);
                              }}
                              className="group/speaker flex items-center gap-1.5 text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-wider"
                              title="Clique para renomear este interlocutor"
                            >
                              <span>{doc.speakerAliases?.[segment.speaker] || segment.speaker}:</span>
                              <User size={10} className="opacity-0 group-hover/speaker:opacity-100 transition-opacity" />
                            </button>
                          )}
                        </div>
                      )}
                      
                      <div className={`text-sm leading-relaxed transition-colors ${isActive ? 'text-white' : 'text-slate-300'}`}>
                        {segment.text.split(/(\*\*.*?\*\*)/).map((part, i) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                          return <strong key={i} className="text-white font-bold">{part.slice(2, -2)}</strong>;
                        }
                        
                        // Highlight search term
                        if (searchTerm && part.toLowerCase().includes(searchTerm.toLowerCase())) {
                          const parts = part.split(new RegExp(`(${searchTerm})`, 'gi'));
                          return parts.map((p, j) => 
                            p.toLowerCase() === searchTerm.toLowerCase() 
                              ? <mark key={j} className="bg-blue-500/30 text-blue-200 rounded-sm px-0.5">{p}</mark>
                              : p
                          );
                        }
                        
                        return part;
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
              
              {!doc.audioSegments?.length && (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 italic">
                  <Mic size={48} className="mb-4 opacity-20" />
                  <p>Transcrição não disponível.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {audioUrl && (
          <audio 
            key={`${audioUrl}-${retryCount}`}
            ref={audioRef} 
            preload="auto"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)} 
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={(e) => {
              const error = e.currentTarget.error;
              console.error("Audio playback error:", error);
              let message = `O navegador não conseguiu carregar o ficheiro "${audioFile.name}".`;
              if (error?.code === 1) message = "O carregamento do áudio foi interrompido (Code 1).";
              if (error?.code === 2) message = "Erro de rede ao carregar o áudio (Code 2).";
              if (error?.code === 3) message = "Erro ao descodificar o áudio. O formato pode não ser suportado (Code 3).";
              if (error?.code === 4) message = `O ficheiro de áudio não foi encontrado ou o formato (${audioMimeType}) não é suportado (Code 4).`;
              if (error) message += ` [Erro: ${error.code}]`;
              setAudioError(message);
            }}
            className="hidden"
          >
            <source src={audioUrl} type={audioMimeType} />
          </audio>
        )}
      </motion.div>
    </div>
  );
};

export default AudioModal;
