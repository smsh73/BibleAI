/**
 * YouTube 스크립트 추출 테스트 스크립트
 * 사용법: npx ts-node scripts/test-youtube.ts
 */

import { extractSermonTranscript, chunkTranscript } from '../lib/youtube'

const TEST_VIDEO_URL = 'https://youtu.be/Ygj_ueI1y-M?si=OSK_cH9SR-ZaG2We'

async function main() {
  console.log('='.repeat(60))
  console.log('YouTube 설교 스크립트 추출 테스트')
  console.log('='.repeat(60))

  console.log(`\n동영상 URL: ${TEST_VIDEO_URL}`)
  console.log('\n1단계: 전체 스크립트 추출 중...\n')

  try {
    // 1. 먼저 전체 스크립트 추출
    const fullResult = await extractSermonTranscript(TEST_VIDEO_URL)

    // 전체 결과 출력
    console.log('[ 전체 동영상 통계 ]')
    console.log(`  전체 길이: ${formatTime(fullResult.summary.totalDuration)}`)
    console.log(`  전체 세그먼트: ${fullResult.summary.totalSegments}개`)

    if (fullResult.summary.totalSegments === 0) {
      console.log('\n⚠️ 이 동영상에는 자막이 없거나 접근할 수 없습니다.')
      console.log('다른 동영상으로 테스트해주세요.')
      return
    }

    // 전체 스크립트 미리보기
    if (fullResult.fullTranscript.length > 0) {
      console.log('\n[ 전체 스크립트 미리보기 (처음 5개 세그먼트) ]')
      fullResult.fullTranscript.slice(0, 5).forEach((seg, idx) => {
        console.log(`  ${idx + 1}. [${formatTime(seg.start)}] ${seg.text}`)
      })
    }

    // 2. 설교 구간 수동 지정 예제
    console.log('\n\n2단계: 설교 구간 추출 테스트 (예제: 2분 ~ 5분)')
    const sermonStart = 120 // 2분
    const sermonEnd = 300 // 5분

    const sermonResult = await extractSermonTranscript(TEST_VIDEO_URL, sermonStart, sermonEnd)

    if (sermonResult.sermonSection) {
      console.log('\n[ 설교 구간 정보 ]')
      console.log(`  시작: ${formatTime(sermonResult.sermonSection.start)}`)
      console.log(`  종료: ${formatTime(sermonResult.sermonSection.end)}`)
      console.log(`  길이: ${formatTime(sermonResult.sermonSection.end - sermonResult.sermonSection.start)}`)
      console.log(`  세그먼트 수: ${sermonResult.sermonSection.segments.length}개`)

      // 청크로 분할
      const chunks = chunkTranscript(sermonResult.sermonSection.segments, 500, 100)
      console.log(`\n[ 청크 분할 결과 ]`)
      console.log(`  총 청크 수: ${chunks.length}개`)

      if (chunks.length > 0) {
        console.log('\n[ 청크 미리보기 (처음 2개) ]')
        chunks.slice(0, 2).forEach((chunk, idx) => {
          console.log(`\n  청크 #${idx + 1}:`)
          console.log(`    시간: ${formatTime(chunk.startTime)} - ${formatTime(chunk.endTime)}`)
          console.log(`    길이: ${chunk.text.length}자`)
          console.log(`    내용: ${chunk.text.substring(0, 200)}...`)
        })
      }

      console.log('\n✓ 추출 성공!')
      console.log('\n💡 사용법:')
      console.log('  - 전체 스크립트를 먼저 확인하여 설교 시작/종료 시간을 파악하세요.')
      console.log('  - extractSermonTranscript(videoUrl, startTime, endTime)로 구간을 지정하세요.')
    } else {
      console.log('\n⚠️ 지정된 시간 범위에서 스크립트를 찾을 수 없습니다.')
    }
  } catch (error: any) {
    console.error('\n❌ 추출 실패:', error.message)
    process.exit(1)
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

main()
