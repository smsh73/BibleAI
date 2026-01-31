/**
 * 설교 구간 감지 알고리즘만 테스트 (STT 없이)
 * 모의 데이터로 키워드 기반 감지 테스트
 */

import { detectSermonByKeywords, detectSermonByAI } from '../lib/sermon-detector'
import type { WhisperSegment } from '../lib/youtube-stt'

// 모의 세그먼트 데이터 (실제 예배 순서 시뮬레이션)
const mockSegments: WhisperSegment[] = [
  // 0~5분: 예배 시작
  { id: 0, text: "안녕하세요 환영합니다", start: 0, end: 5, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 1, text: "오늘도 함께 예배드리겠습니다", start: 5, end: 10, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },

  // 5~17분: 찬양
  { id: 2, text: "이제 찬양을 드리겠습니다", start: 300, end: 305, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 3, text: "성가대의 특송을 듣겠습니다", start: 600, end: 605, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 4, text: "아름다운 노래입니다", start: 900, end: 905, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },

  // 17~18분: 설교 시작
  { id: 5, text: "이제 하나님의 말씀을 전하겠습니다", start: 1020, end: 1025, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 6, text: "오늘 본문은 요한복음입니다", start: 1025, end: 1030, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 7, text: "함께 성경을 펴주시기 바랍니다", start: 1030, end: 1035, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },

  // 18~45분: 설교 본문
  { id: 8, text: "사랑하는 성도 여러분", start: 1200, end: 1205, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 9, text: "오늘 우리가 나눌 말씀은", start: 1800, end: 1805, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 10, text: "첫째로 둘째로 셋째로", start: 2100, end: 2105, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 11, text: "하나님께서 우리에게 주신", start: 2400, end: 2405, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },

  // 45~46분: 설교 종료, 헌금 시작
  { id: 12, text: "이제 말씀을 마치겠습니다", start: 2700, end: 2705, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 13, text: "감사의 헌금을 드리겠습니다", start: 2760, end: 2765, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 14, text: "하나님께 드림니다", start: 2765, end: 2770, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },

  // 46~50분: 봉헌 기도, 축도
  { id: 15, text: "봉헌 기도를 드리겠습니다", start: 2800, end: 2805, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  { id: 16, text: "축복합니다 아멘", start: 2900, end: 2905, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
]

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

async function testKeywordDetection() {
  console.log('='.repeat(70))
  console.log('키워드 기반 설교 구간 감지 테스트')
  console.log('='.repeat(70))

  console.log('\n[ 모의 데이터 ]')
  console.log(`  총 세그먼트: ${mockSegments.length}개`)
  console.log(`  전체 길이: ${formatTime(mockSegments[mockSegments.length - 1].end)}\n`)

  console.log('[ 세그먼트 미리보기 ]')
  mockSegments.forEach((seg, idx) => {
    console.log(`  ${idx + 1}. [${formatTime(seg.start)}] ${seg.text}`)
  })

  console.log('\n[ 키워드 기반 감지 실행 ]')
  const result = detectSermonByKeywords(mockSegments)

  if (result) {
    console.log('\n✓ 감지 성공!')
    console.log(`\n[ 감지 결과 ]`)
    console.log(`  시작: ${formatTime(result.start)} (${result.start}초)`)
    console.log(`  종료: ${formatTime(result.end)} (${result.end}초)`)
    console.log(`  길이: ${formatTime(result.end - result.start)}`)
    console.log(`  신뢰도: ${(result.confidence * 100).toFixed(0)}%`)
    console.log(`  판단 근거: ${result.reasoning}\n`)

    // 예상 값과 비교
    const EXPECTED_START = 1020  // "이제 하나님의 말씀을 전하겠습니다" (17분)
    const EXPECTED_END = 2760    // "감사의 헌금을 드리겠습니다" (46분)

    console.log('[ 정확도 검증 ]')
    console.log(`  예상 시작: ${formatTime(EXPECTED_START)}`)
    console.log(`  감지 시작: ${formatTime(result.start)}`)
    console.log(`  일치: ${result.start === EXPECTED_START ? '✅' : '❌'}\n`)

    console.log(`  예상 종료: ${formatTime(EXPECTED_END)}`)
    console.log(`  감지 종료: ${formatTime(result.end)}`)
    console.log(`  일치: ${result.end === EXPECTED_END ? '✅' : '❌'}\n`)
  } else {
    console.log('❌ 감지 실패')
  }
}

async function testAIDetection() {
  console.log('\n' + '='.repeat(70))
  console.log('AI 기반 설교 구간 감지 테스트')
  console.log('='.repeat(70))

  if (!process.env.OPENAI_API_KEY) {
    console.log('\n⚠️  OPENAI_API_KEY가 설정되지 않아 AI 테스트를 건너뜁니다.')
    return
  }

  console.log('\n[ AI 분석 실행 중... ]')

  try {
    const result = await detectSermonByAI(mockSegments)

    if (result) {
      console.log('\n✓ AI 감지 성공!')
      console.log(`\n[ AI 감지 결과 ]`)
      console.log(`  시작: ${formatTime(result.start)} (${result.start}초)`)
      console.log(`  종료: ${formatTime(result.end)} (${result.end}초)`)
      console.log(`  길이: ${formatTime(result.end - result.start)}`)
      console.log(`  신뢰도: ${(result.confidence * 100).toFixed(0)}%`)
      console.log(`  판단 근거: ${result.reasoning}\n`)
    } else {
      console.log('❌ AI 감지 실패')
    }
  } catch (error: any) {
    console.error('\n❌ AI 테스트 오류:', error.message)
  }
}

async function main() {
  await testKeywordDetection()
  await testAIDetection()

  console.log('\n' + '='.repeat(70))
  console.log('테스트 완료!')
  console.log('='.repeat(70))
  console.log('\n💡 다음 단계: 실제 YouTube 동영상으로 테스트')
  console.log('   1. ffmpeg 설치: brew install ffmpeg')
  console.log('   2. 실행: npx tsx scripts/test-auto-detect.ts\n')
}

main()
