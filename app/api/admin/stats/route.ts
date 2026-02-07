/**
 * 관리자 통계 API
 * GET /api/admin/stats
 */

import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

export async function GET() {
  try {
    // 뉴스 통계
    const { count: newsIssues } = await getSupabase()
      .from('news_issues')
      .select('*', { count: 'exact', head: true })

    const { count: newsChunks } = await getSupabase()
      .from('news_chunks')
      .select('*', { count: 'exact', head: true })

    const { count: newsEmbedded } = await getSupabase()
      .from('news_chunks')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null)

    // 성경 통계
    const { count: bibleVerses } = await getSupabase()
      .from('bible_verses')
      .select('*', { count: 'exact', head: true })

    const { count: bibleEmbedded } = await getSupabase()
      .from('bible_verses')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null)

    // 설교 통계
    const { count: sermons } = await getSupabase()
      .from('sermons')
      .select('*', { count: 'exact', head: true })

    const { count: sermonChunks } = await getSupabase()
      .from('sermon_chunks')
      .select('*', { count: 'exact', head: true })

    // 주보 통계
    const { count: bulletinIssues } = await getSupabase()
      .from('bulletin_issues')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')

    const { count: bulletinChunks } = await getSupabase()
      .from('bulletin_chunks')
      .select('*', { count: 'exact', head: true })

    // 성경 구절 관계 통계
    const { count: verseRelations } = await getSupabase()
      .from('verse_relations')
      .select('*', { count: 'exact', head: true })

    const { count: verseThemes } = await getSupabase()
      .from('verse_themes')
      .select('*', { count: 'exact', head: true })

    // 관계 유형별 통계 (각 유형별로 count 쿼리 실행)
    const relationTypesList = [
      'prophecy_fulfillment',
      'parallel',
      'quotation',
      'thematic',
      'narrative',
      'theological',
      'semantic'
    ]

    const relationTypeCount: Record<string, number> = {}

    await Promise.all(relationTypesList.map(async (relationType) => {
      const { count } = await getSupabase()
        .from('verse_relations')
        .select('*', { count: 'exact', head: true })
        .eq('relation_type', relationType)

      if (count && count > 0) {
        relationTypeCount[relationType] = count
      }
    }))

    return NextResponse.json({
      success: true,
      stats: {
        newsIssues: newsIssues || 0,
        newsChunks: newsChunks || 0,
        newsEmbedded: newsEmbedded || 0,
        bibleVerses: bibleVerses || 0,
        bibleEmbedded: bibleEmbedded || 0,
        sermons: sermons || 0,
        sermonChunks: sermonChunks || 0,
        bulletinIssues: bulletinIssues || 0,
        bulletinChunks: bulletinChunks || 0,
        verseRelations: verseRelations || 0,
        verseThemes: verseThemes || 0,
        relationTypeCount
      }
    })
  } catch (error: any) {
    console.error('Stats error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
