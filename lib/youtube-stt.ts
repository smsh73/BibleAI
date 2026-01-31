/**
 * YouTube 동영상 STT (Speech-to-Text) 변환
 * 폴백 체인: YouTube 자막 → OpenAI Whisper → Gemini STT
 * 25MB 초과 파일은 자동으로 분할 처리
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { extractVideoId, fetchTranscript, type TranscriptSegment } from './youtube'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getAllStoredApiKeys } from './supabase'

const execAsync = promisify(exec)

// 최대 파일 크기 (Whisper API 제한)
const MAX_FILE_SIZE_MB = 25
// 청크당 시간 (분) - 약 15-20MB 이하가 되도록
const CHUNK_DURATION_MINUTES = 8

export interface WhisperSegment {
  id: number
  seek: number
  start: number  // seconds
  end: number    // seconds
  text: string
  tokens: number[]
  temperature: number
  avg_logprob: number
  compression_ratio: number
  no_speech_prob: number
}

export interface WhisperTranscript {
  text: string
  segments: WhisperSegment[]
  language: string
  duration: number
}

/**
 * 오디오 파일 길이(초) 가져오기 (ffprobe 사용)
 */
async function getAudioDuration(audioPath: string): Promise<number> {
  try {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    const { stdout } = await execAsync(command)
    return parseFloat(stdout.trim()) || 0
  } catch (error) {
    console.warn('[STT] ffprobe 실패, 기본값 사용')
    return 0
  }
}

/**
 * 오디오 파일을 청크로 분할 (ffmpeg 사용)
 */
async function splitAudioIntoChunks(
  audioPath: string,
  outputDir: string,
  chunkDurationMinutes: number = CHUNK_DURATION_MINUTES
): Promise<string[]> {
  const duration = await getAudioDuration(audioPath)
  const chunkDurationSec = chunkDurationMinutes * 60
  const numChunks = Math.ceil(duration / chunkDurationSec)

  console.log(`[STT] 오디오 분할: ${duration.toFixed(0)}초 → ${numChunks}개 청크 (청크당 ${chunkDurationMinutes}분)`)

  const chunkPaths: string[] = []
  const baseName = path.basename(audioPath, path.extname(audioPath))

  for (let i = 0; i < numChunks; i++) {
    const startSec = i * chunkDurationSec
    const chunkPath = path.join(outputDir, `${baseName}_chunk${i}.m4a`)

    // ffmpeg로 청크 추출
    const command = `ffmpeg -y -i "${audioPath}" -ss ${startSec} -t ${chunkDurationSec} -c copy "${chunkPath}"`

    try {
      await execAsync(command)
      if (fs.existsSync(chunkPath)) {
        chunkPaths.push(chunkPath)
        console.log(`[STT] 청크 ${i + 1}/${numChunks} 생성 완료`)
      }
    } catch (error: any) {
      console.error(`[STT] 청크 ${i + 1} 생성 실패:`, error.message)
    }
  }

  return chunkPaths
}

/**
 * 여러 청크의 Whisper 결과를 병합
 */
function mergeWhisperResults(
  results: WhisperTranscript[],
  chunkDurationSec: number
): WhisperTranscript {
  const mergedSegments: WhisperSegment[] = []
  let totalText = ''
  let totalDuration = 0

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const timeOffset = i * chunkDurationSec

    // 세그먼트의 시간 오프셋 조정
    for (const seg of result.segments) {
      mergedSegments.push({
        ...seg,
        id: mergedSegments.length,
        start: seg.start + timeOffset,
        end: seg.end + timeOffset,
      })
    }

    totalText += (totalText ? ' ' : '') + result.text
    totalDuration = Math.max(totalDuration, timeOffset + result.duration)
  }

  return {
    text: totalText,
    segments: mergedSegments,
    language: results[0]?.language || 'ko',
    duration: totalDuration,
  }
}

/**
 * YouTube 동영상에서 오디오 다운로드 (yt-dlp 사용)
 * YouTube SABR 스트리밍 제한을 우회하기 위해 브라우저 쿠키 사용
 */
export async function downloadYouTubeAudio(
  videoUrl: string,
  outputPath: string
): Promise<string> {
  const videoId = extractVideoId(videoUrl)

  if (!videoId) {
    throw new Error('유효하지 않은 YouTube URL입니다.')
  }

  // 브라우저 쿠키 옵션 (SABR 스트리밍 제한 우회용)
  // 우선순위: Chrome → Firefox → Safari → 쿠키 없이 시도
  const browserOptions = ['chrome', 'firefox', 'safari', '']

  for (const browser of browserOptions) {
    try {
      // yt-dlp를 사용하여 오디오 다운로드
      // -f bestaudio: 최상 품질 오디오 (SABR 우회 시 더 안정적)
      // --cookies-from-browser: 브라우저 쿠키 사용 (YouTube 인증)
      // -x: 오디오만 추출
      // --audio-format m4a: m4a 형식으로 변환
      // -o: 출력 파일 경로
      const cookieOption = browser ? `--cookies-from-browser ${browser}` : ''
      const command = `yt-dlp -f "bestaudio[ext=m4a]/bestaudio/best" ${cookieOption} -x --audio-format m4a -o "${outputPath}" "${videoUrl}"`

      const browserName = browser || '쿠키 없이'
      console.log(`[STT] yt-dlp 다운로드 시도 (${browserName})...`)
      await execAsync(command, { maxBuffer: 100 * 1024 * 1024, timeout: 600000 })

      // yt-dlp는 파일 확장자를 자동으로 .m4a로 변경하므로 경로 수정
      const m4aPath = outputPath.replace(/\.\w+$/, '.m4a')

      if (fs.existsSync(m4aPath)) {
        console.log(`[STT] 다운로드 성공 (${browserName})`)
        return m4aPath
      } else if (fs.existsSync(outputPath)) {
        console.log(`[STT] 다운로드 성공 (${browserName})`)
        return outputPath
      }
    } catch (error: any) {
      const browserName = browser || '쿠키 없이'
      console.warn(`[STT] ${browserName} 다운로드 실패: ${error.message}`)
      // 다음 브라우저로 시도
      continue
    }
  }

  throw new Error('오디오 다운로드 실패: 모든 방법 실패 (SABR 제한 또는 네트워크 오류)')
}

/**
 * 단일 오디오 파일을 Whisper API로 변환 (25MB 이하)
 */
async function transcribeSingleAudio(
  audioFilePath: string,
  openai: OpenAI
): Promise<WhisperTranscript> {
  console.log(`[STT] Whisper API 호출 중: ${path.basename(audioFilePath)}`)

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioFilePath),
    model: 'whisper-1',
    language: 'ko', // 한국어
    response_format: 'verbose_json', // 타임스탬프 포함
    timestamp_granularities: ['segment'], // 세그먼트 단위 타임스탬프
  })

  console.log(`[STT] 변환 완료: ${transcription.text.length}자`)

  return {
    text: transcription.text,
    segments: (transcription as any).segments || [],
    language: transcription.language || 'ko',
    duration: (transcription as any).duration || 0,
  }
}

/**
 * Whisper API로 오디오 파일을 텍스트로 변환
 * 25MB 초과 시 자동으로 분할 처리
 */
export async function transcribeAudioWithWhisper(
  audioFilePath: string,
  apiKey?: string
): Promise<WhisperTranscript> {
  // API 키 가져오기
  const openaiKey = apiKey || process.env.OPENAI_API_KEY

  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.')
  }

  const openai = new OpenAI({ apiKey: openaiKey })

  // 파일 크기 확인
  const stats = fs.statSync(audioFilePath)
  const fileSizeMB = stats.size / (1024 * 1024)

  console.log(`[STT] 오디오 파일 크기: ${fileSizeMB.toFixed(2)}MB`)

  // 25MB 이하면 직접 처리
  if (fileSizeMB <= MAX_FILE_SIZE_MB) {
    return transcribeSingleAudio(audioFilePath, openai)
  }

  // 25MB 초과: 청크로 분할 처리
  console.log(`[STT] 파일 크기 초과 (${fileSizeMB.toFixed(2)}MB > ${MAX_FILE_SIZE_MB}MB), 분할 처리 시작`)

  const tmpDir = path.dirname(audioFilePath)
  const chunkPaths = await splitAudioIntoChunks(audioFilePath, tmpDir, CHUNK_DURATION_MINUTES)

  if (chunkPaths.length === 0) {
    throw new Error('오디오 분할 실패')
  }

  try {
    // 각 청크 변환
    const results: WhisperTranscript[] = []
    let quotaErrorCount = 0
    let lastQuotaError: Error | null = null

    for (let i = 0; i < chunkPaths.length; i++) {
      console.log(`[STT] 청크 ${i + 1}/${chunkPaths.length} 변환 중...`)

      try {
        const result = await transcribeSingleAudio(chunkPaths[i], openai)
        results.push(result)
      } catch (error: any) {
        console.error(`[STT] 청크 ${i + 1} 변환 실패:`, error.message)

        // 429 할당량 오류 감지
        if (error.message?.includes('429') || error.message?.includes('quota')) {
          quotaErrorCount++
          lastQuotaError = error

          // 연속 2번 이상 할당량 오류 시 즉시 중단 (Gemini 폴백 트리거)
          if (quotaErrorCount >= 2) {
            console.log(`[STT] OpenAI 할당량 초과 (${quotaErrorCount}회 연속), Gemini 폴백 시도...`)
            throw new Error(`OpenAI 할당량 초과: ${error.message}`)
          }
        }

        // 빈 결과 추가 (시간 오프셋 유지를 위해)
        results.push({
          text: '',
          segments: [],
          language: 'ko',
          duration: CHUNK_DURATION_MINUTES * 60,
        })
      }

      // API 요청 간 간격
      if (i < chunkPaths.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    // 모든 청크가 실패한 경우 에러 발생
    const successCount = results.filter(r => r.text.length > 0).length
    if (successCount === 0 && results.length > 0) {
      throw new Error('모든 청크 변환 실패')
    }

    // 결과 병합
    const merged = mergeWhisperResults(results, CHUNK_DURATION_MINUTES * 60)
    console.log(`[STT] 총 ${results.length}개 청크 병합 완료 (성공: ${successCount}개): ${merged.text.length}자`)

    return merged

  } finally {
    // 청크 파일들 삭제
    for (const chunkPath of chunkPaths) {
      if (fs.existsSync(chunkPath)) {
        fs.unlinkSync(chunkPath)
      }
    }
  }
}

/**
 * YouTube 자막을 WhisperTranscript 형식으로 변환
 */
function convertYouTubeTranscript(segments: TranscriptSegment[]): WhisperTranscript {
  const whisperSegments: WhisperSegment[] = segments.map((seg, idx) => ({
    id: idx,
    seek: 0,
    start: seg.start,
    end: seg.start + seg.duration,
    text: seg.text,
    tokens: [],
    temperature: 0,
    avg_logprob: 0,
    compression_ratio: 0,
    no_speech_prob: 0
  }))

  const totalDuration = segments.length > 0
    ? segments[segments.length - 1].start + segments[segments.length - 1].duration
    : 0

  return {
    text: segments.map(s => s.text).join(' '),
    segments: whisperSegments,
    language: 'ko',
    duration: totalDuration
  }
}

/**
 * 단일 오디오 청크를 Gemini로 변환
 */
async function transcribeSingleChunkWithGemini(
  audioFilePath: string,
  genAI: GoogleGenerativeAI
): Promise<string> {
  const audioData = fs.readFileSync(audioFilePath)
  const base64Audio = audioData.toString('base64')

  const ext = path.extname(audioFilePath).toLowerCase()
  const mimeType = ext === '.mp3' ? 'audio/mp3'
    : ext === '.wav' ? 'audio/wav'
    : ext === '.m4a' ? 'audio/mp4'
    : 'audio/mpeg'

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Audio
      }
    },
    {
      text: `이 오디오 파일의 내용을 한국어로 정확하게 받아적어주세요.
설교나 강연 내용입니다. 말하는 내용을 최대한 정확하게 텍스트로 변환해주세요.
타임스탬프 없이 순수 텍스트만 출력해주세요.`
    }
  ])

  return result.response.text()
}

/**
 * Gemini로 오디오 파일 STT 변환
 * 20MB 초과 시 자동으로 분할 처리
 */
async function transcribeAudioWithGemini(
  audioFilePath: string
): Promise<WhisperTranscript> {
  // API 키 가져오기 (관리자 저장 키 우선)
  let googleKey: string | undefined

  try {
    const keys = await getAllStoredApiKeys()
    googleKey = keys.google
  } catch {
    // 관리자 키 없으면 환경변수 사용
  }

  googleKey = googleKey || process.env.GOOGLE_API_KEY

  if (!googleKey) {
    throw new Error('Google API 키가 설정되지 않았습니다.')
  }

  const genAI = new GoogleGenerativeAI(googleKey)

  // 파일 크기 확인
  const stats = fs.statSync(audioFilePath)
  const fileSizeMB = stats.size / (1024 * 1024)

  console.log(`[STT-Gemini] Gemini STT 시도 중... (파일 크기: ${fileSizeMB.toFixed(2)}MB)`)

  let transcribedText: string

  // 20MB 이하면 직접 처리
  if (fileSizeMB <= 20) {
    transcribedText = await transcribeSingleChunkWithGemini(audioFilePath, genAI)
  } else {
    // 20MB 초과: 청크로 분할 처리
    console.log(`[STT-Gemini] 파일 크기 초과 (${fileSizeMB.toFixed(2)}MB > 20MB), 분할 처리 시작`)

    const tmpDir = path.dirname(audioFilePath)
    const chunkPaths = await splitAudioIntoChunks(audioFilePath, tmpDir, 6) // 6분 청크 (약 15MB)

    if (chunkPaths.length === 0) {
      throw new Error('오디오 분할 실패')
    }

    try {
      const textParts: string[] = []

      for (let i = 0; i < chunkPaths.length; i++) {
        console.log(`[STT-Gemini] 청크 ${i + 1}/${chunkPaths.length} 변환 중...`)

        try {
          const chunkText = await transcribeSingleChunkWithGemini(chunkPaths[i], genAI)
          textParts.push(chunkText)
          console.log(`[STT-Gemini] 청크 ${i + 1} 완료: ${chunkText.length}자`)
        } catch (error: any) {
          console.error(`[STT-Gemini] 청크 ${i + 1} 실패:`, error.message)
          // 실패한 청크는 건너뜀
        }

        // API 요청 간 간격
        if (i < chunkPaths.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      transcribedText = textParts.join(' ')
      console.log(`[STT-Gemini] 총 ${chunkPaths.length}개 청크 병합 완료: ${transcribedText.length}자`)

    } finally {
      // 청크 파일들 삭제
      for (const chunkPath of chunkPaths) {
        if (fs.existsSync(chunkPath)) {
          fs.unlinkSync(chunkPath)
        }
      }
    }
  }

  console.log(`[STT-Gemini] Gemini STT 완료: ${transcribedText.length}자`)

  // 텍스트를 세그먼트로 분할 (대략적인 분할)
  const sentences = transcribedText.split(/[.!?。]\s*/).filter(s => s.trim())
  const avgDuration = 5 // 문장당 평균 5초로 추정

  const segments: WhisperSegment[] = sentences.map((text, idx) => ({
    id: idx,
    seek: 0,
    start: idx * avgDuration,
    end: (idx + 1) * avgDuration,
    text: text.trim(),
    tokens: [],
    temperature: 0,
    avg_logprob: 0,
    compression_ratio: 0,
    no_speech_prob: 0
  }))

  return {
    text: transcribedText,
    segments,
    language: 'ko',
    duration: sentences.length * avgDuration
  }
}

/**
 * 전체 파이프라인: YouTube URL -> STT 텍스트
 * 폴백 체인: YouTube 자막 → OpenAI Whisper → Gemini STT
 */
export async function youtubeToText(
  videoUrl: string,
  startTime?: number,
  endTime?: number,
  apiKey?: string
): Promise<WhisperTranscript> {
  const videoId = extractVideoId(videoUrl)

  if (!videoId) {
    throw new Error('유효하지 않은 YouTube URL입니다.')
  }

  // 1. 먼저 YouTube 자막 시도 (무료)
  try {
    console.log(`[STT] YouTube 자막 추출 시도 중: ${videoId}`)
    const ytSegments = await fetchTranscript(videoUrl)

    if (ytSegments && ytSegments.length > 0) {
      console.log(`[STT] YouTube 자막 추출 성공: ${ytSegments.length}개 세그먼트`)
      let transcript = convertYouTubeTranscript(ytSegments)

      // 시간 범위 필터링
      if (startTime !== undefined && endTime !== undefined) {
        const filteredSegments = transcript.segments.filter(seg =>
          seg.start >= startTime && seg.end <= endTime
        )
        transcript = {
          ...transcript,
          segments: filteredSegments,
          text: filteredSegments.map(s => s.text).join(' ')
        }
      }

      return transcript
    }
  } catch (error: any) {
    console.warn(`[STT] YouTube 자막 추출 실패: ${error.message}`)
  }

  // 임시 디렉토리 생성
  const tmpDir = path.join(process.cwd(), 'tmp')
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
  }

  const audioPath = path.join(tmpDir, `${videoId}.m4a`)
  let downloadedPath: string | undefined

  try {
    console.log(`[STT] YouTube 오디오 다운로드 중: ${videoId}`)
    downloadedPath = await downloadYouTubeAudio(videoUrl, audioPath)
    console.log(`[STT] 오디오 다운로드 완료: ${downloadedPath}`)

    // 2. OpenAI Whisper 시도
    let whisperErrorMsg = ''
    try {
      console.log(`[STT] OpenAI Whisper 시도...`)
      const transcript = await transcribeAudioWithWhisper(downloadedPath, apiKey)
      console.log(`[STT] OpenAI Whisper 성공`)

      // 시간 범위 필터링
      if (startTime !== undefined && endTime !== undefined) {
        const filteredSegments = transcript.segments.filter(seg =>
          seg.start >= startTime && seg.end <= endTime
        )
        return {
          ...transcript,
          segments: filteredSegments,
          text: filteredSegments.map(s => s.text).join(' ')
        }
      }

      return transcript
    } catch (whisperError: any) {
      whisperErrorMsg = whisperError.message || 'Unknown error'
      console.warn(`[STT] OpenAI Whisper 실패: ${whisperErrorMsg}`)
    }

    // 3. Gemini 폴백
    try {
      console.log(`[STT] Gemini 폴백 시도...`)
      const transcript = await transcribeAudioWithGemini(downloadedPath)
      console.log(`[STT] Gemini STT 성공`)

      // 시간 범위 필터링
      if (startTime !== undefined && endTime !== undefined) {
        const filteredSegments = transcript.segments.filter(seg =>
          seg.start >= startTime && seg.end <= endTime
        )
        return {
          ...transcript,
          segments: filteredSegments,
          text: filteredSegments.map(s => s.text).join(' ')
        }
      }

      return transcript
    } catch (geminiError: any) {
      const geminiErrorMsg = geminiError.message || 'Unknown error'
      console.warn(`[STT] Gemini 폴백 실패: ${geminiErrorMsg}`)
      throw new Error(`모든 STT 서비스 실패. Whisper: ${whisperErrorMsg}, Gemini: ${geminiErrorMsg}`)
    }

  } finally {
    // 임시 파일 삭제
    if (downloadedPath && fs.existsSync(downloadedPath)) {
      fs.unlinkSync(downloadedPath)
      console.log(`[STT] 임시 파일 삭제: ${downloadedPath}`)
    }
  }
}

/**
 * Whisper 세그먼트를 우리 형식으로 변환
 */
export function convertWhisperSegments(whisperSegments: WhisperSegment[]): Array<{
  text: string
  start: number
  duration: number
}> {
  return whisperSegments.map(seg => ({
    text: seg.text.trim(),
    start: seg.start,
    duration: seg.end - seg.start,
  }))
}
