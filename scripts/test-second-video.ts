/**
 * 두 번째 테스트 영상 - AI 설교 구간 자동 감지 테스트
 *
 * 영상: https://www.youtube.com/watch?v=tApVfC-Wg6c
 * 실제 설교 구간: 39:06 ~ 1:18:57 (39분 51초)
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { transcribeAudioWithWhisper } from '../lib/youtube-stt'
import { detectSermonBoundary } from '../lib/sermon-detector'
import * as fs from 'fs'

// .env.local 파일 로드
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const AUDIO_FILE = 'tmp/test2-compressed.m4a'

// 실제 설교 구간 (수동 확인)
const ACTUAL_START = 39 * 60 + 6  // 39:06 = 2346초
const ACTUAL_END = 78 * 60 + 57   // 1:18:57 = 4737초
const ACTUAL_DURATION = ACTUAL_END - ACTUAL_START  // 2391초 = 39분 51초

async function test() {
  console.log('='.repeat(60))
  console.log('📋 두 번째 테스트: AI 설교 구간 자동 감지')
  console.log('='.repeat(60))
  console.log()

  // 1. 오디오 파일 확인
  console.log('🔍 1단계: 오디오 파일 확인')
  if (!fs.existsSync(AUDIO_FILE)) {
    console.error(`❌ 오디오 파일이 없습니다: ${AUDIO_FILE}`)
    return
  }
  const fileStats = fs.statSync(AUDIO_FILE)
  console.log(`✅ 파일 존재: ${AUDIO_FILE}`)
  console.log(`   크기: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`)
  console.log()

  // 2. STT 변환
  console.log('🎤 2단계: Whisper API로 STT 변환')
  console.log('   (약 5~7분 소요 예상...)')
  const startTime = Date.now()

  const whisperResult = await transcribeAudioWithWhisper(AUDIO_FILE)

  const sttDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
  console.log(`✅ STT 변환 완료! (${sttDuration}분 소요)`)
  console.log(`   전체 길이: ${Math.floor(whisperResult.duration / 60)}분 ${Math.floor(whisperResult.duration % 60)}초`)
  console.log(`   세그먼트 수: ${whisperResult.segments.length}개`)
  console.log(`   텍스트 길이: ${whisperResult.text.length.toLocaleString()}자`)
  console.log()

  // 3. AI 설교 구간 감지
  console.log('🤖 3단계: GPT-4o-mini로 설교 구간 감지')
  console.log('   (약 30초~1분 소요...)')

  const aiStartTime = Date.now()
  const boundary = await detectSermonBoundary(whisperResult.segments, true)
  const aiDuration = ((Date.now() - aiStartTime) / 1000).toFixed(1)

  console.log(`✅ AI 감지 완료! (${aiDuration}초 소요)`)
  console.log()

  // 4. 결과 비교
  console.log('📊 4단계: 결과 비교')
  console.log('='.repeat(60))
  console.log()

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  console.log('실제 설교 구간 (수동 확인):')
  console.log(`  시작: ${formatTime(ACTUAL_START)} (${ACTUAL_START}초)`)
  console.log(`  종료: ${formatTime(ACTUAL_END)} (${ACTUAL_END}초)`)
  console.log(`  길이: ${Math.floor(ACTUAL_DURATION / 60)}분 ${ACTUAL_DURATION % 60}초`)
  console.log()

  console.log('AI 감지 결과:')
  console.log(`  시작: ${formatTime(boundary.start)} (${boundary.start}초)`)
  console.log(`  종료: ${formatTime(boundary.end)} (${boundary.end}초)`)
  console.log(`  길이: ${Math.floor((boundary.end - boundary.start) / 60)}분 ${(boundary.end - boundary.start) % 60}초`)
  console.log(`  신뢰도: ${(boundary.confidence * 100).toFixed(0)}%`)
  console.log()

  // 오차 계산
  const startError = Math.abs(boundary.start - ACTUAL_START)
  const endError = Math.abs(boundary.end - ACTUAL_END)
  const durationError = Math.abs((boundary.end - boundary.start) - ACTUAL_DURATION)

  console.log('오차 분석:')
  console.log(`  시작 오차: ${startError}초 (${(startError / 60).toFixed(1)}분)`)
  console.log(`  종료 오차: ${endError}초 (${(endError / 60).toFixed(1)}분)`)
  console.log(`  길이 오차: ${durationError}초`)
  console.log()

  // 평가
  console.log('🎯 평가:')
  if (startError <= 60 && endError <= 60) {
    console.log('  🏆 완벽! (±1분 이내)')
  } else if (startError <= 120 && endError <= 120) {
    console.log('  ✅ 우수 (±2분 이내)')
  } else if (startError <= 300 && endError <= 300) {
    console.log('  ⚠️ 보통 (±5분 이내)')
  } else {
    console.log('  ❌ 부족 (5분 이상 오차)')
  }
  console.log()

  // AI 판단 근거
  console.log('AI 판단 근거:')
  console.log(`  ${boundary.reasoning}`)
  console.log()

  // 비용 계산
  const sttCost = (whisperResult.duration / 60) * 0.006
  const aiCost = 0.01 // 추정
  const totalCost = sttCost + aiCost

  console.log('💰 비용:')
  console.log(`  STT (Whisper): $${sttCost.toFixed(2)}`)
  console.log(`  AI 감지 (GPT-4o-mini): $${aiCost.toFixed(2)}`)
  console.log(`  총 비용: $${totalCost.toFixed(2)} (약 ${Math.round(totalCost * 1330)}원)`)
  console.log()

  console.log('='.repeat(60))
  console.log('✅ 테스트 완료!')
  console.log('='.repeat(60))
}

test().catch(console.error)
