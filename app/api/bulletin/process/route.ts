/**
 * 주보 처리 API
 * GET: 처리 현황 조회
 * POST: 스캔 및 처리 시작
 * - 증분 스캔: DB 캐시 우선 사용, 신규만 웹 스캔
 * - Graceful stop: 현재 항목 완료 후 중지
 * - 개선된 OCR: 다중 모델 교차 검증, 고유명사 검증
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { analyzeBulletinPage } from '@/lib/bulletin-ocr'
import { validateOCRResult } from '@/lib/ocr-validator'

// Lazy initialization - runtime에서만 생성
let _supabase: SupabaseClient | null = null
let _openai: OpenAI | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

// 개선된 OCR 사용 여부 (환경변수로 제어, 기본값: true)
const USE_ADVANCED_OCR = process.env.USE_ADVANCED_BULLETIN_OCR !== 'false'

const BASE_URL = 'https://www.anyangjeil.org'
const BOARD_ID = 65

/**
 * 중지 요청 확인
 */
async function checkStopRequested(): Promise<boolean> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const res = await fetch(`${baseUrl}/api/admin/task-lock`)
    const data = await res.json()
    return data.stopRequested === true
  } catch {
    return false
  }
}

/**
 * 진행 상태 업데이트 (task-lock에 현재 작업 정보 전송)
 */
async function updateTaskProgress(currentItem: string, processedCount: number, totalCount: number): Promise<void> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    await fetch(`${baseUrl}/api/admin/task-lock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'progress',
        currentItem,
        processedCount,
        totalCount
      })
    })
  } catch {
    // 실패해도 계속 진행
  }
}

/**
 * 최신 캐시된 주보 날짜 조회
 */
async function getLatestCachedBulletinDate(): Promise<string | null> {
  try {
    const { data } = await getSupabase()
      .from('bulletin_issues')
      .select('bulletin_date')
      .order('bulletin_date', { ascending: false })
      .limit(1)
      .single()

    return data?.bulletin_date || null
  } catch {
    return null
  }
}

// OCR 프롬프트 (주보용)
const OCR_PROMPT = `이 이미지는 한국 교회의 주보(예배순서지)의 한 페이지입니다.
이미지에서 모든 한글 텍스트를 정확하게 추출해주세요.

추출 규칙:
1. 섹션별로 구분하여 추출 (### 로 구분)
2. 각 섹션의 유형을 명시
3. 제목, 내용, 일시, 장소 등 구조화된 정보 추출
4. 원본 텍스트를 최대한 그대로 유지

형식:
### 섹션 1
유형: (예배순서/교회소식/광고/기도제목/헌금/봉사자/교회학교/성경봉독/찬송/새가족/감사/추모 등)
제목: (섹션 제목)
내용: (본문 내용)

### 섹션 2
...`

// 이미지 다운로드 및 base64 변환
async function downloadImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'image/jpeg,image/png,image/*',
        'Referer': 'https://www.anyangjeil.org/'
      }
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const arrayBuffer = await response.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const contentType = response.headers.get('content-type') || 'image/jpeg'

    return `data:${contentType};base64,${base64}`
  } catch (error: any) {
    console.error(`이미지 다운로드 실패: ${error.message}`)
    return null
  }
}

// 목록 페이지에서 주보 정보 수집
async function fetchBulletinsFromPage(page: number, listPageUrl: string): Promise<any[]> {
  const url = `${listPageUrl}?page=${page}`
  const response = await fetch(url)
  const html = await response.text()

  const bulletins: any[] = []
  const documentRegex = /<a[^>]*href="\/Board\/Detail\/65\/(\d+)[^"]*"[^>]*title="(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*주보"/g

  let match
  while ((match = documentRegex.exec(html)) !== null) {
    const boardId = parseInt(match[1])
    const year = parseInt(match[2])
    const month = parseInt(match[3])
    const day = parseInt(match[4])

    const bulletinDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const title = `${year}년 ${month}월 ${day}일 주보`

    bulletins.push({
      bulletinDate,
      title,
      boardId,
      year,
      month,
      day,
      pageCount: 8,
      status: 'pending'
    })
  }

  return bulletins
}

// 특정 주보의 이미지 URL 추출
async function fetchBulletinImages(boardId: number): Promise<string[]> {
  const url = `${BASE_URL}/Board/Detail/${BOARD_ID}/${boardId}`
  const response = await fetch(url)
  const html = await response.text()

  const imageUrls: string[] = []
  const imgRegex = /src="(https:\/\/data\.dimode\.co\.kr[^"]+\.jpg)\s*"/g

  let match
  while ((match = imgRegex.exec(html)) !== null) {
    imageUrls.push(match[1].trim())
  }

  return imageUrls
}

// OCR 수행 (기본)
async function performBasicOCR(imageUrl: string): Promise<string> {
  try {
    const base64Image = await downloadImageAsBase64(imageUrl)
    if (!base64Image) return ''

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            { type: 'image_url', image_url: { url: base64Image, detail: 'high' } }
          ]
        }
      ],
      max_tokens: 4096
    })

    return response.choices[0]?.message?.content || ''
  } catch (error: any) {
    console.error('OCR 오류:', error.message)
    return ''
  }
}

// 개선된 OCR 수행 (VLM 구조화 추출 + 페이지 단위 청크)
interface AdvancedOCRResult {
  text: string
  confidence: number
  warnings: string[]
  pageType: string
  sectionTypes: string[]
  properNouns: {
    names: string[]
    positions: string[]
    places: string[]
    numbers: string[]
  }
}

async function performAdvancedOCR(
  imageUrl: string,
  pageNumber: number
): Promise<AdvancedOCRResult> {
  try {
    // data:... 형식이 아닌 순수 base64만 추출
    const fullBase64 = await downloadImageAsBase64(imageUrl)
    if (!fullBase64) return {
      text: '', confidence: 0, warnings: ['이미지 다운로드 실패'],
      pageType: 'unknown', sectionTypes: [],
      properNouns: { names: [], positions: [], places: [], numbers: [] }
    }

    // "data:image/jpeg;base64," 부분 제거
    const base64Match = fullBase64.match(/^data:([^;]+);base64,(.+)$/)
    if (!base64Match) return {
      text: '', confidence: 0, warnings: ['base64 파싱 실패'],
      pageType: 'unknown', sectionTypes: [],
      properNouns: { names: [], positions: [], places: [], numbers: [] }
    }

    const mimeType = base64Match[1]
    const base64Data = base64Match[2]

    // 개선된 OCR 모듈 사용
    const analysis = await analyzeBulletinPage(base64Data, pageNumber, mimeType)

    // 섹션 타입 추출 (중복 제거)
    const sectionTypes = [...new Set(analysis.sections.map(s => s.type).filter(t => t && t !== 'unknown'))]

    return {
      text: analysis.validatedText,
      confidence: analysis.overallConfidence,
      warnings: analysis.warnings,
      pageType: analysis.pageType,
      sectionTypes,
      properNouns: analysis.properNouns
    }
  } catch (error: any) {
    console.error('[Bulletin OCR] 개선된 OCR 실패, 기본 OCR로 폴백:', error.message)
    // 폴백: 기본 OCR 사용
    const basicText = await performBasicOCR(imageUrl)
    const validation = await validateOCRResult(basicText)
    return {
      text: validation.correctedText,
      confidence: validation.confidence,
      warnings: [...validation.warnings, '폴백: 기본 OCR 사용'],
      pageType: 'unknown',
      sectionTypes: [],
      properNouns: { names: [], positions: [], places: [], numbers: [] }
    }
  }
}

/**
 * 페이지 단위로 청크 생성 (개선된 방식)
 *
 * 주보 특성상 페이지 단위가 검색에 더 적합:
 * - 한 페이지 내 섹션들이 맥락적으로 연결됨
 * - 이름+직분+행사가 함께 검색됨
 * - 청크 수를 줄여 임베딩 비용 절약
 */
function createPageChunk(
  text: string,
  issueId: number,
  pageNumber: number,
  bulletinDate: string,
  bulletinTitle: string,
  ocrResult: AdvancedOCRResult
): any {
  const dateObj = new Date(bulletinDate)
  const year = dateObj.getFullYear()
  const month = dateObj.getMonth() + 1

  // 섹션 타입 결정: VLM 추출 결과 우선, 없으면 텍스트에서 추론
  let sectionType = '기타'
  if (ocrResult.sectionTypes.length > 0) {
    // 주요 섹션 타입 우선순위
    const priority = ['worship_order', 'sermon_notes', 'church_news', 'prayer_requests', 'announcements', 'offerings', 'new_family', 'volunteers', 'bible_school']
    for (const p of priority) {
      if (ocrResult.sectionTypes.includes(p)) {
        sectionType = p
        break
      }
    }
  } else {
    // 텍스트 기반 추론
    if (text.includes('예배순서') || text.includes('주일예배')) sectionType = 'worship_order'
    else if (text.includes('설교노트') || text.includes('설교요약') || text.includes('말씀정리') || (text.includes('설교') && text.includes('본문'))) sectionType = 'sermon_notes'
    else if (text.includes('교회소식') || text.includes('광고')) sectionType = 'church_news'
    else if (text.includes('기도제목') || text.includes('중보기도')) sectionType = 'prayer_requests'
    else if (text.includes('헌금') || text.includes('감사헌금')) sectionType = 'offerings'
    else if (text.includes('새가족')) sectionType = 'new_family'
    else if (text.includes('성경공부') || text.includes('말씀묵상')) sectionType = 'bible_school'
  }

  // 페이지 제목 생성 (VLM pageType 기반)
  const pageTypeLabels: Record<string, string> = {
    'worship_order': '예배순서',
    'sermon_notes': '설교노트',
    'church_news': '교회소식',
    'prayer_requests': '기도제목',
    'announcements': '광고/공지',
    'offerings': '헌금',
    'new_family': '새가족',
    'volunteers': '봉사자',
    'bible_school': '성경공부',
    'mixed': '혼합',
  }
  const title = pageTypeLabels[ocrResult.pageType] || `${pageNumber}페이지`

  // 마크다운 기호 제거
  const cleanText = text
    .replace(/^#{1,6}\s*/gm, '')       // # 헤더 제거
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')  // *bold*, **bold**, ***bold*** → 텍스트만
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')     // _italic_ 등 제거
    .replace(/~~([^~]+)~~/g, '$1')     // ~~취소선~~ 제거
    .replace(/`([^`]+)`/g, '$1')       // `code` 제거
    .replace(/^>\s*/gm, '')            // > 인용 제거
    .replace(/^[-*+]\s+/gm, '- ')     // 리스트 마커 통일
    .replace(/^\d+\.\s+/gm, (m) => m) // 번호 리스트는 유지

  // 검색 최적화를 위한 메타데이터 포함 텍스트
  let enrichedContent = cleanText

  // 고유명사가 있으면 상단에 추가 (검색 품질 향상)
  const { names, positions, places, numbers } = ocrResult.properNouns
  if (names.length > 0 || places.length > 0) {
    const metaParts: string[] = []
    if (names.length > 0) metaParts.push(`[이름: ${names.join(', ')}]`)
    if (places.length > 0) metaParts.push(`[장소: ${places.join(', ')}]`)
    if (numbers.length > 0) metaParts.push(`[숫자: ${numbers.join(', ')}]`)
    enrichedContent = `${metaParts.join(' ')}\n\n${cleanText}`
  }

  return {
    issue_id: issueId,
    page_number: pageNumber,
    chunk_index: 0,  // 페이지 단위이므로 항상 0
    section_type: sectionType,
    title,
    content: enrichedContent.substring(0, 4000),  // 페이지 단위이므로 더 긴 내용 허용
    bulletin_date: bulletinDate,
    bulletin_title: bulletinTitle,
    year,
    month
  }
}

// 레거시 호환용 (기본 OCR 사용 시)
function splitIntoChunks(text: string, issueId: number, pageNumber: number, bulletinDate: string, bulletinTitle: string): any[] {
  const chunks: any[] = []

  // 섹션 구분 패턴 개선: ### 뒤에 오는 모든 텍스트를 섹션으로 인식
  const sections = text.split(/###\s*/).filter(s => s.trim())

  const dateObj = new Date(bulletinDate)
  const year = dateObj.getFullYear()
  const month = dateObj.getMonth() + 1

  sections.forEach((section, idx) => {
    // 첫 줄을 제목으로, 나머지를 내용으로
    const lines = section.split('\n')
    const rawTitle = lines[0]?.trim() || `섹션 ${idx + 1}`
    const title = rawTitle.replace(/[#*_~`>]/g, '').trim()
    const rawContent = lines.slice(1).join('\n').trim() || section.trim()
    const content = rawContent
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^>\s*/gm, '')

    // 섹션 타입 추론
    let sectionType = '기타'
    const lowerTitle = title.toLowerCase()
    if (lowerTitle.includes('예배') || lowerTitle.includes('설교')) sectionType = 'worship_order'
    else if (lowerTitle.includes('소식') || lowerTitle.includes('광고')) sectionType = 'church_news'
    else if (lowerTitle.includes('기도')) sectionType = 'prayer_requests'
    else if (lowerTitle.includes('헌금') || lowerTitle.includes('감사')) sectionType = 'offerings'
    else if (lowerTitle.includes('새가족')) sectionType = 'new_family'
    else if (lowerTitle.includes('성경') || lowerTitle.includes('공부')) sectionType = 'bible_school'
    else if (lowerTitle.includes('안내')) sectionType = 'announcements'

    if (content.length > 30) {
      chunks.push({
        issue_id: issueId,
        page_number: pageNumber,
        chunk_index: idx,
        section_type: sectionType,
        title,
        content: content.substring(0, 2000),
        bulletin_date: bulletinDate,
        bulletin_title: bulletinTitle,
        year,
        month
      })
    }
  })

  return chunks
}

// 임베딩 생성
async function createEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000),
    dimensions: 1536
  })
  return response.data[0].embedding
}

// GET: 처리 현황 조회
export async function GET() {
  try {
    const { data: issues } = await getSupabase()
      .from('bulletin_issues')
      .select('id, status')

    const { data: chunks } = await getSupabase()
      .from('bulletin_chunks')
      .select('id, embedding')

    const total = issues?.length || 0
    const completed = issues?.filter(i => i.status === 'completed').length || 0
    const pending = issues?.filter(i => i.status === 'pending').length || 0
    const totalChunks = chunks?.length || 0
    const embeddedChunks = chunks?.filter(c => c.embedding !== null).length || 0

    return NextResponse.json({
      success: true,
      stats: {
        totalIssues: total,
        completedIssues: completed,
        pendingIssues: pending,
        totalChunks,
        embeddedChunks
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Task lock 획득 헬퍼
async function acquireTaskLock(description: string): Promise<{ success: boolean; message?: string }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/api/admin/task-lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskType: 'bulletin', description })
    })
    const data = await response.json()
    if (!response.ok) {
      return { success: false, message: data.message || '다른 작업이 진행 중입니다.' }
    }
    return { success: true }
  } catch (error) {
    console.warn('Task lock 획득 실패 (계속 진행):', error)
    return { success: true } // 락 서비스 에러 시 계속 진행
  }
}

// Task lock 해제 헬퍼
async function releaseTaskLock(): Promise<void> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    await fetch(`${baseUrl}/api/admin/task-lock?taskType=bulletin`, {
      method: 'DELETE'
    })
  } catch (error) {
    console.warn('Task lock 해제 실패:', error)
  }
}

/**
 * 벡터 인덱스 동기화 (IVFFLAT 인덱스 갱신)
 * - 주보 1개 처리 완료 후 호출
 * - 검색 품질 유지를 위한 인덱스 갱신
 */
async function syncVectorIndex(): Promise<void> {
  try {
    // bulletin_chunks 테이블의 벡터 인덱스 갱신
    // ANALYZE로 통계 정보 업데이트 (검색 최적화)
    const { error } = await getSupabase().rpc('refresh_bulletin_vector_index')
    if (error) {
      // RPC가 없으면 직접 ANALYZE 실행 시도
      console.log('[bulletin/process] refresh_bulletin_vector_index RPC 없음, 기본 동기화 사용')
    } else {
      console.log('[bulletin/process] 벡터 인덱스 동기화 완료')
    }
  } catch (error) {
    console.warn('[bulletin/process] 벡터 인덱스 동기화 실패 (계속 진행):', error)
  }
}

// POST: 스캔 및 처리
export async function POST(req: NextRequest) {
  try {
    const { action, config, maxIssues, fullRescan = false } = await req.json()
    const listPageUrl = config?.listPageUrl || `${BASE_URL}/Board/Index/${BOARD_ID}`

    if (action === 'scan') {
      // 전체 리스캔인 경우 미처리 스캔 정보 삭제
      if (fullRescan) {
        console.log('[bulletin/process] 전체 재스캔 - 미처리 스캔 정보 삭제 중...')
        await getSupabase().from('bulletin_issues').delete().in('status', ['pending', 'failed'])
      }

      // DB에 캐시된 주보 확인
      const { data: cachedIssues } = await getSupabase()
        .from('bulletin_issues')
        .select('bulletin_date')
        .order('bulletin_date', { ascending: false })

      const cachedDates = new Set((cachedIssues || []).map(i => i.bulletin_date))
      const latestCached = await getLatestCachedBulletinDate()

      console.log(`[bulletin/process] DB 캐시: ${cachedDates.size}개 주보 (최신: ${latestCached || '없음'})`)

      // 주보 목록 스캔 (웹에서)
      const allBulletins: any[] = []
      let foundCached = false

      for (let page = 1; page <= 60; page++) {
        const bulletins = await fetchBulletinsFromPage(page, listPageUrl)
        if (bulletins.length === 0) break

        for (const bulletin of bulletins) {
          // 이미 캐시된 주보를 만나면 증분 스캔 종료 (전체 리스캔이 아닌 경우)
          if (!fullRescan && cachedDates.has(bulletin.bulletinDate)) {
            foundCached = true
            break
          }
          if (!cachedDates.has(bulletin.bulletinDate)) {
            allBulletins.push(bulletin)
          }
        }

        if (foundCached && !fullRescan) break
        await new Promise(r => setTimeout(r, 300))
      }

      console.log(`[bulletin/process] 웹 스캔: ${allBulletins.length}개 신규 주보 발견`)

      // 중복 제거
      const uniqueBulletins = allBulletins.filter((b, index, self) =>
        index === self.findIndex(x => x.bulletinDate === b.bulletinDate)
      )

      // DB에 저장
      let newCount = 0
      for (const bulletin of uniqueBulletins) {
        const { error } = await getSupabase()
          .from('bulletin_issues')
          .insert({
            bulletin_date: bulletin.bulletinDate,
            title: bulletin.title,
            board_id: bulletin.boardId,
            year: bulletin.year,
            month: bulletin.month,
            day: bulletin.day,
            page_count: bulletin.pageCount,
            status: 'pending'
          })
        if (!error) newCount++
      }

      // 현재 상태 조회
      const { data: allIssues } = await getSupabase()
        .from('bulletin_issues')
        .select('*')
        .order('bulletin_date', { ascending: false })

      const pending = allIssues?.filter(i => i.status === 'pending') || []
      const completed = allIssues?.filter(i => i.status === 'completed') || []

      return NextResponse.json({
        success: true,
        total: allIssues?.length || 0,
        pending: pending.length,
        completed: completed.length,
        newSaved: newCount,
        fullRescan,
        issues: allIssues?.map(i => ({
          bulletinDate: i.bulletin_date,
          title: i.title,
          boardId: i.board_id,
          pageCount: i.page_count,
          status: i.status
        }))
      })
    }

    if (action === 'process') {
      // 미처리 주보 조회 (락 획득 전 체크)
      // maxIssues가 지정되지 않으면 모든 미처리 주보를 처리
      let query = getSupabase()
        .from('bulletin_issues')
        .select('*')
        .eq('status', 'pending')
        .order('bulletin_date', { ascending: false })

      // maxIssues가 명시적으로 지정된 경우에만 제한 적용
      if (maxIssues && maxIssues > 0) {
        query = query.limit(maxIssues)
      }

      const { data: pendingBulletins } = await query

      if (!pendingBulletins || pendingBulletins.length === 0) {
        return NextResponse.json({
          success: true,
          message: '처리할 주보가 없습니다.',
          results: []
        })
      }

      console.log(`[bulletin/process] ${pendingBulletins.length}개 주보 처리 시작`)

      // Task lock 획득
      const lockResult = await acquireTaskLock(`주보 처리 (${pendingBulletins.length}건)`)
      if (!lockResult.success) {
        return NextResponse.json({
          error: lockResult.message,
          locked: true
        }, { status: 409 })
      }

      try {
        const results: any[] = []
        let stoppedByUser = false

        for (let bulletinIdx = 0; bulletinIdx < pendingBulletins.length; bulletinIdx++) {
          // 중지 요청 확인 (각 주보 시작 전)
          if (await checkStopRequested()) {
            stoppedByUser = true
            console.log(`[bulletin/process] 사용자 요청으로 중지됨. ${bulletinIdx}개 완료, ${pendingBulletins.length - bulletinIdx}개 남음.`)
            break
          }

          const bulletin = pendingBulletins[bulletinIdx]

          // 진행 상태 업데이트
          await updateTaskProgress(
            bulletin.bulletin_date,
            bulletinIdx,
            pendingBulletins.length
          )

          console.log(`[bulletin/process] 주보 처리 중 (${bulletinIdx + 1}/${pendingBulletins.length}): ${bulletin.bulletin_date}`)

          try {
            // 이미지 URL 가져오기
            const imageUrls = await fetchBulletinImages(bulletin.board_id)

            let totalChunks = 0
            let totalWarnings: string[] = []

            for (let i = 0; i < imageUrls.length; i++) {
              let chunks: any[] = []

              // 개선된 OCR 사용 (환경변수로 제어, 기본값: true)
              if (USE_ADVANCED_OCR) {
                const result = await performAdvancedOCR(imageUrls[i], i + 1)

                if (result.warnings.length > 0) {
                  console.log(`[bulletin/process] 페이지 ${i + 1} 경고:`, result.warnings.join(', '))
                  totalWarnings.push(...result.warnings)
                }
                console.log(`[bulletin/process] 페이지 ${i + 1} 신뢰도: ${(result.confidence * 100).toFixed(1)}%, 타입: ${result.pageType}`)

                if (result.text) {
                  // 페이지 단위 청크 생성 (VLM 구조화 데이터 활용)
                  const chunk = createPageChunk(
                    result.text,
                    bulletin.id,
                    i + 1,
                    bulletin.bulletin_date,
                    bulletin.title,
                    result
                  )
                  chunks = [chunk]
                }
              } else {
                const ocrText = await performBasicOCR(imageUrls[i])
                if (ocrText) {
                  // 레거시: 섹션 단위 청크 생성
                  chunks = splitIntoChunks(
                    ocrText,
                    bulletin.id,
                    i + 1,
                    bulletin.bulletin_date,
                    bulletin.title
                  )
                }
              }

              // 청크 저장 (임베딩 생성)
              for (const chunk of chunks) {
                try {
                  const embedding = await createEmbedding(chunk.content)
                  await getSupabase().from('bulletin_chunks').insert({
                    ...chunk,
                    embedding
                  })
                  totalChunks++
                  console.log(`[bulletin/process] 청크 저장: 페이지${i + 1}, 타입=${chunk.section_type}, 제목=${chunk.title}`)
                } catch (e: any) {
                  console.error(`[bulletin/process] 임베딩 오류: ${e.message}`)
                }
              }

              await new Promise(r => setTimeout(r, 2000))
            }

            // 상태 업데이트
            await getSupabase()
              .from('bulletin_issues')
              .update({ status: 'completed', page_count: imageUrls.length })
              .eq('id', bulletin.id)

            // 🔄 각 주보 처리 완료 후 벡터 인덱스 동기화
            // 이렇게 하면 처리 중에도 챗봇에서 검색 가능
            await syncVectorIndex()
            console.log(`[bulletin/process] ${bulletin.bulletin_date} 완료 - ${totalChunks}개 청크, 벡터 인덱스 동기화됨`)

            results.push({
              success: true,
              bulletinDate: bulletin.bulletin_date,
              title: bulletin.title,
              chunks: totalChunks
            })
          } catch (error: any) {
            console.error(`[bulletin/process] ${bulletin.bulletin_date} 처리 실패:`, error.message)
            results.push({
              success: false,
              bulletinDate: bulletin.bulletin_date,
              error: error.message
            })
          }
        }

        await releaseTaskLock()

        return NextResponse.json({
          success: true,
          stoppedByUser,
          processedCount: results.length,
          remainingCount: stoppedByUser ? pendingBulletins.length - results.length : 0,
          results
        })
      } catch (error) {
        await releaseTaskLock()
        throw error
      }
    }

    return NextResponse.json({ error: '알 수 없는 action입니다.' }, { status: 400 })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
