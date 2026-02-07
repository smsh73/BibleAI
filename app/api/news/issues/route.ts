/**
 * 열한시 신문 호수 목록 API
 * GET /api/news/issues - 벡터 임베딩 완료된 호수 목록 조회
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') // 'completed', 'pending', 또는 null(전체)

    // 호수 목록 조회 (기사 수 포함)
    let query = supabase
      .from('news_issues')
      .select(`
        id,
        issue_number,
        issue_date,
        year,
        month,
        page_count,
        status,
        created_at,
        updated_at
      `)
      .order('issue_number', { ascending: false })

    // status 파라미터가 있으면 필터링
    if (status) {
      query = query.eq('status', status)
    }

    const { data: issues, error } = await query

    if (error) {
      console.error('호수 목록 조회 오류:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 각 호수별 기사/청크 수 조회
    const issuesWithStats = await Promise.all(
      (issues || []).map(async (issue) => {
        // 기사 수
        const { count: articleCount } = await supabase
          .from('news_articles')
          .select('*', { count: 'exact', head: true })
          .eq('issue_id', issue.id)

        // 청크 수
        const { count: chunkCount } = await supabase
          .from('news_chunks')
          .select('*', { count: 'exact', head: true })
          .eq('issue_id', issue.id)

        return {
          ...issue,
          articleCount: articleCount || 0,
          chunkCount: chunkCount || 0
        }
      })
    )

    // 전체 통계
    const { count: totalArticles } = await supabase
      .from('news_articles')
      .select('*', { count: 'exact', head: true })

    const { count: totalChunks } = await supabase
      .from('news_chunks')
      .select('*', { count: 'exact', head: true })

    return NextResponse.json({
      success: true,
      issues: issuesWithStats,
      totalIssues: issuesWithStats.length,
      totalArticles: totalArticles || 0,
      totalChunks: totalChunks || 0
    })
  } catch (error: any) {
    console.error('호수 목록 API 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
