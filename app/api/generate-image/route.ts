/**
 * 위로 이미지 생성 API
 * POST /api/generate-image
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateComfortImage } from '@/lib/image-generator'

export async function POST(request: NextRequest) {
  try {
    const { question, answer, verseReferences, emotion } = await request.json()

    if (!answer) {
      return NextResponse.json(
        { success: false, error: 'Answer is required' },
        { status: 400 }
      )
    }

    console.log('[generate-image] Generating comfort image...')

    const result = await generateComfortImage({
      question: question || '',
      answer,
      verseReferences: verseReferences || [],
      emotion
    })

    if (result.success) {
      return NextResponse.json({
        success: true,
        imageUrl: result.imageUrl,
        provider: result.provider
      })
    }

    return NextResponse.json(
      { success: false, error: result.error },
      { status: 500 }
    )

  } catch (error: any) {
    console.error('[generate-image] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to generate image' },
      { status: 500 }
    )
  }
}
