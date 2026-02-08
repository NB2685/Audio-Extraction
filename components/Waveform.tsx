import React, { useEffect, useRef } from 'react';

interface WaveformProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  selectionStart: number | null;
  selectionEnd: number | null;
}

export const Waveform: React.FC<WaveformProps> = ({ 
  audioBuffer, 
  currentTime, 
  duration, 
  onSeek,
  selectionStart,
  selectionEnd
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw background line
    ctx.beginPath();
    ctx.moveTo(0, amp);
    ctx.lineTo(width, amp);
    ctx.strokeStyle = '#334155';
    ctx.stroke();

    // Draw Waveform
    ctx.beginPath();
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.strokeStyle = '#64748b'; // Slate 500
    ctx.stroke();

    // Draw Selection Overlay
    if (selectionStart !== null && selectionEnd !== null) {
        const startX = (selectionStart / duration) * width;
        const endX = (selectionEnd / duration) * width;
        const selWidth = endX - startX;
        
        ctx.fillStyle = 'rgba(99, 102, 241, 0.3)'; // Indigo 500 with opacity
        ctx.fillRect(startX, 0, selWidth, height);
        
        // Selection borders
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX, height);
        ctx.moveTo(endX, 0);
        ctx.lineTo(endX, height);
        ctx.strokeStyle = '#818cf8';
        ctx.stroke();
    }

    // Draw Playhead
    const playheadX = (currentTime / duration) * width;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.strokeStyle = '#f43f5e'; // Rose 500
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1; // Reset

  }, [audioBuffer, currentTime, duration, selectionStart, selectionEnd]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.offsetWidth;
        canvasRef.current.height = containerRef.current.offsetHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize(); // Init
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    onSeek(percent * duration);
  };

  return (
    <div ref={containerRef} className="w-full h-32 bg-slate-900 rounded-lg overflow-hidden border border-slate-700 relative cursor-pointer group">
      <canvas 
        ref={canvasRef} 
        onClick={handleClick}
        className="w-full h-full block"
      />
      <div className="absolute top-2 right-2 text-xs text-slate-500 font-mono pointer-events-none">
        {audioBuffer ? `${audioBuffer.sampleRate}Hz • ${audioBuffer.numberOfChannels}ch` : 'No Audio'}
      </div>
    </div>
  );
};
