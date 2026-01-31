/**
 * 성경 데이터 업로드 스크립트
 * 사용법: npx ts-node scripts/upload-bible.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { createAllChunks } from '../lib/chunking'
import { uploadChunks } from '../lib/supabase'

async function main() {
  console.log('='.repeat(60))
  console.log('성경 데이터 업로드')
  console.log('='.repeat(60))

  // 성경 데이터 로드
  const biblePath = path.join(__dirname, '../../bible_gae_full.json')

  if (!fs.existsSync(biblePath)) {
    console.error(`❌ ${biblePath} 파일을 찾을 수 없습니다.`)
    console.error('먼저 BibleAI 루트에서 extract_full_bible.py를 실행하세요.')
    process.exit(1)
  }

  console.log('\n1. 성경 데이터 로딩 중...')
  const bibleData = JSON.parse(fs.readFileSync(biblePath, 'utf-8'))

  console.log('2. 청킹 시작...')
  const chunks = await createAllChunks(bibleData)
  console.log(`✓ ${chunks.length}개 청크 생성 완료`)

  // 통계
  const avgChars = chunks.reduce((sum, c) => sum + c.charCount, 0) / chunks.length
  const avgVerses = chunks.reduce((sum, c) => sum + c.verseCount, 0) / chunks.length

  console.log(`\n[ 청크 통계 ]`)
  console.log(`  평균 글자 수: ${avgChars.toFixed(0)}자`)
  console.log(`  평균 절 수: ${avgVerses.toFixed(1)}절`)

  // 업로드 확인
  console.log(`\n3. Supabase에 업로드 시작...`)
  console.log(`예상 소요 시간: 약 ${Math.ceil(chunks.length / 100)}분`)

  const proceed = process.argv.includes('--yes')
    ? true
    : await confirm('\n계속하시겠습니까? (y/n): ')

  if (!proceed) {
    console.log('취소되었습니다.')
    process.exit(0)
  }

  // 업로드
  try {
    await uploadChunks(chunks)
    console.log('\n✓ 업로드 완료!')
  } catch (error) {
    console.error('\n❌ 업로드 실패:', error)
    process.exit(1)
  }
}

function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(message)
    process.stdin.once('data', (data) => {
      const answer = data.toString().trim().toLowerCase()
      resolve(answer === 'y' || answer === 'yes')
    })
  })
}

main()
