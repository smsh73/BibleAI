/**
 * 설교 목록 API
 * GET /api/youtube/sermons - 벡터 임베딩 완료된 설교 목록 조회
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
    // 처리 완료된 설교 목록 조회
    const { data: sermons, error } = await getSupabase()
      .from('sermons')
      .select('video_id, video_title, video_url, speaker, upload_date, chunk_count, sermon_duration, created_at')
      .eq('processing_status', 'completed')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('설교 목록 조회 오류:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 전체 청크 수 집계
    const { count: totalChunks } = await getSupabase()
      .from('sermon_chunks')
      .select('*', { count: 'exact', head: true })

    return NextResponse.json({
      success: true,
      sermons: sermons || [],
      totalSermons: sermons?.length || 0,
      totalChunks: totalChunks || 0
    })
  } catch (error: any) {
    console.error('설교 목록 API 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
