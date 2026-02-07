/**
 * 주보 목록 API
 * GET /api/bulletin/issues
 */

import { NextRequest, NextResponse } from 'next/server'
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    let query = getSupabase()
      .from('bulletin_issues')
      .select('*')
      .order('bulletin_date', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data: issues, error } = await query

    if (error) throw error

    // 각 주보별 청크 수 조회
    const issuesWithCounts = await Promise.all(
      (issues || []).map(async (issue) => {
        const { count } = await getSupabase()
          .from('bulletin_chunks')
          .select('*', { count: 'exact', head: true })
          .eq('issue_id', issue.id)

        return {
          ...issue,
          chunkCount: count || 0
        }
      })
    )

    return NextResponse.json({
      success: true,
      issues: issuesWithCounts
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
