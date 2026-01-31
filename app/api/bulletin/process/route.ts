/**
 * 주보 처리 API
 * GET: 처리 현황 조회
 * POST: 스캔 및 처리 시작
 * - 증분 스캔: DB 캐시 우선 사용, 신규만 웹 스캔
 * - Graceful stop: 현재 항목 완료 후 중지
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
    const { data } = await supabase
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

// OCR 수행
async function performOCR(imageUrl: string): Promise<string> {
  try {
    const base64Image = await downloadImageAsBase64(imageUrl)
    if (!base64Image) return ''

    const response = await openai.chat.completions.create({
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

// 텍스트를 청크로 분할
function splitIntoChunks(text: string, issueId: number, pageNumber: number, bulletinDate: string, bulletinTitle: string): any[] {
  const chunks: any[] = []
  const sections = text.split(/###\s*섹션\s*\d+/i).filter(s => s.trim())

  const dateObj = new Date(bulletinDate)
  const year = dateObj.getFullYear()
  const month = dateObj.getMonth() + 1

  sections.forEach((section, idx) => {
    const typeMatch = section.match(/유형:\s*(.+)/i)
    const titleMatch = section.match(/제목:\s*(.+)/i)
    const contentMatch = section.match(/내용:\s*([\s\S]+)/i)

    const sectionType = typeMatch ? typeMatch[1].trim() : '기타'
    const title = titleMatch ? titleMatch[1].trim() : `섹션 ${idx + 1}`
    const content = contentMatch ? contentMatch[1].trim() : section.trim()

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
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000),
    dimensions: 1536
  })
  return response.data[0].embedding
}

// GET: 처리 현황 조회
export async function GET() {
  try {
    const { data: issues } = await supabase
      .from('bulletin_issues')
      .select('id, status')

    const { data: chunks } = await supabase
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
    await supabase.rpc('refresh_bulletin_vector_index').catch(() => {
      // RPC가 없으면 직접 ANALYZE 실행 시도
      console.log('[bulletin/process] refresh_bulletin_vector_index RPC 없음, 기본 동기화 사용')
    })
    console.log('[bulletin/process] 벡터 인덱스 동기화 완료')
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
        await supabase.from('bulletin_issues').delete().in('status', ['pending', 'failed'])
      }

      // DB에 캐시된 주보 확인
      const { data: cachedIssues } = await supabase
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
        const { error } = await supabase
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
      const { data: allIssues } = await supabase
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
      let query = supabase
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

            for (let i = 0; i < imageUrls.length; i++) {
              const ocrText = await performOCR(imageUrls[i])

              if (ocrText) {
                const chunks = splitIntoChunks(
                  ocrText,
                  bulletin.id,
                  i + 1,
                  bulletin.bulletin_date,
                  bulletin.title
                )

                for (const chunk of chunks) {
                  try {
                    const embedding = await createEmbedding(chunk.content)
                    await supabase.from('bulletin_chunks').insert({
                      ...chunk,
                      embedding
                    })
                    totalChunks++
                  } catch (e) {
                    console.error('임베딩 오류')
                  }
                }
              }

              await new Promise(r => setTimeout(r, 2000))
            }

            // 상태 업데이트
            await supabase
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
