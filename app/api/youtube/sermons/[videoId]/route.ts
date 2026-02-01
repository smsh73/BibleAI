/**
 * 설교 상세 조회 API
 * GET /api/youtube/sermons/[videoId] - 특정 설교의 전체 텍스트 조회
 *
 * 응답:
 * - sermon: 설교 메타데이터
 * - fullText: 전체 청크를 연결한 텍스트
 * - chunks: 개별 청크 배열 (시간 정보 포함)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  try {
    const { videoId } = await params

    if (!videoId) {
      return NextResponse.json({ error: 'videoId가 필요합니다.' }, { status: 400 })
    }

    // 1. 설교 메타데이터 조회
    const { data: sermon, error: sermonError } = await supabase
      .from('sermons')
      .select('*')
      .eq('video_id', videoId)
      .single()

    if (sermonError && sermonError.code !== 'PGRST116') {
      console.error('설교 조회 오류:', sermonError)
      return NextResponse.json({ error: sermonError.message }, { status: 500 })
    }

    // 2. 청크 조회 (chunk_index 순서대로)
    const { data: chunks, error: chunksError } = await supabase
      .from('sermon_chunks')
      .select('chunk_index, content, start_time, end_time')
      .eq('video_id', videoId)
      .order('chunk_index', { ascending: true })

    if (chunksError) {
      console.error('청크 조회 오류:', chunksError)
      return NextResponse.json({ error: chunksError.message }, { status: 500 })
    }

    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        error: '해당 설교를 찾을 수 없습니다.',
        videoId
      }, { status: 404 })
    }

    // 3. 전체 텍스트 생성 (청크 연결)
    // full_transcript가 있으면 사용, 없으면 청크 연결
    let fullText = sermon?.full_transcript

    if (!fullText) {
      fullText = chunks.map(c => c.content).join('\n\n')
    }

    // 4. 시간 포맷팅 헬퍼
    const formatTime = (seconds: number | null): string => {
      if (seconds === null || seconds === undefined) return ''
      const mins = Math.floor(seconds / 60)
      const secs = Math.floor(seconds % 60)
      return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    return NextResponse.json({
      success: true,
      sermon: sermon ? {
        videoId: sermon.video_id,
        videoTitle: sermon.video_title,
        videoUrl: sermon.video_url,
        speaker: sermon.speaker,
        uploadDate: sermon.upload_date,
        channelName: sermon.channel_name,
        sermonDuration: sermon.sermon_duration,
        sermonStartTime: sermon.sermon_start_time,
        sermonEndTime: sermon.sermon_end_time,
        chunkCount: sermon.chunk_count,
        bibleReferences: sermon.bible_references,
        tags: sermon.tags,
        createdAt: sermon.created_at
      } : null,
      fullText,
      chunks: chunks.map(c => ({
        index: c.chunk_index,
        content: c.content,
        startTime: c.start_time,
        endTime: c.end_time,
        timeRange: c.start_time !== null
          ? `${formatTime(c.start_time)} - ${formatTime(c.end_time)}`
          : null
      })),
      totalChunks: chunks.length,
      textLength: fullText.length
    })
  } catch (error: any) {
    console.error('설교 상세 API 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
