/**
 * 팟캐스트 오디오 생성 서비스
 * - OpenAI TTS → Google Cloud TTS 순서로 fallback
 * - 60대 남성 목사님의 따뜻한 베이스톤 음성
 */

import OpenAI from 'openai'

interface AudioGenerationResult {
  success: boolean
  audioUrl?: string
  audioBase64?: string
  provider?: 'openai' | 'google'
  error?: string
}

interface GenerateAudioParams {
  question: string
  answer: string
  verseReferences: string[]
}

/**
 * 팟캐스트 스타일 텍스트 생성
 * - 60대 남성 목사님의 따뜻하고 친절한 팟캐스트 형식
 */
function buildPodcastScript(params: GenerateAudioParams): string {
  // 성경 구절 참조를 텍스트로 정리
  const versesText = params.verseReferences.length > 0
    ? params.verseReferences.slice(0, 3).join(', ')
    : ''

  // 팟캐스트 스크립트 구조
  const script = `
안녕하세요. 오늘도 말씀을 함께 나눌 수 있어서 참 기쁩니다.

${params.answer}

${versesText ? `오늘 나눈 말씀은 ${versesText}이었습니다.` : ''}

이 말씀이 여러분의 마음에 위로와 평안이 되기를 소망합니다.
주님의 사랑과 평강이 늘 함께하시길 축복합니다.
  `.trim()

  return script
}

/**
 * OpenAI TTS로 오디오 생성
 * - 음성: "onyx" (남성, 깊고 따뜻한 베이스톤)
 */
async function generateWithOpenAI(params: GenerateAudioParams): Promise<AudioGenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return { success: false, error: 'OpenAI API key not configured' }
  }

  try {
    const openai = new OpenAI({ apiKey })
    const script = buildPodcastScript(params)

    // 스크립트가 너무 길면 자르기 (TTS 제한)
    const maxLength = 4000
    const trimmedScript = script.length > maxLength
      ? script.substring(0, maxLength) + '...'
      : script

    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'onyx', // 깊고 따뜻한 남성 음성
      input: trimmedScript,
      speed: 0.95 // 약간 느리게 (차분하고 여유로운 느낌)
    })

    // ArrayBuffer를 Base64로 변환
    const buffer = Buffer.from(await response.arrayBuffer())
    const audioBase64 = buffer.toString('base64')
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`

    return {
      success: true,
      audioUrl,
      audioBase64,
      provider: 'openai'
    }

  } catch (error: any) {
    console.error('[audio-generator] OpenAI TTS error:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Google Cloud TTS로 오디오 생성
 * - 한국어 남성 음성 (ko-KR-Wavenet-C 또는 ko-KR-Standard-C)
 */
async function generateWithGoogle(params: GenerateAudioParams): Promise<AudioGenerationResult> {
  const apiKey = process.env.GOOGLE_API_KEY

  if (!apiKey) {
    return { success: false, error: 'Google API key not configured' }
  }

  try {
    const script = buildPodcastScript(params)

    // 스크립트 길이 제한
    const maxLength = 5000
    const trimmedScript = script.length > maxLength
      ? script.substring(0, maxLength) + '...'
      : script

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: {
            text: trimmedScript
          },
          voice: {
            languageCode: 'ko-KR',
            name: 'ko-KR-Wavenet-C', // 남성 음성
            ssmlGender: 'MALE'
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 0.9, // 약간 느리게
            pitch: -2.0, // 낮은 음조 (베이스톤)
            volumeGainDb: 0
          }
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[audio-generator] Google TTS error:', errorText)
      return { success: false, error: `Google TTS API error: ${response.status}` }
    }

    const data = await response.json()
    const audioBase64 = data.audioContent

    if (audioBase64) {
      const audioUrl = `data:audio/mpeg;base64,${audioBase64}`
      return {
        success: true,
        audioUrl,
        audioBase64,
        provider: 'google'
      }
    }

    return { success: false, error: 'No audio content in Google TTS response' }

  } catch (error: any) {
    console.error('[audio-generator] Google TTS error:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * 팟캐스트 오디오 생성 (fallback 포함)
 */
export async function generatePodcastAudio(params: GenerateAudioParams): Promise<AudioGenerationResult> {
  // 1. OpenAI TTS 시도
  console.log('[audio-generator] Trying OpenAI TTS...')
  const openaiResult = await generateWithOpenAI(params)

  if (openaiResult.success) {
    return openaiResult
  }

  console.log('[audio-generator] OpenAI failed, trying Google TTS...')

  // 2. Google TTS fallback
  const googleResult = await generateWithGoogle(params)

  if (googleResult.success) {
    return googleResult
  }

  // 3. 모두 실패
  return {
    success: false,
    error: `All providers failed. OpenAI: ${openaiResult.error}, Google: ${googleResult.error}`
  }
}
