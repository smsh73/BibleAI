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

// API 키 캐시 (TTL 기반 - 5분마다 갱신)
let apiKeyCache: Record<string, string> = {}
let apiKeyCacheLoaded = false
let apiKeyCacheTime = 0
const API_KEY_CACHE_TTL = 5 * 60 * 1000 // 5분

type AIProvider = 'openai' | 'anthropic' | 'google' | 'perplexity' | 'youtube'

/**
 * Supabase에서 저장된 API 키 가져오기
 * 관리자가 저장한 키가 환경변수보다 우선
 */
async function fetchStoredApiKeys(): Promise<Record<string, string>> {
  const now = Date.now()

  // 캐시가 유효하고 키가 있으면 캐시 반환
  if (apiKeyCacheLoaded && Object.keys(apiKeyCache).length > 0 && (now - apiKeyCacheTime) < API_KEY_CACHE_TTL) {
    return apiKeyCache
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    apiKeyCacheLoaded = true
    return {}
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/api_keys?is_active=eq.true&order=priority.asc`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      apiKeyCacheLoaded = true
      return {}
    }

    const data = await response.json()
    const keys: Record<string, string> = {}
    for (const row of data) {
      try {
        keys[row.provider] = typeof atob === 'function'
          ? atob(row.key)
          : Buffer.from(row.key, 'base64').toString('utf-8')
      } catch {
        keys[row.provider] = row.key
      }
    }

    apiKeyCache = keys
    apiKeyCacheLoaded = true
    apiKeyCacheTime = Date.now()
    console.log('[news-extractor] API 키 로드:', Object.keys(keys).join(', '))
    return keys
  } catch (error) {
    apiKeyCacheTime = Date.now() - API_KEY_CACHE_TTL + 60000
    return apiKeyCache
  }
}

/**
 * API 키 가져오기 (우선순위: 관리자 저장 키 > 환경변수)
 */
async function getApiKey(provider: AIProvider): Promise<string | null> {
  const storedKeys = await fetchStoredApiKeys()
  if (storedKeys[provider]) {
    return storedKeys[provider]
  }

  const envKeys: Record<AIProvider, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
    youtube: process.env.YOUTUBE_API_KEY
  }

  return envKeys[provider] || null
}

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

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
    )
  }
  return supabase
}

// ============ 알려진 OCR 오류 교정 패턴 ============

const KNOWN_OCR_CORRECTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  // 신문 이름 오류
  { pattern: /월\s*한\s*시/g, replacement: '열한시' },
  { pattern: /월한세/g, replacement: '열한시' },
  { pattern: /월간지/g, replacement: '열한시' },  // 문맥에 따라 조정 필요
  { pattern: /열\s*한\s*시/g, replacement: '열한시' },

  // 장소명 오류
  { pattern: /한나홀/g, replacement: '만나홀' },
  { pattern: /만나를/g, replacement: '만나홀' },

  // 직함 오류
  { pattern: /위원목사/g, replacement: '위임목사' },
  { pattern: /우임목사/g, replacement: '위임목사' },

  // 일반적인 한글 혼동
  { pattern: /요즘형/g, replacement: '요르단' },
]

/**
 * 알려진 OCR 오류 패턴을 교정
 */
function applyKnownCorrections(text: string): { correctedText: string; corrections: string[] } {
  let correctedText = text
  const corrections: string[] = []

  for (const { pattern, replacement } of KNOWN_OCR_CORRECTIONS) {
    const matches = correctedText.match(pattern)
    if (matches) {
      corrections.push(`${matches[0]} → ${replacement}`)
      correctedText = correctedText.replace(pattern, replacement)
    }
  }

  return { correctedText, corrections }
}

// ============ VLM 직접 구조화 추출 ============

/**
 * VLM 직접 구조화 추출 프롬프트
 * 전통적인 OCR 대신 VLM이 직접 구조화된 JSON을 출력
 */
const VLM_STRUCTURED_EXTRACTION_PROMPT = `이 이미지는 한국 교회 월간 신문의 한 면입니다.

중요 지시사항:
1. 신문 이름은 "열한시"입니다 (11시를 한글로 쓴 것)
2. 텍스트를 정확하게 읽되, 추측하지 마세요
3. 불확실한 글자는 [?]로 표시

이미지의 모든 텍스트를 분석하여 다음 JSON 형식으로 출력해주세요:

{
  "newspaper_name": "열한시",
  "page_header": "페이지 상단 헤더 텍스트 (있는 경우)",
  "articles": [
    {
      "title": "기사 제목 (정확히)",
      "subtitle": "부제목 (있는 경우, 없으면 null)",
      "type": "목회편지 | 교회소식 | 행사안내 | 인물소개 | 광고 | 사설 | 기타",
      "author": "기고자/필자 이름 (있는 경우)",
      "content": "본문 전체 내용 (줄바꿈 유지, 정확하게)",
      "position": "상단 | 중단 | 하단 | 좌측 | 우측 | 전면"
    }
  ],
  "advertisements": [
    {
      "title": "광고 제목",
      "content": "광고 내용",
      "contact": "연락처 (있는 경우)"
    }
  ],
  "footer": "페이지 하단 정보 (있는 경우)"
}

규칙:
- 모든 기사를 빠짐없이 추출
- 사진 캡션도 해당 기사 content에 포함
- 광고는 별도 배열로 분리
- JSON만 출력, 다른 설명 없이`

/**
 * VLM으로 직접 구조화된 데이터 추출 (OCR 우회)
 *
 * 장점:
 * 1. VLM이 레이아웃을 이해하고 기사 단위로 직접 분리
 * 2. 문맥을 고려한 텍스트 인식 (신문 이름, 직함 등)
 * 3. 별도의 기사 분리/메타데이터 추출 단계 불필요
 */
export async function extractStructuredWithVLM(
  imageData: Buffer | string,
  mimeType: string = 'image/jpeg'
): Promise<{
  success: boolean
  provider: string
  data: {
    newspaper_name: string
    page_header?: string
    articles: Array<{
      title: string
      subtitle?: string
      type: string
      author?: string
      content: string
      position: string
    }>
    advertisements?: Array<{
      title: string
      content: string
      contact?: string
    }>
    footer?: string
  }
  rawResponse: string
  corrections: string[]
}> {
  const base64 = Buffer.isBuffer(imageData) ? imageData.toString('base64') : imageData

  // Claude 우선 사용 (한국어 인식 정확도 높음)
  let rawResponse = ''
  let provider = ''

  try {
    const client = await getAnthropic()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: base64 } },
            { type: 'text', text: VLM_STRUCTURED_EXTRACTION_PROMPT }
          ]
        }
      ]
    })

    const textBlock = response.content.find(block => block.type === 'text')
    rawResponse = textBlock ? (textBlock as any).text : ''
    provider = 'Claude'
  } catch (error: any) {
    console.log(`[VLM Structured] Claude 실패: ${error.message?.substring(0, 50)}`)

    // OpenAI GPT-4o 폴백
    try {
      const client = await getOpenAI()
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VLM_STRUCTURED_EXTRACTION_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' }
              }
            ]
          }
        ],
        max_tokens: 8000
      })
      rawResponse = response.choices[0].message.content || ''
      provider = 'OpenAI'
    } catch (openaiError: any) {
      console.log(`[VLM Structured] OpenAI 실패: ${openaiError.message?.substring(0, 50)}`)
      return {
        success: false,
        provider: 'none',
        data: { newspaper_name: '', articles: [] },
        rawResponse: '',
        corrections: []
      }
    }
  }

  // JSON 파싱
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('JSON not found in response')
    }

    const parsed = JSON.parse(jsonMatch[0])

    // 알려진 오류 교정 적용
    const allCorrections: string[] = []

    // 신문 이름 교정
    if (parsed.newspaper_name) {
      const { correctedText, corrections } = applyKnownCorrections(parsed.newspaper_name)
      parsed.newspaper_name = correctedText
      allCorrections.push(...corrections)
    }

    // 각 기사 내용 교정
    if (parsed.articles && Array.isArray(parsed.articles)) {
      for (const article of parsed.articles) {
        if (article.title) {
          const { correctedText, corrections } = applyKnownCorrections(article.title)
          article.title = correctedText
          allCorrections.push(...corrections)
        }
        if (article.content) {
          const { correctedText, corrections } = applyKnownCorrections(article.content)
          article.content = correctedText
          allCorrections.push(...corrections)
        }
        if (article.author) {
          const { correctedText, corrections } = applyKnownCorrections(article.author)
          article.author = correctedText
          allCorrections.push(...corrections)
        }
      }
    }

    if (allCorrections.length > 0) {
      console.log(`[VLM Structured] 교정 적용: ${allCorrections.join(', ')}`)
    }

    return {
      success: true,
      provider,
      data: parsed,
      rawResponse,
      corrections: allCorrections
    }
  } catch (parseError: any) {
    console.error(`[VLM Structured] JSON 파싱 실패:`, parseError.message)
    return {
      success: false,
      provider,
      data: { newspaper_name: '', articles: [] },
      rawResponse,
      corrections: []
    }
  }
}

/**
 * VLM 구조화 추출 결과를 기존 형식으로 변환
 */
export function convertVLMResultToArticles(
  vlmResult: Awaited<ReturnType<typeof extractStructuredWithVLM>>
): ExtractedArticle[] {
  if (!vlmResult.success || !vlmResult.data.articles) {
    return []
  }

  return vlmResult.data.articles.map(article => ({
    title: article.title || '제목 없음',
    content: article.content || '',
    article_type: article.type,
    speaker: article.author
  }))
}

// OCR 프롬프트 - 정확성 강조 버전
const OCR_PROMPT = `이 이미지는 한국 교회의 월간 신문 "열한시"의 한 면입니다.

⚠️ 중요: 텍스트를 정확하게 읽어주세요. 추측하거나 비슷한 단어로 대체하지 마세요.

정확성 규칙 (반드시 준수):
1. 이름, 직함, 숫자는 이미지에 보이는 그대로 정확히 읽기
   - 예: "최원준 위임목사" → 그대로 출력 (절대 "최재호 위원목사"로 바꾸지 말 것)
   - 예: "만나홀" → 그대로 출력 (절대 "한나홀"로 바꾸지 말 것)
2. 불확실한 글자는 [?]로 표시하되, 추측하지 말 것
3. 고유명사(사람 이름, 장소명, 팀명)는 특히 주의
4. 한글 초성 구분: ㅁ/ㅎ, ㄴ/ㄹ, ㅇ/ㅁ 등 비슷한 글자 주의

추출 규칙:
1. 제목, 소제목, 본문 내용을 모두 추출
2. 기사별로 구분하여 추출 (### 로 구분)
3. 사진 캡션도 포함
4. 광고 문구도 포함
5. 원본 텍스트를 최대한 그대로 유지
6. 줄바꿈과 단락 구조 유지

형식:
### 기사 1
제목: (제목 - 정확히)
유형: (목회편지/교회소식/행사안내/광고/인물소개/기타)
내용: (본문 내용 - 정확히)

### 기사 2
...`

// OCR 결과 검증/교정 프롬프트
const OCR_VERIFY_PROMPT = `당신은 한국어 OCR 결과를 검증하는 전문가입니다.
아래 OCR 결과를 원본 이미지와 비교하여 오류를 교정해주세요.

흔한 OCR 오류 패턴:
- 만나홀 → 한나홀 (ㅁ/ㅎ 혼동)
- 위임목사 → 위원목사
- 요르단 → 요즘형
- 공연 → 청
- 워쉽 → 사역

교정 규칙:
1. 이미지에 보이는 텍스트와 정확히 일치하도록 수정
2. 사람 이름, 장소명, 팀명은 특히 주의깊게 확인
3. 문맥상 말이 안 되는 부분은 이미지를 다시 확인
4. 숫자와 날짜 정확히 확인

OCR 결과:
`

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
  const client = await getOpenAI()
  const response = await client.chat.completions.create({
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
  const client = await getGenAI()
  const model = client.getGenerativeModel({ model: 'gemini-1.5-pro' })
  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Image } },
    { text: OCR_PROMPT }
  ])
  return result.response.text()
}

async function extractWithClaude(base64Image: string, mimeType: string = 'image/jpeg'): Promise<string> {
  const client = await getAnthropic()
  const response = await client.messages.create({
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
 * OCR 결과를 원본 이미지와 비교하여 검증/교정
 * 다른 모델을 사용하여 cross-check
 */
async function verifyOCRWithImage(
  ocrText: string,
  base64Image: string,
  mimeType: string = 'image/jpeg',
  originalProvider: string
): Promise<string> {
  // 원본 제공자와 다른 모델로 검증
  const verifyPrompt = `${OCR_VERIFY_PROMPT}
---
${ocrText}
---

위 OCR 결과를 이미지와 비교하여 오류가 있으면 교정한 전체 텍스트를 출력해주세요.
오류가 없으면 원본 그대로 출력해주세요.
설명 없이 교정된 텍스트만 출력하세요.`

  try {
    // Claude로 검증 (가장 정확한 한국어 인식)
    if (originalProvider !== 'Claude') {
      const client = await getAnthropic()
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: base64Image } },
              { type: 'text', text: verifyPrompt }
            ]
          }
        ]
      })
      const textBlock = response.content.find(block => block.type === 'text')
      if (textBlock) {
        console.log('[OCR 검증] Claude로 교정 완료')
        return (textBlock as any).text
      }
    }

    // OpenAI로 검증
    if (originalProvider !== 'OpenAI') {
      const client = await getOpenAI()
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: verifyPrompt },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' }
              }
            ]
          }
        ],
        max_tokens: 4096
      })
      if (response.choices[0].message.content) {
        console.log('[OCR 검증] OpenAI로 교정 완료')
        return response.choices[0].message.content
      }
    }
  } catch (error: any) {
    console.log(`[OCR 검증] 검증 실패, 원본 사용: ${error.message?.substring(0, 50)}`)
  }

  return ocrText // 검증 실패시 원본 반환
}

/**
 * OCR 실행 (fallback: OpenAI -> Gemini -> Claude) + 검증
 * @param verify - true이면 다른 모델로 결과 검증 (기본값: true)
 */
export async function performOCR(
  imageData: Buffer | string,
  mimeType: string = 'image/jpeg',
  verify: boolean = true
): Promise<{ text: string; provider: string; verified: boolean }> {
  const base64 = Buffer.isBuffer(imageData) ? imageData.toString('base64') : imageData
  let ocrResult: { text: string; provider: string } | null = null

  // 1. OpenAI 시도
  try {
    const text = await extractWithOpenAI(base64, mimeType)
    ocrResult = { text, provider: 'OpenAI' }
  } catch (error: any) {
    console.log(`OpenAI 실패: ${error.message?.substring(0, 50)}...`)
  }

  // 2. Gemini 시도
  if (!ocrResult) {
    try {
      const text = await extractWithGemini(base64, mimeType)
      ocrResult = { text, provider: 'Gemini' }
    } catch (error: any) {
      console.log(`Gemini 실패: ${error.message?.substring(0, 50)}...`)
    }
  }

  // 3. Claude 시도
  if (!ocrResult) {
    try {
      const text = await extractWithClaude(base64, mimeType)
      ocrResult = { text, provider: 'Claude' }
    } catch (error: any) {
      console.log(`Claude 실패: ${error.message?.substring(0, 50)}...`)
    }
  }

  if (!ocrResult) {
    throw new Error('모든 OCR 서비스가 실패했습니다.')
  }

  // 4. 검증 단계 (옵션)
  if (verify) {
    console.log(`[OCR] ${ocrResult.provider}로 추출 완료, 검증 시작...`)
    const verifiedText = await verifyOCRWithImage(
      ocrResult.text,
      base64,
      mimeType,
      ocrResult.provider
    )
    return {
      text: verifiedText,
      provider: ocrResult.provider,
      verified: true
    }
  }

  return { ...ocrResult, verified: false }
}

// ============ 메타데이터 추출 ============

/**
 * 기사 텍스트에서 메타데이터 추출
 */
export async function extractMetadata(articleText: string): Promise<ExtractedArticle> {
  console.log(`[extractMetadata] 시작 - 텍스트 길이: ${articleText?.length || 0}`)
  try {
    const client = await getAnthropic()
    const response = await client.messages.create({
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
    const client = await getOpenAI()
    const response = await client.embeddings.create({
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
    const client = await getOpenAI()
    const response = await client.embeddings.create({
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

// ============ VLM 직접 추출 파이프라인 ============

/**
 * VLM 직접 추출을 사용한 이미지 처리
 *
 * 기존 OCR 방식과의 차이점:
 * 1. VLM이 레이아웃을 분석하고 기사 단위로 직접 추출
 * 2. 별도의 기사 분리 단계 불필요
 * 3. 알려진 오류 패턴 자동 교정
 * 4. 검증 단계 불필요 (구조화된 출력이므로)
 */
export async function processImageWithVLM(
  imageData: Buffer,
  issueId: number,
  issueNumber: number,
  issueDate: string,
  pageNumber: number,
  mimeType: string = 'image/jpeg',
  onProgress?: (step: string) => void
): Promise<{
  articles: number
  chunks: number
  provider: string
  corrections: string[]
}> {
  let articleCount = 0
  let chunkCount = 0

  // 1. VLM 직접 구조화 추출
  onProgress?.('VLM 구조화 추출 중...')
  const vlmResult = await extractStructuredWithVLM(imageData, mimeType)

  if (!vlmResult.success) {
    console.log('[VLM Process] VLM 추출 실패, 기존 OCR로 폴백')
    // 기존 OCR 방식으로 폴백
    const fallbackResult = await processImageToArticles(
      imageData, issueId, issueNumber, issueDate, pageNumber, mimeType, onProgress
    )
    return { ...fallbackResult, provider: 'OCR-fallback', corrections: [] }
  }

  console.log(`[VLM Process] ${vlmResult.provider}로 추출 완료, ${vlmResult.data.articles.length}개 기사`)

  // 2. 전체 텍스트 조합 (OCR 텍스트 저장용)
  const fullOCRText = vlmResult.data.articles
    .map(a => `### ${a.title}\n유형: ${a.type}\n${a.content}`)
    .join('\n\n---\n\n')

  // 3. 페이지 저장
  const pageId = await saveNewsPage({
    issue_id: issueId,
    page_number: pageNumber,
    file_hash: generateFileHash(imageData),
    ocr_text: fullOCRText,
    ocr_provider: `VLM-${vlmResult.provider}`,
    status: 'completed'
  })

  // 4. 각 기사 처리
  for (const article of vlmResult.data.articles) {
    onProgress?.(`기사 저장 중: ${article.title.substring(0, 20)}...`)

    // 기사 저장 (이미 구조화된 데이터 사용)
    const articleId = await saveNewsArticle({
      issue_id: issueId,
      page_id: pageId,
      title: article.title,
      content: article.content,
      article_type: article.type,
      speaker: article.author
    })
    articleCount++

    // 청킹
    onProgress?.('청킹 중...')
    const chunks = chunkText(article.content)

    if (chunks.length > 0) {
      onProgress?.('임베딩 생성 중...')
      try {
        const embeddings = await createBatchEmbeddings(chunks)

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
            article_title: article.title,
            article_type: article.type,
            embedding: embeddings[i]
          })
          chunkCount++
        }
      } catch (embeddingError) {
        if (embeddingError instanceof EmbeddingQuotaError) {
          throw embeddingError
        }
        console.error(`[VLM Process] 임베딩 실패:`, embeddingError)
        throw embeddingError
      }
    }
  }

  return {
    articles: articleCount,
    chunks: chunkCount,
    provider: vlmResult.provider,
    corrections: vlmResult.corrections
  }
}

// ============ 개선된 OCR 통합 (고급 분석 모듈 사용) ============

import { analyzeNewsPage, checkArticleContinuity, mergeConnectedArticles, type PageAnalysis, type ArticleStructure } from './news-ocr-advanced'
import { validateOCRResult, correctOCRText } from './ocr-validator'

/**
 * 개선된 이미지 처리 (다단 레이아웃, 연속 기사, 고유명사 검증 포함)
 *
 * @param useAdvancedOCR - true이면 개선된 OCR 사용 (기본값: false, 호환성 유지)
 */
export async function processImageToArticlesAdvanced(
  imageData: Buffer,
  issueId: number,
  issueNumber: number,
  issueDate: string,
  pageNumber: number,
  mimeType: string = 'image/jpeg',
  onProgress?: (step: string) => void,
  options?: {
    useAdvancedOCR?: boolean
    prevPageImage?: Buffer  // 이전 페이지 이미지 (연속 기사 확인용)
  }
): Promise<{
  articles: number
  chunks: number
  pageAnalysis?: PageAnalysis
  warnings: string[]
  confidence: number
}> {
  const useAdvanced = options?.useAdvancedOCR ?? false

  // 기본 OCR 사용 시 기존 함수 호출
  if (!useAdvanced) {
    const result = await processImageToArticles(
      imageData, issueId, issueNumber, issueDate, pageNumber, mimeType, onProgress
    )
    return { ...result, warnings: [], confidence: 1.0 }
  }

  // ============ 개선된 OCR 처리 ============

  let articleCount = 0
  let chunkCount = 0
  const warnings: string[] = []

  // 1. 개선된 OCR (레이아웃 분석 + 기사 구조 분석 + 검증)
  onProgress?.('고급 OCR 분석 중...')
  const base64Image = imageData.toString('base64')
  const pageAnalysis = await analyzeNewsPage(base64Image, pageNumber, mimeType)

  warnings.push(...pageAnalysis.warnings)
  console.log(`[News OCR Advanced] 페이지 ${pageNumber}: ${pageAnalysis.layout.columnCount}단, ${pageAnalysis.articles.length}개 기사, 신뢰도 ${(pageAnalysis.confidence * 100).toFixed(1)}%`)

  // 2. 이전 페이지와 연속성 확인
  if (options?.prevPageImage) {
    onProgress?.('연속 기사 확인 중...')
    const prevBase64 = options.prevPageImage.toString('base64')
    const continuity = await checkArticleContinuity(prevBase64, base64Image, mimeType)

    if (continuity.isConnected) {
      console.log(`[News OCR Advanced] 페이지 ${pageNumber - 1}→${pageNumber} 연속 기사 발견`)
      warnings.push(`페이지 ${pageNumber - 1}에서 계속되는 기사 있음`)
    }
  }

  // 3. 검증된 텍스트로 페이지 저장
  const pageId = await saveNewsPage({
    issue_id: issueId,
    page_number: pageNumber,
    file_hash: generateFileHash(imageData),
    ocr_text: pageAnalysis.validatedText,
    ocr_provider: 'advanced',
    status: 'completed'
  })

  // 4. 각 기사 처리
  for (const article of pageAnalysis.articles) {
    onProgress?.(`기사 처리 중: ${article.title.substring(0, 20)}...`)

    // 고유명사 추가 교정
    const { correctedText } = await correctOCRText(article.content)

    // 메타데이터 추출
    const metadata = await extractMetadata(correctedText)

    // 기사 저장 (연속 기사 정보 포함)
    const articleId = await saveNewsArticle({
      issue_id: issueId,
      page_id: pageId,
      title: article.title || metadata.title,
      content: correctedText,
      article_type: article.type || metadata.article_type,
      speaker: article.author || metadata.speaker,
      event_name: metadata.event_name,
      event_date: metadata.event_date,
      bible_references: metadata.bible_references,
      keywords: metadata.keywords
    })
    articleCount++

    // 청킹
    onProgress?.('청킹 중...')
    const chunks = chunkText(correctedText)

    if (chunks.length > 0) {
      onProgress?.('임베딩 생성 중...')
      try {
        const embeddings = await createBatchEmbeddings(chunks)

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
            article_title: article.title || metadata.title,
            article_type: article.type || metadata.article_type,
            embedding: embeddings[i]
          })
          chunkCount++
        }
      } catch (embeddingError) {
        if (embeddingError instanceof EmbeddingQuotaError) {
          throw embeddingError
        }
        console.error(`[processImageToArticlesAdvanced] 임베딩 실패:`, embeddingError)
        throw embeddingError
      }
    }
  }

  return {
    articles: articleCount,
    chunks: chunkCount,
    pageAnalysis,
    warnings,
    confidence: pageAnalysis.confidence
  }
}

/**
 * 다중 페이지 일괄 처리 (연속 기사 자동 병합)
 */
export async function processMultiplePagesAdvanced(
  pageImages: Array<{ data: Buffer; mimeType: string }>,
  issueId: number,
  issueNumber: number,
  issueDate: string,
  onProgress?: (page: number, step: string) => void
): Promise<{
  totalArticles: number
  totalChunks: number
  pageResults: Array<{
    pageNumber: number
    articles: number
    chunks: number
    confidence: number
    warnings: string[]
  }>
  connectedArticles: Array<{ fromPage: number; toPage: number }>
}> {
  const pageResults: Array<{
    pageNumber: number
    articles: number
    chunks: number
    confidence: number
    warnings: string[]
  }> = []
  const connectedArticles: Array<{ fromPage: number; toPage: number }> = []

  let totalArticles = 0
  let totalChunks = 0

  for (let i = 0; i < pageImages.length; i++) {
    const pageNumber = i + 1

    const result = await processImageToArticlesAdvanced(
      pageImages[i].data,
      issueId,
      issueNumber,
      issueDate,
      pageNumber,
      pageImages[i].mimeType,
      (step) => onProgress?.(pageNumber, step),
      {
        useAdvancedOCR: true,
        prevPageImage: i > 0 ? pageImages[i - 1].data : undefined
      }
    )

    pageResults.push({
      pageNumber,
      articles: result.articles,
      chunks: result.chunks,
      confidence: result.confidence,
      warnings: result.warnings
    })

    totalArticles += result.articles
    totalChunks += result.chunks

    // 연속 기사 감지
    if (result.warnings.some(w => w.includes('계속되는 기사'))) {
      connectedArticles.push({ fromPage: pageNumber - 1, toPage: pageNumber })
    }
  }

  return {
    totalArticles,
    totalChunks,
    pageResults,
    connectedArticles
  }
}
