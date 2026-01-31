/**
 * 설교 구간 자동 감지 테스트
 * STT + AI를 사용하여 설교 시작/종료 지점 자동 탐지
 */

import { youtubeToText } from '../lib/youtube-stt'
import { detectSermonBoundary } from '../lib/sermon-detector'
import { chunkTranscript } from '../lib/youtube'

const VIDEO_URL = 'https://www.youtube.com/watch?v=Ygj_ueI1y-M'

async function main() {
  console.log('='.repeat(70))
  console.log('설교 구간 자동 감지 테스트 (STT + AI)')
  console.log('='.repeat(70))

  console.log(`\n동영상: ${VIDEO_URL}`)

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY가 필요합니다.')
    process.exit(1)
  }

  try {
    // 1단계: 전체 동영상 STT
    console.log('\n1단계: 전체 동영상 STT 변환 중...')
    console.log('⚠️  이 작업은 몇 분 정도 소요될 수 있습니다.\n')

    const whisperResult = await youtubeToText(VIDEO_URL)

    console.log('✓ STT 변환 완료')
    console.log(`  전체 길이: ${formatTime(whisperResult.duration)}`)
    console.log(`  세그먼트: ${whisperResult.segments.length}개\n`)

    // 2단계: AI로 설교 구간 감지
    console.log('2단계: AI로 설교 구간 자동 감지 중...\n')

    const boundary = await detectSermonBoundary(whisperResult.segments, true)

    console.log('✓ 설교 구간 감지 완료\n')
    console.log('[ 감지 결과 ]')
    console.log(`  시작: ${formatTime(boundary.start)} (${boundary.start}초)`)
    console.log(`  종료: ${formatTime(boundary.end)} (${boundary.end}초)`)
    console.log(`  길이: ${formatTime(boundary.end - boundary.start)}`)
    console.log(`  신뢰도: ${(boundary.confidence * 100).toFixed(0)}%`)
    console.log(`  판단 근거: ${boundary.reasoning}\n`)

    // 3단계: 감지된 구간의 세그먼트만 추출
    console.log('3단계: 감지된 구간 추출 중...\n')

    const filteredSegments = whisperResult.segments.filter(seg => {
      return seg.start >= boundary.start && seg.end <= boundary.end
    })

    console.log(`✓ ${filteredSegments.length}개 세그먼트 추출\n`)

    // 4단계: 청크로 분할
    const segments = filteredSegments.map(seg => ({
      text: seg.text,
      start: seg.start,
      duration: seg.end - seg.start,
    }))

    const chunks = chunkTranscript(segments, 500, 100)

    console.log('[ 청크 분할 결과 ]')
    console.log(`  총 청크 수: ${chunks.length}개`)
    console.log(`  평균 청크 길이: ${Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length)}자\n`)

    // 청크 미리보기
    if (chunks.length > 0) {
      console.log('[ 청크 미리보기 (처음 3개) ]')
      chunks.slice(0, 3).forEach((chunk, idx) => {
        console.log(`\n  청크 #${idx + 1}:`)
        console.log(`    시간: ${formatTime(chunk.startTime)} ~ ${formatTime(chunk.endTime)}`)
        console.log(`    길이: ${chunk.text.length}자`)
        console.log(`    내용: ${chunk.text.substring(0, 150).replace(/\n/g, ' ')}...`)
      })
    }

    console.log('\n' + '='.repeat(70))
    console.log('✓ 자동 감지 성공!')
    console.log('='.repeat(70))

    // 실제 값과 비교 (알려진 경우)
    const ACTUAL_START = 1072  // 17:52
    const ACTUAL_END = 2804    // 46:44

    console.log('\n[ 정확도 검증 ]')
    console.log(`  실제 시작: ${formatTime(ACTUAL_START)} (${ACTUAL_START}초)`)
    console.log(`  감지 시작: ${formatTime(boundary.start)} (${boundary.start}초)`)
    console.log(`  오차: ${Math.abs(boundary.start - ACTUAL_START)}초\n`)

    console.log(`  실제 종료: ${formatTime(ACTUAL_END)} (${ACTUAL_END}초)`)
    console.log(`  감지 종료: ${formatTime(boundary.end)} (${boundary.end}초)`)
    console.log(`  오차: ${Math.abs(boundary.end - ACTUAL_END)}초\n`)

    const startAccuracy = Math.max(0, 100 - (Math.abs(boundary.start - ACTUAL_START) / ACTUAL_START * 100))
    const endAccuracy = Math.max(0, 100 - (Math.abs(boundary.end - ACTUAL_END) / ACTUAL_END * 100))

    console.log(`  시작 정확도: ${startAccuracy.toFixed(1)}%`)
    console.log(`  종료 정확도: ${endAccuracy.toFixed(1)}%`)
    console.log(`  평균 정확도: ${((startAccuracy + endAccuracy) / 2).toFixed(1)}%\n`)

    // 비용 추정
    const totalMinutes = whisperResult.duration / 60
    const whisperCost = totalMinutes * 0.006
    const gptCost = 0.005 // 대략적인 추정
    const totalCost = whisperCost + gptCost

    console.log('[ 비용 ]')
    console.log(`  전체 동영상 길이: ${totalMinutes.toFixed(2)}분`)
    console.log(`  Whisper API: $${whisperCost.toFixed(3)}`)
    console.log(`  GPT-4o-mini: ~$${gptCost.toFixed(3)}`)
    console.log(`  총 비용: ~$${totalCost.toFixed(3)}`)

  } catch (error: any) {
    console.error('\n❌ 자동 감지 실패:', error.message)
    if (error.stack) {
      console.error('\n상세 오류:')
      console.error(error.stack)
    }
    process.exit(1)
  }
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

main()
