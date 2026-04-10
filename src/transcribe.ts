// ── 影片轉錄抽象層 ──────────────────────────────────────────
// 策略模式：定義轉錄介面，具體實作由外部決定。
// 新增轉錄服務時只需實作 Transcriber 介面並在 createTranscriber() 加入。

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

// ── 工廠 ──────────────────────────────────────────────────

export type TranscriberType = 'noop';

export function createTranscriber(type: TranscriberType = 'noop'): Transcriber {
  switch (type) {
    case 'noop':
      return new NoopTranscriber();
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
