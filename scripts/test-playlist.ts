/**
 * 플레이리스트 자동 처리 테스트
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

// .env.local 파일 로드
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

import { processPlaylist, getPlaylistVideos } from '../lib/youtube-playlist'

const PLAYLIST_URL =
  'https://youtube.com/playlist?list=PLJR3b9DmwxmTCOzuH_AUV5rfv_qime3tB&si=QJcQZByTgFIx-3ZN'

async function test() {
  console.log('='.repeat(70))
  console.log('YouTube 플레이리스트 자동 처리 테스트')
  console.log('='.repeat(70))
  console.log(`플레이리스트: ${PLAYLIST_URL}`)
  console.log()

  try {
    // 1. 플레이리스트 정보 확인
    console.log('[1단계] 플레이리스트 정보 확인 중...')
    const videos = await getPlaylistVideos(PLAYLIST_URL)

    console.log(`\n총 ${videos.length}개 비디오 발견:\n`)
    videos.forEach((video, index) => {
      const duration = video.duration
        ? `${Math.floor(video.duration / 60)}:${(video.duration % 60)
            .toString()
            .padStart(2, '0')}`
        : '알 수 없음'
      console.log(`${index + 1}. ${video.title} (${duration})`)
    })

    // 2. 사용자에게 처리할 동영상 수 확인
    console.log(`\n[2단계] 처리 시작 (최대 3개로 제한)`)
    console.log(
      '⚠️  실제 사용 시에는 maxVideos 제한을 제거하거나 조정하세요.\n'
    )

    // 3. 플레이리스트 처리 (테스트용으로 최대 3개만)
    const results = await processPlaylist(PLAYLIST_URL, {
      maxVideos: 3, // 테스트용 제한
      skipErrors: true,
      onProgress: (current, total, message) => {
        // 진행 상황은 이미 processPlaylist 내부에서 출력됨
      },
    })

    // 4. 결과 요약
    console.log('\n' + '='.repeat(70))
    console.log('처리 결과 요약')
    console.log('='.repeat(70))

    results.forEach((result, index) => {
      console.log(`\n[${index + 1}] ${result.videoTitle}`)
      console.log(`   URL: ${result.videoUrl}`)
      console.log(`   상태: ${result.success ? '✅ 성공' : '❌ 실패'}`)

      if (result.success) {
        if (result.detectedBoundary) {
          const startMin = Math.floor(result.detectedBoundary.start / 60)
          const startSec = result.detectedBoundary.start % 60
          const endMin = Math.floor(result.detectedBoundary.end / 60)
          const endSec = result.detectedBoundary.end % 60

          console.log(
            `   설교 구간: ${startMin}:${startSec
              .toString()
              .padStart(2, '0')} ~ ${endMin}:${endSec
              .toString()
              .padStart(2, '0')}`
          )
          console.log(
            `   신뢰도: ${(result.detectedBoundary.confidence * 100).toFixed(
              0
            )}%`
          )
          console.log(`   청크: ${result.totalChunks}개`)
          console.log(`   비용: $${result.cost?.toFixed(2)}`)
        }
      } else {
        console.log(`   오류: ${result.error}`)
      }
    })

    const successCount = results.filter((r) => r.success).length
    const totalCost = results
      .filter((r) => r.success)
      .reduce((sum, r) => sum + (r.cost || 0), 0)

    console.log('\n' + '='.repeat(70))
    console.log(`✅ 성공: ${successCount}개`)
    console.log(`❌ 실패: ${results.length - successCount}개`)
    console.log(`💰 총 비용: $${totalCost.toFixed(2)}`)
    console.log('='.repeat(70))
  } catch (error: any) {
    console.error('❌ 테스트 실패:', error.message)
    console.error(error.stack)
  }
}

test()
