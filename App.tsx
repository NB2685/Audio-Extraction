import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from './components/Button';
import { Waveform } from './components/Waveform';
import { audioService } from './services/audioService';
import { geminiService } from './services/geminiService';
import { TranscriptSegment, AppState } from './types';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  
  // Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // Selection State
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<number>>(new Set());
  const [selectionRange, setSelectionRange] = useState<{start: number, end: number} | null>(null);

  // Refs for Audio Logic
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  // Initialize Audio Context on user interaction (if needed, but usually handled in service for decoding)
  // We need a context for playback
  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioContextRef.current = new AudioContextClass();
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // Update selection range (time) when segment selection changes
  useEffect(() => {
    if (selectedSegmentIds.size === 0) {
      setSelectionRange(null);
      return;
    }
    
    // Fix: Explicitly cast Array.from result to number[] to avoid TS errors
    const ids = (Array.from(selectedSegmentIds) as number[]).sort((a, b) => a - b);
    const firstSeg = transcript.find(s => s.id === ids[0]);
    const lastSeg = transcript.find(s => s.id === ids[ids.length - 1]);
    
    if (firstSeg && lastSeg) {
      setSelectionRange({ start: firstSeg.start, end: lastSeg.end });
    }
  }, [selectedSegmentIds, transcript]);

  // --- Handlers ---

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAudioFile(file);
    setAppState(AppState.UPLOADING);

    try {
      // Decode Audio
      const buffer = await audioService.decodeAudio(file);
      setAudioBuffer(buffer);
      setDuration(buffer.duration);

      // Transcribe
      setAppState(AppState.TRANSCRIBING);
      const segments = await geminiService.transcribeAudio(file);
      setTranscript(segments);
      
      setAppState(AppState.READY);
    } catch (error) {
      console.error(error);
      setAppState(AppState.ERROR);
      alert("An error occurred during processing. Please try again.");
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      stopAudio();
    } else {
      playAudio(currentTime);
    }
  };

  const playAudio = (startOffset: number) => {
    if (!audioBuffer || !audioContextRef.current) return;

    // Stop existing source if any
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e) {}
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    
    // Resume context if suspended (browser policy)
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    source.start(0, startOffset);
    startTimeRef.current = audioContextRef.current.currentTime - startOffset;
    sourceNodeRef.current = source;
    setIsPlaying(true);

    source.onended = () => {
      // Only set to false if it finished naturally, not if we stopped it manually to seek
      // But for simplicity in this React loop, we'll handle state updates via RAF
    };

    // Animation Loop
    const loop = () => {
      if (!audioContextRef.current) return;
      const now = audioContextRef.current.currentTime - startTimeRef.current;
      
      if (now >= duration) {
        setIsPlaying(false);
        setCurrentTime(duration);
        cancelAnimationFrame(rafRef.current!);
        return;
      }

      setCurrentTime(now);
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e) {}
      sourceNodeRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    setIsPlaying(false);
  };

  const handleSeek = (time: number) => {
    const wasPlaying = isPlaying;
    stopAudio();
    setCurrentTime(time);
    if (wasPlaying) playAudio(time);
  };

  const handleSegmentClick = (id: number, e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Range selection
      // Fix: Explicitly cast Array.from result to number[]
      const lastId = (Array.from(selectedSegmentIds) as number[]).pop();
      if (lastId === undefined) {
        setSelectedSegmentIds(new Set([id]));
      } else {
        const start = Math.min(lastId, id);
        const end = Math.max(lastId, id);
        const range = new Set<number>();
        transcript.forEach(t => {
          if (t.id >= start && t.id <= end) range.add(t.id);
        });
        setSelectedSegmentIds(range);
      }
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle single
      const newSet = new Set(selectedSegmentIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedSegmentIds(newSet);
    } else {
      // Single select and Seek
      setSelectedSegmentIds(new Set([id]));
      const segment = transcript.find(s => s.id === id);
      if (segment) {
        handleSeek(segment.start);
      }
    }
  };

  const handleExtract = () => {
    if (!audioBuffer || !selectionRange) return;
    
    try {
      const blob = audioService.extractClip(audioBuffer, selectionRange.start, selectionRange.end);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clip_${audioService.formatTime(selectionRange.start)}-${audioService.formatTime(selectionRange.end)}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Error extracting clip.");
    }
  };

  const handlePlaySelection = () => {
    if (!selectionRange) return;
    stopAudio();
    playAudio(selectionRange.start);
    
    // Auto stop at end of selection (hacky but works for demo)
    const duration = (selectionRange.end - selectionRange.start) * 1000;
    setTimeout(() => {
      // Ideally we check if we are still playing that specific sequence, 
      // but for this scope, let's just let it play or user stops it.
      // Or we can set a timeout to stop.
    }, duration);
  };

  // --- Render Helpers ---

  const renderWelcome = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8 bg-slate-900 rounded-2xl border-2 border-dashed border-slate-700">
      <div className="bg-indigo-600/20 p-6 rounded-full mb-6">
        <svg className="w-12 h-12 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">Start Editing with AI</h2>
      <p className="text-slate-400 mb-8 max-w-md">Upload an audio file to generate a transcript, then simply select text to create clips.</p>
      
      <label className="cursor-pointer">
        <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
        <div className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-lg font-semibold transition-colors shadow-lg shadow-indigo-500/20 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Upload Audio File
        </div>
      </label>
    </div>
  );

  const renderLoader = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
      <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-xl font-medium text-slate-300">
        {appState === AppState.UPLOADING ? 'Decoding Audio...' : 'AI Transcribing...'}
      </p>
      <p className="text-sm text-slate-500">This might take a moment depending on file size.</p>
    </div>
  );

  const renderEditor = () => (
    <div className="flex flex-col h-full gap-6">
      {/* Header / Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-sm">
        <div className="flex items-center gap-3">
          <button 
            onClick={togglePlayback}
            className={`w-12 h-12 flex items-center justify-center rounded-full transition-colors ${isPlaying ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-white hover:bg-slate-600'}`}
          >
            {isPlaying ? (
               <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
            ) : (
               <svg className="w-5 h-5 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <div>
            <h3 className="font-medium text-white max-w-[200px] truncate" title={audioFile?.name}>{audioFile?.name}</h3>
            <p className="text-xs text-indigo-400 font-mono">
              {audioService.formatTime(currentTime)} / {audioService.formatTime(duration)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
            <div className="px-3 py-1 bg-slate-900 rounded text-sm text-slate-400 font-mono border border-slate-700">
                Selected: {selectionRange ? `${audioService.formatTime(selectionRange.start)} - ${audioService.formatTime(selectionRange.end)}` : 'None'}
            </div>
            {selectionRange && (
                <>
                <Button variant="secondary" onClick={handlePlaySelection} title="Play Selection">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </Button>
                <Button variant="primary" onClick={handleExtract}>
                    Extract Clip
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                </Button>
                </>
            )}
        </div>
      </div>

      {/* Waveform */}
      <Waveform 
        audioBuffer={audioBuffer} 
        currentTime={currentTime} 
        duration={duration} 
        onSeek={handleSeek}
        selectionStart={selectionRange?.start ?? null}
        selectionEnd={selectionRange?.end ?? null}
      />

      {/* Transcript Area */}
      <div className="flex-1 bg-slate-900 rounded-xl border border-slate-700 overflow-hidden flex flex-col min-h-0">
        <div className="p-3 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
            <h4 className="font-semibold text-slate-300">Transcript</h4>
            <span className="text-xs text-slate-500">Hold Shift for range, Ctrl/Cmd for multi-select</span>
        </div>
        <div className="overflow-y-auto p-6 space-y-1 custom-scrollbar flex-1">
          {transcript.map((seg) => {
            const isSelected = selectedSegmentIds.has(seg.id);
            const isCurrent = currentTime >= seg.start && currentTime <= seg.end;
            
            return (
              <span 
                key={seg.id}
                onClick={(e) => handleSegmentClick(seg.id, e)}
                className={`
                  inline-block mr-1 mb-1 px-1 py-0.5 rounded cursor-pointer transition-colors duration-150 select-none text-lg leading-relaxed
                  ${isSelected ? 'bg-indigo-600 text-white shadow-sm' : ''}
                  ${!isSelected && isCurrent ? 'text-indigo-400 bg-indigo-900/20' : ''}
                  ${!isSelected && !isCurrent ? 'text-slate-300 hover:bg-slate-800 hover:text-white' : ''}
                `}
                title={`${audioService.formatTime(seg.start)} - ${audioService.formatTime(seg.end)}`}
              >
                {seg.text}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8">
      <header className="max-w-6xl mx-auto mb-8 flex items-center justify-between">
         <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-white">E</div>
            <h1 className="text-xl font-bold tracking-tight text-white">EchoEdit</h1>
         </div>
         <div className="text-sm text-slate-500">AI-Powered Audio Extraction</div>
      </header>

      <main className="max-w-6xl mx-auto h-[calc(100vh-140px)]">
        {appState === AppState.IDLE && renderWelcome()}
        {(appState === AppState.UPLOADING || appState === AppState.TRANSCRIBING) && renderLoader()}
        {appState === AppState.READY && renderEditor()}
        {appState === AppState.ERROR && (
           <div className="text-center mt-20">
             <p className="text-rose-500 mb-4">Something went wrong.</p>
             <Button onClick={() => setAppState(AppState.IDLE)}>Try Again</Button>
           </div>
        )}
      </main>
    </div>
  );
};

export default App;