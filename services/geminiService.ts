import { GoogleGenAI, Type } from "@google/genai";
import { TranscriptSegment } from "../types";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    // API Key is injected by the environment
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async transcribeAudio(file: File): Promise<TranscriptSegment[]> {
    const base64Data = await this.fileToBase64(file);
    
    // Using gemini-3-flash-preview as the compliant Flash model
    const modelId = "gemini-3-flash-preview"; 

    try {
      const response = await this.ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: file.type,
                data: base64Data
              }
            },
            {
              text: `Transcribe this audio. Return the result strictly as a JSON array of objects.
                     Each object must represent a sentence or a distinct phrase.
                     The object structure must be:
                     {
                       "text": "The content of the speech",
                       "start": <number, start time in seconds>,
                       "end": <number, end time in seconds>
                     }
                     Do not include any other text or markdown block markers.`
            }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER }
              },
              required: ["text", "start", "end"]
            }
          }
        }
      });

      if (!response.text) {
        throw new Error("No response from Gemini");
      }

      const rawSegments = JSON.parse(response.text);
      
      // Map to ensure IDs and structure
      return rawSegments.map((seg: any, index: number) => ({
        id: index,
        text: seg.text,
        start: seg.start,
        end: seg.end
      }));

    } catch (error) {
      console.error("Transcription failed", error);
      throw error;
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data:audio/xyz;base64, prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  }
}

export const geminiService = new GeminiService();