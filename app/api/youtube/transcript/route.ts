/**
 * YouTube 스크립트 추출 API
 * POST /api/youtube/transcript
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractSermonTranscript, chunkTranscript } from '@/lib/youtube'
import { youtubeToText, convertWhisperSegments } from '@/lib/youtube-stt'
import { detectSermonBoundary } from '@/lib/sermon-detector'

export async function POST(req: NextRequest) {
  try {
    const {
      videoUrl,
      extractSermonOnly = false,
      startTime,
      endTime,
      useSTT = false,        // STT 사용 여부
      autoDetect = false,    // 설교 구간 자동 감지
    } = await req.json()

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'videoUrl is required' },
        { status: 400 }
      )
    }

    // 설교 구간 추출을 원하는 경우 시작/종료 시간 필수 (자동 감지 아닌 경우)
    if (extractSermonOnly && !autoDetect && (startTime === undefined || endTime === undefined)) {
      return NextResponse.json(
        { error: 'startTime and endTime are required when extractSermonOnly is true (unless autoDetect is enabled)' },
        { status: 400 }
      )
    }

    let targetSegments: any[]
    let summary: any
    let detectedBoundary: any = null
    let actualStartTime = startTime
    let actualEndTime = endTime

    // STT 사용 여부에 따라 분기
    if (useSTT) {
      console.log('[API] STT 모드로 스크립트 추출')

      // 자동 감지인 경우: 전체 동영상 STT 후 구간 감지
      if (autoDetect) {
        console.log('[API] 설교 구간 자동 감지 모드')

        // 1. 전체 동영상 STT
        const fullWhisperResult = await youtubeToText(videoUrl)

        // 2. AI로 설교 구간 감지
        const boundary = await detectSermonBoundary(
          fullWhisperResult.segments,
          true // AI 사용
        )

        detectedBoundary = boundary
        actualStartTime = boundary.start
        actualEndTime = boundary.end

        console.log(`[API] 감지된 설교 구간: ${actualStartTime}초 ~ ${actualEndTime}초 (신뢰도: ${boundary.confidence})`)

        // 3. 감지된 구간의 세그먼트만 필터링
        const filteredSegments = fullWhisperResult.segments.filter(seg => {
          return seg.start >= actualStartTime && seg.end <= actualEndTime
        })

        targetSegments = convertWhisperSegments(filteredSegments)

        summary = {
          totalDuration: fullWhisperResult.duration,
          totalSegments: fullWhisperResult.segments.length,
          sermonDuration: actualEndTime - actualStartTime,
          sermonSegments: targetSegments.length,
        }
      } else {
        // 수동 시간 범위 지정
        const whisperResult = await youtubeToText(
          videoUrl,
          extractSermonOnly ? startTime : undefined,
          extractSermonOnly ? endTime : undefined
        )

        targetSegments = convertWhisperSegments(whisperResult.segments)

        summary = {
          totalDuration: whisperResult.duration,
          totalSegments: whisperResult.segments.length,
          sermonDuration: extractSermonOnly && startTime !== undefined && endTime !== undefined
            ? endTime - startTime
            : whisperResult.duration,
          sermonSegments: targetSegments.length,
        }
      }
    } else {
      console.log('[API] 자막 모드로 스크립트 추출')

      // 기존 자막 추출 방식
      const result = await extractSermonTranscript(
        videoUrl,
        extractSermonOnly ? startTime : undefined,
        extractSermonOnly ? endTime : undefined
      )

      // 설교 구간만 추출
      targetSegments = extractSermonOnly && result.sermonSection
        ? result.sermonSection.segments
        : result.fullTranscript

      summary = result.summary
    }

    // 청크로 분할
    const chunks = chunkTranscript(targetSegments, 500, 100)

    // 응답 생성
    const fullText = targetSegments.map(s => s.text).join(' ')

    return NextResponse.json({
      success: true,
      videoUrl,
      method: useSTT ? 'STT (Whisper)' : 'Caption',
      autoDetected: autoDetect,
      detectedBoundary: detectedBoundary ? {
        start: detectedBoundary.start,
        end: detectedBoundary.end,
        confidence: detectedBoundary.confidence,
        reasoning: detectedBoundary.reasoning,
      } : null,
      summary,
      sermonSection: (extractSermonOnly || autoDetect) && actualStartTime !== undefined && actualEndTime !== undefined
        ? {
            start: actualStartTime,
            end: actualEndTime,
            duration: actualEndTime - actualStartTime,
            text: fullText.substring(0, 500) + (fullText.length > 500 ? '...' : ''),
          }
        : null,
      chunks: chunks.map(chunk => ({
        text: chunk.text,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        duration: chunk.endTime - chunk.startTime,
      })),
      totalChunks: chunks.length,
    })
  } catch (error: any) {
    console.error('Transcript extraction error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to extract transcript' },
      { status: 500 }
    )
  }
}
