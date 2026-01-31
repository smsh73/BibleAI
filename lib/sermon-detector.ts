/**
 * AI 기반 설교 구간 자동 감지
 *
 * 전략:
 * 1. 전체 동영상을 STT로 변환
 * 2. AI로 텍스트 분석하여 설교 시작/종료 지점 찾기
 * 3. 타임스탬프로 정확한 구간 반환
 */

import OpenAI from 'openai'
import type { WhisperSegment } from './youtube-stt'

export interface SermonBoundary {
  start: number      // 시작 시간 (초)
  end: number        // 종료 시간 (초)
  confidence: number // 신뢰도 (0~1)
  reasoning: string  // 판단 근거
}

/**
 * 키워드 기반 1차 필터링
 */
export function detectSermonByKeywords(
  segments: WhisperSegment[]
): SermonBoundary | null {
  // 찬양/성가대 관련 키워드 (이 이후에 설교 시작)
  const choirKeywords = [
    '찬양', '성가대', '합창', '특송',
    '노래', '찬송가', '찬송'
  ]

  // 설교 시작 전환 키워드 (찬양 직후 나타남)
  const sermonStartKeywords = [
    '우리 찬양대', '감사합니다', '아멘',
    '사랑하는', '성도', '여러분',
    '말씀', '설교', '본문', '오늘',
    '간절히', '바랍니다', '함께'
  ]

  // 헌금/봉헌 관련 키워드 (설교 종료 후)
  const offeringKeywords = [
    '봉헌', '헌금', '드리', '드림',
    '십일조', '감사헌금', '예물'
  ]

  let choirEndIndex = -1
  let offeringStartIndex = -1
  let sermonStartIndex = -1

  // 1. 찬양 종료 지점 찾기 (마지막 찬양 관련 언급)
  for (let i = 0; i < segments.length; i++) {
    const text = segments[i].text.toLowerCase()
    if (choirKeywords.some(keyword => text.includes(keyword))) {
      choirEndIndex = i
    }
  }

  // 2. 설교 시작 지점 찾기 (찬양 이후 첫 설교 키워드)
  if (choirEndIndex !== -1) {
    for (let i = choirEndIndex + 1; i < segments.length; i++) {
      const text = segments[i].text.toLowerCase()
      if (sermonStartKeywords.some(keyword => text.includes(keyword))) {
        sermonStartIndex = i
        break
      }
    }
  }

  // 3. 헌금 시작 지점 찾기
  const searchStart = sermonStartIndex !== -1 ? sermonStartIndex : choirEndIndex + 1
  for (let i = searchStart; i < segments.length; i++) {
    const text = segments[i].text.toLowerCase()
    if (offeringKeywords.some(keyword => text.includes(keyword))) {
      offeringStartIndex = i
      break
    }
  }

  // 구간을 찾지 못한 경우
  if (sermonStartIndex === -1 || offeringStartIndex === -1) {
    // 전체의 20% ~ 80% 구간을 설교로 추정
    const startIdx = Math.floor(segments.length * 0.2)
    const endIdx = Math.floor(segments.length * 0.8)

    if (segments.length === 0) {
      return null
    }

    return {
      start: segments[startIdx]?.start || 0,
      end: segments[endIdx]?.end || segments[segments.length - 1].end,
      confidence: 0.3,
      reasoning: '키워드를 찾지 못해 전체의 20-80% 구간을 설교로 추정했습니다.'
    }
  }

  return {
    start: segments[sermonStartIndex].start,
    end: segments[offeringStartIndex].start,
    confidence: 0.7,
    reasoning: `설교 시작: "${segments[sermonStartIndex].text.substring(0, 30)}...", 헌금 시작: "${segments[offeringStartIndex].text.substring(0, 30)}..."`
  }
}

/**
 * AI 기반 정밀 분석
 * GPT/Claude를 사용하여 텍스트 분석
 */
export async function detectSermonByAI(
  segments: WhisperSegment[],
  apiKey?: string
): Promise<SermonBoundary | null> {
  const openaiKey = apiKey || process.env.OPENAI_API_KEY

  if (!openaiKey) {
    console.warn('[AI 감지] OPENAI_API_KEY가 없어 키워드 기반으로 대체합니다.')
    return detectSermonByKeywords(segments)
  }

  const openai = new OpenAI({ apiKey: openaiKey })

  // 전체 텍스트를 타임스탬프와 함께 준비
  const textWithTimestamps = segments.map((seg, idx) => {
    return `[${formatTime(seg.start)} - ${formatTime(seg.end)}] ${seg.text}`
  }).join('\n')

  // GPT에게 분석 요청
  const prompt = `주일 예배 영상의 음성을 텍스트로 변환한 내용입니다.
각 줄은 [시작시간 - 종료시간] 발화내용 형식입니다.

${textWithTimestamps}

예배 순서: 기도 → 성경말씀 낭독 → 성가대 찬양 → **설교** → 봉헌찬송 → 봉헌기도

당신의 임무: **설교 시작 시간**과 **설교 종료 시간**을 찾으세요.

1. 설교 시작 찾기:
   - 성가대 찬양이 완전히 끝난 직후
   - 찬양 가사("주님께 드립니다", "사랑해 주님", "예수 예수" 등)가 끝나고
   - "아멘", "감사합니다" 후에
   - 목사님이 직접 회중에게 말씀을 시작하는 지점
   - 예: "우리 찬양대의 고백처럼", "사랑하는 성도 여러분", "간절히 바랍니다"

   ⚠️ 주의: 기도 중에 설교 제목을 소개하는 부분("이 시간 ~ 제목으로 말씀을 전하시는")은 설교 시작이 아닙니다!
   찬양이 모두 끝난 후 목사님이 직접 말씀을 시작하는 지점을 찾으세요.

2. 설교 종료 찾기:
   - 설교 메시지가 완전히 끝난 지점
   - "봉헌", "헌금", "드림" 등이 나오기 직전

3. 설교는 보통 20-40분 이상입니다.

JSON으로만 응답:
{
  "startTime": "MM:SS",
  "endTime": "MM:SS",
  "confidence": 0.95,
  "reasoning": "시작/종료를 선택한 이유"
}`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '당신은 교회 예배 영상 분석 전문가입니다. 설교 구간을 정확하게 찾아냅니다.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    })

    const result = JSON.parse(response.choices[0].message.content || '{}')

    // 시간 파싱 (MM:SS -> 초)
    const startSeconds = parseTimeToSeconds(result.startTime)
    const endSeconds = parseTimeToSeconds(result.endTime)

    if (startSeconds === null || endSeconds === null) {
      throw new Error('시간 파싱 실패')
    }

    // 설교 길이 검증 (최소 20분)
    const duration = endSeconds - startSeconds
    if (duration < 1200) { // 20분 미만
      console.warn(`[AI 감지] 설교 길이가 너무 짧습니다 (${Math.floor(duration / 60)}분). 키워드 기반으로 대체합니다.`)
      return detectSermonByKeywords(segments)
    }

    return {
      start: startSeconds,
      end: endSeconds,
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning || 'AI 분석 결과'
    }
  } catch (error: any) {
    console.error('[AI 감지 실패]', error.message)
    // AI 실패 시 키워드 기반으로 폴백
    return detectSermonByKeywords(segments)
  }
}

/**
 * 하이브리드 접근: 키워드 + AI
 */
export async function detectSermonBoundary(
  segments: WhisperSegment[],
  useAI: boolean = true,
  apiKey?: string
): Promise<SermonBoundary> {
  if (segments.length === 0) {
    return {
      start: 0,
      end: 0,
      confidence: 0,
      reasoning: '세그먼트가 없습니다.'
    }
  }

  // 1차: 키워드 기반
  const keywordResult = detectSermonByKeywords(segments)

  if (!useAI || !keywordResult) {
    return keywordResult || {
      start: 0,
      end: segments[segments.length - 1].end,
      confidence: 0.1,
      reasoning: '구간을 찾을 수 없습니다.'
    }
  }

  // 2차: AI 기반 (더 정확)
  try {
    const aiResult = await detectSermonByAI(segments, apiKey)

    if (aiResult && aiResult.confidence > 0.6) {
      return aiResult
    }

    // AI 신뢰도가 낮으면 키워드 결과 반환
    return keywordResult
  } catch (error) {
    return keywordResult
  }
}

// 유틸리티 함수
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function parseTimeToSeconds(timeStr: string): number | null {
  // MM:SS 또는 HH:MM:SS 형식 파싱
  const parts = timeStr.split(':').map(Number)

  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1]
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }

  return null
}
