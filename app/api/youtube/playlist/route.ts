/**
 * YouTube 플레이리스트 처리 API
 * POST /api/youtube/playlist
 *
 * 기능:
 * - 플레이리스트 URL에서 동영상 목록 추출
 * - 이미 처리된 동영상 필터링 (중복 방지)
 * - 각 동영상 STT 및 임베딩 저장
 * - 작업 잠금으로 동시 실행 방지
 * - 설교 구간 20분 미만 시 재시도
 * - 최근 동영상은 전체를 설교로 처리
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
  uploadSermonChunksWithRetry,
  saveSermonMetadata,
  updateSermonStatus
} from '@/lib/supabase'

export interface PlaylistProcessResult {
  success: boolean
  playlistId: string
  totalVideos: number
  processedVideos: number   // 이번에 새로 처리된 동영상 수
  skippedVideos: number     // 이미 처리되어 스킵된 동영상 수
  failedVideos: number      // 처리 실패한 동영상 수
  remainingVideos?: number  // 아직 처리되지 않은 남은 동영상 수
  results: Array<{
    videoId: string
    title: string
    status: 'processed' | 'skipped' | 'failed'
    chunksCreated?: number
    error?: string
    retryCount?: number
  }>
}

// 설교 최소 길이 (초) - 20분
const MIN_SERMON_DURATION_SEC = 20 * 60

// 최대 재시도 횟수
const MAX_RETRY_COUNT = 3

// 설교 구간 감지 건너뛰기 시작 날짜 (이 날짜 이후 동영상은 전체가 설교)
const SKIP_DETECTION_AFTER_DATE = '20240601'  // 2024년 6월 1일 이후

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

/**
 * 작업 잠금 획득
 */
async function acquireTaskLock(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/admin/task-lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskType: 'sermon',
        description: '설교 동영상 추출'
      })
    })

    const data = await response.json()
    return data.success === true
  } catch (error) {
    console.warn('[Playlist] 작업 잠금 획득 실패, 계속 진행:', error)
    return true  // 잠금 실패해도 진행 (단독 서버 환경)
  }
}

/**
 * 작업 잠금 해제
 */
async function releaseTaskLock(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/admin/task-lock?taskType=sermon`, {
      method: 'DELETE'
    })
  } catch (error) {
    console.warn('[Playlist] 작업 잠금 해제 실패:', error)
  }
}

/**
 * 단일 동영상 처리 (재시도 로직 포함)
 */
async function processVideo(
  video: PlaylistVideoInfo,
  autoDetect: boolean,
  saveToDatabase: boolean
): Promise<{
  success: boolean
  sermonDuration: number
  chunksCreated: number
  error?: string
  usedFullVideo?: boolean
}> {
  // 1. STT 추출
  const whisperResult = await youtubeToText(video.url)
  console.log(`[Playlist] STT 완료: ${video.title} (${whisperResult.duration}초)`)

  // 2. 설교 구간 결정
  let targetSegments = whisperResult.segments
  let sermonBoundary = { start: 0, end: whisperResult.duration, confidence: 1 }
  let usedFullVideo = false

  // 최근 동영상은 설교 구간 감지 건너뛰기 (이미 편집된 동영상)
  const isRecentVideo = video.uploadDate && video.uploadDate >= SKIP_DETECTION_AFTER_DATE

  if (isRecentVideo) {
    console.log(`[Playlist] 최근 동영상 - 전체를 설교로 처리 (업로드: ${video.uploadDate})`)
    usedFullVideo = true
  } else if (autoDetect) {
    try {
      sermonBoundary = await detectSermonBoundary(whisperResult.segments, true)
      console.log(`[Playlist] 설교 구간 감지: ${sermonBoundary.start}초 ~ ${sermonBoundary.end}초 (${Math.round((sermonBoundary.end - sermonBoundary.start) / 60)}분)`)

      targetSegments = whisperResult.segments.filter(seg =>
        seg.start >= sermonBoundary.start && seg.end <= sermonBoundary.end
      )
    } catch (e) {
      console.warn('[Playlist] 설교 구간 감지 실패, 전체 사용')
      usedFullVideo = true
    }
  } else {
    usedFullVideo = true
  }

  const sermonDuration = sermonBoundary.end - sermonBoundary.start

  // 3. 전체 스크립트 생성
  const fullTranscript = targetSegments.map(s => s.text).join(' ')

  // 4. 청크 생성
  const segments = convertWhisperSegments(targetSegments)
  const chunks = chunkTranscript(segments, 500, 100)

  console.log(`[Playlist] 청크 생성 완료: ${chunks.length}개`)

  // 5. 데이터베이스 저장
  if (saveToDatabase && chunks.length > 0) {
    // 5a. 메타데이터 저장 (sermons 테이블)
    await saveSermonMetadata({
      videoId: video.videoId,
      videoUrl: video.url,
      videoTitle: video.title,
      sermonStartTime: sermonBoundary.start,
      sermonEndTime: sermonBoundary.end,
      sermonDuration,
      fullTranscript,
      uploadDate: video.uploadDate ?
        `${video.uploadDate.slice(0, 4)}-${video.uploadDate.slice(4, 6)}-${video.uploadDate.slice(6, 8)}` :
        undefined
    })

    // 5b. 청크 저장 (재시도 로직 포함)
    const { success, failed } = await uploadSermonChunksWithRetry(
      video.videoId,
      video.title,
      chunks,
      (current, total) => {
        if (current % 5 === 0 || current === total) {
          console.log(`[Playlist] ${video.title}: 청크 ${current}/${total} 업로드`)
        }
      },
      video.url
    )

    // 5c. 처리 완료 상태 업데이트
    await updateSermonStatus(video.videoId, 'completed', success)

    if (failed > 0) {
      console.warn(`[Playlist] ${video.title}: ${failed}개 청크 실패`)
    }

    return {
      success: true,
      sermonDuration,
      chunksCreated: success,
      usedFullVideo
    }
  }

  return {
    success: true,
    sermonDuration,
    chunksCreated: chunks.length,
    usedFullVideo
  }
}

export async function POST(req: NextRequest) {
  // 기본 URL 추출
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`
  let lockAcquired = false

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

    // 작업 잠금 획득 시도
    const lockResponse = await fetch(`${baseUrl}/api/admin/task-lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskType: 'sermon',
        description: '설교 동영상 추출'
      })
    })

    const lockData = await lockResponse.json()

    if (!lockResponse.ok || !lockData.success) {
      return NextResponse.json({
        error: lockData.message || '다른 작업이 진행 중입니다.',
        locked: true,
        currentTask: lockData.currentTask
      }, { status: 409 })
    }

    lockAcquired = true
    console.log('[Playlist] 작업 잠금 획득 성공')

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

      console.log(`[Playlist] 처리 대상: ${videos.length}개 (최대 ${maxVideos}개 새 동영상 처리 예정)`)
    } else {
      // 단일 동영상
      const videoId = extractVideoId(url)
      if (!videoId) {
        await releaseTaskLock(baseUrl)
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

    console.log(`[Playlist] 총 ${videos.length}개 중 ${alreadyProcessed.length}개 이미 처리됨, ${pendingVideos.length}개 처리 가능`)

    // 처리 결과
    const results: PlaylistProcessResult['results'] = []
    let processedCount = 0  // 실제로 처리된 새 동영상 수
    let skippedCount = 0    // 스킵된 동영상 수 (이미 처리됨)
    let failedCount = 0

    // 동영상 순서대로 처리 (maxVideos개의 새 동영상이 처리될 때까지)
    for (const video of videos) {
      // 이미 maxVideos개를 처리했으면 종료
      if (processedCount >= maxVideos) {
        console.log(`[Playlist] 목표 처리 수 도달: ${processedCount}/${maxVideos}개`)
        break
      }

      // 이미 처리된 동영상은 스킵 (카운트하지 않음)
      if (alreadyProcessed.includes(video.videoId)) {
        console.log(`[Playlist] 스킵 (이미 처리됨): ${video.title}`)
        results.push({
          videoId: video.videoId,
          title: video.title,
          status: 'skipped'
        })
        skippedCount++
        continue
      }

      console.log(`[Playlist] 처리 중 (${processedCount + 1}/${maxVideos}): ${video.title} (${video.videoId})`)

      let retryCount = 0
      let success = false
      let lastError: string | undefined

      // 재시도 루프
      while (retryCount < MAX_RETRY_COUNT && !success) {
        try {
          // 첫 시도는 autoDetect 사용, 재시도는 전체 동영상 사용
          const useAutoDetect = retryCount === 0 ? autoDetect : false

          if (retryCount > 0) {
            console.log(`[Playlist] 재시도 ${retryCount}/${MAX_RETRY_COUNT}: ${video.title} (전체 동영상 사용)`)
            // 재시도 전 대기 (지수 백오프)
            await new Promise(resolve => setTimeout(resolve, 5000 * retryCount))
          }

          const result = await processVideo(video, useAutoDetect, saveToDatabase)

          // 설교 구간이 20분 미만이고 첫 시도인 경우 재시도
          if (result.sermonDuration < MIN_SERMON_DURATION_SEC && !result.usedFullVideo) {
            console.log(`[Playlist] 설교 구간 너무 짧음: ${Math.round(result.sermonDuration / 60)}분 < 20분, 재시도 예정`)
            retryCount++

            // 기존 데이터 삭제 (재시도 전)
            if (saveToDatabase) {
              await updateSermonStatus(video.videoId, 'failed', 0, '설교 구간 너무 짧음 - 재시도')
            }
            continue
          }

          // 청크가 0개인 경우 재시도
          if (result.chunksCreated === 0) {
            console.log(`[Playlist] 청크 생성 실패 (0개), 재시도 예정`)
            retryCount++
            lastError = '청크 생성 실패'
            continue
          }

          results.push({
            videoId: video.videoId,
            title: video.title,
            status: 'processed',
            chunksCreated: result.chunksCreated,
            retryCount: retryCount > 0 ? retryCount : undefined
          })

          success = true
          processedCount++
          console.log(`[Playlist] 처리 완료: ${processedCount}/${maxVideos}개 (${result.chunksCreated}청크, ${Math.round(result.sermonDuration / 60)}분)`)

        } catch (error: any) {
          console.error(`[Playlist] ${video.title} 처리 오류 (시도 ${retryCount + 1}):`, error.message)
          lastError = error.message
          retryCount++

          // Rate limit 에러인 경우 더 긴 대기
          if (error.message?.includes('rate') || error.message?.includes('429')) {
            console.log('[Playlist] Rate limit 감지, 30초 대기...')
            await new Promise(resolve => setTimeout(resolve, 30000))
          }
        }
      }

      // 모든 재시도 실패
      if (!success) {
        console.error(`[Playlist] ${video.title} 최종 실패 (${retryCount}회 시도)`)

        await updateSermonStatus(video.videoId, 'failed', 0, lastError || 'Unknown error')

        results.push({
          videoId: video.videoId,
          title: video.title,
          status: 'failed',
          error: lastError,
          retryCount
        })
        failedCount++
      }

      // 다음 동영상 처리 전 대기 (API rate limit 방지)
      await new Promise(resolve => setTimeout(resolve, 3000))
    }

    // 작업 잠금 해제
    await releaseTaskLock(baseUrl)
    lockAcquired = false

    // 처리 완료 로그
    const remainingPending = pendingVideos.length - processedCount - failedCount
    if (remainingPending > 0 && processedCount >= maxVideos) {
      console.log(`[Playlist] 목표 달성. 남은 미처리 동영상: ${remainingPending}개`)
    } else if (remainingPending <= 0) {
      console.log(`[Playlist] 모든 동영상 처리 완료`)
    }

    const playlistId = isPlaylist ? extractPlaylistId(url) : null

    return NextResponse.json({
      success: true,
      playlistId: playlistId || 'single',
      totalVideos: videos.length,
      processedVideos: processedCount,
      skippedVideos: skippedCount,
      failedVideos: failedCount,
      remainingVideos: Math.max(0, pendingVideos.length - processedCount - failedCount),
      results
    } as PlaylistProcessResult)

  } catch (error: any) {
    console.error('Playlist processing error:', error)

    // 에러 발생 시 잠금 해제
    if (lockAcquired) {
      await releaseTaskLock(baseUrl)
    }

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
