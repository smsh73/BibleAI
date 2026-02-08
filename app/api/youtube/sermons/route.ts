/**
 * 설교 목록 API
 * GET /api/youtube/sermons - 벡터 임베딩 완료된 설교 목록 조회
 * GET /api/youtube/sermons?action=duplicates - 중복 설교 분석
 * DELETE /api/youtube/sermons - 중복 설교 정리
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
    const action = searchParams.get('action')

    // 중복 분석 모드
    if (action === 'duplicates') {
      return await analyzeDuplicates()
    }

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

    // 완료된 설교의 video_id 목록으로 청크 수 집계 (정확한 카운트)
    const completedVideoIds = (sermons || []).map((s: any) => s.video_id)
    let totalChunks = 0
    if (completedVideoIds.length > 0) {
      const { count } = await getSupabase()
        .from('sermon_chunks')
        .select('*', { count: 'exact', head: true })
        .in('video_id', completedVideoIds)
      totalChunks = count || 0
    }

    return NextResponse.json({
      success: true,
      sermons: sermons || [],
      totalSermons: sermons?.length || 0,
      totalChunks
    })
  } catch (error: any) {
    console.error('설교 목록 API 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE: 중복 설교 정리
 * - 같은 제목의 설교 중 chunk_count가 가장 많은 것만 유지
 * - 0 청크 설교 삭제
 * - 비완료 상태 설교 정리
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const mode = searchParams.get('mode') || 'preview'  // 'preview' | 'execute'

    // 모든 설교 조회
    const { data: allSermons, error } = await getSupabase()
      .from('sermons')
      .select('id, video_id, video_title, processing_status, chunk_count, sermon_duration, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error

    const toDelete: { id: number; video_id: string; reason: string; video_title: string; chunk_count: number }[] = []

    // 1. 0 청크 + completed 상태 → 삭제
    for (const s of allSermons || []) {
      if (s.processing_status === 'completed' && (!s.chunk_count || s.chunk_count === 0)) {
        toDelete.push({
          id: s.id,
          video_id: s.video_id,
          reason: '완료 상태이지만 0 청크',
          video_title: s.video_title,
          chunk_count: 0
        })
      }
    }

    // 2. failed/processing 상태에서 오래된 것 → 삭제
    for (const s of allSermons || []) {
      if (s.processing_status !== 'completed') {
        const age = Date.now() - new Date(s.created_at).getTime()
        if (age > 2 * 60 * 60 * 1000) { // 2시간 이상
          toDelete.push({
            id: s.id,
            video_id: s.video_id,
            reason: `비완료 상태(${s.processing_status}) + ${Math.round(age / 3600000)}시간 경과`,
            video_title: s.video_title,
            chunk_count: s.chunk_count || 0
          })
        }
      }
    }

    // 3. 제목 중복 → chunk_count가 가장 많은 것 유지, 나머지 삭제
    const completedSermons = (allSermons || []).filter(
      (s: any) => s.processing_status === 'completed' && s.chunk_count > 0
    )
    const titleGroups = new Map<string, any[]>()
    for (const s of completedSermons) {
      const title = s.video_title || ''
      if (!titleGroups.has(title)) titleGroups.set(title, [])
      titleGroups.get(title)!.push(s)
    }

    for (const [title, entries] of titleGroups) {
      if (entries.length <= 1) continue
      // chunk_count 내림차순 정렬, 첫 번째(최다 청크)만 유지
      entries.sort((a: any, b: any) => (b.chunk_count || 0) - (a.chunk_count || 0))
      for (let i = 1; i < entries.length; i++) {
        const alreadyMarked = toDelete.find(d => d.video_id === entries[i].video_id)
        if (!alreadyMarked) {
          toDelete.push({
            id: entries[i].id,
            video_id: entries[i].video_id,
            reason: `제목 중복 (${entries[0].chunk_count} 청크 버전 유지, 이 버전은 ${entries[i].chunk_count} 청크)`,
            video_title: title,
            chunk_count: entries[i].chunk_count || 0
          })
        }
      }
    }

    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        toDelete: toDelete.length,
        chunksToDelete: toDelete.reduce((sum, d) => sum + d.chunk_count, 0),
        details: toDelete.map(d => ({
          video_id: d.video_id,
          title: d.video_title?.substring(0, 60),
          chunks: d.chunk_count,
          reason: d.reason
        }))
      })
    }

    // 실행 모드
    let deletedSermons = 0
    let deletedChunks = 0

    for (const item of toDelete) {
      // 청크 삭제
      if (item.chunk_count > 0) {
        const { error: delErr } = await getSupabase()
          .from('sermon_chunks')
          .delete()
          .eq('video_id', item.video_id)

        if (!delErr) {
          deletedChunks += item.chunk_count
        }
      }

      // 설교 메타데이터 삭제
      await getSupabase()
        .from('sermons')
        .delete()
        .eq('video_id', item.video_id)

      deletedSermons++
      console.log(`[cleanup] 삭제: ${item.video_id} (${item.reason})`)
    }

    return NextResponse.json({
      success: true,
      mode: 'execute',
      deletedSermons,
      deletedChunks,
      message: `${deletedSermons}개 설교, ${deletedChunks}개 청크 삭제 완료`
    })

  } catch (error: any) {
    console.error('설교 정리 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// 중복 분석
async function analyzeDuplicates() {
  const { data: sermons, error } = await getSupabase()
    .from('sermons')
    .select('video_id, video_title, processing_status, chunk_count, sermon_duration, created_at')
    .order('video_title', { ascending: true })

  if (error) throw error

  const titleGroups = new Map<string, any[]>()
  for (const s of sermons || []) {
    const title = s.video_title || ''
    if (!titleGroups.has(title)) titleGroups.set(title, [])
    titleGroups.get(title)!.push(s)
  }

  const duplicates = [...titleGroups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([title, entries]) => ({
      title: title.substring(0, 80),
      count: entries.length,
      entries: entries.map((e: any) => ({
        video_id: e.video_id,
        status: e.processing_status,
        chunks: e.chunk_count || 0,
        duration: Math.round((e.sermon_duration || 0) / 60) + '분'
      }))
    }))

  const zeroChunks = (sermons || []).filter(
    (s: any) => s.processing_status === 'completed' && (!s.chunk_count || s.chunk_count === 0)
  )

  const nonCompleted = (sermons || []).filter(
    (s: any) => s.processing_status !== 'completed'
  )

  return NextResponse.json({
    success: true,
    total: sermons?.length || 0,
    completed: (sermons || []).filter((s: any) => s.processing_status === 'completed').length,
    duplicateTitles: duplicates.length,
    duplicateEntries: duplicates.reduce((sum, d) => sum + d.count - 1, 0),
    zeroChunkCompleted: zeroChunks.length,
    nonCompleted: nonCompleted.length,
    duplicates,
    zeroChunks: zeroChunks.map((s: any) => ({ video_id: s.video_id, title: s.video_title?.substring(0, 60) })),
    nonCompletedList: nonCompleted.map((s: any) => ({ video_id: s.video_id, title: s.video_title?.substring(0, 60), status: s.processing_status }))
  })
}
