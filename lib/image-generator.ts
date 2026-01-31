/**
 * 위로 이미지 생성 서비스
 * - OpenAI DALL-E 3 → Google Gemini Imagen 순서로 fallback
 * - 따뜻한 수채화 스타일의 위로 이미지 생성
 */

import OpenAI from 'openai'

interface ImageGenerationResult {
  success: boolean
  imageUrl?: string
  provider?: 'openai' | 'gemini'
  error?: string
}

interface GenerateImageParams {
  question: string
  answer: string
  verseReferences: string[]
  emotion?: string
}

// 감정별 이미지 스타일 힌트
const EMOTION_STYLE_HINTS: Record<string, string> = {
  loneliness: 'a person finding warmth and connection, soft light breaking through clouds',
  anxiety: 'a peaceful garden with calm waters, gentle breeze, soothing atmosphere',
  sadness: 'comfort and embrace, gentle morning light, hope emerging',
  stress: 'a quiet peaceful sanctuary, serene nature, moment of rest',
  fear: 'protective light surrounding, safe haven, courage',
  anger: 'tranquil stream, releasing tension, finding peace',
  confusion: 'clear path emerging from mist, guiding light',
  hopelessness: 'dawn breaking over horizon, new beginning, hope',
  gratitude: 'golden warm sunlight, abundance, thanksgiving',
  joy: 'celebration, bright colors, happiness overflowing',
  peace: 'still waters, green pastures, complete serenity',
  hope: 'rainbow after rain, bright future, promise'
}

/**
 * 성경 구절에서 이미지 힌트 추출
 */
function extractImageHintFromVerses(verses: string[]): string {
  // 구절에 따른 일반적인 성경적 이미지 힌트
  const hints: string[] = []

  for (const verse of verses) {
    const lowerVerse = verse.toLowerCase()

    // 시편 23편
    if (lowerVerse.includes('시편 23') || lowerVerse.includes('psalm 23')) {
      hints.push('shepherd with sheep in green pastures, still waters, peaceful valley')
    }
    // 요한복음 3:16
    else if (lowerVerse.includes('요한복음 3:16') || lowerVerse.includes('john 3:16')) {
      hints.push('divine love, light from heaven, warm embrace')
    }
    // 이사야
    else if (lowerVerse.includes('이사야') || lowerVerse.includes('isaiah')) {
      hints.push('majestic mountains, strength and comfort')
    }
    // 로마서
    else if (lowerVerse.includes('로마서') || lowerVerse.includes('romans')) {
      hints.push('victorious light, overcoming, triumph')
    }
  }

  return hints.length > 0 ? hints.join(', ') : 'peaceful biblical scene with divine light'
}

/**
 * DALL-E 프롬프트 생성
 */
function buildDallePrompt(params: GenerateImageParams): string {
  const emotionHint = params.emotion
    ? EMOTION_STYLE_HINTS[params.emotion] || ''
    : ''

  const verseHint = extractImageHintFromVerses(params.verseReferences)

  // 기본 스타일: 따뜻한 수채화
  const baseStyle = `
    A warm, comforting watercolor painting style.
    Soft, gentle colors with warm golden and amber tones.
    Light rays gently streaming through, creating a peaceful atmosphere.
    No text, no words, purely visual art.
    Inspirational and uplifting mood.
    Professional quality illustration.
  `.trim()

  const prompt = `
    ${baseStyle}

    Theme: ${emotionHint}
    Scene: ${verseHint}

    Create a serene, comforting scene that conveys peace, hope, and divine comfort.
    The image should feel warm, inviting, and spiritually uplifting.
  `.trim()

  return prompt
}

/**
 * OpenAI DALL-E 3로 이미지 생성
 */
async function generateWithOpenAI(params: GenerateImageParams): Promise<ImageGenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return { success: false, error: 'OpenAI API key not configured' }
  }

  try {
    const openai = new OpenAI({ apiKey })

    const prompt = buildDallePrompt(params)

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      style: 'vivid'
    })

    const imageUrl = response.data[0]?.url

    if (imageUrl) {
      return {
        success: true,
        imageUrl,
        provider: 'openai'
      }
    }

    return { success: false, error: 'No image URL in response' }

  } catch (error: any) {
    console.error('[image-generator] OpenAI error:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Google Gemini로 이미지 생성 (Imagen API)
 * Note: Gemini의 이미지 생성은 별도 API 엔드포인트 필요
 */
async function generateWithGemini(params: GenerateImageParams): Promise<ImageGenerationResult> {
  const apiKey = process.env.GOOGLE_API_KEY

  if (!apiKey) {
    return { success: false, error: 'Google API key not configured' }
  }

  try {
    // Gemini Imagen API 엔드포인트 (imagen-3.0-generate-002)
    const prompt = buildDallePrompt(params)

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImages?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: {
            text: prompt
          },
          sampleCount: 1,
          aspectRatio: '1:1'
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[image-generator] Gemini error:', errorText)
      return { success: false, error: `Gemini API error: ${response.status}` }
    }

    const data = await response.json()

    // Gemini는 base64 이미지를 반환할 수 있음
    const imageData = data.images?.[0]?.imageBytes

    if (imageData) {
      // Base64를 Data URL로 변환
      const imageUrl = `data:image/png;base64,${imageData}`
      return {
        success: true,
        imageUrl,
        provider: 'gemini'
      }
    }

    return { success: false, error: 'No image data in Gemini response' }

  } catch (error: any) {
    console.error('[image-generator] Gemini error:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * 위로 이미지 생성 (fallback 포함)
 */
export async function generateComfortImage(params: GenerateImageParams): Promise<ImageGenerationResult> {
  // 1. OpenAI DALL-E 3 시도
  console.log('[image-generator] Trying OpenAI DALL-E 3...')
  const openaiResult = await generateWithOpenAI(params)

  if (openaiResult.success) {
    return openaiResult
  }

  console.log('[image-generator] OpenAI failed, trying Gemini...')

  // 2. Gemini Imagen fallback
  const geminiResult = await generateWithGemini(params)

  if (geminiResult.success) {
    return geminiResult
  }

  // 3. 모두 실패
  return {
    success: false,
    error: `All providers failed. OpenAI: ${openaiResult.error}, Gemini: ${geminiResult.error}`
  }
}
