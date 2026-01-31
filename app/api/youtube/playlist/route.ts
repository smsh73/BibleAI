/**
 * YouTube 플레이리스트 처리 API
 * POST /api/youtube/playlist
 *
 * 기능:
 * - 플레이리스트 URL에서 동영상 목록 추출
 * - 이미 처리된 동영상 필터링 (중복 방지)
 * - 각 동영상 STT 및 임베딩 저장
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  extractVideoId,
  extractPlaylistId,
  isPlaylistUrl,
  getPlaylistVideos,
  getVideoMetadata,
  chunkTranscript,
  type PlaylistVideoInfo
} from '@/lib/youtube'
import { youtubeToText, convertWhisperSegments } from '@/lib/youtube-stt'
import { detectSermonBoundary } from '@/lib/sermon-detector'
import {
  isVideoProcessed,
  filterProcessedVideos,
  uploadSermonChunks,
  saveSermonMetadata,
  updateSermonStatus
} from '@/lib/supabase'

export interface PlaylistProcessResult {
  success: boolean
  playlistId: string
  totalVideos: number
  processedVideos: number
  skippedVideos: number  // 이미 처리된 동영상
  failedVideos: number
  results: Array<{
    videoId: string
    title: string
    status: 'processed' | 'skipped' | 'failed'
    chunksCreated?: number
    error?: string
  }>
}

/**
 * 기간 필터에 따른 날짜 계산
 */
function getDateThreshold(dateRange: string): Date | null {
  const now = new Date()
  switch (dateRange) {
    case '1m':
      return new Date(now.setMonth(now.getMonth() - 1))
    case '6m':
      return new Date(now.setMonth(now.getMonth() - 6))
    case '1y':
      return new Date(now.setFullYear(now.getFullYear() - 1))
    case '3y':
      return new Date(now.setFullYear(now.getFullYear() - 3))
    case 'all':
    default:
      return null
  }
}

/**
 * YYYYMMDD 형식의 날짜 문자열을 Date로 변환
 */
function parseUploadDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.length !== 8) return null
  const year = parseInt(dateStr.substring(0, 4))
  const month = parseInt(dateStr.substring(4, 6)) - 1
  const day = parseInt(dateStr.substring(6, 8))
  return new Date(year, month, day)
}

export async function POST(req: NextRequest) {
  try {
    const {
      playlistUrl,
      videoUrl,  // 단일 동영상 URL도 지원
      autoDetect = true,
      saveToDatabase = true,
      maxVideos = 10,  // 최대 처리할 동영상 수
      dateRange = 'all',  // 기간 필터: '1m', '6m', '1y', '3y', 'all'
      sortOrder = 'newest',  // 정렬: 'newest' | 'oldest'
    } = await req.json()

    const url = playlistUrl || videoUrl

    if (!url) {
      return NextResponse.json(
        { error: 'playlistUrl 또는 videoUrl이 필요합니다.' },
        { status: 400 }
      )
    }

    // 플레이리스트인지 단일 동영상인지 확인
    const isPlaylist = isPlaylistUrl(url)
    let videos: PlaylistVideoInfo[] = []

    if (isPlaylist) {
      // 플레이리스트에서 동영상 목록 추출
      console.log('[Playlist] 플레이리스트 URL 감지')
      videos = await getPlaylistVideos(url)
      console.log(`[Playlist] 총 ${videos.length}개 동영상 발견`)

      // 1. 기간 필터 적용
      const dateThreshold = getDateThreshold(dateRange)
      if (dateThreshold) {
        const beforeCount = videos.length
        videos = videos.filter(v => {
          const uploadDate = parseUploadDate(v.uploadDate)
          return uploadDate && uploadDate >= dateThreshold
        })
        console.log(`[Playlist] 기간 필터 (${dateRange}): ${beforeCount} → ${videos.length}개`)
      }

      // 2. 정렬 적용
      videos.sort((a, b) => {
        const dateA = a.uploadDate || ''
        const dateB = b.uploadDate || ''
        if (sortOrder === 'newest') {
          return dateB.localeCompare(dateA)  // 내림차순 (최신순)
        } else {
          return dateA.localeCompare(dateB)  // 오름차순 (오래된순)
        }
      })
      console.log(`[Playlist] 정렬: ${sortOrder === 'newest' ? '최신순' : '오래된순'}`)

      // 3. 최대 개수 제한
      if (videos.length > maxVideos) {
        console.log(`[Playlist] 동영상 수 제한: ${videos.length} → ${maxVideos}`)
        videos = videos.slice(0, maxVideos)
      }
    } else {
      // 단일 동영상
      const videoId = extractVideoId(url)
      if (!videoId) {
        return NextResponse.json(
          { error: '유효하지 않은 YouTube URL입니다.' },
          { status: 400 }
        )
      }

      try {
        const metadata = await getVideoMetadata(url)
        videos = [{
          videoId: metadata.videoId,
          title: metadata.title,
          uploadDate: metadata.uploadDate,
          duration: metadata.duration,
          url
        }]
      } catch (e) {
        videos = [{
          videoId,
          title: 'Unknown',
          uploadDate: '',
          duration: 0,
          url
        }]
      }
    }

    // 이미 처리된 동영상 필터링
    const videoIds = videos.map(v => v.videoId)
    const { processed: alreadyProcessed, pending: pendingVideos } =
      await filterProcessedVideos(videoIds)

    console.log(`[Playlist] 총 ${videos.length}개 중 ${alreadyProcessed.length}개 이미 처리됨, ${pendingVideos.length}개 처리 예정`)

    // 처리 결과
    const results: PlaylistProcessResult['results'] = []
    let processedCount = 0
    let failedCount = 0

    // 이미 처리된 동영상 결과 추가
    for (const videoId of alreadyProcessed) {
      const video = videos.find(v => v.videoId === videoId)
      results.push({
        videoId,
        title: video?.title || 'Unknown',
        status: 'skipped'
      })
    }

    // 미처리 동영상 처리
    for (const videoId of pendingVideos) {
      const video = videos.find(v => v.videoId === videoId)
      if (!video) continue

      console.log(`[Playlist] 처리 중: ${video.title} (${videoId})`)

      try {
        // 1. STT 추출
        const whisperResult = await youtubeToText(video.url)

        // 2. 설교 구간 감지 (autoDetect인 경우)
        let targetSegments = whisperResult.segments
        let sermonBoundary = { start: 0, end: whisperResult.duration, confidence: 1 }
        if (autoDetect) {
          try {
            sermonBoundary = await detectSermonBoundary(whisperResult.segments, true)
            console.log(`[Playlist] 설교 구간 감지: ${sermonBoundary.start}초 ~ ${sermonBoundary.end}초`)

            targetSegments = whisperResult.segments.filter(seg =>
              seg.start >= sermonBoundary.start && seg.end <= sermonBoundary.end
            )
          } catch (e) {
            console.warn('[Playlist] 설교 구간 감지 실패, 전체 사용')
          }
        }

        // 3. 전체 스크립트 생성
        const fullTranscript = targetSegments.map(s => s.text).join(' ')

        // 4. 청크 생성
        const segments = convertWhisperSegments(targetSegments)
        const chunks = chunkTranscript(segments, 500, 100)

        // 5. 데이터베이스 저장
        if (saveToDatabase && chunks.length > 0) {
          // 5a. 메타데이터 저장 (sermons 테이블)
          await saveSermonMetadata({
            videoId,
            videoUrl: video.url,
            videoTitle: video.title,
            sermonStartTime: sermonBoundary.start,
            sermonEndTime: sermonBoundary.end,
            sermonDuration: sermonBoundary.end - sermonBoundary.start,
            fullTranscript,
            uploadDate: video.uploadDate ?
              `${video.uploadDate.slice(0, 4)}-${video.uploadDate.slice(4, 6)}-${video.uploadDate.slice(6, 8)}` :
              undefined
          })

          // 5b. 청크 저장 (sermon_chunks 테이블, video_url 포함)
          const { success, failed } = await uploadSermonChunks(
            videoId,
            video.title,
            chunks,
            (current, total) => {
              console.log(`[Playlist] ${video.title}: 청크 ${current}/${total} 업로드`)
            },
            video.url  // video_url 전달
          )

          // 5c. 처리 완료 상태 업데이트
          await updateSermonStatus(videoId, 'completed', success)

          results.push({
            videoId,
            title: video.title,
            status: 'processed',
            chunksCreated: success
          })

          if (failed > 0) {
            console.warn(`[Playlist] ${video.title}: ${failed}개 청크 실패`)
          }
        } else {
          results.push({
            videoId,
            title: video.title,
            status: 'processed',
            chunksCreated: chunks.length
          })
        }

        processedCount++

        // 다음 동영상 처리 전 대기
        await new Promise(resolve => setTimeout(resolve, 2000))

      } catch (error: any) {
        console.error(`[Playlist] ${video.title} 처리 실패:`, error.message)

        // 실패 상태 업데이트
        await updateSermonStatus(videoId, 'failed', 0, error.message)

        results.push({
          videoId,
          title: video.title,
          status: 'failed',
          error: error.message
        })
        failedCount++
      }
    }

    const playlistId = isPlaylist ? extractPlaylistId(url) : null

    return NextResponse.json({
      success: true,
      playlistId: playlistId || 'single',
      totalVideos: videos.length,
      processedVideos: processedCount,
      skippedVideos: alreadyProcessed.length,
      failedVideos: failedCount,
      results
    } as PlaylistProcessResult)

  } catch (error: any) {
    console.error('Playlist processing error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process playlist' },
      { status: 500 }
    )
  }
}

/**
 * GET: 플레이리스트 정보 조회 (처리하지 않고 정보만)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const url = searchParams.get('url')

    if (!url) {
      return NextResponse.json(
        { error: 'url parameter is required' },
        { status: 400 }
      )
    }

    if (!isPlaylistUrl(url)) {
      return NextResponse.json(
        { error: 'URL is not a playlist' },
        { status: 400 }
      )
    }

    // 플레이리스트 정보 추출
    const videos = await getPlaylistVideos(url)

    // 이미 처리된 동영상 확인
    const videoIds = videos.map(v => v.videoId)
    const { processed, pending } = await filterProcessedVideos(videoIds)

    return NextResponse.json({
      playlistId: extractPlaylistId(url),
      totalVideos: videos.length,
      processedCount: processed.length,
      pendingCount: pending.length,
      videos: videos.map(v => ({
        ...v,
        isProcessed: processed.includes(v.videoId)
      }))
    })

  } catch (error: any) {
    console.error('Playlist info error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get playlist info' },
      { status: 500 }
    )
  }
}
