// ── 影片轉錄抽象層 ──────────────────────────────────────────
// 策略模式：定義轉錄介面，具體實作由外部決定。
// 新增轉錄服務時只需實作 Transcriber 介面並在 createTranscriber() 加入。

import Groq from 'groq-sdk';

export interface TranscribeResult {
  text: string;
  durationSec?: number;
}

export interface Transcriber {
  readonly name: string;
  transcribe(videoUrl: string): Promise<TranscribeResult>;
}

// ── Noop（預設：不轉錄）────────────────────────────────────

export class NoopTranscriber implements Transcriber {
  readonly name = 'noop';
  async transcribe(_videoUrl: string): Promise<TranscribeResult> {
    return { text: '' };
  }
}

// ── Groq Whisper ────────────────────────────────────────────

export class GroqTranscriber implements Transcriber {
  readonly name = 'groq';
  private client: Groq;
  private model: string;

  constructor(apiKey: string, model = 'whisper-large-v3') {
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  async transcribe(videoUrl: string): Promise<TranscribeResult> {
    const result = await this.client.audio.transcriptions.create({
      url: videoUrl,
      model: this.model,
      language: 'zh',
      temperature: 0,
      response_format: 'verbose_json',
    });
    const raw = result as any;
    return {
      text: result.text ?? '',
      durationSec: raw.duration ? Math.round(raw.duration) : undefined,
    };
  }
}

// ── 工廠 ──────────────────────────────────────────────────

export type TranscriberType = 'noop' | 'groq';

export function createTranscriber(type: TranscriberType = 'noop'): Transcriber {
  switch (type) {
    case 'noop':
      return new NoopTranscriber();
    case 'groq': {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error('GROQ_API_KEY 環境變數未設定');
      return new GroqTranscriber(apiKey, process.env.GROQ_WHISPER_MODEL ?? 'whisper-large-v3');
    }
    default:
      throw new Error(`不支援的轉錄器類型: ${type}`);
  }
}

// ── 輔助：判斷貼文是否為影片 ────────────────────────────────

export function isVideoPost(mediaType: string): boolean {
  const videoTypes = ['video', 'native_video', 'live_video', 'reel'];
  return videoTypes.includes(mediaType.toLowerCase());
}

// ── 批次轉錄 ────────────────────────────────────────────────

export interface TranscribablePost {
  id: string;
  mediaType: string;
  mediaUrl: string;
}

export async function transcribeVideoPosts<T extends TranscribablePost>(
  posts: T[],
  transcriber: Transcriber,
): Promise<Map<string, TranscribeResult>> {
  const results = new Map<string, TranscribeResult>();

  for (const post of posts) {
    if (!isVideoPost(post.mediaType) || !post.mediaUrl) continue;

    try {
      console.log(`[轉錄][${transcriber.name}] 處理影片: ${post.id}`);
      const result = await transcriber.transcribe(post.mediaUrl);
      if (result.text.trim().length > 0) {
        results.set(post.id, result);
        console.log(`[轉錄] ${post.id}: ${result.text.slice(0, 50)}...（${result.durationSec ?? '?'}s）`);
      } else {
        console.log(`[轉錄] ${post.id}: 無可辨識內容`);
      }
    } catch (err) {
      console.error(`[轉錄] ${post.id} 失敗: ${err instanceof Error ? err.message : err}`);
    }
  }

  return results;
}
