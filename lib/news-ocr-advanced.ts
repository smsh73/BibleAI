/**
 * 열한시 신문 고급 OCR 모듈
 *
 * 기능:
 * 1. 다단 레이아웃 분석 (2단/3단/4단)
 * 2. 연속 기사 감지 (페이지 간 기사 연속성)
 * 3. 기사 구조 분석 (제목, 기고자, 본문, 기자명)
 * 4. VML 레이아웃 분석
 * 5. 고유명사 검증 통합
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getApiKey, validateOCRResult, extractProperNouns } from './ocr-validator'

// API 클라이언트 (lazy initialization)
let openai: OpenAI | null = null
let anthropic: Anthropic | null = null
let genAI: GoogleGenerativeAI | null = null

async function getOpenAI(): Promise<OpenAI> {
  if (!openai) {
    const apiKey = await getApiKey('openai')
    if (!apiKey) throw new Error('OpenAI API key not available')
    openai = new OpenAI({ apiKey })
  }
  return openai
}

async function getAnthropic(): Promise<Anthropic> {
  if (!anthropic) {
    const apiKey = await getApiKey('anthropic')
    if (!apiKey) throw new Error('Anthropic API key not available')
    anthropic = new Anthropic({ apiKey })
  }
  return anthropic
}

async function getGenAI(): Promise<GoogleGenerativeAI> {
  if (!genAI) {
    const apiKey = await getApiKey('google')
    if (!apiKey) throw new Error('Google API key not available')
    genAI = new GoogleGenerativeAI(apiKey)
  }
  return genAI
}

// ============ 인터페이스 ============

export interface LayoutAnalysis {
  columnCount: number          // 단 수 (1-4)
  articleCount: number         // 기사 개수
  hasHeaderBanner: boolean     // 상단 배너/헤더 존재
  hasFooterAd: boolean         // 하단 광고 존재
  layoutType: 'standard' | 'special' | 'ad_heavy' | 'single_article'
}

export interface ArticleStructure {
  id: string                   // 기사 고유 ID
  title: string                // 제목
  subtitle?: string            // 부제목
  author?: string              // 기고자/필자
  reporter?: string            // 기자명
  content: string              // 본문
  type: string                 // 기사 유형
  position: {                  // 페이지 내 위치
    column: number             // 시작 단
    columnSpan: number         // 차지하는 단 수
    startY: 'top' | 'middle' | 'bottom'
  }
  isContinued: boolean         // 이전 페이지에서 계속됨
  continuesNext: boolean       // 다음 페이지로 계속됨
  continueMarker?: string      // 계속 표시 ("계속", "→", "다음 면에 계속" 등)
}

export interface PageAnalysis {
  pageNumber: number
  layout: LayoutAnalysis
  articles: ArticleStructure[]
  rawOCRText: string
  validatedText: string
  properNouns: {
    names: string[]
    positions: string[]
    places: string[]
    numbers: string[]
  }
  warnings: string[]
  confidence: number
}

export interface ContinuityCheckResult {
  isConnected: boolean         // 두 페이지 간 연결된 기사 있음
  connectedArticles: Array<{
    prevPageArticleId: string
    nextPageArticleId: string
    connectionType: 'continued' | 'related'
    confidence: number
  }>
}

// ============ 프롬프트 ============

/**
 * 레이아웃 분석 프롬프트
 */
const LAYOUT_ANALYSIS_PROMPT = `이 이미지는 한국 교회 "열한시" 신문의 한 면입니다.

이 면의 레이아웃을 분석해주세요:

1. **단 구성**: 몇 단으로 구성되어 있는가? (1단/2단/3단/4단)
2. **기사 개수**: 이 면에 포함된 기사는 몇 개인가?
3. **상단 배너**: 면 상단에 제호나 배너가 있는가?
4. **하단 광고**: 면 하단에 광고가 있는가?
5. **레이아웃 유형**:
   - standard: 일반적인 다단 기사 레이아웃
   - special: 특별 기획 (한 기사가 전면 차지)
   - ad_heavy: 광고 비중 높음
   - single_article: 단일 기사

JSON 형식으로만 응답:
{
  "columnCount": 3,
  "articleCount": 4,
  "hasHeaderBanner": true,
  "hasFooterAd": false,
  "layoutType": "standard"
}`

/**
 * 기사 구조 분석 프롬프트
 */
const ARTICLE_STRUCTURE_PROMPT = `이 이미지는 한국 교회 "열한시" 신문의 한 면입니다.

⚠️ 중요: 텍스트를 정확하게 읽어주세요. 추측하거나 비슷한 단어로 대체하지 마세요.

정확성 규칙:
1. 이름, 직함, 숫자는 이미지에 보이는 그대로 정확히 읽기
   - 예: "최원준 위임목사" → 그대로 출력
   - 예: "만나홀" → 그대로 출력
2. 불확실한 글자는 [?]로 표시
3. 고유명사(사람 이름, 장소명, 팀명)는 특히 주의

각 기사를 다음 형식으로 분석해주세요:

{
  "articles": [
    {
      "id": "article_1",
      "title": "기사 제목",
      "subtitle": "부제목 (있는 경우)",
      "author": "기고자/필자 이름 (있는 경우)",
      "reporter": "OOO 기자 (있는 경우)",
      "content": "본문 전체 내용 (정확하게)",
      "type": "목회편지|교회소식|행사안내|인물소개|광고|기타",
      "position": {
        "column": 1,
        "columnSpan": 2,
        "startY": "top|middle|bottom"
      },
      "isContinued": false,
      "continuesNext": true,
      "continueMarker": "다음 면에 계속"
    }
  ]
}

기사 연속성 판단 기준:
- 기사가 "계속", "→", "다음 면에 계속"으로 끝나면 continuesNext: true
- 기사가 제목 없이 시작하거나 "(전면에서 계속)"으로 시작하면 isContinued: true
- 기자명(OOO 기자)으로 끝나면 기사 완결

JSON 형식으로만 응답해주세요.`

/**
 * 연속 기사 확인 프롬프트 (2페이지 비교)
 */
const CONTINUITY_CHECK_PROMPT = `두 개의 이미지가 제공됩니다:
- 첫 번째 이미지: 이전 페이지
- 두 번째 이미지: 다음 페이지

두 페이지 간에 연결되는 기사가 있는지 확인해주세요.

확인 사항:
1. 이전 페이지에서 "계속", "→", "다음 면에 계속"으로 끝나는 기사
2. 다음 페이지에서 제목 없이 시작하거나 "(전면에서 계속)"으로 시작하는 기사
3. 같은 주제/키워드를 공유하는 기사

JSON 형식으로 응답:
{
  "isConnected": true,
  "connectedArticles": [
    {
      "prevPageArticle": "이전 페이지 기사 요약",
      "nextPageArticle": "다음 페이지 기사 요약",
      "connectionType": "continued|related",
      "confidence": 0.95
    }
  ]
}`

// ============ 분석 함수 ============

/**
 * 레이아웃 분석
 */
export async function analyzeLayout(
  base64Image: string,
  mimeType: string = 'image/jpeg'
): Promise<LayoutAnalysis> {
  try {
    const client = await getOpenAI()
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: LAYOUT_ANALYSIS_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' }
            }
          ]
        }
      ],
      max_tokens: 500
    })

    const content = response.choices[0].message.content || '{}'
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (error) {
    console.error('[Layout Analysis] 실패:', error)
  }

  // 기본값 반환
  return {
    columnCount: 3,
    articleCount: 1,
    hasHeaderBanner: true,
    hasFooterAd: false,
    layoutType: 'standard'
  }
}

/**
 * 기사 구조 분석 및 OCR
 */
export async function analyzeArticles(
  base64Image: string,
  mimeType: string = 'image/jpeg'
): Promise<{ articles: ArticleStructure[]; rawText: string }> {
  try {
    // Claude 사용 (한국어 정확도 높음)
    const client = await getAnthropic()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: base64Image } },
            { type: 'text', text: ARTICLE_STRUCTURE_PROMPT }
          ]
        }
      ]
    })

    const textBlock = response.content.find(block => block.type === 'text')
    const content = textBlock ? (textBlock as any).text : '{}'

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])

      // 전체 텍스트 조합
      const rawText = parsed.articles
        .map((a: ArticleStructure) => `### ${a.title}\n${a.content}`)
        .join('\n\n---\n\n')

      return {
        articles: parsed.articles,
        rawText
      }
    }
  } catch (error) {
    console.error('[Article Analysis] 실패:', error)
  }

  return { articles: [], rawText: '' }
}

/**
 * 연속 페이지 기사 연결 확인
 */
export async function checkArticleContinuity(
  prevPageBase64: string,
  nextPageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<ContinuityCheckResult> {
  try {
    const client = await getOpenAI()
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: CONTINUITY_CHECK_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${prevPageBase64}`, detail: 'high' }
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${nextPageBase64}`, detail: 'high' }
            }
          ]
        }
      ],
      max_tokens: 1000
    })

    const content = response.choices[0].message.content || '{}'
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        isConnected: parsed.isConnected,
        connectedArticles: parsed.connectedArticles?.map((a: any) => ({
          prevPageArticleId: a.prevPageArticle,
          nextPageArticleId: a.nextPageArticle,
          connectionType: a.connectionType,
          confidence: a.confidence
        })) || []
      }
    }
  } catch (error) {
    console.error('[Continuity Check] 실패:', error)
  }

  return { isConnected: false, connectedArticles: [] }
}

/**
 * 전체 페이지 분석 (레이아웃 + 기사 + 검증)
 */
export async function analyzeNewsPage(
  base64Image: string,
  pageNumber: number,
  mimeType: string = 'image/jpeg'
): Promise<PageAnalysis> {
  console.log(`[News OCR] 페이지 ${pageNumber} 분석 시작...`)

  // 1. 레이아웃 분석
  const layout = await analyzeLayout(base64Image, mimeType)
  console.log(`[News OCR] 레이아웃: ${layout.columnCount}단, ${layout.articleCount}개 기사`)

  // 2. 기사 구조 분석 및 OCR
  const { articles, rawText } = await analyzeArticles(base64Image, mimeType)
  console.log(`[News OCR] 기사 추출: ${articles.length}개`)

  // 3. 고유명사 추출
  const properNouns = extractProperNouns(rawText)

  // 4. 텍스트 검증 및 교정
  const validation = await validateOCRResult(rawText)
  console.log(`[News OCR] 검증 결과: 신뢰도 ${(validation.confidence * 100).toFixed(1)}%`)

  if (validation.corrections.length > 0) {
    console.log(`[News OCR] 교정: ${validation.corrections.map(c => `${c.from}→${c.to}`).join(', ')}`)
  }

  return {
    pageNumber,
    layout,
    articles,
    rawOCRText: rawText,
    validatedText: validation.correctedText,
    properNouns,
    warnings: [...validation.warnings, ...validation.hallucinations],
    confidence: validation.confidence
  }
}

/**
 * 다중 페이지 분석 (연속 기사 처리 포함)
 */
export async function analyzeNewsIssue(
  pageImages: Array<{ base64: string; mimeType: string }>,
  issueNumber: number
): Promise<{
  pages: PageAnalysis[]
  connectedArticles: Array<{
    fromPage: number
    toPage: number
    articles: string[]
  }>
}> {
  console.log(`[News OCR] ${issueNumber}호 분석 시작 (${pageImages.length}페이지)`)

  const pages: PageAnalysis[] = []
  const connectedArticles: Array<{ fromPage: number; toPage: number; articles: string[] }> = []

  // 각 페이지 분석
  for (let i = 0; i < pageImages.length; i++) {
    const page = await analyzeNewsPage(
      pageImages[i].base64,
      i + 1,
      pageImages[i].mimeType
    )
    pages.push(page)

    // 연속 페이지 간 기사 연결 확인 (2페이지 이상인 경우)
    if (i > 0) {
      const continuity = await checkArticleContinuity(
        pageImages[i - 1].base64,
        pageImages[i].base64,
        pageImages[i].mimeType
      )

      if (continuity.isConnected) {
        connectedArticles.push({
          fromPage: i,
          toPage: i + 1,
          articles: continuity.connectedArticles.map(a =>
            `${a.prevPageArticleId} → ${a.nextPageArticleId}`
          )
        })
        console.log(`[News OCR] 페이지 ${i}→${i + 1} 연결 기사 발견`)
      }
    }
  }

  return { pages, connectedArticles }
}

// ============ 유틸리티 ============

/**
 * 기사 병합 (연속 기사)
 */
export function mergeConnectedArticles(
  prevArticle: ArticleStructure,
  nextArticle: ArticleStructure
): ArticleStructure {
  return {
    ...prevArticle,
    content: `${prevArticle.content}\n\n[페이지 연속]\n\n${nextArticle.content}`,
    continuesNext: nextArticle.continuesNext,
    continueMarker: nextArticle.continueMarker
  }
}

/**
 * 기사 끝 패턴 감지
 */
export function detectArticleEnding(text: string): {
  isComplete: boolean
  endingType: 'reporter' | 'continued' | 'normal' | 'unknown'
} {
  const trimmed = text.trim()

  // 기자명으로 끝남 (완결)
  if (/[가-힣]{2,4}\s*기자\s*$/.test(trimmed)) {
    return { isComplete: true, endingType: 'reporter' }
  }

  // 계속 표시로 끝남 (미완결)
  if (/(계속|→|다음\s*면에\s*계속)\s*$/.test(trimmed)) {
    return { isComplete: false, endingType: 'continued' }
  }

  // 마침표로 끝남 (일반 완결)
  if (/[.。]\s*$/.test(trimmed)) {
    return { isComplete: true, endingType: 'normal' }
  }

  return { isComplete: false, endingType: 'unknown' }
}
