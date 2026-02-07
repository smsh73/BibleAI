/**
 * 뉴스 처리 통합 API
 * POST /api/news/process
 * - action: 'scan' | 'process' | 'process_all'
 * - URL 기반 자동 크롤링
 * - 중복 필터링 및 증분 처리
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  performOCR,
  processImageToArticles,
  processImageWithVLM,
  saveNewsIssue,
  updateIssueStatus,
  isIssueProcessed
} from '@/lib/news-extractor'

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

// 기본값 (설정이 없을 경우)
const DEFAULT_BASE_URL = 'https://www.anyangjeil.org'
const DEFAULT_BOARD_ID = 66

// URL에서 호수 정보 파싱
interface IssueInfo {
  boardId: number
  issueNumber: number
  issueDate: string
  year: number
  month: number
  imageUrls: string[]
}

interface UrlConfig {
  // 새로운 유연한 방식
  listPageUrl?: string
  startUrl?: string  // 시작(최신) 게시물 URL - 범위 시작점
  endUrl?: string    // 끝(가장 오래된) 게시물 URL - 범위 종료점
  // 레거시 호환
  baseUrl?: string
  boardId?: number
  maxPages?: number
}

/**
 * URL에서 도메인(origin) 추출
 */
function extractOrigin(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.origin
  } catch {
    return url
  }
}

/**
 * 페이지네이션 URL 생성 (유연한 방식)
 */
function buildPaginatedUrl(baseListUrl: string, page: number): string {
  try {
    const url = new URL(baseListUrl)
    url.searchParams.set('page', String(page))
    return url.toString()
  } catch {
    // URL 파싱 실패시 단순 문자열 조합
    if (baseListUrl.includes('?')) {
      return `${baseListUrl}&page=${page}`
    }
    return `${baseListUrl}?page=${page}`
  }
}

/**
 * HTML에서 상세 페이지 링크 패턴 자동 감지
 */
function detectDetailLinks(html: string, origin: string): { pattern: RegExp, links: string[] } {
  const links: string[] = []

  // 일반적인 링크 패턴들 시도
  const patterns = [
    // Dimode CMS 패턴: /Board/Detail/숫자/숫자 (쿼리스트링 포함 가능)
    /href="(\/Board\/Detail\/\d+\/\d+[^"]*)"/g,
    // 일반 상세 페이지 패턴: /view/숫자, /detail/숫자, /read/숫자
    /href="(\/(?:view|detail|read|article|post|news)\/\d+[^"]*)"/gi,
    // 쿼리 파라미터 방식: ?id=숫자, ?no=숫자, ?seq=숫자
    /href="([^"]*\?(?:id|no|seq|idx|num)=\d+[^"]*)"/gi,
    // 상대 경로 숫자 ID: /숫자 (단, 4자리 이상)
    /href="(\/\d{4,}[^"]*)"/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(html)) !== null) {
      const link = match[1]
      if (!links.includes(link)) {
        links.push(link)
      }
    }
    if (links.length > 0) {
      console.log(`[detectDetailLinks] 패턴 감지 성공: ${pattern.source}, ${links.length}개 링크`)
      return { pattern, links }
    }
    pattern.lastIndex = 0 // 리셋
  }

  console.log('[detectDetailLinks] 링크 패턴 감지 실패')
  return { pattern: /(?!)/, links: [] } // 빈 결과
}

async function scanAllIssues(config: UrlConfig): Promise<IssueInfo[]> {
  const issues: IssueInfo[] = []
  const { maxPages = 10 } = config

  // 유연한 URL 처리: listPageUrl 우선, 없으면 레거시 방식
  let listPageUrl: string
  let origin: string

  if (config.listPageUrl) {
    listPageUrl = config.listPageUrl
    origin = extractOrigin(listPageUrl)
    console.log(`[scanAllIssues] 유연한 URL 모드 - listPageUrl: ${listPageUrl}`)
  } else {
    // 레거시 호환: baseUrl + boardId
    const baseUrl = config.baseUrl || DEFAULT_BASE_URL
    const boardId = config.boardId || DEFAULT_BOARD_ID
    origin = extractOrigin(baseUrl)
    listPageUrl = `${origin}/Board/Index/${boardId}`
    console.log(`[scanAllIssues] 레거시 모드 - baseUrl: ${baseUrl}, boardId: ${boardId}`)
  }

  // 범위 설정: 시작/끝 URL에서 호수 번호 추출
  let startIssueNumber: number | undefined
  let endIssueNumber: number | undefined

  if (config.startUrl) {
    console.log(`[scanAllIssues] 시작 URL에서 범위 파악 중: ${config.startUrl}`)
    const startInfo = await fetchIssueDetailsByUrl(config.startUrl)
    if (startInfo) {
      startIssueNumber = startInfo.issueNumber
      console.log(`[scanAllIssues] 시작 호수: ${startIssueNumber}호 (${startInfo.issueDate})`)
    }
  }

  if (config.endUrl) {
    console.log(`[scanAllIssues] 끝 URL에서 범위 파악 중: ${config.endUrl}`)
    const endInfo = await fetchIssueDetailsByUrl(config.endUrl)
    if (endInfo) {
      endIssueNumber = endInfo.issueNumber
      console.log(`[scanAllIssues] 끝 호수: ${endIssueNumber}호 (${endInfo.issueDate})`)
    }
  }

  // 범위 정렬 (startIssueNumber가 더 큰 값이어야 함 - 최신 호수)
  if (startIssueNumber && endIssueNumber && startIssueNumber < endIssueNumber) {
    [startIssueNumber, endIssueNumber] = [endIssueNumber, startIssueNumber]
  }

  console.log(`[scanAllIssues] 시작 - origin: ${origin}, maxPages: ${maxPages}, 범위: ${startIssueNumber || '없음'} ~ ${endIssueNumber || '없음'}`)

  for (let page = 1; page <= maxPages; page++) {
    const url = buildPaginatedUrl(listPageUrl, page)
    console.log(`[scanAllIssues] 페이지 ${page} fetch 시작: ${url}`)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30초 타임아웃

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      clearTimeout(timeoutId)

      console.log(`[scanAllIssues] 페이지 ${page} 응답: ${response.status}`)

      if (!response.ok) {
        console.error(`[scanAllIssues] 페이지 ${page} HTTP 오류: ${response.status}`)
        break
      }

      const html = await response.text()
      console.log(`[scanAllIssues] 페이지 ${page} HTML 길이: ${html.length}자`)

      // 게시물 링크 자동 감지
      const { links } = detectDetailLinks(html, origin)

      console.log(`[scanAllIssues] 페이지 ${page}에서 ${links.length}개 게시물 발견`)

      if (links.length === 0) {
        console.log(`[scanAllIssues] 페이지 ${page}에 게시물 없음, 스캔 종료`)
        break
      }

      // 각 게시물 상세 정보 가져오기
      for (const link of links) {
        // 상대 경로를 절대 경로로 변환
        const detailUrl = link.startsWith('http') ? link : `${origin}${link}`
        console.log(`[scanAllIssues] 상세 페이지 조회 중: ${detailUrl}`)

        const issueInfo = await fetchIssueDetailsByUrl(detailUrl)
        if (issueInfo) {
          // 범위 체크
          const inRange = (
            (!startIssueNumber || issueInfo.issueNumber <= startIssueNumber) &&
            (!endIssueNumber || issueInfo.issueNumber >= endIssueNumber)
          )

          if (!inRange) {
            console.log(`[scanAllIssues] ${issueInfo.issueNumber}호: 범위 외 (${endIssueNumber || '없음'} ~ ${startIssueNumber || '없음'})`)
            // 범위를 벗어났고 끝 호수보다 작으면 더 이상 스캔 불필요
            if (endIssueNumber && issueInfo.issueNumber < endIssueNumber) {
              console.log(`[scanAllIssues] 끝 호수(${endIssueNumber})보다 오래된 호수 발견, 스캔 종료`)
              return issues.sort((a, b) => b.issueNumber - a.issueNumber)
            }
            continue
          }

          // 중복 체크
          if (!issues.find(i => i.issueNumber === issueInfo.issueNumber)) {
            issues.push(issueInfo)
            console.log(`[scanAllIssues] 호수 추가: ${issueInfo.issueDate} (${issueInfo.issueNumber}호)`)
          }
        } else {
          console.log(`[scanAllIssues] ${detailUrl}: 호수 정보 파싱 실패`)
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error(`[scanAllIssues] 페이지 ${page} 타임아웃 (30초 초과)`)
      } else {
        console.error(`[scanAllIssues] 페이지 ${page} 스캔 실패:`, error.message)
      }
      break
    }
  }

  console.log(`[scanAllIssues] 완료 - 총 ${issues.length}개 호수 수집`)
  return issues.sort((a, b) => b.issueNumber - a.issueNumber)
}

/**
 * URL로 상세 페이지 정보 가져오기 (유연한 방식)
 */
async function fetchIssueDetailsByUrl(detailUrl: string): Promise<IssueInfo | null> {
  try {
    console.log(`[fetchIssueDetailsByUrl] 요청: ${detailUrl}`)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(detailUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    clearTimeout(timeoutId)

    console.log(`[fetchIssueDetailsByUrl] 응답: ${response.status}`)

    if (!response.ok) {
      console.error(`[fetchIssueDetailsByUrl] HTTP 오류: ${response.status}`)
      return null
    }

    const html = await response.text()
    console.log(`[fetchIssueDetailsByUrl] HTML 길이: ${html.length}자`)

    // URL에서 ID 추출 시도
    const urlMatch = detailUrl.match(/\/(\d+)\/?$/) || detailUrl.match(/[?&](?:id|no|seq)=(\d+)/)
    const boardId = urlMatch ? parseInt(urlMatch[1]) : 0

    let year: number | undefined
    let month: number | undefined
    let issueNumber: number | undefined

    // 1단계: document-title 영역에서 날짜 추출 시도 (가장 정확)
    // HTML: <div class="document-title">\n                2023년 3월\n            </div>
    const titleMatch = html.match(/class="document-title"[^>]*>[\s\S]*?(\d{4})년\s*(\d{1,2})월/)
    if (titleMatch) {
      year = parseInt(titleMatch[1])
      month = parseInt(titleMatch[2])
      console.log(`[fetchIssueDetailsByUrl] document-title에서 추출: ${year}년 ${month}월`)
    }

    // 2단계: title 영역에서 추출 시도
    if (!year || !month) {
      const htmlTitleMatch = html.match(/<title[^>]*>.*?(\d{4})년\s*(\d{1,2})월/)
      if (htmlTitleMatch) {
        year = parseInt(htmlTitleMatch[1])
        month = parseInt(htmlTitleMatch[2])
        console.log(`[fetchIssueDetailsByUrl] <title>에서 추출: ${year}년 ${month}월`)
      }
    }

    // 3단계: 본문에서 다양한 패턴 시도
    if (!year || !month) {
      const datePatterns = [
        // 패턴 1: 2024년 1월호 (호 포함)
        /(\d{4})년\s*(\d{1,2})월호/,
        // 패턴 2: 2024년 1월 (호 없음, 본문 시작 부분에서만)
        />\s*(\d{4})년\s*(\d{1,2})월\s*</,
        // 패턴 3: 제목이나 본문에서 호수 직접 추출 (예: 제504호)
        /제?(\d{3,4})호/,
      ]

      for (const pattern of datePatterns) {
        const match = html.match(pattern)
        if (match) {
          // match[2]가 있으면 년/월 패턴, 없으면 호수 직접 추출 패턴
          if (match[2]) {
            year = parseInt(match[1])
            month = parseInt(match[2])
          } else if (match[1] && !match[2]) {
            // 호수 직접 추출 (예: 제504호)
            issueNumber = parseInt(match[1])
            // 호수에서 년월 역산 (433호 = 2020년 2월 기준)
            const monthsFromBase = issueNumber - 433
            year = 2020 + Math.floor((monthsFromBase + 1) / 12)
            month = ((monthsFromBase + 1) % 12) + 1
          }
          if (year && month) break
        }
      }
    }

    if (!year || !month) {
      console.log(`[fetchIssueDetailsByUrl] 날짜 패턴 매칭 실패`)
      // 디버깅: 제목 영역 출력
      const titleMatch = html.match(/<title[^>]*>([^<]+)/i) || html.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)/i)
      console.log(`[fetchIssueDetailsByUrl] 페이지 제목: ${titleMatch?.[1]?.substring(0, 100)}...`)
      return null
    }

    // 호수 계산 (2020년 2월 = 433호 기준)
    if (!issueNumber) {
      const baseIssue = 433
      const baseYear = 2020
      const baseMonth = 2
      const monthsDiff = (year - baseYear) * 12 + (month - baseMonth)
      issueNumber = baseIssue + monthsDiff
    }

    // 이미지 URL 추출 (다양한 패턴)
    const imageUrls: string[] = []
    const imgPatterns = [
      // Dimode CDN (공백 허용)
      /src="(https:\/\/data\.dimode\.co\.kr[^"\s]+\.(?:jpg|jpeg|png|gif))\s*"/gi,
      // 일반 이미지 (절대 경로, 공백 허용)
      /src="(https?:\/\/[^"\s]+\.(?:jpg|jpeg|png|gif))\s*"/gi,
    ]

    for (const imgPattern of imgPatterns) {
      let imgMatch
      while ((imgMatch = imgPattern.exec(html)) !== null) {
        const imgUrl = imgMatch[1].trim()
        // 로고, 아이콘 등 제외 (본문 이미지만)
        if (!imageUrls.includes(imgUrl) &&
            !imgUrl.includes('/Layouts/') &&
            !imgUrl.includes('/Images/') &&
            imgUrl.includes('/files/')) {
          imageUrls.push(imgUrl)
        }
      }
      if (imageUrls.length > 0) break
    }

    return {
      boardId,
      issueNumber,
      issueDate: `${year}년 ${month}월호`,
      year,
      month,
      imageUrls
    }
  } catch (error) {
    console.error(`[fetchIssueDetailsByUrl] 조회 실패:`, error)
    return null
  }
}

/**
 * 특정 게시물의 상세 정보 가져오기 (레거시 호환)
 */
async function fetchIssueDetails(
  detailId: number,
  baseUrl: string = DEFAULT_BASE_URL,
  boardId: number = DEFAULT_BOARD_ID
): Promise<IssueInfo | null> {
  const origin = extractOrigin(baseUrl)
  const url = `${origin}/Board/Detail/${boardId}/${detailId}`
  return fetchIssueDetailsByUrl(url)
}

/**
 * 이미지 다운로드
 */
async function downloadImage(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl)
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * 단일 호수 처리
 * @param useVLM - VLM 직접 구조화 추출 사용 여부 (기본값: true, 더 정확한 한국어 인식)
 */
async function processIssue(
  issueInfo: IssueInfo,
  onProgress?: (message: string) => void,
  useVLM: boolean = true  // 기본값을 VLM으로 변경
): Promise<{ success: boolean; articles: number; chunks: number; provider?: string; corrections?: string[]; error?: string }> {
  let totalArticles = 0
  let totalChunks = 0
  let provider = 'OCR'
  const allCorrections: string[] = []

  try {
    // 이미 처리된 호수인지 확인
    if (await isIssueProcessed(issueInfo.issueNumber)) {
      onProgress?.(`${issueInfo.issueDate}: 이미 처리됨, 스킵`)
      return { success: true, articles: 0, chunks: 0 }
    }

    onProgress?.(`${issueInfo.issueDate} 처리 시작... (${useVLM ? 'VLM 직접 추출' : '기존 OCR'})`)

    // 이슈 저장
    const issueId = await saveNewsIssue({
      issue_number: issueInfo.issueNumber,
      issue_date: issueInfo.issueDate,
      year: issueInfo.year,
      month: issueInfo.month,
      board_id: issueInfo.boardId,
      page_count: issueInfo.imageUrls.length,
      source_type: 'url',
      status: 'processing'
    })

    // 각 페이지 처리
    for (let i = 0; i < issueInfo.imageUrls.length; i++) {
      const pageNumber = i + 1
      onProgress?.(`페이지 ${pageNumber}/${issueInfo.imageUrls.length} 처리 중...`)

      try {
        // 이미지 다운로드
        const imageBuffer = await downloadImage(issueInfo.imageUrls[i])

        // VLM 또는 기존 OCR 선택
        if (useVLM) {
          const result = await processImageWithVLM(
            imageBuffer,
            issueId,
            issueInfo.issueNumber,
            issueInfo.issueDate,
            pageNumber,
            'image/jpeg',
            onProgress
          )
          totalArticles += result.articles
          totalChunks += result.chunks
          provider = result.provider
          allCorrections.push(...result.corrections)
        } else {
          const result = await processImageToArticles(
            imageBuffer,
            issueId,
            issueInfo.issueNumber,
            issueInfo.issueDate,
            pageNumber,
            'image/jpeg',
            onProgress
          )
          totalArticles += result.articles
          totalChunks += result.chunks
        }
      } catch (pageError: any) {
        console.error(`페이지 ${pageNumber} 처리 실패:`, pageError)
      }
    }

    // 상태 업데이트
    await updateIssueStatus(issueId, 'completed')

    // 🔄 각 호수 처리 완료 후 벡터 인덱스 동기화
    // 이렇게 하면 처리 중에도 챗봇에서 검색 가능
    await syncVectorIndex()

    const correctionSummary = allCorrections.length > 0 ? ` (교정: ${allCorrections.length}건)` : ''
    onProgress?.(`${issueInfo.issueDate} 완료: ${totalArticles}개 기사, ${totalChunks}개 청크${correctionSummary} (벡터 인덱스 동기화됨)`)

    return { success: true, articles: totalArticles, chunks: totalChunks, provider, corrections: allCorrections }
  } catch (error: any) {
    console.error(`${issueInfo.issueDate} 처리 실패:`, error)
    return { success: false, articles: totalArticles, chunks: totalChunks, error: error.message }
  }
}

// Task lock 획득 헬퍼 (직접 API 호출 - self-fetch 제거)
async function acquireTaskLock(description: string): Promise<{ success: boolean; message?: string }> {
  try {
    const { POST: taskLockPost } = await import('@/app/api/admin/task-lock/route')
    const fakeReq = new Request('http://localhost/api/admin/task-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskType: 'news', description })
    }) as unknown as NextRequest
    const response = await taskLockPost(fakeReq)
    const data = await response.json()

    if (response.status === 409) {
      return { success: false, message: data.message || '다른 작업이 진행 중입니다.' }
    }
    return { success: data.success !== false }
  } catch (error) {
    console.warn('Task lock 획득 실패 (계속 진행):', error)
    return { success: true }
  }
}

// Task lock 해제 헬퍼 (직접 API 호출 - self-fetch 제거)
async function releaseTaskLock(): Promise<void> {
  try {
    const { DELETE: taskLockDelete } = await import('@/app/api/admin/task-lock/route')
    const fakeReq = new Request('http://localhost/api/admin/task-lock?taskType=news', {
      method: 'DELETE'
    }) as unknown as NextRequest
    await taskLockDelete(fakeReq)
  } catch (error) {
    console.warn('Task lock 해제 실패:', error)
  }
}

/**
 * 벡터 인덱스 동기화 (IVFFLAT 인덱스 갱신)
 * - 뉴스 1호 처리 완료 후 호출
 * - 검색 품질 유지를 위한 인덱스 갱신
 */
async function syncVectorIndex(): Promise<void> {
  try {
    // news_chunks 테이블의 벡터 인덱스 갱신
    const { error } = await getSupabase().rpc('refresh_news_vector_index')
    if (error) {
      // RPC가 없으면 기본 동작 (INSERT 후 자동 인덱싱)
      console.log('[news/process] refresh_news_vector_index RPC 없음, 기본 동기화 사용')
    } else {
      console.log('[news/process] 벡터 인덱스 동기화 완료')
    }
  } catch (error) {
    console.warn('[news/process] 벡터 인덱스 동기화 실패 (계속 진행):', error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    // maxIssues 기본값 0 = 제한 없음 (모든 미처리 호수 처리)
    // useVLM 기본값 true = VLM 직접 구조화 추출 사용 (더 정확한 한국어 인식)
    const { action, config, issueNumber, maxIssues = 0, useVLM = true } = body

    // ============ 스캔: 전체 호수 목록 수집 ============
    if (action === 'scan') {
      const urlConfig: UrlConfig = {
        // 새로운 유연한 방식
        listPageUrl: config?.listPageUrl,
        startUrl: config?.startUrl,
        endUrl: config?.endUrl,
        // 레거시 호환
        baseUrl: config?.baseUrl,
        boardId: config?.boardId,
        maxPages: config?.maxPages || 10
      }

      console.log('전체 호수 스캔 시작...', {
        listPageUrl: urlConfig.listPageUrl,
        startUrl: urlConfig.startUrl,
        endUrl: urlConfig.endUrl
      })
      const issues = await scanAllIssues(urlConfig)

      // 처리 상태 확인
      const issuesWithStatus = await Promise.all(
        issues.map(async (issue) => {
          const isProcessed = await isIssueProcessed(issue.issueNumber)
          return {
            ...issue,
            status: isProcessed ? 'completed' : 'pending',
            pageCount: issue.imageUrls.length
          }
        })
      )

      const pendingCount = issuesWithStatus.filter(i => i.status === 'pending').length
      const completedCount = issuesWithStatus.filter(i => i.status === 'completed').length

      return NextResponse.json({
        success: true,
        action: 'scan',
        total: issues.length,
        pending: pendingCount,
        completed: completedCount,
        issues: issuesWithStatus // 전체 반환
      })
    }

    // ============ 단일 호수 처리 ============
    if (action === 'process' && issueNumber) {
      // Task lock 획득
      const lockResult = await acquireTaskLock(`뉴스 ${issueNumber}호 처리`)
      if (!lockResult.success) {
        return NextResponse.json({
          error: lockResult.message,
          locked: true
        }, { status: 409 })
      }

      try {
        // DB에서 호수 정보 가져오기 또는 새로 스캔
        const { data: existingIssue } = await getSupabase()
          .from('news_issues')
          .select('*')
          .eq('issue_number', issueNumber)
          .single()

        let issueInfo: IssueInfo

        if (existingIssue) {
          // 기존 정보로 이미지 URL 다시 가져오기
          const details = await fetchIssueDetails(existingIssue.board_id)
          if (!details) {
            await releaseTaskLock()
            return NextResponse.json({ error: '호수 정보를 가져올 수 없습니다.' }, { status: 404 })
          }
          issueInfo = details
        } else {
          await releaseTaskLock()
          return NextResponse.json({ error: '호수를 찾을 수 없습니다. 먼저 스캔을 실행하세요.' }, { status: 404 })
        }

        const result = await processIssue(issueInfo, undefined, useVLM)
        await releaseTaskLock()

        return NextResponse.json({
          success: result.success,
          action: 'process',
          issueNumber,
          issueDate: issueInfo.issueDate,
          articles: result.articles,
          chunks: result.chunks,
          provider: result.provider,
          corrections: result.corrections,
          error: result.error
        })
      } catch (error) {
        await releaseTaskLock()
        throw error
      }
    }

    // ============ 증분 처리: 미처리 호수만 처리 ============
    if (action === 'process_incremental') {
      console.log('증분 처리 시작...')

      // 스캔 (새로운 유연한 방식 + 레거시 호환) - 스캔은 락 없이 수행
      const issues = await scanAllIssues({
        listPageUrl: config?.listPageUrl,
        startUrl: config?.startUrl,
        endUrl: config?.endUrl,
        baseUrl: config?.baseUrl,
        boardId: config?.boardId,
        maxPages: config?.maxPages || 10
      })

      // 미처리 호수만 필터링
      // maxIssues가 지정되지 않거나 0이면 모든 미처리 호수를 처리
      const pendingIssues: IssueInfo[] = []
      for (const issue of issues) {
        if (!(await isIssueProcessed(issue.issueNumber))) {
          pendingIssues.push(issue)
          // maxIssues가 명시적으로 지정된 경우에만 제한 적용
          if (maxIssues && maxIssues > 0 && pendingIssues.length >= maxIssues) break
        }
      }
      console.log(`[news/process] ${pendingIssues.length}개 미처리 호수 발견`)

      if (pendingIssues.length === 0) {
        return NextResponse.json({
          success: true,
          action: 'process_incremental',
          message: '처리할 새로운 호수가 없습니다.',
          processed: 0
        })
      }

      // Task lock 획득 (처리 시작 전)
      const lockResult = await acquireTaskLock(`뉴스 증분 처리 (${pendingIssues.length}건)`)
      if (!lockResult.success) {
        return NextResponse.json({
          error: lockResult.message,
          locked: true
        }, { status: 409 })
      }

      try {
        // 처리 (VLM 사용 여부 전달)
        const results = []
        for (const issue of pendingIssues) {
          const result = await processIssue(issue, undefined, useVLM)
          results.push({
            issueNumber: issue.issueNumber,
            issueDate: issue.issueDate,
            ...result
          })
        }

        const successCount = results.filter(r => r.success).length
        const totalArticles = results.reduce((sum, r) => sum + r.articles, 0)
        const totalChunks = results.reduce((sum, r) => sum + r.chunks, 0)
        const totalCorrections = results.reduce((sum, r) => sum + (r.corrections?.length || 0), 0)

        await releaseTaskLock()

        return NextResponse.json({
          success: true,
          action: 'process_incremental',
          processed: successCount,
          failed: results.length - successCount,
          totalArticles,
          totalChunks,
          totalCorrections,
          useVLM,
          results
        })
      } catch (error) {
        await releaseTaskLock()
        throw error
      }
    }

    // ============ 전체 처리 (주의: 시간이 오래 걸림) ============
    if (action === 'process_all') {
      return NextResponse.json({
        error: '전체 처리는 process_incremental을 여러 번 호출하세요.',
        suggestion: 'maxIssues 파라미터로 배치 크기 조절 가능'
      }, { status: 400 })
    }

    return NextResponse.json({ error: '알 수 없는 action입니다.' }, { status: 400 })

  } catch (error: any) {
    console.error('뉴스 처리 API 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// 상태 조회
export async function GET(req: NextRequest) {
  try {
    // 전체 통계
    const { count: totalIssues } = await getSupabase()
      .from('news_issues')
      .select('*', { count: 'exact', head: true })

    const { count: completedIssues } = await getSupabase()
      .from('news_issues')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')

    const { count: totalChunks } = await getSupabase()
      .from('news_chunks')
      .select('*', { count: 'exact', head: true })

    const { count: totalArticles } = await getSupabase()
      .from('news_articles')
      .select('*', { count: 'exact', head: true })

    // 최근 처리된 호수
    const { data: recentIssues } = await getSupabase()
      .from('news_issues')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(10)

    return NextResponse.json({
      success: true,
      stats: {
        totalIssues: totalIssues || 0,
        completedIssues: completedIssues || 0,
        pendingIssues: (totalIssues || 0) - (completedIssues || 0),
        totalArticles: totalArticles || 0,
        totalChunks: totalChunks || 0
      },
      recentIssues: recentIssues || []
    })

  } catch (error: any) {
    console.error('상태 조회 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
