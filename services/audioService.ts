export class AudioService {
  private audioContext: AudioContext;

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  async decodeAudio(file: File): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  /**
   * Extracts a portion of the audio buffer and returns a WAV Blob.
   */
  extractClip(buffer: AudioBuffer, startTime: number, endTime: number): Blob {
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.floor(endTime * sampleRate);
    const frameCount = endSample - startSample;

    if (frameCount <= 0) {
      throw new Error("Invalid time range");
    }

    const newBuffer = this.audioContext.createBuffer(
      buffer.numberOfChannels,
      frameCount,
      sampleRate
    );

    for (let i = 0; i < buffer.numberOfChannels; i++) {
      const channelData = buffer.getChannelData(i);
      const newChannelData = newBuffer.getChannelData(i);
      // Copy the segment
      for (let j = 0; j < frameCount; j++) {
        // Safety check for bounds
        if (startSample + j < channelData.length) {
          newChannelData[j] = channelData[startSample + j];
        }
      }
    }

    return this.bufferToWav(newBuffer);
  }

  /**
   * Encodes AudioBuffer to WAV format (Blob).
   */
  private bufferToWav(abuffer: AudioBuffer): Blob {
    const numOfChan = abuffer.numberOfChannels;
    const length = abuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let i: number;
    let sample: number;
    let offset = 0;
    let pos = 0;

    // Write WAV Header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this example)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // Interleave channels
    for (i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));

    while (pos < abuffer.length) {
      for (i = 0; i < numOfChan; i++) {
        // clamp
        sample = Math.max(-1, Math.min(1, channels[i][pos]));
        // scale to 16-bit signed int
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(44 + offset, sample, true);
        offset += 2;
      }
      pos++;
    }

    return new Blob([buffer], { type: "audio/wav" });

    function setUint16(data: number) {
      view.setUint16(pos, data, true);
      pos += 2;
    }

    function setUint32(data: number) {
      view.setUint32(pos, data, true);
      pos += 4;
    }
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }
}

export const audioService = new AudioService();
