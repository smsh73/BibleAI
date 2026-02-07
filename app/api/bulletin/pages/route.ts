/**
 * 주보 페이지 이미지 API
 * GET /api/bulletin/pages?issueId=123
 * - 특정 주보의 모든 페이지 이미지 URL 반환
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
    const issueId = searchParams.get('issueId')

    if (!issueId) {
      return NextResponse.json({ error: 'issueId가 필요합니다.' }, { status: 400 })
    }

    const { data: pages, error } = await getSupabase()
      .from('bulletin_pages')
      .select('id, page_number, image_url')
      .eq('issue_id', parseInt(issueId))
      .order('page_number', { ascending: true })

    if (error) throw error

    return NextResponse.json({
      success: true,
      pages: (pages || []).filter(p => p.image_url)
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
