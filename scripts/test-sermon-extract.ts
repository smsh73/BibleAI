/**
 * 특정 설교 구간 추출 테스트
 * 동영상: https://www.youtube.com/watch?v=Ygj_ueI1y-M
 * 시간: 17:52 ~ 46:44
 */

import { extractSermonTranscript, chunkTranscript } from '../lib/youtube'

const VIDEO_URL = 'https://www.youtube.com/watch?v=Ygj_ueI1y-M'
const START_TIME = 1072  // 17분 52초
const END_TIME = 2804    // 46분 44초

async function main() {
  console.log('='.repeat(70))
  console.log('설교 구간 추출 테스트')
  console.log('='.repeat(70))

  console.log(`\n동영상: ${VIDEO_URL}`)
  console.log(`시간 구간: 17:52 ~ 46:44 (${START_TIME}초 ~ ${END_TIME}초)`)
  console.log(`설교 길이: ${formatTime(END_TIME - START_TIME)}\n`)

  try {
    console.log('1단계: 전체 스크립트 추출 중...')
    const fullResult = await extractSermonTranscript(VIDEO_URL)

    console.log(`\n[ 전체 동영상 정보 ]`)
    console.log(`  전체 길이: ${formatTime(fullResult.summary.totalDuration)}`)
    console.log(`  전체 세그먼트: ${fullResult.summary.totalSegments}개\n`)

    if (fullResult.summary.totalSegments === 0) {
      console.log('⚠️  이 동영상에는 자막이 없거나 접근할 수 없습니다.')
      console.log('\n가능한 원인:')
      console.log('  1. 동영상에 자막(CC)이 없음')
      console.log('  2. 자막이 비활성화되어 있음')
      console.log('  3. 비공개 또는 제한된 동영상')
      console.log('\n해결 방법:')
      console.log('  - YouTube에서 동영상 재생 후 자막(CC) 버튼 확인')
      console.log('  - 자막이 있는 다른 공개 동영상으로 테스트')
      return
    }

    console.log('2단계: 설교 구간 추출 중...')
    const sermonResult = await extractSermonTranscript(VIDEO_URL, START_TIME, END_TIME)

    if (!sermonResult.sermonSection) {
      console.log('❌ 지정된 시간 범위에서 스크립트를 찾을 수 없습니다.')
      return
    }

    console.log(`\n[ 설교 구간 정보 ]`)
    console.log(`  시작: ${formatTime(sermonResult.sermonSection.start)}`)
    console.log(`  종료: ${formatTime(sermonResult.sermonSection.end)}`)
    console.log(`  길이: ${formatTime(sermonResult.sermonSection.end - sermonResult.sermonSection.start)}`)
    console.log(`  세그먼트 수: ${sermonResult.sermonSection.segments.length}개`)

    // 첫 부분 미리보기
    if (sermonResult.sermonSection.text.length > 0) {
      console.log(`\n[ 설교 내용 미리보기 (처음 800자) ]`)
      console.log('-'.repeat(70))
      console.log(sermonResult.sermonSection.text.substring(0, 800))
      if (sermonResult.sermonSection.text.length > 800) {
        console.log('...')
      }
      console.log('-'.repeat(70))
    }

    // 청크 분할
    console.log('\n3단계: 청크 분할 중...')
    const chunks = chunkTranscript(sermonResult.sermonSection.segments, 500, 100)

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
    console.log('✓ 추출 성공!')
    console.log('='.repeat(70))

    // 통계 요약
    console.log('\n[ 요약 ]')
    console.log(`  설교 길이: ${formatTime(END_TIME - START_TIME)}`)
    console.log(`  추출된 텍스트: ${sermonResult.sermonSection.text.length.toLocaleString()}자`)
    console.log(`  청크 수: ${chunks.length}개`)
    console.log(`  평균 청크: ${Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length)}자`)

  } catch (error: any) {
    console.error('\n❌ 추출 실패:', error.message)
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
