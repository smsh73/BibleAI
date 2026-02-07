/**
 * 열한시 신문 크롤러 및 OCR 처리 시스템
 * - 웹사이트에서 신문 이미지 크롤링
 * - OCR로 텍스트 추출 (OpenAI -> Gemini -> Claude fallback)
 * - 메타데이터 추출 및 청킹
 * - 벡터 임베딩 및 DB 저장
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { splitArticles } from './news-extractor'

// API 클라이언트 (lazy initialization - runtime에서만 생성)
let _openai: OpenAI | null = null
let _anthropic: Anthropic | null = null
let _genAI: GoogleGenerativeAI | null = null
let _supabase: SupabaseClient | null = null

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    _genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '')
  }
  return _genAI
}

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

// 상수
const BASE_URL = 'https://www.anyangjeil.org'
const DATA_CDN = 'https://data.dimode.co.kr'
const BOARD_ID = 66
const DATA_DIR = path.join(process.cwd(), 'data', 'news')

// OCR 프롬프트 (news-extractor.ts와 동일한 ### 형식 사용)
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
1. 제목 (title)
2. 기사 유형 (type): 목회편지, 교회소식, 행사안내, 인물소개, 광고, 기타
3. 인물/화자 (speaker): 언급된 주요 인물
4. 행사명 (event_name): 언급된 행사
5. 행사 일시 (event_date): 언급된 날짜/시간
6. 성경 참조 (bible_references): 언급된 성경 구절 (배열)
7. 키워드 (keywords): 주요 키워드 5개 이내 (배열)

JSON 형식으로 응답해주세요:
{
  "title": "...",
  "type": "...",
  "speaker": "...",
  "event_name": "...",
  "event_date": "...",
  "bible_references": ["..."],
  "keywords": ["..."]
}`

export interface NewsIssue {
  id?: number
  issue_number: number
  issue_date: string
  year: number
  month: number
  board_id: number
  page_count: number
  status: string
}

export interface NewsPage {
  id?: number
  issue_id: number
  page_number: number
  image_url: string
  local_path?: string
  ocr_text?: string
  ocr_provider?: string
  status: string
}

export interface NewsArticle {
  id?: number
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
}

export interface NewsChunk {
  article_id: number
  issue_id: number
  chunk_index: number
  chunk_text: string
  issue_number: number
  issue_date: string
  page_number: number
  article_title: string
  article_type?: string
  embedding?: number[]
}

// ============ 크롤링 함수 ============

/**
 * 목록 페이지에서 모든 호수 정보 수집
 */
export async function fetchAllIssues(): Promise<NewsIssue[]> {
  const issues: NewsIssue[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const url = `${BASE_URL}/Board/Index/${BOARD_ID}?page=${page}`
    console.log(`페이지 ${page} 크롤링 중...`)

    const response = await fetch(url)
    const html = await response.text()

    // 게시물 링크 추출
    const linkRegex = /href="\/Board\/Detail\/66\/(\d+)/g
    const titleRegex = /title="(\d{4}년\s*\d{1,2}월호)"/g

    let match
    const boardIds: number[] = []
    while ((match = linkRegex.exec(html)) !== null) {
      const boardId = parseInt(match[1])
      if (!boardIds.includes(boardId)) {
        boardIds.push(boardId)
      }
    }

    if (boardIds.length === 0) {
      hasMore = false
      break
    }

    // 각 게시물의 상세 정보 가져오기
    for (const boardId of boardIds) {
      const detailUrl = `${BASE_URL}/Board/Detail/${BOARD_ID}/${boardId}`
      const detailResponse = await fetch(detailUrl)
      const detailHtml = await detailResponse.text()

      // 제목에서 년월 추출
      const titleMatch = detailHtml.match(/class="document-title">[\s\S]*?(\d{4})년\s*(\d{1,2})월호/)
      if (titleMatch) {
        const year = parseInt(titleMatch[1])
        const month = parseInt(titleMatch[2])

        // 호수 계산 (2020년 2월 = 433호 기준)
        // 504호 = 2026년 1월
        // 차이: 71개월 = 71호
        const baseIssue = 433 // 2020년 2월호
        const baseYear = 2020
        const baseMonth = 2
        const monthsDiff = (year - baseYear) * 12 + (month - baseMonth)
        const issueNumber = baseIssue + monthsDiff

        issues.push({
          issue_number: issueNumber,
          issue_date: `${year}년 ${month}월호`,
          year,
          month,
          board_id: boardId,
          page_count: 8,
          status: 'pending'
        })
      }
    }

    page++

    // 최대 10페이지까지만
    if (page > 10) hasMore = false
  }

  return issues.sort((a, b) => a.issue_number - b.issue_number)
}

/**
 * 특정 호수의 이미지 URL 목록 추출
 */
export async function fetchIssueImages(boardId: number): Promise<string[]> {
  const url = `${BASE_URL}/Board/Detail/${BOARD_ID}/${boardId}`
  const response = await fetch(url)
  const html = await response.text()

  const imageUrls: string[] = []
  const imgRegex = /src="(https:\/\/data\.dimode\.co\.kr[^"]+)"/g

  let match
  while ((match = imgRegex.exec(html)) !== null) {
    const imageUrl = match[1].trim()
    if (imageUrl.endsWith('.jpg') || imageUrl.endsWith('.png')) {
      imageUrls.push(imageUrl)
    }
  }

  return imageUrls
}

/**
 * 이미지 다운로드
 */
export async function downloadImage(imageUrl: string, localPath: string): Promise<boolean> {
  try {
    const dir = path.dirname(localPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const response = await fetch(imageUrl)
    const buffer = await response.arrayBuffer()
    fs.writeFileSync(localPath, Buffer.from(buffer))

    return true
  } catch (error) {
    console.error(`이미지 다운로드 실패: ${imageUrl}`, error)
    return false
  }
}

// ============ OCR 함수 ============

async function extractWithOpenAI(base64Image: string): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: OCR_PROMPT },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' }
          }
        ]
      }
    ],
    max_tokens: 4096
  })
  return response.choices[0].message.content || ''
}

async function extractWithGemini(base64Image: string): Promise<string> {
  const model = getGenAI().getGenerativeModel({ model: 'gemini-1.5-pro' })
  const result = await model.generateContent([
    { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
    { text: OCR_PROMPT }
  ])
  return result.response.text()
}

async function extractWithClaude(base64Image: string): Promise<string> {
  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
          { type: 'text', text: OCR_PROMPT }
        ]
      }
    ]
  })
  const textBlock = response.content.find(block => block.type === 'text')
  return textBlock ? (textBlock as any).text : ''
}

/**
 * OCR 실행 (fallback 순서: OpenAI -> Gemini -> Claude)
 */
export async function performOCR(imagePath: string): Promise<{ text: string; provider: string }> {
  const imageBuffer = fs.readFileSync(imagePath)
  const base64Image = imageBuffer.toString('base64')

  // 1. OpenAI 시도
  try {
    const text = await extractWithOpenAI(base64Image)
    return { text, provider: 'OpenAI' }
  } catch (error: any) {
    console.log(`OpenAI 실패: ${error.message?.substring(0, 50)}...`)
  }

  // 2. Gemini 시도
  try {
    const text = await extractWithGemini(base64Image)
    return { text, provider: 'Gemini' }
  } catch (error: any) {
    console.log(`Gemini 실패: ${error.message?.substring(0, 50)}...`)
  }

  // 3. Claude 시도
  try {
    const text = await extractWithClaude(base64Image)
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
export async function extractMetadata(articleText: string): Promise<Partial<NewsArticle>> {
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${METADATA_PROMPT}\n\n기사 텍스트:\n${articleText}`
        }
      ]
    })

    const textBlock = response.content.find(block => block.type === 'text')
    const jsonText = textBlock ? (textBlock as any).text : '{}'

    // JSON 파싱
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const metadata = JSON.parse(jsonMatch[0])
      return {
        title: metadata.title || '제목 없음',
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

  return { title: '제목 없음' }
}

// ============ 청킹 및 임베딩 ============

/**
 * 텍스트를 청크로 분할 (500자, 20% 오버랩)
 */
export function chunkText(text: string, chunkSize: number = 500, overlap: number = 0.2): string[] {
  const chunks: string[] = []
  const overlapSize = Math.floor(chunkSize * overlap)
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    const chunk = text.substring(start, end)

    // 문장 경계에서 자르기 시도
    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf('.')
      const lastNewline = chunk.lastIndexOf('\n')
      const cutPoint = Math.max(lastPeriod, lastNewline)

      if (cutPoint > chunkSize * 0.5) {
        chunks.push(text.substring(start, start + cutPoint + 1).trim())
        start = start + cutPoint + 1 - overlapSize
      } else {
        chunks.push(chunk.trim())
        start = end - overlapSize
      }
    } else {
      chunks.push(chunk.trim())
      break
    }
  }

  return chunks.filter(c => c.length > 50) // 너무 짧은 청크 제거
}

/**
 * 텍스트 임베딩 생성 (1536차원)
 * bible_verses, sermon_chunks와 동일한 차원 사용
 */
export async function createEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536
  })
  return response.data[0].embedding
}

// ============ DB 저장 ============

export async function saveIssue(issue: NewsIssue): Promise<number> {
  const { data, error } = await getSupabase()
    .from('news_issues')
    .upsert(issue, { onConflict: 'issue_number' })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

export async function savePage(page: NewsPage): Promise<number> {
  const { data, error } = await getSupabase()
    .from('news_pages')
    .upsert(page, { onConflict: 'issue_id,page_number' })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

export async function saveArticle(article: NewsArticle): Promise<number> {
  const { data, error } = await getSupabase()
    .from('news_articles')
    .insert(article)
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

export async function saveChunk(chunk: NewsChunk): Promise<void> {
  const { error } = await getSupabase().from('news_chunks').insert(chunk)
  if (error) throw error
}

// ============ 검색 함수 ============

export async function searchNews(
  query: string,
  options: {
    year?: number
    articleType?: string
    limit?: number
  } = {}
): Promise<any[]> {
  const { year, articleType, limit = 10 } = options

  // 쿼리 임베딩 생성
  const queryEmbedding = await createEmbedding(query)

  // 하이브리드 검색 실행
  const { data, error } = await getSupabase().rpc('hybrid_search_news', {
    query_embedding: queryEmbedding,
    query_text: query,
    match_threshold: 0.5,
    match_count: limit,
    year_filter: year || null,
    article_type_filter: articleType || null
  })

  if (error) throw error
  return data || []
}

// ============ 전체 처리 파이프라인 ============

export async function processIssue(
  issue: NewsIssue,
  onProgress?: (step: string, progress: number) => void
): Promise<void> {
  console.log(`\n=== ${issue.issue_date} (${issue.issue_number}호) 처리 시작 ===`)

  // 1. 이슈 저장
  const issueId = await saveIssue({ ...issue, status: 'processing' })
  onProgress?.('저장', 10)

  // 2. 이미지 URL 수집
  const imageUrls = await fetchIssueImages(issue.board_id)
  console.log(`이미지 ${imageUrls.length}개 발견`)
  onProgress?.('이미지 수집', 20)

  // 3. 각 페이지 처리
  for (let i = 0; i < imageUrls.length; i++) {
    const pageNumber = i + 1
    const imageUrl = imageUrls[i]
    const localPath = path.join(DATA_DIR, `${issue.issue_number}`, `page-${pageNumber}.jpg`)

    console.log(`\n페이지 ${pageNumber}/${imageUrls.length} 처리 중...`)

    // 이미지 다운로드
    await downloadImage(imageUrl, localPath)
    onProgress?.(`페이지 ${pageNumber} 다운로드`, 20 + (i / imageUrls.length) * 20)

    // 페이지 저장
    const pageId = await savePage({
      issue_id: issueId,
      page_number: pageNumber,
      image_url: imageUrl,
      local_path: localPath,
      status: 'ocr_processing'
    })

    // OCR 실행
    const { text: ocrText, provider } = await performOCR(localPath)
    console.log(`OCR 완료 (${provider}): ${ocrText.length}자`)

    // 페이지 업데이트
    await getSupabase()
      .from('news_pages')
      .update({ ocr_text: ocrText, ocr_provider: provider, status: 'completed' })
      .eq('id', pageId)

    onProgress?.(`페이지 ${pageNumber} OCR`, 40 + (i / imageUrls.length) * 20)

    // 기사 분리 및 메타데이터 추출 (통합된 splitArticles 함수 사용)
    const articles = splitArticles(ocrText)

    for (const articleText of articles) {
      // 메타데이터 추출
      const metadata = await extractMetadata(articleText)

      // 기사 저장
      const articleId = await saveArticle({
        issue_id: issueId,
        page_id: pageId,
        title: metadata.title || '제목 없음',
        content: articleText,
        article_type: metadata.article_type,
        speaker: metadata.speaker,
        event_name: metadata.event_name,
        event_date: metadata.event_date,
        bible_references: metadata.bible_references,
        keywords: metadata.keywords
      })

      // 청킹
      const chunks = chunkText(articleText)

      // 각 청크 임베딩 및 저장
      for (let j = 0; j < chunks.length; j++) {
        const embedding = await createEmbedding(chunks[j])

        await saveChunk({
          article_id: articleId,
          issue_id: issueId,
          chunk_index: j,
          chunk_text: chunks[j],
          issue_number: issue.issue_number,
          issue_date: issue.issue_date,
          page_number: pageNumber,
          article_title: metadata.title || '제목 없음',
          article_type: metadata.article_type,
          embedding
        })
      }
    }

    onProgress?.(`페이지 ${pageNumber} 완료`, 60 + (i / imageUrls.length) * 30)
  }

  // 4. 이슈 상태 업데이트
  await getSupabase()
    .from('news_issues')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', issueId)

  onProgress?.('완료', 100)
  console.log(`=== ${issue.issue_date} 처리 완료 ===\n`)
}
