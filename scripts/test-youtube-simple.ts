/**
 * 간단한 YouTube Transcript API 테스트
 */

import { YoutubeTranscript } from 'youtube-transcript'

// Test with a known video that has captions
// Using a popular TED talk video
const VIDEO_ID = 'jPZEJHJPwIw' // Example TED talk
// Original sermon video: Ygj_ueI1y-M

async function test() {
  console.log(`Testing video ID: ${VIDEO_ID}`)
  console.log(`Video URL: https://youtube.com/watch?v=${VIDEO_ID}\n`)

  try {
    // Try fetching without language specification
    console.log('Attempting to fetch transcript (any language)...')
    const result = await YoutubeTranscript.fetchTranscript(VIDEO_ID)
    console.log(`Success! Found ${result.length} segments`)

    if (result.length > 0) {
      console.log('\nFirst 3 segments:')
      result.slice(0, 3).forEach((seg: any, idx: number) => {
        console.log(`  ${idx + 1}. [${seg.offset}ms] ${seg.text}`)
      })
    }
  } catch (error: any) {
    console.error(`Failed: ${error.message}\n`)

    // Try with Korean explicitly
    try {
      console.log('Attempting to fetch Korean transcript...')
      const result = await YoutubeTranscript.fetchTranscript(VIDEO_ID, { lang: 'ko' })
      console.log(`Success! Found ${result.length} segments`)

      if (result.length > 0) {
        console.log('\nFirst 3 segments:')
        result.slice(0, 3).forEach((seg: any, idx: number) => {
          console.log(`  ${idx + 1}. [${seg.offset}ms] ${seg.text}`)
        })
      }
    } catch (koError: any) {
      console.error(`Korean transcript also failed: ${koError.message}`)
    }
  }
}

test()
