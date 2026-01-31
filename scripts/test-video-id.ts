/**
 * YouTube URL에서 비디오 ID 추출 테스트
 */

import { extractVideoId } from '../lib/youtube'

const urls = [
  'https://www.youtube.com/watch?v=Ygj_ueI1y-M',
  'https://youtu.be/Ygj_ueI1y-M?si=tgLVCpUMieoQQolF',
  'https://youtu.be/Ygj_ueI1y-M',
  'https://www.youtube.com/watch?v=Ygj_ueI1y-M&t=1072s',
]

console.log('YouTube URL 비디오 ID 추출 테스트\n')

urls.forEach((url, idx) => {
  const videoId = extractVideoId(url)
  console.log(`${idx + 1}. ${url}`)
  console.log(`   -> 비디오 ID: ${videoId}`)
  console.log(`   -> 상태: ${videoId === 'Ygj_ueI1y-M' ? '✅ 정상' : '❌ 오류'}\n`)
})
