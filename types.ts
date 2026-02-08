export interface TranscriptSegment {
  id: number;
  text: string;
  start: number; // seconds
  end: number;   // seconds
}

export interface AudioMetadata {
  fileName: string;
  duration: number;
  fileSize: number;
}

export enum AppState {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  TRANSCRIBING = 'TRANSCRIBING',
  READY = 'READY',
  ERROR = 'ERROR'
}
