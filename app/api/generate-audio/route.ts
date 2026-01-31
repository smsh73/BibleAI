/**
 * 팟캐스트 오디오 생성 API
 * POST /api/generate-audio
 */

import { NextRequest, NextResponse } from 'next/server'
import { generatePodcastAudio } from '@/lib/audio-generator'

export async function POST(request: NextRequest) {
  try {
    const { question, answer, verseReferences } = await request.json()

    if (!answer) {
      return NextResponse.json(
        { success: false, error: 'Answer is required' },
        { status: 400 }
      )
    }

    console.log('[generate-audio] Generating podcast audio...')

    const result = await generatePodcastAudio({
      question: question || '',
      answer,
      verseReferences: verseReferences || []
    })

    if (result.success) {
      return NextResponse.json({
        success: true,
        audioUrl: result.audioUrl,
        provider: result.provider
      })
    }

    return NextResponse.json(
      { success: false, error: result.error },
      { status: 500 }
    )

  } catch (error: any) {
    console.error('[generate-audio] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to generate audio' },
      { status: 500 }
    )
  }
}
