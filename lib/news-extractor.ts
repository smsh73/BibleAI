/**
 * 뉴스 텍스트 추출 공통 모듈
 * - URL 크롤링과 PDF 업로드 모두 지원
 * - OCR (OpenAI -> Gemini -> Claude fallback)
 * - 메타데이터 추출
 * - 청킹 및 벡터 임베딩
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'
import * as crypto from 'crypto'

// API 클라이언트 (lazy initialization)
let openai: OpenAI | null = null
let anthropic: Anthropic | null = null
let genAI: GoogleGenerativeAI | null = null
let supabase: ReturnType<typeof createClient> | null = null

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openai
}

function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropic
}

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '')
  }
  return genAI
}

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
  }
  return supabase
}

// OCR 프롬프트
const OCR_PROMPT = `이 이미지는 한국 교회의 월간 신문 "열한시"의 한 면입니다.
이미지에서 모든 한글 텍스트를 정확하게 추출해주세요.

추출 규칙:
1. 제목, 소제목, 본문 내용을 모두 추출
2. 기사별로 구분하여 추출 (### 로 구분)
3. 사진 캡션도 포함
4. 광고 문구도 포함
5. 원본 텍스트를 최대한 그대로 유지
6. 줄바꿈과 단락 구조 유지

형식:
### 기사 1
제목: (제목)
유형: (목회편지/교회소식/행사안내/광고/인물소개/기타)
내용: (본문 내용)

### 기사 2
...`

// 메타데이터 추출 프롬프트
const METADATA_PROMPT = `다음 신문 기사 텍스트에서 메타데이터를 추출해주세요.

추출할 정보:
1. title: 기사 제목
2. type: 기사 유형 (목회편지, 교회소식, 행사안내, 인물소개, 광고, 기타)
3. speaker: 언급된 주요 인물/화자
4. event_name: 언급된 행사명
5. event_date: 언급된 날짜/시간
6. bible_references: 언급된 성경 구절 (배열)
7. keywords: 주요 키워드 5개 이내 (배열)

반드시 JSON 형식으로만 응답해주세요:
{"title":"...","type":"...","speaker":"...","event_name":"...","event_date":"...","bible_references":["..."],"keywords":["..."]}`

// ============ 인터페이스 ============

export interface ExtractedArticle {
  title: string
  content: string
  article_type?: string
  speaker?: string
  event_name?: string
  event_date?: string
  bible_references?: string[]
  keywords?: string[]
}

export interface ProcessingResult {
  success: boolean
  issueNumber?: number
  issueDate?: string
  pageCount?: number
  articleCount?: number
  chunkCount?: number
  error?: string
}

export interface CrawlConfig {
  baseUrl: string          // 최상위 URL
  newestUrl?: string       // 가장 최신 데이터 URL
  oldestUrl?: string       // 가장 오래된 데이터 URL
  maxPages?: number        // 최대 페이지 수
  incremental?: boolean    // 증분 처리 여부
}

// ============ OCR 함수 ============

async function extractWithOpenAI(base64Image: string, mimeType: string = 'image/jpeg'): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: OCR_PROMPT },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' }
          }
        ]
      }
    ],
    max_tokens: 4096
  })
  return response.choices[0].message.content || ''
}

async function extractWithGemini(base64Image: string, mimeType: string = 'image/jpeg'): Promise<string> {
  const model = getGenAI().getGenerativeModel({ model: 'gemini-1.5-pro' })
  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Image } },
    { text: OCR_PROMPT }
  ])
  return result.response.text()
}

async function extractWithClaude(base64Image: string, mimeType: string = 'image/jpeg'): Promise<string> {
  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: base64Image } },
          { type: 'text', text: OCR_PROMPT }
        ]
      }
    ]
  })
  const textBlock = response.content.find(block => block.type === 'text')
  return textBlock ? (textBlock as any).text : ''
}

/**
 * OCR 실행 (fallback: OpenAI -> Gemini -> Claude)
 */
export async function performOCR(
  imageData: Buffer | string,
  mimeType: string = 'image/jpeg'
): Promise<{ text: string; provider: string }> {
  const base64 = Buffer.isBuffer(imageData) ? imageData.toString('base64') : imageData

  // 1. OpenAI 시도
  try {
    const text = await extractWithOpenAI(base64, mimeType)
    return { text, provider: 'OpenAI' }
  } catch (error: any) {
    console.log(`OpenAI 실패: ${error.message?.substring(0, 50)}...`)
  }

  // 2. Gemini 시도
  try {
    const text = await extractWithGemini(base64, mimeType)
    return { text, provider: 'Gemini' }
  } catch (error: any) {
    console.log(`Gemini 실패: ${error.message?.substring(0, 50)}...`)
  }

  // 3. Claude 시도
  try {
    const text = await extractWithClaude(base64, mimeType)
    return { text, provider: 'Claude' }
  } catch (error: any) {
    console.log(`Claude 실패: ${error.message?.substring(0, 50)}...`)
  }

  throw new Error('모든 OCR 서비스가 실패했습니다.')
}

// ============ 메타데이터 추출 ============

/**
 * 기사 텍스트에서 메타데이터 추출
 */
export async function extractMetadata(articleText: string): Promise<ExtractedArticle> {
  console.log(`[extractMetadata] 시작 - 텍스트 길이: ${articleText?.length || 0}`)
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${METADATA_PROMPT}\n\n기사 텍스트:\n${articleText.substring(0, 2000)}`
        }
      ]
    })
    console.log(`[extractMetadata] Claude API 응답 받음`)

    const textBlock = response.content.find(block => block.type === 'text')
    const jsonText = textBlock ? (textBlock as any).text : '{}'

    // JSON 파싱
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const metadata = JSON.parse(jsonMatch[0])
      return {
        title: metadata.title || '제목 없음',
        content: articleText,
        article_type: metadata.type,
        speaker: metadata.speaker,
        event_name: metadata.event_name,
        event_date: metadata.event_date,
        bible_references: metadata.bible_references,
        keywords: metadata.keywords
      }
    }
  } catch (error) {
    console.error('메타데이터 추출 실패:', error)
  }

  return { title: '제목 없음', content: articleText }
}

/**
 * OCR 텍스트에서 기사 분리
 *
 * 지원하는 구분자 형식:
 * 1. "### 기사 1", "### 기사 2" ... (news-extractor.ts 형식)
 * 2. "---" (news-crawler.ts 레거시 형식)
 * 3. "[기사 1]", "[기사 2]" ... (news-crawler.ts 대체 형식)
 */
export function splitArticles(ocrText: string): string[] {
  if (!ocrText || ocrText.trim().length < 100) {
    return []
  }

  // 먼저 구분자 형식 감지
  const hasHashSeparator = /###\s*기사/i.test(ocrText)
  const hasDashSeparator = /\n---\n/.test(ocrText)
  const hasBracketSeparator = /\[기사\s*\d+\]/i.test(ocrText)

  let articles: string[] = []

  if (hasHashSeparator) {
    // "### 기사" 형식으로 분리
    articles = ocrText.split(/###\s*기사\s*\d*/i)
      .map(a => a.trim())
      .filter(a => a.length > 100)
  } else if (hasDashSeparator) {
    // "---" 형식으로 분리
    articles = ocrText.split(/\n---\n/)
      .map(a => a.trim())
      .filter(a => a.length > 100)
  } else if (hasBracketSeparator) {
    // "[기사 N]" 형식으로 분리
    articles = ocrText.split(/\[기사\s*\d+\]/i)
      .map(a => a.trim())
      .filter(a => a.length > 100)
  }

  // 분리된 기사가 없으면 전체를 하나의 기사로
  if (articles.length === 0 && ocrText.trim().length > 100) {
    return [ocrText.trim()]
  }

  // 조각난 짧은 기사들을 이전 기사와 합치기
  const mergedArticles: string[] = []
  for (const article of articles) {
    // 200자 미만의 짧은 조각은 이전 기사에 병합
    if (article.length < 200 && mergedArticles.length > 0) {
      mergedArticles[mergedArticles.length - 1] += '\n\n' + article
    } else {
      mergedArticles.push(article)
    }
  }

  return mergedArticles
}

// ============ 청킹 및 임베딩 ============

/**
 * 한국어 문장 경계 위치 찾기
 * 다양한 문장 종결 패턴을 지원
 */
function findKoreanSentenceBoundary(text: string): number {
  // 우선순위별 문장 종결 패턴 (높은 우선순위부터)
  const patterns = [
    // 한국어 종결어미 + 구두점
    /다\.\s*$/,      // "...합니다."
    /다\.\n/,        // "...합니다.\n"
    /요\.\s*$/,      // "...해요."
    /요\.\n/,        // "...해요.\n"
    /죠\.\s*$/,      // "...하죠."
    /니다\.\s*$/,    // "...됩니다."

    // 일반 구두점
    /\.\s*$/,        // 마침표로 끝남
    /\.\n/,          // 마침표 + 줄바꿈
    /。\s*$/,        // 중국식 마침표
    /\?\s*$/,        // 물음표
    /!\s*$/,         // 느낌표

    // 줄바꿈 (마지막 우선순위)
    /\n\n/,          // 빈 줄 (단락 구분)
    /\n/             // 일반 줄바꿈
  ]

  // 텍스트의 마지막 40%에서 패턴 검색 (앞쪽에서 끊으면 너무 짧아짐)
  const searchStart = Math.floor(text.length * 0.6)
  const searchText = text.substring(searchStart)

  for (const pattern of patterns) {
    const match = searchText.match(pattern)
    if (match && match.index !== undefined) {
      // 전체 텍스트 기준 위치 반환
      return searchStart + match.index + match[0].length
    }
  }

  // 마지막 시도: 공백 위치에서 자르기
  const lastSpace = text.lastIndexOf(' ')
  if (lastSpace > text.length * 0.6) {
    return lastSpace + 1
  }

  return -1 // 경계를 찾지 못함
}

/**
 * 텍스트를 청크로 분할 (500자, 20% 오버랩)
 *
 * 개선 사항:
 * 1. 한국어 문장 경계 감지 향상
 * 2. 조각난 청크 병합으로 정보 손실 방지
 * 3. 오버랩 보장으로 문맥 유지
 */
export function chunkText(text: string, chunkSize: number = 500, overlapRatio: number = 0.2): string[] {
  // 빈 텍스트 처리
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return []
  }

  const trimmedText = text.trim()

  // 텍스트가 chunkSize보다 짧으면 전체를 하나의 청크로
  if (trimmedText.length <= chunkSize) {
    return trimmedText.length > 50 ? [trimmedText] : []
  }

  const chunks: string[] = []
  const overlapSize = Math.floor(chunkSize * overlapRatio)
  let start = 0
  let prevStart = -1

  while (start < trimmedText.length) {
    // 무한 루프 방지
    if (start === prevStart) {
      break
    }
    prevStart = start

    let end = Math.min(start + chunkSize, trimmedText.length)

    // 문장 경계에서 자르기 (마지막 청크가 아닌 경우)
    if (end < trimmedText.length) {
      const chunk = trimmedText.substring(start, end)
      const boundaryPos = findKoreanSentenceBoundary(chunk)

      if (boundaryPos > 0) {
        end = start + boundaryPos
      }
    }

    const chunk = trimmedText.substring(start, end).trim()

    // 50자 미만 조각은 이전 청크에 병합
    if (chunk.length < 50 && chunks.length > 0) {
      chunks[chunks.length - 1] += ' ' + chunk
    } else if (chunk.length >= 50) {
      chunks.push(chunk)
    }

    // start가 항상 전진하도록 보장 (오버랩 적용)
    const nextStart = end - overlapSize
    start = nextStart > start ? nextStart : end

    // 남은 텍스트가 50자 미만이면 마지막 청크에 병합
    if (start >= trimmedText.length - 50) {
      const remaining = trimmedText.substring(start).trim()
      if (remaining.length > 0 && chunks.length > 0) {
        chunks[chunks.length - 1] += ' ' + remaining
      } else if (remaining.length >= 50) {
        chunks.push(remaining)
      }
      break
    }
  }

  return chunks
}

// ============ 임베딩 함수 (OpenAI text-embedding-3-small 전용 - Fallback 없음) ============
// ⚠️ 중요: 벡터 임베딩은 반드시 동일한 모델을 사용해야 합니다.
// 다른 모델로 fallback하면 임베딩 공간이 달라져 검색 품질이 크게 저하됩니다.

/**
 * 임베딩 쿼타 에러 클래스
 */
export class EmbeddingQuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbeddingQuotaError'
  }
}

/**
 * OpenAI 임베딩 에러가 쿼타 관련인지 확인
 */
function isQuotaError(error: any): boolean {
  const message = error?.message?.toLowerCase() || ''
  const code = error?.code || error?.status || ''

  return (
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('insufficient_quota') ||
    message.includes('billing') ||
    code === 429 ||
    code === 'insufficient_quota'
  )
}

/**
 * 텍스트 임베딩 생성 (1536차원)
 * ⚠️ OpenAI text-embedding-3-small 전용 - Fallback 없음
 * 쿼타 소진 시 EmbeddingQuotaError를 throw합니다.
 * bible_verses, sermon_chunks와 동일한 차원 사용
 */
export async function createEmbedding(text: string): Promise<number[]> {
  try {
    const response = await getOpenAI().embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536
    })
    return response.data[0].embedding
  } catch (error: any) {
    console.error(`[createEmbedding] OpenAI 임베딩 실패:`, error.message)

    if (isQuotaError(error)) {
      throw new EmbeddingQuotaError(
        'OpenAI API 쿼타가 소진되었습니다. 임베딩 작업을 중단합니다. ' +
        '관리자 페이지에서 API 키를 확인하거나 쿼타를 충전해주세요.'
      )
    }

    // 쿼타 이외의 오류도 다른 모델로 fallback하지 않음
    throw new Error(
      `임베딩 생성 실패: ${error.message}. ` +
      '벡터 일관성을 위해 다른 모델로 대체하지 않습니다.'
    )
  }
}

/**
 * 배치 임베딩 생성 (Fallback 없음)
 * ⚠️ OpenAI text-embedding-3-small 전용 (1536차원)
 * 쿼타 소진 시 EmbeddingQuotaError를 throw합니다.
 * bible_verses, sermon_chunks와 동일한 차원 사용
 */
export async function createBatchEmbeddings(texts: string[]): Promise<number[][]> {
  console.log(`[createBatchEmbeddings] 시작 - 텍스트 수: ${texts?.length || 0}`)

  // 빈 배열 처리
  if (!texts || texts.length === 0) {
    console.log(`[createBatchEmbeddings] 빈 배열 반환`)
    return []
  }

  // 유효한 텍스트만 필터링
  const validTexts = texts.filter(t => t && typeof t === 'string' && t.trim().length > 0)
  if (validTexts.length === 0) {
    console.log(`[createBatchEmbeddings] 유효한 텍스트 없음, 빈 배열 반환`)
    return []
  }
  console.log(`[createBatchEmbeddings] 유효한 텍스트 수: ${validTexts.length}`)

  try {
    const response = await getOpenAI().embeddings.create({
      model: 'text-embedding-3-small',
      input: validTexts,
      dimensions: 1536
    })
    console.log(`[createBatchEmbeddings] 성공 - 임베딩 수: ${response.data.length}`)
    return response.data.map(d => d.embedding)
  } catch (error: any) {
    console.error(`[createBatchEmbeddings] OpenAI 배치 임베딩 실패:`, error.message)

    if (isQuotaError(error)) {
      throw new EmbeddingQuotaError(
        'OpenAI API 쿼타가 소진되었습니다. 임베딩 작업을 중단합니다. ' +
        '관리자 페이지에서 API 키를 확인하거나 쿼타를 충전해주세요.'
      )
    }

    // 쿼타 이외의 오류도 다른 모델로 fallback하지 않음
    throw new Error(
      `배치 임베딩 생성 실패: ${error.message}. ` +
      '벡터 일관성을 위해 다른 모델로 대체하지 않습니다.'
    )
  }
}

// ============ 중복 체크 ============

/**
 * 파일 해시 생성
 */
export function generateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * URL에서 게시물 ID 추출
 */
export function extractBoardId(url: string): number | null {
  const match = url.match(/\/Board\/Detail\/\d+\/(\d+)/)
  return match ? parseInt(match[1]) : null
}

/**
 * 이미 처리된 호수인지 확인
 */
export async function isIssueProcessed(issueNumber: number): Promise<boolean> {
  const { data } = await getSupabase()
    .from('news_issues')
    .select('status')
    .eq('issue_number', issueNumber)
    .single()

  return (data as any)?.status === 'completed'
}

/**
 * 이미 처리된 파일인지 확인 (해시 기반)
 */
export async function isFileProcessed(fileHash: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from('news_pages')
    .select('id')
    .eq('file_hash', fileHash)
    .single()

  return !!data
}

// ============ DB 저장 ============

export async function saveNewsIssue(issue: {
  issue_number: number
  issue_date: string
  year: number
  month: number
  board_id: number
  page_count?: number
  source_type?: string
  status?: string
}): Promise<number> {
  const { data, error } = await getSupabase()
    .from('news_issues')
    .upsert({
      ...issue,
      status: issue.status || 'processing',
      updated_at: new Date().toISOString()
    } as any, { onConflict: 'issue_number' })
    .select('id')
    .single()

  if (error) throw error
  return (data as any).id
}

export async function saveNewsPage(page: {
  issue_id: number
  page_number: number
  image_url?: string
  file_hash?: string
  ocr_text?: string
  ocr_provider?: string
  status?: string
}): Promise<number> {
  const { data, error } = await getSupabase()
    .from('news_pages')
    .upsert(page as any, { onConflict: 'issue_id,page_number' })
    .select('id')
    .single()

  if (error) throw error
  return (data as any).id
}

export async function saveNewsArticle(article: {
  issue_id: number
  page_id: number
  title: string
  content: string
  article_type?: string
  speaker?: string
  event_name?: string
  event_date?: string
  bible_references?: string[]
  keywords?: string[]
}): Promise<number> {
  const { data, error } = await getSupabase()
    .from('news_articles')
    .insert(article as any)
    .select('id')
    .single()

  if (error) throw error
  return (data as any).id
}

export async function saveNewsChunk(chunk: {
  article_id: number
  issue_id: number
  chunk_index: number
  chunk_text: string
  issue_number: number
  issue_date: string
  page_number: number
  article_title: string
  article_type?: string
  embedding: number[]
}): Promise<void> {
  const { error } = await getSupabase().from('news_chunks').insert(chunk as any)
  if (error) throw error
}

export async function updateIssueStatus(issueId: number, status: string): Promise<void> {
  const client = getSupabase() as any
  await client
    .from('news_issues')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', issueId)
}

// ============ 통합 처리 파이프라인 ============

/**
 * 이미지 데이터를 처리하여 기사 추출 및 벡터화
 */
export async function processImageToArticles(
  imageData: Buffer,
  issueId: number,
  issueNumber: number,
  issueDate: string,
  pageNumber: number,
  mimeType: string = 'image/jpeg',
  onProgress?: (step: string) => void
): Promise<{ articles: number; chunks: number }> {
  let articleCount = 0
  let chunkCount = 0

  // 1. OCR
  onProgress?.('OCR 진행 중...')
  const { text: ocrText, provider } = await performOCR(imageData, mimeType)

  // 2. 페이지 저장
  const pageId = await saveNewsPage({
    issue_id: issueId,
    page_number: pageNumber,
    file_hash: generateFileHash(imageData),
    ocr_text: ocrText,
    ocr_provider: provider,
    status: 'completed'
  })

  // 3. 기사 분리
  onProgress?.('기사 분리 중...')
  const articleTexts = splitArticles(ocrText)

  // 4. 각 기사 처리
  for (const articleText of articleTexts) {
    // 메타데이터 추출
    onProgress?.('메타데이터 추출 중...')
    const metadata = await extractMetadata(articleText)

    // 기사 저장
    const articleId = await saveNewsArticle({
      issue_id: issueId,
      page_id: pageId,
      title: metadata.title,
      content: metadata.content,
      article_type: metadata.article_type,
      speaker: metadata.speaker,
      event_name: metadata.event_name,
      event_date: metadata.event_date,
      bible_references: metadata.bible_references,
      keywords: metadata.keywords
    })
    articleCount++

    // 청킹
    onProgress?.('청킹 중...')
    const chunks = chunkText(metadata.content)

    // 청크가 있을 때만 임베딩 처리
    if (chunks.length > 0) {
      // 배치 임베딩 (쿼타 에러 시 전파하여 작업 중단)
      onProgress?.('임베딩 생성 중...')
      try {
        const embeddings = await createBatchEmbeddings(chunks)

        // 청크 저장 (임베딩 수와 청크 수가 일치할 때만)
        const saveCount = Math.min(chunks.length, embeddings.length)
        for (let i = 0; i < saveCount; i++) {
          await saveNewsChunk({
            article_id: articleId,
            issue_id: issueId,
            chunk_index: i,
            chunk_text: chunks[i],
            issue_number: issueNumber,
            issue_date: issueDate,
            page_number: pageNumber,
            article_title: metadata.title,
            article_type: metadata.article_type,
            embedding: embeddings[i]
          })
          chunkCount++
        }
      } catch (embeddingError) {
        // 쿼타 에러인 경우 상위로 전파하여 전체 작업 중단
        if (embeddingError instanceof EmbeddingQuotaError) {
          console.error(`[processImageToArticles] 임베딩 쿼타 소진 - 작업 중단`)
          throw embeddingError
        }
        // 기타 임베딩 에러도 전파 (fallback 없음)
        console.error(`[processImageToArticles] 임베딩 실패:`, embeddingError)
        throw embeddingError
      }
    }
  }

  return { articles: articleCount, chunks: chunkCount }
}
