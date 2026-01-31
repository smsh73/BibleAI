/**
 * 간단한 STT 테스트 (10초만)
 */

import { youtubeToText } from '../lib/youtube-stt'

const VIDEO_URL = 'https://www.youtube.com/watch?v=Ygj_ueI1y-M'
const START_TIME = 1072  // 17:52
const END_TIME = 1082    // 17:52 + 10초

async function test() {
  console.log('간단한 STT 테스트 (10초만 추출)')
  console.log(`URL: ${VIDEO_URL}`)
  console.log(`시간: ${START_TIME}초 ~ ${END_TIME}초\n`)

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY가 필요합니다.')
    process.exit(1)
  }

  try {
    console.log('오디오 다운로드 및 STT 변환 중...\n')
    const result = await youtubeToText(VIDEO_URL, START_TIME, END_TIME)

    console.log('✓ 변환 완료!\n')
    console.log(`언어: ${result.language}`)
    console.log(`세그먼트: ${result.segments.length}개`)
    console.log(`\n텍스트:\n${result.text}`)

  } catch (error: any) {
    console.error('❌ 실패:', error.message)
  }
}

test()
