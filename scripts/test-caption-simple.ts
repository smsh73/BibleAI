/**
 * 자막 기반 스크립트 추출 테스트
 */

import { extractSermonTranscript, chunkTranscript } from '../lib/youtube'

const VIDEO_URL = 'https://www.youtube.com/watch?v=Ygj_ueI1y-M'
const START_TIME = 1072  // 17:52
const END_TIME = 2804    // 46:44

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

async function test() {
  console.log('자막 기반 스크립트 추출 테스트')
  console.log(`URL: ${VIDEO_URL}`)
  console.log(`시간: ${formatTime(START_TIME)} ~ ${formatTime(END_TIME)}\n`)

  try {
    console.log('자막 추출 중...')
    const result = await extractSermonTranscript(VIDEO_URL, START_TIME, END_TIME)

    if (result.sermonSection) {
      console.log('\n✓ 추출 완료!\n')
      console.log(`설교 길이: ${formatTime(result.sermonSection.end - result.sermonSection.start)}`)
      console.log(`세그먼트: ${result.sermonSection.segments.length}개`)
      console.log(`\n텍스트 미리보기 (처음 300자):`)
      console.log('-'.repeat(60))
      console.log(result.sermonSection.text.substring(0, 300))
      console.log('...')
      console.log('-'.repeat(60))

      // 청크 분할
      const chunks = chunkTranscript(result.sermonSection.segments, 500, 100)
      console.log(`\n청크 수: ${chunks.length}개`)
      console.log(`평균 청크 길이: ${Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length)}자`)
    } else {
      console.log('⚠️  설교 구간을 찾을 수 없습니다.')
    }
  } catch (error: any) {
    console.error('❌ 실패:', error.message)

    if (error.message.includes('자막')) {
      console.log('\n💡 이 동영상에는 자막이 없는 것 같습니다.')
      console.log('STT 방식을 사용하거나 다른 동영상으로 테스트해주세요.')
    }
  }
}

test()
