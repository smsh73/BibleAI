/**
 * 설교 데이터 리셋 API
 * POST /api/admin/sermon-reset
 *
 * 기능:
 * - sermon_chunks 테이블 전체 삭제
 * - sermons 테이블 전체 삭제
 * - 스키마 재생성 (선택적)
 */

import { NextRequest, NextResponse } from 'next/server'
import { resetAllSermonData, getSupabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { createSchema = false } = await req.json().catch(() => ({}))

    // 1. 기존 데이터 삭제
    console.log('[sermon-reset] 설교 데이터 리셋 시작...')
    const resetResult = await resetAllSermonData()

    if (!resetResult.success) {
      return NextResponse.json(
        { error: resetResult.error || '데이터 리셋 실패' },
        { status: 500 }
      )
    }

    console.log(`[sermon-reset] 삭제 완료: ${resetResult.deletedChunks} chunks, ${resetResult.deletedSermons} sermons`)

    // 2. 스키마 생성 (선택적)
    let schemaCreated = false
    if (createSchema) {
      const client = getSupabaseAdmin()
      if (client) {
        try {
          // sermons 테이블 생성
          const { error: createError } = await client.rpc('exec_sql', {
            sql: `
              CREATE TABLE IF NOT EXISTS sermons (
                id SERIAL PRIMARY KEY,
                video_id VARCHAR(50) UNIQUE NOT NULL,
                video_url TEXT NOT NULL,
                video_title TEXT NOT NULL,
                sermon_start_time NUMERIC,
                sermon_end_time NUMERIC,
                sermon_duration NUMERIC,
                full_transcript TEXT,
                speaker TEXT,
                upload_date DATE,
                channel_name TEXT,
                description TEXT,
                tags TEXT[],
                bible_references TEXT[],
                chunk_count INTEGER DEFAULT 0,
                processing_status VARCHAR(20) DEFAULT 'pending',
                error_message TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
              );
            `
          })

          if (createError) {
            console.warn('[sermon-reset] 스키마 생성 실패:', createError.message)
          } else {
            schemaCreated = true
          }
        } catch (e: any) {
          console.warn('[sermon-reset] 스키마 생성 건너뜀:', e.message)
        }
      }
    }

    // 3. video_url 컬럼 추가 (sermon_chunks)
    const client = getSupabaseAdmin()
    if (client) {
      try {
        await client.rpc('exec_sql', {
          sql: 'ALTER TABLE sermon_chunks ADD COLUMN IF NOT EXISTS video_url TEXT;'
        })
        console.log('[sermon-reset] video_url 컬럼 추가 완료')
      } catch (e: any) {
        // 직접 쿼리로 시도
        console.warn('[sermon-reset] RPC 실패, 직접 확인...')
      }
    }

    return NextResponse.json({
      success: true,
      message: '설교 데이터가 완전히 리셋되었습니다.',
      deletedChunks: resetResult.deletedChunks,
      deletedSermons: resetResult.deletedSermons,
      schemaCreated
    })

  } catch (error: any) {
    console.error('[sermon-reset] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to reset sermon data' },
      { status: 500 }
    )
  }
}

/**
 * GET: 현재 설교 데이터 상태 조회
 */
export async function GET() {
  try {
    const client = getSupabaseAdmin()
    if (!client) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
    }

    // sermon_chunks 카운트
    const { count: chunksCount, error: chunksError } = await client
      .from('sermon_chunks')
      .select('*', { count: 'exact', head: true })

    // 고유 video_id 카운트
    const { data: videoIds } = await client
      .from('sermon_chunks')
      .select('video_id')

    const uniqueVideos = new Set(videoIds?.map(v => v.video_id) || [])

    // sermons 테이블 카운트 (존재하는 경우)
    let sermonsCount = 0
    try {
      const { count } = await client
        .from('sermons')
        .select('*', { count: 'exact', head: true })
      sermonsCount = count || 0
    } catch (e) {
      // 테이블이 없을 수 있음
    }

    return NextResponse.json({
      chunksCount: chunksCount || 0,
      uniqueVideosInChunks: uniqueVideos.size,
      sermonsCount,
      videoIds: Array.from(uniqueVideos)
    })

  } catch (error: any) {
    console.error('[sermon-reset] GET Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get sermon data status' },
      { status: 500 }
    )
  }
}
