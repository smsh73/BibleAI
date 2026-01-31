/**
 * 뉴스 처리 스트리밍 API (실시간 진행상황 표시)
 * POST /api/news/process-stream
 * - Server-Sent Events로 진행상황 스트리밍
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  performOCR,
  saveNewsIssue,
  saveNewsPage,
  saveNewsArticle,
  saveNewsChunk,
  updateIssueStatus,
  isIssueProcessed,
  splitArticles,
  extractMetadata,
  chunkText,
  createBatchEmbeddings,
  generateFileHash
} from '@/lib/news-extractor'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// 기본값
const DEFAULT_BASE_URL = 'https://www.anyangjeil.org'
const DEFAULT_BOARD_ID = 66

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

interface IssueInfo {
  boardId: number
  issueNumber: number
  issueDate: string
  year: number
  month: number
  imageUrls: string[]
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

  const patterns = [
    // Dimode CMS 패턴: /Board/Detail/숫자/숫자 (쿼리스트링 포함 가능)
    /href="(\/Board\/Detail\/\d+\/\d+[^"]*)"/g,
    /href="(\/(?:view|detail|read|article|post|news)\/\d+[^"]*)"/gi,
    /href="([^"]*\?(?:id|no|seq|idx|num)=\d+[^"]*)"/gi,
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
      return { pattern, links }
    }
    pattern.lastIndex = 0
  }

  return { pattern: /(?!)/, links: [] }
}

/**
 * URL로 상세 페이지 정보 가져오기 (유연한 방식)
 */
async function fetchIssueDetailsByUrl(detailUrl: string): Promise<IssueInfo | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(detailUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    clearTimeout(timeoutId)

    if (!response.ok) return null

    const html = await response.text()

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
    }

    // 2단계: title 영역에서 추출 시도
    if (!year || !month) {
      const htmlTitleMatch = html.match(/<title[^>]*>.*?(\d{4})년\s*(\d{1,2})월/)
      if (htmlTitleMatch) {
        year = parseInt(htmlTitleMatch[1])
        month = parseInt(htmlTitleMatch[2])
      }
    }

    // 3단계: 본문에서 다양한 패턴 시도
    if (!year || !month) {
      const datePatterns = [
        /(\d{4})년\s*(\d{1,2})월호/,
        />\s*(\d{4})년\s*(\d{1,2})월\s*</,
        /제?(\d{3,4})호/,
      ]

      for (const pattern of datePatterns) {
        const match = html.match(pattern)
        if (match) {
          if (match[2]) {
            year = parseInt(match[1])
            month = parseInt(match[2])
          } else if (match[1] && !match[2]) {
            issueNumber = parseInt(match[1])
            const monthsFromBase = issueNumber - 433
            year = 2020 + Math.floor((monthsFromBase + 1) / 12)
            month = ((monthsFromBase + 1) % 12) + 1
          }
          if (year && month) break
        }
      }
    }

    if (!year || !month) return null

    if (!issueNumber) {
      const baseIssue = 433
      const baseYear = 2020
      const baseMonth = 2
      const monthsDiff = (year - baseYear) * 12 + (month - baseMonth)
      issueNumber = baseIssue + monthsDiff
    }

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
 * 전체 호수 스캔 (유연한 방식)
 */
async function scanAllIssues(config: UrlConfig, send: (data: any) => void): Promise<IssueInfo[]> {
  const issues: IssueInfo[] = []
  const { maxPages = 5 } = config

  let listPageUrl: string
  let origin: string

  if (config.listPageUrl) {
    listPageUrl = config.listPageUrl
    origin = extractOrigin(listPageUrl)
  } else {
    const baseUrl = config.baseUrl || DEFAULT_BASE_URL
    const boardId = config.boardId || DEFAULT_BOARD_ID
    origin = extractOrigin(baseUrl)
    listPageUrl = `${origin}/Board/Index/${boardId}`
  }

  // 범위 설정: 시작/끝 URL에서 호수 번호 추출
  let startIssueNumber: number | undefined
  let endIssueNumber: number | undefined

  if (config.startUrl) {
    const startInfo = await fetchIssueDetailsByUrl(config.startUrl)
    if (startInfo) startIssueNumber = startInfo.issueNumber
  }

  if (config.endUrl) {
    const endInfo = await fetchIssueDetailsByUrl(config.endUrl)
    if (endInfo) endIssueNumber = endInfo.issueNumber
  }

  // 범위 정렬 (startIssueNumber가 더 큰 값이어야 함 - 최신 호수)
  if (startIssueNumber && endIssueNumber && startIssueNumber < endIssueNumber) {
    [startIssueNumber, endIssueNumber] = [endIssueNumber, startIssueNumber]
  }

  for (let page = 1; page <= maxPages; page++) {
    const url = buildPaginatedUrl(listPageUrl, page)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      clearTimeout(timeoutId)

      if (!response.ok) break

      const html = await response.text()
      const { links } = detectDetailLinks(html, origin)

      if (links.length === 0) break

      for (const link of links) {
        const detailUrl = link.startsWith('http') ? link : `${origin}${link}`
        const issueInfo = await fetchIssueDetailsByUrl(detailUrl)
        if (issueInfo) {
          // 범위 체크
          const inRange = (
            (!startIssueNumber || issueInfo.issueNumber <= startIssueNumber) &&
            (!endIssueNumber || issueInfo.issueNumber >= endIssueNumber)
          )

          if (!inRange) {
            // 범위를 벗어났고 끝 호수보다 작으면 더 이상 스캔 불필요
            if (endIssueNumber && issueInfo.issueNumber < endIssueNumber) {
              return issues.sort((a, b) => b.issueNumber - a.issueNumber)
            }
            continue
          }

          if (!issues.find(i => i.issueNumber === issueInfo.issueNumber)) {
            issues.push(issueInfo)
          }
        }
      }
    } catch (error: any) {
      break
    }
  }

  return issues.sort((a, b) => b.issueNumber - a.issueNumber)
}

/**
 * 이미지 다운로드
 */
async function downloadImage(imageUrl: string): Promise<Buffer> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  const response = await fetch(imageUrl, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })
  clearTimeout(timeoutId)

  return Buffer.from(await response.arrayBuffer())
}

export async function POST(req: NextRequest) {
  const { action, issueNumber, maxIssues = 3, config = {} } = await req.json()

  // URL 설정 추출 (유연한 방식 + 레거시 호환)
  const urlConfig: UrlConfig = {
    listPageUrl: config.listPageUrl,
    startUrl: config.startUrl,
    endUrl: config.endUrl,
    baseUrl: config.baseUrl || DEFAULT_BASE_URL,
    boardId: config.boardId || DEFAULT_BOARD_ID,
    maxPages: config.maxPages || 5
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        if (action === 'process_incremental') {
          send({ type: 'start', message: '증분 처리 시작...' })

          // 스캔 (유연한 방식)
          send({ type: 'progress', step: 'scan', message: '호수 목록 스캔 중...', percent: 5 })

          const issues = await scanAllIssues(urlConfig, send)

          send({ type: 'progress', step: 'scan', message: `${issues.length}개 호수 발견`, percent: 10 })

          // 미처리 호수 필터링
          const pendingIssues: any[] = []
          for (const issue of issues) {
            if (!(await isIssueProcessed(issue.issueNumber))) {
              pendingIssues.push(issue)
              if (pendingIssues.length >= maxIssues) break
            }
          }

          if (pendingIssues.length === 0) {
            send({ type: 'complete', message: '처리할 새로운 호수가 없습니다.', results: [] })
            controller.close()
            return
          }

          send({ type: 'progress', step: 'filter', message: `${pendingIssues.length}개 미처리 호수 선택`, percent: 15 })

          // 각 호수 처리
          const results: any[] = []
          for (let i = 0; i < pendingIssues.length; i++) {
            const issue = pendingIssues[i]
            const basePercent = 15 + (i / pendingIssues.length) * 80

            send({
              type: 'progress',
              step: 'issue_start',
              message: `${issue.issueDate} 처리 시작 (${i + 1}/${pendingIssues.length})`,
              percent: basePercent,
              issueDate: issue.issueDate
            })

            try {
              // 이슈 저장
              const issueId = await saveNewsIssue({
                issue_number: issue.issueNumber,
                issue_date: issue.issueDate,
                year: issue.year,
                month: issue.month,
                board_id: issue.boardId,
                page_count: issue.imageUrls.length,
                source_type: 'url',
                status: 'processing'
              })

              let totalArticles = 0
              let totalChunks = 0

              // 각 페이지 처리
              for (let p = 0; p < issue.imageUrls.length; p++) {
                const pageNumber = p + 1
                const pagePercent = basePercent + ((p / issue.imageUrls.length) * (80 / pendingIssues.length))

                send({
                  type: 'progress',
                  step: 'page',
                  message: `${issue.issueDate} - ${pageNumber}/${issue.imageUrls.length}면 이미지 다운로드`,
                  percent: pagePercent,
                  detail: '이미지 다운로드 중...'
                })

                // 이미지 다운로드
                const imageBuffer = await downloadImage(issue.imageUrls[p])

                send({
                  type: 'progress',
                  step: 'ocr',
                  message: `${issue.issueDate} - ${pageNumber}면 OCR 처리`,
                  percent: pagePercent + 2,
                  detail: 'OpenAI/Gemini/Claude OCR 진행 중...'
                })

                // OCR
                const { text: ocrText, provider } = await performOCR(imageBuffer)

                send({
                  type: 'progress',
                  step: 'ocr_done',
                  message: `${issue.issueDate} - ${pageNumber}면 OCR 완료 (${provider})`,
                  percent: pagePercent + 5,
                  detail: `${ocrText.length}자 추출`
                })

                // 페이지 저장
                const pageId = await saveNewsPage({
                  issue_id: issueId,
                  page_number: pageNumber,
                  image_url: issue.imageUrls[p],
                  file_hash: generateFileHash(imageBuffer),
                  ocr_text: ocrText,
                  ocr_provider: provider,
                  status: 'completed'
                })

                // 기사 분리
                const articles = splitArticles(ocrText)

                send({
                  type: 'progress',
                  step: 'articles',
                  message: `${issue.issueDate} - ${pageNumber}면 기사 추출`,
                  percent: pagePercent + 7,
                  detail: `${articles.length}개 기사 발견`
                })

                // 각 기사 처리
                for (let a = 0; a < articles.length; a++) {
                  const articleText = articles[a]

                  send({
                    type: 'progress',
                    step: 'metadata',
                    message: `${issue.issueDate} - ${pageNumber}면 기사 ${a + 1}/${articles.length}`,
                    percent: pagePercent + 8,
                    detail: '메타데이터 추출 중...'
                  })

                  // 메타데이터 추출
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
                  totalArticles++

                  // 청킹
                  const chunks = chunkText(metadata.content)

                  // 청크가 있을 때만 임베딩 처리
                  if (chunks.length > 0) {
                    send({
                      type: 'progress',
                      step: 'embedding',
                      message: `${issue.issueDate} - 기사 "${metadata.title?.substring(0, 20)}..." 임베딩`,
                      percent: pagePercent + 9,
                      detail: `${chunks.length}개 청크 벡터화 중...`
                    })

                    // 배치 임베딩
                    const embeddings = await createBatchEmbeddings(chunks)

                    // 청크 저장 (임베딩 수와 청크 수가 일치할 때만)
                    const saveCount = Math.min(chunks.length, embeddings.length)
                    for (let c = 0; c < saveCount; c++) {
                      await saveNewsChunk({
                        article_id: articleId,
                        issue_id: issueId,
                        chunk_index: c,
                        chunk_text: chunks[c],
                        issue_number: issue.issueNumber,
                        issue_date: issue.issueDate,
                        page_number: pageNumber,
                        article_title: metadata.title,
                        article_type: metadata.article_type,
                        embedding: embeddings[c]
                      })
                      totalChunks++
                    }
                  }
                }
              }

              // 상태 업데이트
              await updateIssueStatus(issueId, 'completed')

              results.push({
                issueNumber: issue.issueNumber,
                issueDate: issue.issueDate,
                success: true,
                articles: totalArticles,
                chunks: totalChunks
              })

              send({
                type: 'progress',
                step: 'issue_done',
                message: `${issue.issueDate} 완료`,
                percent: basePercent + (80 / pendingIssues.length),
                detail: `${totalArticles}개 기사, ${totalChunks}개 청크`,
                issueDate: issue.issueDate
              })

            } catch (error: any) {
              // 상세 오류 로깅
              console.error(`[process-stream] ${issue.issueDate} 처리 오류:`, error)
              console.error(`[process-stream] 오류 스택:`, error.stack)

              results.push({
                issueNumber: issue.issueNumber,
                issueDate: issue.issueDate,
                success: false,
                error: error.message
              })

              send({
                type: 'error',
                message: `${issue.issueDate} 처리 실패: ${error.message}`,
                detail: error.stack?.split('\n')[1]?.trim() || ''
              })
            }
          }

          // 완료
          send({
            type: 'complete',
            message: '모든 처리 완료',
            percent: 100,
            results
          })
        }

        controller.close()
      } catch (error: any) {
        send({ type: 'error', message: error.message })
        controller.close()
      }
    }
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}
