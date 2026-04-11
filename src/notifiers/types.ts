export interface PostSummary {
  source: 'facebook';
  timestamp: string;
  isToday: boolean;
  text: string;
  url: string;
}

export interface MentionedTarget {
  name: string;
  type: string;
  herAction: string;
  reverseView: string;
  confidence: string;
  reasoning: string;
}

export interface AnalysisResult {
  summary: string;
  hasInvestmentContent: boolean;
  mentionedTargets?: MentionedTarget[];
  chainAnalysis?: string;
  actionableSuggestion?: string;
  moodScore?: number;
}

export interface ReportData {
  analysis: AnalysisResult;
  postCount: { fb: number };
  posts: PostSummary[];
  isFallback: boolean;
}

export interface Notifier {
  readonly name: string;
  send(report: ReportData): Promise<void>;
}
