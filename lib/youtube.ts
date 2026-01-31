/**
 * YouTube 동영상 스크립트 추출 및 설교 구간 감지
 */

import { YoutubeTranscript } from 'youtube-transcript'

export interface TranscriptSegment {
  text: string
  start: number // seconds
  duration: number
}

export interface SermonSection {
  start: number
  end: number
  text: string
  segments: TranscriptSegment[]
}

/**
 * YouTube 동영상 ID 추출
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/, // YouTube video IDs are always 11 characters
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?\s]+)/, // Fallback: capture until &, ?, or space
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  return null
}

/**
 * YouTube 플레이리스트 ID 추출
 */
export function extractPlaylistId(url: string): string | null {
  const patterns = [
    /[?&]list=([a-zA-Z0-9_-]+)/,
    /youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  return null
}

/**
 * URL이 플레이리스트인지 확인
 */
export function isPlaylistUrl(url: string): boolean {
  return extractPlaylistId(url) !== null
}

/**
 * 플레이리스트에서 모든 동영상 정보 추출 (yt-dlp 사용)
 */
export interface PlaylistVideoInfo {
  videoId: string
  title: string
  uploadDate: string  // YYYYMMDD 형식
  duration: number    // 초 단위
  url: string
}

export async function getPlaylistVideos(playlistUrl: string): Promise<PlaylistVideoInfo[]> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const playlistId = extractPlaylistId(playlistUrl)
  if (!playlistId) {
    throw new Error('유효하지 않은 플레이리스트 URL입니다.')
  }

  try {
    // yt-dlp로 플레이리스트 정보 추출 (JSON 형식)
    const command = `yt-dlp --flat-playlist -j "https://www.youtube.com/playlist?list=${playlistId}"`

    console.log(`[Playlist] 플레이리스트 정보 추출 중: ${playlistId}`)
    const { stdout } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024 })

    const videos: PlaylistVideoInfo[] = []
    const lines = stdout.trim().split('\n')

    for (const line of lines) {
      try {
        const info = JSON.parse(line)
        videos.push({
          videoId: info.id,
          title: info.title || 'Unknown',
          uploadDate: info.upload_date || '',
          duration: info.duration || 0,
          url: `https://www.youtube.com/watch?v=${info.id}`
        })
      } catch (e) {
        // JSON 파싱 실패 시 무시
      }
    }

    console.log(`[Playlist] ${videos.length}개 동영상 발견`)
    return videos

  } catch (error: any) {
    throw new Error(`플레이리스트 정보 추출 실패: ${error.message}`)
  }
}

/**
 * 단일 동영상 메타데이터 추출 (yt-dlp 사용)
 */
export async function getVideoMetadata(videoUrl: string): Promise<{
  videoId: string
  title: string
  uploadDate: string
  duration: number
  channel: string
}> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const videoId = extractVideoId(videoUrl)
  if (!videoId) {
    throw new Error('유효하지 않은 YouTube URL입니다.')
  }

  try {
    const command = `yt-dlp -j --no-download "${videoUrl}"`
    const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 })

    const info = JSON.parse(stdout)

    return {
      videoId: info.id,
      title: info.title || 'Unknown',
      uploadDate: info.upload_date || '',
      duration: info.duration || 0,
      channel: info.channel || info.uploader || 'Unknown'
    }
  } catch (error: any) {
    throw new Error(`동영상 메타데이터 추출 실패: ${error.message}`)
  }
}

/**
 * YouTube 동영상 전체 스크립트 추출
 */
export async function fetchTranscript(videoUrl: string): Promise<TranscriptSegment[]> {
  const videoId = extractVideoId(videoUrl)

  console.log(`[DEBUG] Extracted video ID: ${videoId}`)

  if (!videoId) {
    throw new Error('유효하지 않은 YouTube URL입니다.')
  }

  try {
    console.log(`[DEBUG] Attempting to fetch Korean transcript for video ID: ${videoId}`)
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: 'ko', // 한국어 우선
    })

    console.log(`[DEBUG] Successfully fetched ${transcript.length} segments`)

    return transcript.map((item: any) => ({
      text: item.text,
      start: item.offset / 1000, // ms -> seconds
      duration: item.duration / 1000,
    }))
  } catch (error: any) {
    console.log(`[DEBUG] Korean transcript failed: ${error.message}`)
    // 한국어 자막이 없으면 자동 생성 자막 시도
    try {
      console.log(`[DEBUG] Attempting to fetch auto-generated transcript`)
      const transcript = await YoutubeTranscript.fetchTranscript(videoId)
      console.log(`[DEBUG] Successfully fetched ${transcript.length} auto-generated segments`)
      return transcript.map((item: any) => ({
        text: item.text,
        start: item.offset / 1000,
        duration: item.duration / 1000,
      }))
    } catch (retryError: any) {
      console.log(`[DEBUG] Auto-generated transcript also failed: ${retryError.message}`)
      throw new Error(`스크립트 추출 실패: ${error.message}`)
    }
  }
}

/**
 * 시간 범위로 설교 구간 추출
 * @param segments 전체 스크립트 세그먼트
 * @param startTime 시작 시간 (초)
 * @param endTime 종료 시간 (초)
 */
export function extractSermonByTimeRange(
  segments: TranscriptSegment[],
  startTime: number,
  endTime: number
): SermonSection | null {
  // 시작 시간과 종료 시간 범위 내의 세그먼트만 필터링
  const sermonSegments = segments.filter(seg => {
    const segEnd = seg.start + seg.duration
    // 세그먼트가 지정된 시간 범위와 겹치는지 확인
    return (seg.start >= startTime && seg.start < endTime) ||
           (segEnd > startTime && segEnd <= endTime) ||
           (seg.start < startTime && segEnd > endTime)
  })

  if (sermonSegments.length === 0) {
    return null
  }

  return {
    start: startTime,
    end: endTime,
    text: sermonSegments.map(s => s.text).join(' '),
    segments: sermonSegments,
  }
}

// 공통 세그먼트 타입 (TranscriptSegment, WhisperSegment 호환)
export type GenericSegment = { text: string; start: number; duration?: number; end?: number }

/**
 * 스크립트를 청크로 분할 (임베딩용)
 */
export function chunkTranscript(
  segments: GenericSegment[],
  chunkSize: number = 500,
  overlapSize: number = 100
): Array<{ text: string; startTime: number; endTime: number }> {
  const chunks: Array<{ text: string; startTime: number; endTime: number }> = []
  let currentChunk = ''
  let chunkStartTime = segments[0]?.start || 0
  let chunkEndTime = chunkStartTime

  for (const segment of segments) {
    if (currentChunk.length + segment.text.length > chunkSize && currentChunk.length > 0) {
      // 청크 저장
      chunks.push({
        text: currentChunk.trim(),
        startTime: chunkStartTime,
        endTime: chunkEndTime,
      })

      // 오버랩 적용
      const words = currentChunk.split(' ')
      const overlapWords = words.slice(-Math.floor(overlapSize / 10)) // 대략 100자 = 10단어
      currentChunk = overlapWords.join(' ') + ' '

      // 새 청크 시작 시간 업데이트
      chunkStartTime = segment.start
    }

    currentChunk += segment.text + ' '
    // duration 또는 end 사용 (WhisperSegment는 end 사용, TranscriptSegment는 duration 사용)
    chunkEndTime = segment.end ?? (segment.start + (segment.duration || 0))
  }

  // 마지막 청크
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      startTime: chunkStartTime,
      endTime: chunkEndTime,
    })
  }

  return chunks
}

/**
 * 전체 파이프라인: URL -> 설교 스크립트 추출
 * @param videoUrl YouTube 동영상 URL
 * @param startTime 설교 시작 시간 (초) - 선택사항
 * @param endTime 설교 종료 시간 (초) - 선택사항
 */
export async function extractSermonTranscript(
  videoUrl: string,
  startTime?: number,
  endTime?: number
): Promise<{
  fullTranscript: TranscriptSegment[]
  sermonSection: SermonSection | null
  summary: {
    totalDuration: number
    totalSegments: number
    sermonDuration: number
    sermonSegments: number
  }
}> {
  // 1. 전체 스크립트 추출
  const fullTranscript = await fetchTranscript(videoUrl)

  // 2. 전체 동영상 길이 계산
  const totalDuration = fullTranscript.length > 0
    ? fullTranscript[fullTranscript.length - 1].start + fullTranscript[fullTranscript.length - 1].duration
    : 0

  // 3. 설교 구간 추출 (시간 범위가 지정된 경우만)
  let sermonSection: SermonSection | null = null
  if (startTime !== undefined && endTime !== undefined) {
    // 종료 시간이 전체 길이를 초과하지 않도록 조정
    const adjustedEndTime = Math.min(endTime, totalDuration)
    sermonSection = extractSermonByTimeRange(fullTranscript, startTime, adjustedEndTime)
  }

  const sermonDuration = sermonSection ? sermonSection.end - sermonSection.start : 0

  return {
    fullTranscript,
    sermonSection,
    summary: {
      totalDuration,
      totalSegments: fullTranscript.length,
      sermonDuration,
      sermonSegments: sermonSection?.segments.length || 0,
    },
  }
}
