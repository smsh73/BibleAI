/**
 * 팟캐스트 오디오 생성 서비스
 * - ElevenLabs (클론 음성) → OpenAI TTS → Google Cloud TTS 순서로 fallback
 * - 목사님의 실제 음성을 클론하여 자연스러운 팟캐스트 생성
 */

import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

interface AudioGenerationResult {
  success: boolean
  audioUrl?: string
  audioBase64?: string
  provider?: 'elevenlabs' | 'openai' | 'google'
  error?: string
}

interface GenerateAudioParams {
  question: string
  answer: string
  verseReferences: string[]
}

/**
 * 데이터베이스에서 Voice ID 가져오기
 * - 관리자 페이지에서 설정한 Voice ID 우선 사용
 * - 없으면 환경 변수 사용
 */
async function getVoiceId(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'voice_settings')
      .single()

    if (!error && data) {
      const settings = JSON.parse(data.value as string)
      return settings.voice_id || null
    }
  } catch (error) {
    console.warn('[audio-generator] Failed to fetch voice settings from DB, using env:', error)
  }

  // Fallback to env variable
  return process.env.ELEVENLABS_VOICE_ID || null
}

/**
 * TTS용 텍스트 전처리
 * - 성경 구절 형식을 자연스러운 읽기 형식으로 변환
 * - 책 참조를 자연스러운 문장으로 변환
 * - 이모지 제거
 */
function preprocessTextForTTS(text: string): string {
  let processed = text

  // 이모지 제거
  processed = processed.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|📚|📖|✝️|🙏|💡|⭐|🌟|❤️|💕|🔥|✨/gu, '')

  // 성경 구절 형식 변환: "시편 37:5" → "시편 37장 5절"
  // 패턴: 책이름 장:절 또는 책이름 장:절-절
  processed = processed.replace(/(\d+):(\d+)(?:-(\d+))?/g, (match, chapter, verseStart, verseEnd) => {
    if (verseEnd) {
      return `${chapter}장 ${verseStart}절에서 ${verseEnd}절`
    }
    return `${chapter}장 ${verseStart}절`
  })

  // 책 참조 형식 변환: "팀 켈러 - 기도" → "팀 켈러의 기도라는 책에서"
  processed = processed.replace(/([가-힣a-zA-Z\s]+)\s*[-–—]\s*([가-힣a-zA-Z\s]+)/g, (match, author, bookTitle) => {
    const trimmedAuthor = author.trim()
    const trimmedTitle = bookTitle.trim()
    // 저자 이름과 책 제목이 각각 2글자 이상인 경우에만 변환
    if (trimmedAuthor.length >= 2 && trimmedTitle.length >= 1) {
      return `${trimmedAuthor}의 ${trimmedTitle}라는 책에서`
    }
    return match
  })

  // 연속된 공백 정리
  processed = processed.replace(/\s+/g, ' ')

  // 문장 끝에 자연스러운 쉼표 추가 (억양 조절)
  processed = processed.replace(/\.\s+/g, '.\n')

  return processed.trim()
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

  // 본문 전처리
  const processedAnswer = preprocessTextForTTS(params.answer)
  const processedVerses = preprocessTextForTTS(versesText)

  // 팟캐스트 스크립트 구조
  const script = `
안녕하세요. 오늘도 말씀을 함께 나눌 수 있어서 참 기쁩니다.

${processedAnswer}

${processedVerses ? `오늘 나눈 말씀은 ${processedVerses} 이었습니다.` : ''}

오늘 이 말씀이 여러분의 마음에 위로와 평안이 되기를 소망합니다.
주님의 사랑과 평강이 늘 함께하시길 축복합니다.
  `.trim()

  return script
}

/**
 * ElevenLabs TTS로 오디오 생성 (클론 음성)
 * - 목사님의 실제 음성을 학습한 커스텀 보이스 사용
 */
async function generateWithElevenLabs(params: GenerateAudioParams): Promise<AudioGenerationResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = await getVoiceId()

  if (!apiKey || !voiceId) {
    return { success: false, error: 'ElevenLabs API key or Voice ID not configured' }
  }

  console.log('[audio-generator] Using Voice ID:', voiceId)

  try {
    const script = buildPodcastScript(params)

    // ElevenLabs 최대 길이 제한 (약 5000자)
    const maxLength = 5000
    const trimmedScript = script.length > maxLength
      ? script.substring(0, maxLength) + '...'
      : script

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        body: JSON.stringify({
          text: trimmedScript,
          model_id: 'eleven_multilingual_v2', // 다국어 지원 (한국어 포함)
          voice_settings: {
            stability: 0.75,       // 음성 안정성 높임 (늘어짐 방지)
            similarity_boost: 0.85, // 원본 음성 유사도
            style: 0.15,           // 스타일 낮춤 (차분한 어조, 억양 내림)
            use_speaker_boost: true
          }
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[audio-generator] ElevenLabs TTS error:', errorText)
      return { success: false, error: `ElevenLabs API error: ${response.status}` }
    }

    // ArrayBuffer를 Base64로 변환
    const buffer = Buffer.from(await response.arrayBuffer())
    const audioBase64 = buffer.toString('base64')
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`

    return {
      success: true,
      audioUrl,
      audioBase64,
      provider: 'elevenlabs'
    }

  } catch (error: any) {
    console.error('[audio-generator] ElevenLabs TTS error:', error.message)
    return { success: false, error: error.message }
  }
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
      voice: 'echo', // 부드럽고 따뜻한 남성 음성
      input: trimmedScript,
      speed: 0.92 // 천천히 (더욱 차분하고 따뜻한 느낌)
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
 * 우선순위: ElevenLabs (클론 음성) → OpenAI TTS → Google TTS
 */
export async function generatePodcastAudio(params: GenerateAudioParams): Promise<AudioGenerationResult> {
  // 1. ElevenLabs TTS 시도 (클론 음성)
  console.log('[audio-generator] Trying ElevenLabs TTS (cloned voice)...')
  const elevenLabsResult = await generateWithElevenLabs(params)

  if (elevenLabsResult.success) {
    console.log('[audio-generator] ElevenLabs TTS success!')
    return elevenLabsResult
  }

  console.log('[audio-generator] ElevenLabs failed, trying OpenAI TTS...')

  // 2. OpenAI TTS fallback
  const openaiResult = await generateWithOpenAI(params)

  if (openaiResult.success) {
    return openaiResult
  }

  console.log('[audio-generator] OpenAI failed, trying Google TTS...')

  // 3. Google TTS fallback
  const googleResult = await generateWithGoogle(params)

  if (googleResult.success) {
    return googleResult
  }

  // 4. 모두 실패
  return {
    success: false,
    error: `All providers failed. ElevenLabs: ${elevenLabsResult.error}, OpenAI: ${openaiResult.error}, Google: ${googleResult.error}`
  }
}
