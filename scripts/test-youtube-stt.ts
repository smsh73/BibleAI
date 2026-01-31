/**
 * YouTube STT 테스트 스크립트
 * 동영상: https://www.youtube.com/watch?v=Ygj_ueI1y-M
 * 시간: 17:52 ~ 46:44
 */

import { youtubeToText, convertWhisperSegments } from '../lib/youtube-stt'
import { chunkTranscript } from '../lib/youtube'

const VIDEO_URL = 'https://www.youtube.com/watch?v=Ygj_ueI1y-M'
const START_TIME = 1072  // 17분 52초
const END_TIME = 2804    // 46분 44초

async function main() {
  console.log('='.repeat(70))
  console.log('YouTube STT (Whisper API) 테스트')
  console.log('='.repeat(70))

  console.log(`\n동영상: ${VIDEO_URL}`)
  console.log(`시간 구간: 17:52 ~ 46:44 (${START_TIME}초 ~ ${END_TIME}초)`)
  console.log(`설교 길이: ${formatTime(END_TIME - START_TIME)}\n`)

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY가 설정되지 않았습니다.')
    console.error('.env.local 파일에 OPENAI_API_KEY를 추가해주세요.')
    process.exit(1)
  }

  try {
    console.log('1단계: YouTube 오디오 다운로드 및 STT 변환 중...')
    console.log('⚠️  이 작업은 몇 분 정도 소요될 수 있습니다.\n')

    const whisperResult = await youtubeToText(VIDEO_URL, START_TIME, END_TIME)

    console.log('\n[ STT 변환 결과 ]')
    console.log(`  전체 길이: ${formatTime(whisperResult.duration)}`)
    console.log(`  언어: ${whisperResult.language}`)
    console.log(`  세그먼트 수: ${whisperResult.segments.length}개`)
    console.log(`  전체 텍스트 길이: ${whisperResult.text.length.toLocaleString()}자`)

    // 세그먼트 변환
    const segments = convertWhisperSegments(whisperResult.segments)

    // 처음 10개 세그먼트 미리보기
    if (segments.length > 0) {
      console.log('\n[ 세그먼트 미리보기 (처음 10개) ]')
      segments.slice(0, 10).forEach((seg, idx) => {
        console.log(`  ${idx + 1}. [${formatTime(seg.start)}] ${seg.text}`)
      })

      if (segments.length > 10) {
        console.log(`  ... 외 ${segments.length - 10}개 세그먼트`)
      }
    }

    // 청크 분할
    console.log('\n2단계: 청크 분할 중...')
    const chunks = chunkTranscript(segments, 500, 100)

    console.log(`\n[ 청크 분할 결과 ]`)
    console.log(`  총 청크 수: ${chunks.length}개`)
    console.log(`  평균 청크 길이: ${Math.round(chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length)}자`)

    // 청크 미리보기
    if (chunks.length > 0) {
      console.log(`\n[ 청크 미리보기 (처음 5개) ]`)
      chunks.slice(0, 5).forEach((chunk, idx) => {
        console.log(`\n  청크 #${idx + 1}:`)
        console.log(`    시간: ${formatTime(chunk.startTime)} ~ ${formatTime(chunk.endTime)} (${Math.floor(chunk.endTime - chunk.startTime)}초)`)
        console.log(`    길이: ${chunk.text.length}자`)
        console.log(`    내용: ${chunk.text.substring(0, 150).replace(/\n/g, ' ')}...`)
      })

      if (chunks.length > 5) {
        console.log(`\n  ... 외 ${chunks.length - 5}개 청크`)
      }
    }

    console.log('\n' + '='.repeat(70))
    console.log('✓ STT 변환 성공!')
    console.log('='.repeat(70))

    // 통계 요약
    console.log('\n[ 요약 ]')
    console.log(`  설교 길이: ${formatTime(END_TIME - START_TIME)}`)
    console.log(`  추출된 텍스트: ${whisperResult.text.length.toLocaleString()}자`)
    console.log(`  세그먼트 수: ${segments.length}개`)
    console.log(`  청크 수: ${chunks.length}개`)
    console.log(`  평균 청크: ${Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length)}자`)

    // 비용 추정
    const durationMinutes = (END_TIME - START_TIME) / 60
    const estimatedCost = durationMinutes * 0.006
    console.log(`\n[ 비용 ]`)
    console.log(`  처리 시간: ${durationMinutes.toFixed(2)}분`)
    console.log(`  예상 비용: $${estimatedCost.toFixed(3)} (Whisper API)`)

  } catch (error: any) {
    console.error('\n❌ STT 변환 실패:', error.message)
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
