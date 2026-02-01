// 타입 정의

export interface BibleVerse {
  testament: string
  bookName: string
  bookAbbr: string
  bookNumber: number
  chapter: number
  verse: number
  content: string
}

export interface BibleChunk {
  id: string
  testament: string
  bookName: string
  bookAbbr: string
  bookNumber: number
  chapter: number
  verseStart: number
  verseEnd: number

  // 참조
  referenceFull: string  // "창세기 1:1-5"
  referenceShort: string // "창 1:1-5"

  // 내용
  content: string // 실제 청크 텍스트 (500자)
  contentWithMetadata: string // 메타정보 포함 (임베딩용, 768자 이하)

  // 메타정보
  characters: string[] // 등장인물
  themes: string[]     // 주제
  keywords: string[]   // 핵심 키워드
  emotions: string[]   // 감정 태그

  // 통계
  charCount: number
  verseCount: number

  // 벡터 (Supabase에만 저장)
  embedding?: number[]
}

export interface SearchResult {
  chunk: BibleChunk
  similarity: number
  distance: number
}

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'perplexity' | 'youtube'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
  isActive: boolean
  priority: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  verseReferences?: Array<{
    reference: string
    content: string
  }>
  provider?: AIProvider
  createdAt: Date
}

export interface VerseRelation {
  source: string
  target: string
  relationType: string
  relationLabel: string
  description?: string
}

export interface ConversationContext {
  emotion?: string
  previousMessages: ChatMessage[]
  relevantVerses: SearchResult[]
  sermonContent?: string | null     // YouTube 설교에서 추출한 관련 내용
  newsContent?: string | null       // 교회신문 기사에서 추출한 관련 내용
  bulletinContent?: string | null   // 주보에서 추출한 관련 내용
  christianWisdom?: string | null   // 기독교 철학자/신학자의 지혜 (Perplexity 검색)
  verseRelations?: VerseRelation[]  // 성경 구절 간 관계 (GraphRAG)
  verseRelationsText?: string       // 성경 구절 관계 설명 텍스트
  simpleMode?: boolean              // 간단 응답 모드 (인사, 짧은 메시지)
  language?: 'ko' | 'en'            // UI 언어 (한국어/영어)
}

export interface EmbeddingModel {
  name: string
  provider: AIProvider
  dimension: number
  maxTokens: number
  costPer1M: number
  language: 'multilingual' | 'korean'
}

// 한글 최적화 임베딩 모델
export const EMBEDDING_MODELS: Record<string, EmbeddingModel> = {
  // OpenAI - 다국어 지원, 한글 성능 우수
  'text-embedding-3-small': {
    name: 'text-embedding-3-small',
    provider: 'openai',
    dimension: 1536,
    maxTokens: 8191,
    costPer1M: 0.02,
    language: 'multilingual'
  },

  // OpenAI - 768 차원 설정 가능
  'text-embedding-3-large-768': {
    name: 'text-embedding-3-large',
    provider: 'openai',
    dimension: 768, // dimensions 파라미터로 축소
    maxTokens: 8191,
    costPer1M: 0.13,
    language: 'multilingual'
  },

  // 추천: 가성비 + 한글 성능
  'text-embedding-3-small-768': {
    name: 'text-embedding-3-small',
    provider: 'openai',
    dimension: 768,
    maxTokens: 8191,
    costPer1M: 0.02,
    language: 'multilingual'
  }
}

// 채팅 모델
export interface ChatModel {
  name: string
  provider: AIProvider
  maxTokens: number
  costPer1MInput: number
  costPer1MOutput: number
  supportsStreaming: boolean
}

export const CHAT_MODELS: Record<string, ChatModel> = {
  // OpenAI
  'gpt-4o': {
    name: 'gpt-4o',
    provider: 'openai',
    maxTokens: 128000,
    costPer1MInput: 2.50,
    costPer1MOutput: 10.00,
    supportsStreaming: true
  },
  'gpt-4o-mini': {
    name: 'gpt-4o-mini',
    provider: 'openai',
    maxTokens: 128000,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.60,
    supportsStreaming: true
  },

  // Anthropic Claude
  'claude-3-5-sonnet': {
    name: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    maxTokens: 200000,
    costPer1MInput: 3.00,
    costPer1MOutput: 15.00,
    supportsStreaming: true
  },
  'claude-3-5-haiku': {
    name: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    maxTokens: 200000,
    costPer1MInput: 0.80,
    costPer1MOutput: 4.00,
    supportsStreaming: true
  },

  // Google Gemini
  'gemini-pro': {
    name: 'gemini-1.5-pro',
    provider: 'google',
    maxTokens: 2000000,
    costPer1MInput: 1.25,
    costPer1MOutput: 5.00,
    supportsStreaming: true
  },
  'gemini-flash': {
    name: 'gemini-1.5-flash',
    provider: 'google',
    maxTokens: 1000000,
    costPer1MInput: 0.075,
    costPer1MOutput: 0.30,
    supportsStreaming: true
  }
}

// 감정 카테고리 (한국어/영어 라벨 모두 포함)
export const EMOTIONS = [
  { value: 'loneliness', label: '외로움', labelEn: 'Lonely', icon: '😔' },
  { value: 'anxiety', label: '불안', labelEn: 'Anxious', icon: '😰' },
  { value: 'sadness', label: '슬픔', labelEn: 'Sad', icon: '😢' },
  { value: 'stress', label: '스트레스', labelEn: 'Stressed', icon: '😫' },
  { value: 'fear', label: '두려움', labelEn: 'Fearful', icon: '😨' },
  { value: 'anger', label: '분노', labelEn: 'Angry', icon: '😠' },
  { value: 'confusion', label: '혼란', labelEn: 'Confused', icon: '😕' },
  { value: 'hopelessness', label: '절망', labelEn: 'Hopeless', icon: '😞' },
  { value: 'gratitude', label: '감사', labelEn: 'Grateful', icon: '🙏' },
  { value: 'joy', label: '기쁨', labelEn: 'Joyful', icon: '😊' },
  { value: 'peace', label: '평안', labelEn: 'Peaceful', icon: '😌' },
  { value: 'hope', label: '희망', labelEn: 'Hopeful', icon: '✨' }
] as const

export type EmotionType = typeof EMOTIONS[number]['value']
