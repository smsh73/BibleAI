/**
 * 개선된 OCR 테스트 스크립트
 * 샘플 이미지로 OCR 정확도 테스트
 *
 * API 키는 데이터베이스에서 로드됨 (환경변수는 Supabase 연결용만 필요)
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { performOCR } from '../lib/news-extractor'
import * as fs from 'fs'

async function testOCR() {
  const imagePath = '/tmp/news_article.jpg'

  if (!fs.existsSync(imagePath)) {
    console.error('테스트 이미지가 없습니다. 먼저 이미지를 다운로드하세요.')
    process.exit(1)
  }

  console.log('=== 개선된 OCR 테스트 ===\n')

  const imageBuffer = fs.readFileSync(imagePath)

  console.log('1. 검증 없이 OCR 실행...')
  const resultNoVerify = await performOCR(imageBuffer, 'image/jpeg', false)
  console.log(`제공자: ${resultNoVerify.provider}`)
  console.log(`검증: ${resultNoVerify.verified}`)
  console.log('\n--- OCR 결과 (검증 전) ---')
  console.log(resultNoVerify.text.substring(0, 1500))

  console.log('\n\n2. 검증 포함 OCR 실행...')
  const resultWithVerify = await performOCR(imageBuffer, 'image/jpeg', true)
  console.log(`제공자: ${resultWithVerify.provider}`)
  console.log(`검증: ${resultWithVerify.verified}`)
  console.log('\n--- OCR 결과 (검증 후) ---')
  console.log(resultWithVerify.text.substring(0, 1500))

  // 주요 키워드 확인
  console.log('\n\n=== 정확도 체크 ===')
  const correctKeywords = [
    '만나홀',
    '최원준',
    '위임목사',
    'MK 공연',
    '요르단',
    '청년찬양팀',
    '워쉽',
    '145여 명'
  ]

  const wrongKeywords = [
    '한나홀',
    '최재호',
    '위원목사',
    '행복채널',
    '요즘형',
    '8가족'
  ]

  console.log('\n[정확한 키워드 포함 여부]')
  for (const keyword of correctKeywords) {
    const found = resultWithVerify.text.includes(keyword)
    console.log(`${found ? '✅' : '❌'} "${keyword}"`)
  }

  console.log('\n[오류 키워드 포함 여부 - 없어야 함]')
  for (const keyword of wrongKeywords) {
    const found = resultWithVerify.text.includes(keyword)
    console.log(`${found ? '❌ (오류 포함)' : '✅ (정상)'} "${keyword}"`)
  }
}

testOCR().catch(console.error)
