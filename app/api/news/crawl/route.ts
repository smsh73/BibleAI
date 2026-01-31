/**
 * 뉴스 크롤링 API
 * POST /api/news/crawl - 특정 호수 또는 전체 크롤링 시작
 * GET /api/news/crawl - 크롤링 상태 조회
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BASE_URL = 'https://www.anyangjeil.org'
const BOARD_ID = 66

// 목록 페이지에서 호수 정보 수집
async function fetchIssuesFromPage(page: number): Promise<any[]> {
  const url = `${BASE_URL}/Board/Index/${BOARD_ID}?page=${page}`
  const response = await fetch(url)
  const html = await response.text()

  const issues: any[] = []

  // 게시물 링크와 제목 추출
  const documentRegex = /<div class="each-document">[\s\S]*?href="\/Board\/Detail\/66\/(\d+)[^"]*"[\s\S]*?<a class="title"[^>]*title="(\d{4})년\s*(\d{1,2})월호"/g

  let match
  while ((match = documentRegex.exec(html)) !== null) {
    const boardId = parseInt(match[1])
    const year = parseInt(match[2])
    const month = parseInt(match[3])

    // 호수 계산 (2020년 2월 = 433호 기준)
    const baseIssue = 433
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

  return issues
}

// 특정 호수의 이미지 URL 추출
async function fetchIssueImages(boardId: number): Promise<string[]> {
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

export async function POST(req: NextRequest) {
  try {
    const { action, issueNumber, maxIssues = 5 } = await req.json()

    if (action === 'scan') {
      // 전체 호수 스캔
      const allIssues: any[] = []

      for (let page = 1; page <= 5; page++) {
        const issues = await fetchIssuesFromPage(page)
        if (issues.length === 0) break
        allIssues.push(...issues)
      }

      // 중복 제거
      const uniqueIssues = allIssues.filter((issue, index, self) =>
        index === self.findIndex(i => i.issue_number === issue.issue_number)
      )

      // DB에 저장 (기존 것은 업데이트하지 않음)
      for (const issue of uniqueIssues) {
        const { data: existing } = await supabase
          .from('news_issues')
          .select('id')
          .eq('issue_number', issue.issue_number)
          .single()

        if (!existing) {
          await supabase.from('news_issues').insert(issue)
        }
      }

      return NextResponse.json({
        success: true,
        action: 'scan',
        totalFound: uniqueIssues.length,
        issues: uniqueIssues.slice(0, 10) // 처음 10개만 반환
      })
    }

    if (action === 'fetch_images') {
      // 특정 호수의 이미지 URL 가져오기
      const { data: issue } = await supabase
        .from('news_issues')
        .select('*')
        .eq('issue_number', issueNumber)
        .single()

      if (!issue) {
        return NextResponse.json({ error: '호수를 찾을 수 없습니다.' }, { status: 404 })
      }

      const imageUrls = await fetchIssueImages(issue.board_id)

      return NextResponse.json({
        success: true,
        issue_number: issueNumber,
        issue_date: issue.issue_date,
        images: imageUrls,
        count: imageUrls.length
      })
    }

    return NextResponse.json({ error: '알 수 없는 action입니다.' }, { status: 400 })

  } catch (error: any) {
    console.error('크롤링 API 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    // 전체 이슈 상태 조회
    const { data: issues, error } = await supabase
      .from('news_issues')
      .select('*')
      .order('issue_number', { ascending: false })
      .limit(20)

    if (error) throw error

    // 상태별 카운트
    const { data: statusCounts } = await supabase
      .from('news_issues')
      .select('status')

    const counts = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: statusCounts?.length || 0
    }

    statusCounts?.forEach(s => {
      counts[s.status as keyof typeof counts]++
    })

    return NextResponse.json({
      success: true,
      counts,
      recentIssues: issues || []
    })

  } catch (error: any) {
    console.error('크롤링 상태 조회 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
