/**
 * 주보(예배순서지) 전용 OCR 모듈
 *
 * 열한시 신문과의 차이점:
 * - 기사가 아닌 텍스트/정보 자체를 읽음
 * - 단 구성 없음 (다양한 레이아웃)
 * - 글자 크기가 작아 오탐 확률 높음
 * - 면마다 레이아웃이 다름
 * - 할루시네이션 절대 불가
 *
 * 기능:
 * 1. 면별 레이아웃 인식 (예배순서, 교회소식, 광고, 기도제목 등)
 * 2. 텍스트 꼼꼼한 검증 (특히 이름, 직분, 숫자)
 * 3. 다중 모델 교차 검증
 * 4. 불확실한 텍스트 표시
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getApiKey, validateOCRResult, validateName, extractProperNouns } from './ocr-validator'

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

// ============ 알려진 OCR 오류 교정 패턴 (주보 전용) ============

const BULLETIN_OCR_CORRECTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  // 교회명 오류
  { pattern: /안양제일교회교회/g, replacement: '안양제일교회' },

  // 직함 오류
  { pattern: /위원목사/g, replacement: '위임목사' },
  { pattern: /우임목사/g, replacement: '위임목사' },
  { pattern: /전도샤/g, replacement: '전도사' },

  // 장소명 오류
  { pattern: /한나홀/g, replacement: '만나홀' },
  { pattern: /만나를/g, replacement: '만나홀' },
  { pattern: /비전젤/g, replacement: '비전센터' },

  // 행사명/프로그램명 오류 (VLM 빈번한 오독)
  { pattern: /예배순서지/g, replacement: '예배순서' },
  { pattern: /영어전목/g, replacement: '영어전폭' },
  { pattern: /워테이\s*워크샵/g, replacement: '원데이 워크샵' },
  { pattern: /원테이\s*워크샵/g, replacement: '원데이 워크샵' },
  { pattern: /전목\s*중국/g, replacement: '전폭 총국' },
  { pattern: /전폭\s*중국/g, replacement: '전폭 총국' },

  // 한글 오독 (종성/초성 혼동)
  { pattern: /다갈이/g, replacement: '다같이' },
  { pattern: /여호와에서/g, replacement: '여호와께서' },
  { pattern: /법사에\s*감사/g, replacement: '범사에 감사' },
  { pattern: /가정에배/g, replacement: '가정예배' },
]

/**
 * 알려진 OCR 오류 패턴을 교정 (주보 전용)
 */
function applyBulletinCorrections(text: string): { correctedText: string; corrections: string[] } {
  let correctedText = text
  const corrections: string[] = []

  for (const { pattern, replacement } of BULLETIN_OCR_CORRECTIONS) {
    const matches = correctedText.match(pattern)
    if (matches) {
      corrections.push(`${matches[0]} → ${replacement}`)
      correctedText = correctedText.replace(pattern, replacement)
    }
  }

  return { correctedText, corrections }
}

// ============ VLM 직접 구조화 추출 (주보 전용) ============

/**
 * VLM 직접 구조화 추출 프롬프트 (주보 전용)
 * 열한시 추출과 별도로 주보 특성에 맞게 최적화
 */
const BULLETIN_VLM_PROMPT = `이 이미지는 한국 교회의 주보(예배순서지) 한 페이지입니다.

⚠️ 정확성 최우선 규칙:
1. 이름, 직분, 숫자는 이미지에 보이는 그대로 정확히 읽기
2. 추측하지 말고, 불확실하면 [?]로 표시
3. 없는 내용을 만들어내지 말 것 (할루시네이션 금지)
4. 한글 초성 구분 주의: ㅁ/ㅎ, ㄴ/ㄹ, ㅇ/ㅁ

이미지의 모든 내용을 분석하여 다음 JSON 형식으로 출력:

{
  "page_type": "worship_order | sermon_notes | church_news | prayer_requests | announcements | offerings | bible_school | mixed",
  "sections": [
    {
      "type": "예배순서 | 설교노트 | 교회소식 | 기도제목 | 광고 | 새가족 | 헌금 | 봉사자 | 교회학교 | 감사 | 추모 | 기타",
      "title": "섹션 제목 (정확히)",
      "content": "본문 내용 (정확히, 줄바꿈 유지)",
      "items": [
        {"label": "항목명", "value": "값 (이름, 숫자 등 정확히)"}
      ]
    }
  ],
  "proper_nouns": {
    "names": ["사람 이름들 (정확히)"],
    "positions": ["목사", "장로", "권사", "집사", "전도사"],
    "places": ["장소명들"],
    "numbers": ["중요 숫자들 (금액, 인원, 전화번호)"]
  },
  "uncertain_texts": ["불확실한 텍스트들"]
}

규칙:
- 모든 섹션을 빠짐없이 추출
- 이름+직분 조합 주의 (예: "김OO 장로")
- 숫자(금액, 날짜, 시간) 정확히
- JSON만 출력, 다른 설명 없이
- 마크다운 기호(#, *, _, ~, \`)를 사용하지 말 것. 일반 텍스트로만 출력

참고 - 이 교회에서 자주 등장하는 용어:
- 전도폭발(전폭): 전도 프로그램 (영어전폭 = 영어 전도폭발)
- 원데이 워크샵: 전도폭발 집중 교육
- 브릿지전도학교, 쿠티학교, 중보기도세미나: 양육 프로그램
- 만나홀, 비전센터, 비전홀, 평강홀, 미스바: 교회 내 장소명
- 전도회, 선교회, 권사회, 집사회: 교회 조직명
- 위임목사, 부목사, 전도사: 직함`

/**
 * VLM으로 주보 직접 구조화 추출
 * 기존 다중 모델 교차 검증 대신 VLM 직접 추출 사용
 *
 * 장점:
 * 1. 단일 호출로 구조화된 데이터 추출
 * 2. 레이아웃 이해 기반 섹션 분리
 * 3. 속도 향상 (교차 검증 단계 생략)
 */
export async function extractBulletinWithVLM(
  base64Image: string,
  mimeType: string = 'image/jpeg'
): Promise<{
  success: boolean
  provider: string
  data: {
    page_type: BulletinPageType
    sections: BulletinSection[]
    proper_nouns: {
      names: string[]
      positions: string[]
      places: string[]
      numbers: string[]
    }
    uncertain_texts: string[]
  }
  rawResponse: string
  corrections: string[]
  duration: number
}> {
  const startTime = Date.now()
  let rawResponse = ''
  let provider = ''

  // Claude 우선 사용 (한국어 정확도 높음)
  try {
    const client = await getAnthropic()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: base64Image } },
            { type: 'text', text: BULLETIN_VLM_PROMPT }
          ]
        }
      ]
    })

    const textBlock = response.content.find(block => block.type === 'text')
    rawResponse = textBlock ? (textBlock as any).text : ''
    provider = 'Claude'
  } catch (error: any) {
    console.log(`[Bulletin VLM] Claude 실패: ${error.message?.substring(0, 50)}`)

    // OpenAI GPT-4o 폴백
    try {
      const client = await getOpenAI()
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: BULLETIN_VLM_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' }
              }
            ]
          }
        ],
        max_tokens: 8000
      })
      rawResponse = response.choices[0].message.content || ''
      provider = 'OpenAI'
    } catch (openaiError: any) {
      console.log(`[Bulletin VLM] OpenAI 실패: ${openaiError.message?.substring(0, 50)}`)
      return {
        success: false,
        provider: 'none',
        data: {
          page_type: 'unknown',
          sections: [],
          proper_nouns: { names: [], positions: [], places: [], numbers: [] },
          uncertain_texts: []
        },
        rawResponse: '',
        corrections: [],
        duration: Date.now() - startTime
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
    const allCorrections: string[] = []

    // 섹션 내용 교정
    if (parsed.sections && Array.isArray(parsed.sections)) {
      for (const section of parsed.sections) {
        if (section.title) {
          const { correctedText, corrections } = applyBulletinCorrections(section.title)
          section.title = correctedText
          allCorrections.push(...corrections)
        }
        if (section.content) {
          const { correctedText, corrections } = applyBulletinCorrections(section.content)
          section.content = correctedText
          allCorrections.push(...corrections)
        }
        // items 교정
        if (section.items && Array.isArray(section.items)) {
          for (const item of section.items) {
            if (item.value) {
              const { correctedText, corrections } = applyBulletinCorrections(item.value)
              item.value = correctedText
              allCorrections.push(...corrections)
            }
          }
        }
      }
    }

    if (allCorrections.length > 0) {
      console.log(`[Bulletin VLM] 교정 적용: ${allCorrections.join(', ')}`)
    }

    // 섹션을 BulletinSection 형식으로 변환
    const sections: BulletinSection[] = (parsed.sections || []).map((s: any) => ({
      type: mapSectionType(s.type || '기타'),
      title: s.title || '',
      content: s.content || '',
      items: s.items,
      confidence: parsed.uncertain_texts?.length === 0 ? 0.95 : 0.8,
      uncertainTexts: []
    }))

    return {
      success: true,
      provider,
      data: {
        page_type: mapPageType(parsed.page_type),
        sections,
        proper_nouns: parsed.proper_nouns || { names: [], positions: [], places: [], numbers: [] },
        uncertain_texts: parsed.uncertain_texts || []
      },
      rawResponse,
      corrections: allCorrections,
      duration: Date.now() - startTime
    }
  } catch (parseError: any) {
    console.error(`[Bulletin VLM] JSON 파싱 실패:`, parseError.message)
    return {
      success: false,
      provider,
      data: {
        page_type: 'unknown',
        sections: [],
        proper_nouns: { names: [], positions: [], places: [], numbers: [] },
        uncertain_texts: []
      },
      rawResponse,
      corrections: [],
      duration: Date.now() - startTime
    }
  }
}

/**
 * 페이지 유형 매핑
 */
function mapPageType(type: string): BulletinPageType {
  const typeMap: Record<string, BulletinPageType> = {
    'worship_order': 'worship_order',
    'sermon_notes': 'sermon_notes',
    'church_news': 'church_news',
    'prayer_requests': 'prayer_requests',
    'announcements': 'announcements',
    'offerings': 'offerings',
    'bible_school': 'bible_school',
    'new_family': 'new_family',
    'volunteers': 'volunteers',
    'memorial': 'memorial',
    'thanksgiving': 'thanksgiving',
    'mixed': 'mixed',
  }
  return typeMap[type] || 'unknown'
}

// ============ 인터페이스 ============

export type BulletinPageType =
  | 'worship_order'      // 예배순서
  | 'sermon_notes'       // 설교노트
  | 'church_news'        // 교회소식
  | 'prayer_requests'    // 기도제목
  | 'announcements'      // 광고/공지
  | 'new_family'         // 새가족
  | 'offerings'          // 헌금
  | 'volunteers'         // 봉사자
  | 'bible_school'       // 교회학교
  | 'memorial'           // 추모/장례
  | 'thanksgiving'       // 감사
  | 'mixed'              // 혼합
  | 'unknown'            // 알 수 없음

export interface BulletinSection {
  type: BulletinPageType
  title: string
  content: string
  items?: BulletinItem[]       // 구조화된 항목 (예배순서, 헌금 목록 등)
  confidence: number           // 섹션별 신뢰도
  uncertainTexts: string[]     // 불확실한 텍스트 목록
}

export interface BulletinItem {
  label: string               // 항목명 (예: "찬송", "기도", "말씀")
  value: string               // 값 (예: "123장", "김OO 장로", "요한복음 3:16")
  subItems?: BulletinItem[]   // 하위 항목
}

export interface BulletinPageAnalysis {
  pageNumber: number
  pageType: BulletinPageType
  sections: BulletinSection[]
  rawText: string
  validatedText: string
  properNouns: {
    names: string[]
    positions: string[]
    places: string[]
    numbers: string[]
  }
  warnings: string[]
  overallConfidence: number
}

// ============ 프롬프트 ============

/**
 * 주보 페이지 유형 감지 프롬프트
 */
const PAGE_TYPE_PROMPT = `이 이미지는 한국 교회 주보(예배순서지)의 한 페이지입니다.

이 페이지의 유형을 분석해주세요:
- worship_order: 예배순서 (찬송, 기도, 말씀 등)
- church_news: 교회소식
- prayer_requests: 기도제목
- announcements: 광고/공지
- new_family: 새가족
- offerings: 헌금 보고
- volunteers: 봉사자 명단
- bible_school: 교회학교
- memorial: 추모/장례
- thanksgiving: 감사
- mixed: 여러 유형 혼합
- unknown: 판별 불가

JSON 형식으로 응답:
{
  "pageType": "worship_order",
  "sections": ["예배순서", "찬송", "헌금"]
}`

/**
 * 주보 OCR 프롬프트 (정확성 최우선)
 */
const BULLETIN_OCR_PROMPT = `이 이미지는 한국 교회 주보(예배순서지)의 한 페이지입니다.

⚠️ 매우 중요: 정확성이 최우선입니다.

절대 규칙:
1. 이름, 직분, 숫자는 이미지에 보이는 그대로 정확히 읽기
   - 절대 추측하지 말 것
   - 불확실하면 [?]로 표시
2. 없는 내용을 만들어내지 말 것 (할루시네이션 금지)
3. 한글 초성 구분 주의: ㅁ/ㅎ, ㄴ/ㄹ, ㅇ/ㅁ

특히 주의할 내용:
- 사람 이름 (2-4글자 한글)
- 직분 (목사, 전도사, 장로, 권사, 집사 등)
- 숫자 (인원수, 금액, 전화번호)
- 날짜/시간
- 장소명

형식:
### 섹션 1
유형: (예배순서/교회소식/광고/기도제목/헌금/봉사자/새가족/감사/추모 등)
제목: (섹션 제목)
내용:
(본문 내용 - 정확하게)

### 섹션 2
...

불확실한 텍스트는 [불확실: 원본텍스트] 형식으로 표시해주세요.`

/**
 * 주보 검증 프롬프트 (교차 검증용)
 */
const BULLETIN_VERIFY_PROMPT = `당신은 한국어 OCR 결과를 검증하는 전문가입니다.
아래 OCR 결과를 원본 이미지와 비교하여 오류를 찾아주세요.

특히 확인할 사항:
1. 사람 이름이 정확한가?
2. 직분(목사, 장로, 집사 등)이 정확한가?
3. 숫자(금액, 인원수, 전화번호)가 정확한가?
4. 장소명이 정확한가?
5. 없는 내용이 추가되지 않았는가?

OCR 결과:
---
{OCR_TEXT}
---

오류 목록을 JSON 형식으로 응답:
{
  "errors": [
    {
      "wrong": "잘못된 텍스트",
      "correct": "올바른 텍스트 (이미지 기준)",
      "type": "이름|직분|숫자|장소|추가됨",
      "confidence": 0.95
    }
  ],
  "missingContent": ["이미지에 있지만 OCR에 없는 내용"],
  "overallAccuracy": 0.85
}`

// ============ 분석 함수 ============

/**
 * 주보 페이지 유형 감지
 */
async function detectPageType(
  base64Image: string,
  mimeType: string = 'image/jpeg'
): Promise<{ pageType: BulletinPageType; sections: string[] }> {
  try {
    const client = await getOpenAI()
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PAGE_TYPE_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'low' }
            }
          ]
        }
      ],
      max_tokens: 200
    })

    const content = response.choices[0].message.content || '{}'
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        pageType: parsed.pageType || 'unknown',
        sections: parsed.sections || []
      }
    }
  } catch (error) {
    console.error('[Bulletin OCR] 페이지 유형 감지 실패:', error)
  }

  return { pageType: 'unknown', sections: [] }
}

/**
 * 주보 OCR 수행 (Claude 사용 - 한국어 정확도 높음)
 */
async function performBulletinOCR(
  base64Image: string,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  try {
    const client = await getAnthropic()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: base64Image } },
            { type: 'text', text: BULLETIN_OCR_PROMPT }
          ]
        }
      ]
    })

    const textBlock = response.content.find(block => block.type === 'text')
    return textBlock ? (textBlock as any).text : ''
  } catch (error) {
    console.error('[Bulletin OCR] Claude OCR 실패:', error)
    throw error
  }
}

/**
 * OCR 결과 교차 검증 (다른 모델로 확인)
 */
async function verifyBulletinOCR(
  base64Image: string,
  ocrText: string,
  mimeType: string = 'image/jpeg'
): Promise<{
  errors: Array<{ wrong: string; correct: string; type: string; confidence: number }>
  missingContent: string[]
  overallAccuracy: number
}> {
  try {
    const verifyPrompt = BULLETIN_VERIFY_PROMPT.replace('{OCR_TEXT}', ocrText)

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
      max_tokens: 2000
    })

    const content = response.choices[0].message.content || '{}'
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        errors: parsed.errors || [],
        missingContent: parsed.missingContent || [],
        overallAccuracy: parsed.overallAccuracy || 0.8
      }
    }
  } catch (error) {
    console.error('[Bulletin OCR] 검증 실패:', error)
  }

  return { errors: [], missingContent: [], overallAccuracy: 0.8 }
}

/**
 * 섹션 파싱
 */
function parseSections(ocrText: string): BulletinSection[] {
  const sections: BulletinSection[] = []
  const sectionBlocks = ocrText.split(/###\s*섹션\s*\d+/i).filter(s => s.trim())

  for (const block of sectionBlocks) {
    const typeMatch = block.match(/유형:\s*(.+)/i)
    const titleMatch = block.match(/제목:\s*(.+)/i)
    const contentMatch = block.match(/내용:\s*([\s\S]+)/i)

    const sectionType = typeMatch ? mapSectionType(typeMatch[1].trim()) : 'unknown'
    const title = titleMatch ? titleMatch[1].trim() : ''
    const content = contentMatch ? contentMatch[1].trim() : block.trim()

    // 불확실한 텍스트 추출
    const uncertainTexts: string[] = []
    const uncertainPattern = /\[불확실:\s*([^\]]+)\]/g
    let match
    while ((match = uncertainPattern.exec(content)) !== null) {
      uncertainTexts.push(match[1])
    }

    if (content.length > 30) {
      sections.push({
        type: sectionType,
        title,
        content,
        confidence: uncertainTexts.length === 0 ? 0.9 : 0.7,
        uncertainTexts
      })
    }
  }

  return sections
}

/**
 * 섹션 유형 매핑
 */
function mapSectionType(type: string): BulletinPageType {
  const typeMap: Record<string, BulletinPageType> = {
    '예배순서': 'worship_order',
    '설교노트': 'sermon_notes',
    '설교': 'sermon_notes',
    '말씀묵상': 'sermon_notes',
    '교회소식': 'church_news',
    '기도제목': 'prayer_requests',
    '광고': 'announcements',
    '공지': 'announcements',
    '새가족': 'new_family',
    '헌금': 'offerings',
    '봉사자': 'volunteers',
    '교회학교': 'bible_school',
    '추모': 'memorial',
    '장례': 'memorial',
    '감사': 'thanksgiving',
  }

  for (const [key, value] of Object.entries(typeMap)) {
    if (type.includes(key)) {
      return value
    }
  }

  return 'unknown'
}

/**
 * 이름+직분 이중 검증
 */
async function validateNamesInText(text: string): Promise<{
  validatedText: string
  corrections: Array<{ from: string; to: string }>
}> {
  let validatedText = text
  const corrections: Array<{ from: string; to: string }> = []

  // 이름+직분 패턴 찾기
  const pattern = /([가-힣]{2,4})\s*(목사|전도사|장로|권사|집사)/g
  let match

  while ((match = pattern.exec(text)) !== null) {
    const name = match[1]
    const position = match[2]

    const validation = await validateName(name)

    if (!validation.valid && validation.suggestion) {
      const oldText = `${name} ${position}`
      const newText = `${validation.suggestion} ${position}`
      validatedText = validatedText.replace(oldText, newText)
      corrections.push({ from: name, to: validation.suggestion })
    }
  }

  return { validatedText, corrections }
}

// ============ 메인 분석 함수 ============

// VLM 사용 여부 (환경변수로 제어, 기본값: true)
const USE_BULLETIN_VLM = process.env.USE_BULLETIN_VLM !== 'false'

/**
 * 주보 페이지 전체 분석
 *
 * VLM 모드 (기본): 단일 VLM 호출로 구조화 추출
 * 레거시 모드: Claude OCR + OpenAI 교차 검증
 */
export async function analyzeBulletinPage(
  base64Image: string,
  pageNumber: number,
  mimeType: string = 'image/jpeg'
): Promise<BulletinPageAnalysis> {
  console.log(`[Bulletin OCR] 페이지 ${pageNumber} 분석 시작... (VLM: ${USE_BULLETIN_VLM ? 'ON' : 'OFF'})`)

  // VLM 모드 사용
  if (USE_BULLETIN_VLM) {
    const vlmResult = await extractBulletinWithVLM(base64Image, mimeType)

    if (vlmResult.success) {
      console.log(`[Bulletin VLM] ${vlmResult.provider}로 추출 완료 (${vlmResult.duration}ms)`)
      console.log(`[Bulletin VLM] 섹션 ${vlmResult.data.sections.length}개, 교정 ${vlmResult.corrections.length}건`)

      // 전체 텍스트 조합 (마크다운 기호 제거, items 보완)
      const validatedText = vlmResult.data.sections
        .map(s => {
          const title = (s.title || s.type).replace(/[#*_~`>]/g, '').trim()
          const content = (s.content || '').replace(/[#*_~`>]/g, '').trim()

          // items → 텍스트 변환 (content가 짧을 때만 추가하여 중복 방지)
          let itemsText = ''
          if (s.items && Array.isArray(s.items) && s.items.length > 0 && content.length < 50) {
            itemsText = s.items
              .map((item: BulletinItem) => {
                const label = (item.label || '').replace(/[#*_~`>]/g, '').trim()
                const value = (item.value || '').replace(/[#*_~`>]/g, '').trim()
                return label && value ? `${label}: ${value}` : label || value
              })
              .filter((line: string) => line.length > 0)
              .join('\n')
          }

          const parts = [content, itemsText].filter(p => p.length > 0)
          return `${title}\n${parts.join('\n')}`
        })
        .join('\n\n')

      // 경고 수집
      const warnings: string[] = []
      if (vlmResult.data.uncertain_texts.length > 0) {
        warnings.push(`불확실한 텍스트: ${vlmResult.data.uncertain_texts.join(', ')}`)
      }

      return {
        pageNumber,
        pageType: vlmResult.data.page_type,
        sections: vlmResult.data.sections,
        rawText: vlmResult.rawResponse,
        validatedText,
        properNouns: vlmResult.data.proper_nouns,
        warnings,
        overallConfidence: vlmResult.data.uncertain_texts.length === 0 ? 0.95 : 0.8
      }
    }

    console.log(`[Bulletin VLM] VLM 실패, 레거시 OCR로 폴백`)
  }

  // 레거시 OCR 모드 (폴백 또는 VLM 비활성화)
  // 1. 페이지 유형 감지
  const { pageType, sections: expectedSections } = await detectPageType(base64Image, mimeType)
  console.log(`[Bulletin OCR] 페이지 유형: ${pageType}`)

  // 2. OCR 수행 (Claude)
  let rawText = await performBulletinOCR(base64Image, mimeType)
  console.log(`[Bulletin OCR] OCR 완료: ${rawText.length}자`)

  // 3. 교차 검증 (OpenAI)
  const verification = await verifyBulletinOCR(base64Image, rawText, mimeType)
  console.log(`[Bulletin OCR] 검증 완료: 정확도 ${(verification.overallAccuracy * 100).toFixed(1)}%`)

  // 4. 검증 오류 적용
  let validatedText = rawText
  for (const error of verification.errors) {
    if (error.correct && error.confidence > 0.8) {
      validatedText = validatedText.replace(error.wrong, error.correct)
      console.log(`[Bulletin OCR] 교정: ${error.wrong} → ${error.correct}`)
    }
  }

  // 5. 고유명사 검증
  const { validatedText: nameValidatedText, corrections } = await validateNamesInText(validatedText)
  if (corrections.length > 0) {
    validatedText = nameValidatedText
    console.log(`[Bulletin OCR] 이름 교정: ${corrections.map(c => `${c.from}→${c.to}`).join(', ')}`)
  }

  // 6. 추가 텍스트 검증
  const ocrValidation = await validateOCRResult(validatedText)
  validatedText = ocrValidation.correctedText

  // 7. 섹션 파싱
  const sections = parseSections(validatedText)

  // 8. 고유명사 추출
  const properNouns = extractProperNouns(validatedText)

  // 9. 경고 수집
  const warnings = [
    ...ocrValidation.warnings,
    ...ocrValidation.hallucinations,
    ...verification.missingContent.map(m => `누락 가능성: ${m}`)
  ]

  // 10. 전체 신뢰도 계산
  const sectionConfidences = sections.map(s => s.confidence)
  const avgSectionConfidence = sectionConfidences.length > 0
    ? sectionConfidences.reduce((a, b) => a + b) / sectionConfidences.length
    : 0.5
  const overallConfidence = (verification.overallAccuracy + ocrValidation.confidence + avgSectionConfidence) / 3

  return {
    pageNumber,
    pageType,
    sections,
    rawText,
    validatedText,
    properNouns,
    warnings,
    overallConfidence
  }
}

/**
 * 전체 주보 분석 (모든 페이지)
 */
export async function analyzeBulletin(
  pageImages: Array<{ base64: string; mimeType: string }>,
  bulletinDate: string
): Promise<{
  pages: BulletinPageAnalysis[]
  summary: {
    totalPages: number
    avgConfidence: number
    totalWarnings: number
    allProperNouns: {
      names: string[]
      positions: string[]
      places: string[]
    }
  }
}> {
  console.log(`[Bulletin OCR] ${bulletinDate} 주보 분석 시작 (${pageImages.length}페이지)`)

  const pages: BulletinPageAnalysis[] = []

  for (let i = 0; i < pageImages.length; i++) {
    const page = await analyzeBulletinPage(
      pageImages[i].base64,
      i + 1,
      pageImages[i].mimeType
    )
    pages.push(page)
  }

  // 전체 통계 계산
  const avgConfidence = pages.reduce((sum, p) => sum + p.overallConfidence, 0) / pages.length
  const totalWarnings = pages.reduce((sum, p) => sum + p.warnings.length, 0)

  // 모든 고유명사 수집 (중복 제거)
  const allNames = new Set<string>()
  const allPositions = new Set<string>()
  const allPlaces = new Set<string>()

  for (const page of pages) {
    page.properNouns.names.forEach(n => allNames.add(n))
    page.properNouns.positions.forEach(p => allPositions.add(p))
    page.properNouns.places.forEach(p => allPlaces.add(p))
  }

  return {
    pages,
    summary: {
      totalPages: pages.length,
      avgConfidence,
      totalWarnings,
      allProperNouns: {
        names: Array.from(allNames),
        positions: Array.from(allPositions),
        places: Array.from(allPlaces)
      }
    }
  }
}

// ============ 예배순서 파싱 유틸리티 ============

/**
 * 예배순서 텍스트를 구조화된 항목으로 파싱
 */
export function parseWorshipOrder(content: string): BulletinItem[] {
  const items: BulletinItem[] = []
  const lines = content.split('\n').filter(l => l.trim())

  for (const line of lines) {
    // "찬송 123장" 패턴
    const hymnMatch = line.match(/^(찬송|찬양)\s*(\d+)장?/)
    if (hymnMatch) {
      items.push({ label: hymnMatch[1], value: `${hymnMatch[2]}장` })
      continue
    }

    // "기도 OOO 장로" 패턴
    const prayerMatch = line.match(/^(기도|봉헌기도|대표기도)\s*(.+)/)
    if (prayerMatch) {
      items.push({ label: prayerMatch[1], value: prayerMatch[2] })
      continue
    }

    // "성경봉독 요한복음 3:16" 패턴
    const bibleMatch = line.match(/^(성경봉독|본문)\s*(.+)/)
    if (bibleMatch) {
      items.push({ label: bibleMatch[1], value: bibleMatch[2] })
      continue
    }

    // "설교 / 말씀" 패턴
    const sermonMatch = line.match(/^(설교|말씀)\s*(.*)/)
    if (sermonMatch) {
      items.push({ label: sermonMatch[1], value: sermonMatch[2] || '' })
      continue
    }

    // 일반 항목 "항목명 : 값" 또는 "항목명 값"
    const generalMatch = line.match(/^([가-힣]+)\s*[:：]?\s*(.+)/)
    if (generalMatch) {
      items.push({ label: generalMatch[1], value: generalMatch[2] })
    }
  }

  return items
}
