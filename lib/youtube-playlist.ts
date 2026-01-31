/**
 * YouTube 플레이리스트 자동 처리
 * 플레이리스트의 모든 동영상을 순차적으로 STT + AI 자동 감지 처리
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { youtubeToText } from './youtube-stt'
import { detectSermonBoundary } from './sermon-detector'
import { chunkTranscript } from './youtube'

const execAsync = promisify(exec)

export interface PlaylistVideo {
  id: string
  title: string
  url: string
  duration?: number
}

export interface SermonProcessResult {
  videoId: string
  videoTitle: string
  videoUrl: string
  success: boolean
  error?: string
  detectedBoundary?: {
    start: number
    end: number
    confidence: number
    reasoning: string
  }
  sermonSection?: {
    start: number
    end: number
    duration: number
    text: string
    segments: any[]
  }
  chunks?: Array<{
    text: string
    startTime: number
    endTime: number
    duration?: number
  }>
  totalChunks?: number
  cost?: number
}

/**
 * 플레이리스트 URL에서 비디오 ID 추출
 */
export function extractPlaylistId(url: string): string | null {
  // https://youtube.com/playlist?list=PLAYLIST_ID
  // https://www.youtube.com/playlist?list=PLAYLIST_ID
  const match = url.match(/[?&]list=([^&]+)/)
  return match ? match[1] : null
}

/**
 * yt-dlp로 플레이리스트 정보 추출
 */
export async function getPlaylistVideos(
  playlistUrl: string
): Promise<PlaylistVideo[]> {
  const playlistId = extractPlaylistId(playlistUrl)

  if (!playlistId) {
    throw new Error('유효하지 않은 플레이리스트 URL입니다.')
  }

  try {
    // yt-dlp로 플레이리스트 비디오 목록 추출
    // --flat-playlist: 비디오 다운로드 없이 메타데이터만 추출
    // --print: 출력 형식 지정
    const command = `yt-dlp --flat-playlist --print "%(id)s|%(title)s|%(duration)s" "${playlistUrl}"`

    console.log('[플레이리스트] 비디오 목록 추출 중...')
    const { stdout } = await execAsync(command)

    const lines = stdout.trim().split('\n')
    const videos: PlaylistVideo[] = []

    for (const line of lines) {
      const [id, title, duration] = line.split('|')
      if (id && title) {
        videos.push({
          id,
          title: title || `Video ${id}`,
          url: `https://www.youtube.com/watch?v=${id}`,
          duration: duration ? parseInt(duration) : undefined,
        })
      }
    }

    console.log(`[플레이리스트] ${videos.length}개 비디오 발견`)
    return videos
  } catch (error: any) {
    throw new Error(`플레이리스트 정보 추출 실패: ${error.message}`)
  }
}

/**
 * 단일 동영상 처리 (STT + AI 자동 감지)
 */
export async function processSermonVideo(
  videoUrl: string,
  videoId: string,
  videoTitle: string,
  onProgress?: (message: string) => void
): Promise<SermonProcessResult> {
  const log = (msg: string) => {
    console.log(`[${videoId}] ${msg}`)
    if (onProgress) onProgress(msg)
  }

  try {
    // 1. 전체 동영상 STT
    log('STT 변환 중...')
    const whisperResult = await youtubeToText(videoUrl)

    log(`STT 완료 (${whisperResult.segments.length} 세그먼트)`)

    // 2. AI 자동 감지
    log('AI 설교 구간 감지 중...')
    const boundary = await detectSermonBoundary(whisperResult.segments, true)

    log(`감지 완료: ${Math.floor(boundary.start / 60)}:${(boundary.start % 60)
      .toString()
      .padStart(2, '0')} ~ ${Math.floor(boundary.end / 60)}:${(
      boundary.end % 60
    )
      .toString()
      .padStart(2, '0')} (신뢰도 ${(boundary.confidence * 100).toFixed(0)}%)`)

    // 3. 설교 구간 필터링
    const sermonSegments = whisperResult.segments.filter(
      (seg) => seg.start >= boundary.start && seg.end <= boundary.end
    )

    const sermonText = sermonSegments.map((s) => s.text).join(' ')

    // 4. 청크 분할
    log('청크 분할 중...')
    const chunks = chunkTranscript(sermonSegments, 500, 100)

    log(`처리 완료! (${chunks.length} 청크)`)

    // 5. 비용 계산
    const durationMinutes = whisperResult.duration / 60
    const sttCost = durationMinutes * 0.006 // Whisper: $0.006/분
    const aiCost = 0.01 // GPT-4o-mini: ~$0.01
    const totalCost = sttCost + aiCost

    return {
      videoId,
      videoTitle,
      videoUrl,
      success: true,
      detectedBoundary: boundary,
      sermonSection: {
        start: boundary.start,
        end: boundary.end,
        duration: boundary.end - boundary.start,
        text: sermonText,
        segments: sermonSegments,
      },
      chunks,
      totalChunks: chunks.length,
      cost: totalCost,
    }
  } catch (error: any) {
    log(`실패: ${error.message}`)
    return {
      videoId,
      videoTitle,
      videoUrl,
      success: false,
      error: error.message,
    }
  }
}

/**
 * 플레이리스트 전체 처리
 */
export async function processPlaylist(
  playlistUrl: string,
  options: {
    maxVideos?: number // 최대 처리할 동영상 수
    skipErrors?: boolean // 오류 발생 시 건너뛰기
    onProgress?: (current: number, total: number, message: string) => void
  } = {}
): Promise<SermonProcessResult[]> {
  const { maxVideos, skipErrors = true, onProgress } = options

  // 1. 플레이리스트 비디오 목록 가져오기
  console.log('[플레이리스트] 처리 시작')
  const videos = await getPlaylistVideos(playlistUrl)

  const videosToProcess = maxVideos
    ? videos.slice(0, maxVideos)
    : videos

  console.log(
    `[플레이리스트] ${videosToProcess.length}개 비디오 처리 예정`
  )

  const results: SermonProcessResult[] = []
  let processedCount = 0
  let successCount = 0
  let errorCount = 0

  // 2. 각 비디오 순차 처리
  for (const video of videosToProcess) {
    processedCount++

    if (onProgress) {
      onProgress(
        processedCount,
        videosToProcess.length,
        `[${processedCount}/${videosToProcess.length}] ${video.title}`
      )
    }

    console.log('\n' + '='.repeat(70))
    console.log(`[${processedCount}/${videosToProcess.length}] ${video.title}`)
    console.log('='.repeat(70))

    const result = await processSermonVideo(
      video.url,
      video.id,
      video.title,
      (msg) => {
        if (onProgress) {
          onProgress(processedCount, videosToProcess.length, msg)
        }
      }
    )

    results.push(result)

    if (result.success) {
      successCount++
    } else {
      errorCount++
      if (!skipErrors) {
        console.error(`[플레이리스트] 오류로 인해 중단: ${result.error}`)
        break
      }
    }
  }

  // 3. 최종 요약
  console.log('\n' + '='.repeat(70))
  console.log('플레이리스트 처리 완료')
  console.log('='.repeat(70))
  console.log(`총 ${processedCount}개 비디오 처리`)
  console.log(`성공: ${successCount}개`)
  console.log(`실패: ${errorCount}개`)

  const totalCost = results
    .filter((r) => r.success)
    .reduce((sum, r) => sum + (r.cost || 0), 0)

  console.log(`총 비용: $${totalCost.toFixed(2)}`)

  return results
}
