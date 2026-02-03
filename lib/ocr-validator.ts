/**
 * OCR 결과 검증 및 교정 모듈
 *
 * 기능:
 * 1. 고유명사(이름, 직분, 장소 등) 검증
 * 2. 알려진 오류 패턴 자동 교정
 * 3. 숫자, 날짜, 시간 형식 검증
 * 4. 할루시네이션 감지 및 제거
 */

import { createClient } from '@supabase/supabase-js'

// API 키 캐시
let apiKeyCache: Record<string, string> = {}
let apiKeyCacheTime = 0
const API_KEY_CACHE_TTL = 5 * 60 * 1000 // 5분

type AIProvider = 'openai' | 'anthropic' | 'google'

// Supabase 클라이언트 (lazy initialization)
let supabase: ReturnType<typeof createClient> | null = null

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
    )
  }
  return supabase
}

/**
 * Supabase에서 저장된 API 키 가져오기
 */
async function fetchStoredApiKeys(): Promise<Record<string, string>> {
  const now = Date.now()
  if (Object.keys(apiKeyCache).length > 0 && (now - apiKeyCacheTime) < API_KEY_CACHE_TTL) {
    return apiKeyCache
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) return {}

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/api_keys?is_active=eq.true&order=priority.asc`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) return {}

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
    apiKeyCacheTime = Date.now()
    return keys
  } catch {
    return apiKeyCache
  }
}

/**
 * API 키 가져오기
 */
export async function getApiKey(provider: AIProvider): Promise<string | null> {
  const storedKeys = await fetchStoredApiKeys()
  if (storedKeys[provider]) return storedKeys[provider]

  const envKeys: Record<AIProvider, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY
  }

  return envKeys[provider] || null
}

// ============ 고유명사 데이터 캐시 ============

interface ChurchMember {
  name: string
  position: string
  department?: string
  role?: string
}

interface OCRCorrection {
  wrong_text: string
  correct_text: string
  category: string
  confidence: number
}

interface ChurchPlace {
  name: string
  aliases: string[]
}

let churchMembersCache: ChurchMember[] = []
let ocrCorrectionsCache: OCRCorrection[] = []
let churchPlacesCache: ChurchPlace[] = []
let cacheLoadedTime = 0
const CACHE_TTL = 10 * 60 * 1000 // 10분

/**
 * 고유명사 캐시 로드
 */
async function loadValidationCache(): Promise<void> {
  const now = Date.now()
  if (churchMembersCache.length > 0 && (now - cacheLoadedTime) < CACHE_TTL) {
    return
  }

  try {
    const db = getSupabase() as any

    // 교회 구성원 로드
    const { data: members } = await db
      .from('church_members')
      .select('name, position, department, role')
      .eq('is_active', true)

    if (members) {
      churchMembersCache = members
    }

    // OCR 교정 패턴 로드
    const { data: corrections } = await db
      .from('ocr_corrections')
      .select('wrong_text, correct_text, category, confidence')

    if (corrections) {
      ocrCorrectionsCache = corrections
    }

    // 장소 목록 로드
    const { data: places } = await db
      .from('church_places')
      .select('name, aliases')

    if (places) {
      churchPlacesCache = places.map((p: any) => ({
        name: p.name,
        aliases: p.aliases || []
      }))
    }

    cacheLoadedTime = Date.now()
    console.log(`[OCR Validator] 캐시 로드: 구성원 ${churchMembersCache.length}명, 교정 패턴 ${ocrCorrectionsCache.length}개, 장소 ${churchPlacesCache.length}개`)
  } catch (error) {
    console.warn('[OCR Validator] 캐시 로드 실패:', error)
  }
}

// ============ 검증 함수 ============

/**
 * 이름+직분 검증
 * 입력된 이름이 교회 구성원 목록에 있는지 확인
 */
export async function validateName(name: string): Promise<{
  valid: boolean
  suggestion?: string
  member?: ChurchMember
}> {
  await loadValidationCache()

  // 정확히 일치하는 이름 찾기
  const exactMatch = churchMembersCache.find(m => m.name === name)
  if (exactMatch) {
    return { valid: true, member: exactMatch }
  }

  // 유사한 이름 찾기 (편집 거리 기반)
  const similarMembers = churchMembersCache
    .map(m => ({
      member: m,
      distance: levenshteinDistance(name, m.name)
    }))
    .filter(({ distance }) => distance <= 2) // 2글자 이하 차이
    .sort((a, b) => a.distance - b.distance)

  if (similarMembers.length > 0) {
    const best = similarMembers[0]
    return {
      valid: false,
      suggestion: best.member.name,
      member: best.member
    }
  }

  return { valid: false }
}

/**
 * 직분 검증
 */
export function validatePosition(position: string): { valid: boolean; suggestion?: string } {
  const validPositions = [
    '위임목사', '담임목사', '목사', '전도사', '장로', '권사',
    '안수집사', '집사', '간사', '사무', '사역자'
  ]

  if (validPositions.includes(position)) {
    return { valid: true }
  }

  // 오타 교정
  const corrections: Record<string, string> = {
    '위원목사': '위임목사',
    '담당목사': '담임목사',
    '전도시': '전도사',
    '장로님': '장로',
  }

  if (corrections[position]) {
    return { valid: false, suggestion: corrections[position] }
  }

  return { valid: false }
}

/**
 * 장소명 검증
 */
export async function validatePlace(place: string): Promise<{
  valid: boolean
  suggestion?: string
}> {
  await loadValidationCache()

  // 정확히 일치
  const exactMatch = churchPlacesCache.find(p =>
    p.name === place || p.aliases.includes(place)
  )
  if (exactMatch) {
    return { valid: true }
  }

  // 알려진 오류 패턴 확인
  const correction = ocrCorrectionsCache.find(c =>
    c.wrong_text === place && c.category === '장소'
  )
  if (correction) {
    return { valid: false, suggestion: correction.correct_text }
  }

  return { valid: false }
}

// ============ 텍스트 교정 ============

/**
 * OCR 텍스트 자동 교정
 * 알려진 오류 패턴을 찾아 수정
 */
export async function correctOCRText(text: string): Promise<{
  correctedText: string
  corrections: Array<{ from: string; to: string; category: string }>
}> {
  await loadValidationCache()

  let correctedText = text
  const corrections: Array<{ from: string; to: string; category: string }> = []

  // 알려진 오류 패턴 교정
  for (const correction of ocrCorrectionsCache) {
    if (correction.correct_text && correctedText.includes(correction.wrong_text)) {
      correctedText = correctedText.replace(
        new RegExp(escapeRegExp(correction.wrong_text), 'g'),
        correction.correct_text
      )
      corrections.push({
        from: correction.wrong_text,
        to: correction.correct_text,
        category: correction.category
      })
    }
  }

  // 이름+직분 패턴 검증 및 교정
  const namePositionPattern = /([가-힣]{2,4})\s*(위임목사|담임목사|목사|전도사|장로)/g
  let match
  while ((match = namePositionPattern.exec(text)) !== null) {
    const [fullMatch, name, position] = match
    const validation = await validateName(name)

    if (!validation.valid && validation.suggestion) {
      const correctedMatch = `${validation.suggestion} ${position}`
      if (correctedMatch !== fullMatch) {
        correctedText = correctedText.replace(fullMatch, correctedMatch)
        corrections.push({
          from: name,
          to: validation.suggestion,
          category: '이름'
        })
      }
    }
  }

  return { correctedText, corrections }
}

/**
 * 할루시네이션 감지
 * 없는 고유명사나 이상한 조합 감지
 */
export async function detectHallucinations(text: string): Promise<string[]> {
  await loadValidationCache()

  const hallucinations: string[] = []

  // 할루시네이션으로 알려진 패턴
  const knownHallucinations = ocrCorrectionsCache
    .filter(c => c.category === '할루시네이션')
    .map(c => c.wrong_text)

  for (const pattern of knownHallucinations) {
    if (text.includes(pattern)) {
      hallucinations.push(pattern)
    }
  }

  // 이름+직분 패턴에서 검증되지 않은 이름 찾기
  const namePositionPattern = /([가-힣]{2,4})\s*(위임목사|담임목사|목사|전도사|장로)/g
  let match
  while ((match = namePositionPattern.exec(text)) !== null) {
    const name = match[1]
    const validation = await validateName(name)

    if (!validation.valid && !validation.suggestion) {
      // 유사한 이름도 없는 경우 의심스러운 이름으로 표시
      hallucinations.push(`의심스러운 이름: ${name}`)
    }
  }

  return hallucinations
}

// ============ 전체 텍스트 검증 ============

export interface ValidationResult {
  isValid: boolean
  correctedText: string
  corrections: Array<{ from: string; to: string; category: string }>
  warnings: string[]
  hallucinations: string[]
  confidence: number // 0-1, 전체 텍스트 신뢰도
}

/**
 * OCR 결과 종합 검증
 */
export async function validateOCRResult(text: string): Promise<ValidationResult> {
  // 자동 교정
  const { correctedText, corrections } = await correctOCRText(text)

  // 할루시네이션 감지
  const hallucinations = await detectHallucinations(correctedText)

  // 경고 수집
  const warnings: string[] = []

  // 숫자 형식 검증
  const suspiciousNumbers = findSuspiciousNumbers(correctedText)
  warnings.push(...suspiciousNumbers.map(n => `의심스러운 숫자: ${n}`))

  // 신뢰도 계산
  const totalIssues = corrections.length + hallucinations.length + warnings.length
  const textLength = correctedText.length
  const confidence = Math.max(0, Math.min(1, 1 - (totalIssues * 50) / textLength))

  return {
    isValid: hallucinations.length === 0 && warnings.length === 0,
    correctedText,
    corrections,
    warnings,
    hallucinations,
    confidence
  }
}

// ============ 유틸리티 함수 ============

/**
 * Levenshtein 편집 거리 계산
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length
  const n = s2.length

  if (m === 0) return n
  if (n === 0) return m

  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // 삭제
          dp[i][j - 1] + 1,     // 삽입
          dp[i - 1][j - 1] + 1  // 교체
        )
      }
    }
  }

  return dp[m][n]
}

/**
 * 정규식 이스케이프
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 의심스러운 숫자 패턴 찾기
 */
function findSuspiciousNumbers(text: string): string[] {
  const suspicious: string[] = []

  // 너무 큰 인원수 (10,000명 이상)
  const largeNumbers = text.match(/\d{5,}여?\s*(명|분|가정|가족)/g)
  if (largeNumbers) {
    suspicious.push(...largeNumbers)
  }

  // 이상한 날짜 (13월 이상, 32일 이상)
  const datePattern = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g
  let match
  while ((match = datePattern.exec(text)) !== null) {
    const month = parseInt(match[2])
    const day = parseInt(match[3])
    if (month > 12 || day > 31) {
      suspicious.push(match[0])
    }
  }

  return suspicious
}

// ============ 고유명사 추출 ============

/**
 * 텍스트에서 고유명사 추출
 */
export function extractProperNouns(text: string): {
  names: string[]
  positions: string[]
  places: string[]
  numbers: string[]
} {
  // 이름 (2-4글자 한글 + 직분)
  const namePattern = /([가-힣]{2,4})\s*(위임목사|담임목사|목사|전도사|장로|권사|집사)/g
  const names: string[] = []
  let match
  while ((match = namePattern.exec(text)) !== null) {
    if (!names.includes(match[1])) {
      names.push(match[1])
    }
  }

  // 직분
  const positionPattern = /(위임목사|담임목사|목사|전도사|장로|권사|안수집사|집사|간사)/g
  const positions: string[] = []
  while ((match = positionPattern.exec(text)) !== null) {
    if (!positions.includes(match[1])) {
      positions.push(match[1])
    }
  }

  // 장소 (XX홀, XX실 등)
  const placePattern = /([가-힣]{2,6})(홀|실|관|당)/g
  const places: string[] = []
  while ((match = placePattern.exec(text)) !== null) {
    const place = match[0]
    if (!places.includes(place)) {
      places.push(place)
    }
  }

  // 숫자 (인원, 금액 등)
  const numberPattern = /[\d,]+\s*(명|분|가정|가족|원|만원)/g
  const numbers: string[] = []
  while ((match = numberPattern.exec(text)) !== null) {
    if (!numbers.includes(match[0])) {
      numbers.push(match[0])
    }
  }

  return { names, positions, places, numbers }
}
