/**
 * 뉴스 검색 API
 * POST /api/news/search
 * - 임베딩: OpenAI > Gemini > Claude(해시) fallback
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createEmbedding } from '@/lib/news-extractor'

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

export async function POST(req: NextRequest) {
  try {
    const { query, year, articleType, limit = 10 } = await req.json()

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: '검색어를 입력해주세요.' }, { status: 400 })
    }

    // 쿼리 임베딩 생성
    const queryEmbedding = await createEmbedding(query)

    // 하이브리드 검색 실행
    const { data, error } = await getSupabase().rpc('hybrid_search_news', {
      query_embedding: queryEmbedding,
      query_text: query,
      match_threshold: 0.4,
      match_count: limit,
      year_filter: year || null,
      article_type_filter: articleType || null
    })

    if (error) {
      console.error('뉴스 검색 오류:', error)
      return NextResponse.json({ error: '검색 중 오류가 발생했습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      query,
      results: data || [],
      count: data?.length || 0
    })

  } catch (error: any) {
    console.error('뉴스 검색 API 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// 통계 조회
export async function GET(req: NextRequest) {
  try {
    // 전체 이슈 수
    const { count: issueCount } = await getSupabase()
      .from('news_issues')
      .select('*', { count: 'exact', head: true })

    // 전체 청크 수
    const { count: chunkCount } = await getSupabase()
      .from('news_chunks')
      .select('*', { count: 'exact', head: true })

    // 연도별 통계
    const { data: yearStats } = await getSupabase()
      .from('news_issues')
      .select('year')
      .order('year', { ascending: false })

    const years = [...new Set(yearStats?.map(s => s.year) || [])]

    return NextResponse.json({
      success: true,
      stats: {
        totalIssues: issueCount || 0,
        totalChunks: chunkCount || 0,
        years
      }
    })

  } catch (error: any) {
    console.error('뉴스 통계 조회 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
