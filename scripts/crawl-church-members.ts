/**
 * 교회 인명/고유명사 크롤링 스크립트
 *
 * 대상 페이지:
 * - 목사 목록: https://www.anyangjeil.org/Page/Index/27
 * - 전도사 목록: https://www.anyangjeil.org/Page/Index/28
 * - 장로 목록: https://www.anyangjeil.org/Page/Index/29
 * - 교회직원 목록: https://www.anyangjeil.org/Page/Index/30
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BASE_URL = 'https://www.anyangjeil.org'

interface ChurchMember {
  name: string
  position: string
  department?: string
  role?: string
  source_url: string
}

/**
 * 목사 목록 크롤링
 */
async function fetchPastors(): Promise<ChurchMember[]> {
  const url = `${BASE_URL}/Page/Index/27`
  console.log(`목사 목록 크롤링: ${url}`)

  const response = await fetch(url)
  const html = await response.text()

  const members: ChurchMember[] = []

  // 이름 + 직분 패턴 추출 (예: "최원준 위임목사", "김장훈 목사")
  // HTML 구조에 따라 패턴 조정 필요
  const namePatterns = [
    // 위임목사/담임목사
    /([가-힣]{2,4})\s*(위임목사|담임목사)/g,
    // 일반 목사
    /([가-힣]{2,4})\s*목사/g,
  ]

  // 하드코딩된 목사 목록 (웹 크롤링 실패 시 백업)
  const hardcodedPastors: ChurchMember[] = [
    // 담임/위임목사
    { name: '최원준', position: '위임목사', department: '담임', role: '담임목사', source_url: url },

    // 교구목사
    { name: '김장훈', position: '목사', department: '교구', role: '교구목사', source_url: url },
    { name: '고학몽', position: '목사', department: '교구', role: '교구목사', source_url: url },
    { name: '변상선', position: '목사', department: '교구', role: '교구목사', source_url: url },
    { name: '송준', position: '목사', department: '교구', role: '교구목사', source_url: url },
    { name: '민창진', position: '목사', department: '교구', role: '교구목사', source_url: url },
    { name: '성세원', position: '목사', department: '교구', role: '교구목사', source_url: url },
    { name: '전기현', position: '목사', department: '교구', role: '교구목사', source_url: url },
    { name: '박연성', position: '목사', department: '교구', role: '교구목사', source_url: url },

    // 청년부 목사
    { name: '홍성호', position: '목사', department: '청년부', role: '청년부 담당', source_url: url },
    { name: '함신주', position: '목사', department: '청년부', role: '청년부 담당', source_url: url },

    // 교육부 목사
    { name: '장재인', position: '목사', department: '교육부', role: '교육부 담당', source_url: url },
    { name: '고유경', position: '목사', department: '교육부', role: '교육부 담당', source_url: url },
    { name: '김은희', position: '목사', department: '교육부', role: '교육부 담당', source_url: url },

    // 장애인사역부 목사
    { name: '노연정', position: '목사', department: '장애인사역부', role: '장애인사역 담당', source_url: url },
    { name: '김한나', position: '목사', department: '장애인사역부', role: '장애인사역 담당', source_url: url },

    // 국제사역부 목사
    { name: '원주희', position: '목사', department: '국제사역부', role: '국제사역 담당', source_url: url },
    { name: '하서진', position: '목사', department: '국제사역부', role: '국제사역 담당', source_url: url },
    { name: '아조', position: '목사', department: '국제사역부', role: '국제사역 담당', source_url: url },

    // 협동목사
    { name: '신현태', position: '목사', department: '협동', role: '협동목사', source_url: url },
    { name: '정은찬', position: '목사', department: '협동', role: '협동목사', source_url: url },
  ]

  // HTML에서 추출 시도
  for (const pattern of namePatterns) {
    let match
    while ((match = pattern.exec(html)) !== null) {
      const name = match[1]
      const position = match[2] || '목사'

      // 중복 체크
      if (!members.find(m => m.name === name)) {
        members.push({
          name,
          position,
          source_url: url
        })
      }
    }
  }

  // 크롤링 결과가 없으면 하드코딩된 목록 사용
  if (members.length < 5) {
    console.log('  웹 크롤링 결과 부족, 하드코딩된 목록 사용')
    return hardcodedPastors
  }

  return members
}

/**
 * 전도사 목록 크롤링
 */
async function fetchEvangelists(): Promise<ChurchMember[]> {
  const url = `${BASE_URL}/Page/Index/28`
  console.log(`전도사 목록 크롤링: ${url}`)

  const response = await fetch(url)
  const html = await response.text()

  const members: ChurchMember[] = []

  // 이름 + 전도사 패턴
  const pattern = /([가-힣]{2,4})\s*전도사/g

  let match
  while ((match = pattern.exec(html)) !== null) {
    const name = match[1]
    if (!members.find(m => m.name === name)) {
      members.push({
        name,
        position: '전도사',
        source_url: url
      })
    }
  }

  console.log(`  발견: ${members.length}명`)
  return members
}

/**
 * 장로 목록 크롤링
 */
async function fetchElders(): Promise<ChurchMember[]> {
  const url = `${BASE_URL}/Page/Index/29`
  console.log(`장로 목록 크롤링: ${url}`)

  const response = await fetch(url)
  const html = await response.text()

  const members: ChurchMember[] = []

  // 이름 + 장로 패턴
  const pattern = /([가-힣]{2,4})\s*장로/g

  let match
  while ((match = pattern.exec(html)) !== null) {
    const name = match[1]
    if (!members.find(m => m.name === name)) {
      members.push({
        name,
        position: '장로',
        source_url: url
      })
    }
  }

  console.log(`  발견: ${members.length}명`)
  return members
}

/**
 * 교회직원 목록 크롤링
 */
async function fetchStaff(): Promise<ChurchMember[]> {
  const url = `${BASE_URL}/Page/Index/30`
  console.log(`교회직원 목록 크롤링: ${url}`)

  const response = await fetch(url)
  const html = await response.text()

  const members: ChurchMember[] = []

  // 직원 이름 패턴 (다양한 직함)
  const patterns = [
    /([가-힣]{2,4})\s*(간사|사무|사역자)/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(html)) !== null) {
      const name = match[1]
      const position = match[2] || '직원'
      if (!members.find(m => m.name === name)) {
        members.push({
          name,
          position,
          source_url: url
        })
      }
    }
  }

  console.log(`  발견: ${members.length}명`)
  return members
}

/**
 * DB에 저장
 */
async function saveMembers(members: ChurchMember[]): Promise<number> {
  let savedCount = 0

  for (const member of members) {
    const { error } = await supabase
      .from('church_members')
      .upsert({
        name: member.name,
        position: member.position,
        department: member.department || null,
        role: member.role || null,
        source_url: member.source_url,
        is_active: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'name,position,department'
      })

    if (!error) {
      savedCount++
    } else {
      console.error(`저장 실패: ${member.name} - ${error.message}`)
    }
  }

  return savedCount
}

/**
 * OCR 오류 패턴 추가
 * 사용자가 제공한 목사 목록을 기반으로 자주 발생하는 오류 패턴 등록
 */
async function addOCRCorrections(): Promise<void> {
  const corrections = [
    // 이름 오류 패턴
    { wrong_text: '최재호', correct_text: '최원준', category: '이름' },
    { wrong_text: '최원준목사', correct_text: '최원준 위임목사', category: '이름+직분' },

    // 장소 오류 패턴
    { wrong_text: '한나홀', correct_text: '만나홀', category: '장소' },
    { wrong_text: '만남홀', correct_text: '만나홀', category: '장소' },

    // 직분 오류 패턴
    { wrong_text: '위원목사', correct_text: '위임목사', category: '직분' },
    { wrong_text: '담당목사', correct_text: '담임목사', category: '직분' },

    // 부서/팀명 오류 패턴
    { wrong_text: '요즘형', correct_text: '요르단', category: '팀명' },
    { wrong_text: '청연찬양팀', correct_text: '청년찬양팀', category: '팀명' },

    // 일반 오류 패턴
    { wrong_text: '8가족', correct_text: '새가족', category: '일반' },
    { wrong_text: '새가측', correct_text: '새가족', category: '일반' },
    { wrong_text: '행복채널', correct_text: '', category: '할루시네이션' },  // 없는 단어
  ]

  for (const correction of corrections) {
    if (correction.correct_text) {
      await supabase
        .from('ocr_corrections')
        .upsert(correction, { onConflict: 'wrong_text,correct_text' })
    }
  }

  console.log(`OCR 교정 패턴 ${corrections.length}개 등록`)
}

/**
 * 메인 실행
 */
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('   교회 인명/고유명사 크롤링')
  console.log('═══════════════════════════════════════════════\n')

  // 1. 목사 목록
  const pastors = await fetchPastors()
  const pastorsSaved = await saveMembers(pastors)
  console.log(`  저장: ${pastorsSaved}/${pastors.length}명\n`)

  await new Promise(r => setTimeout(r, 1000))

  // 2. 전도사 목록
  const evangelists = await fetchEvangelists()
  const evangelistsSaved = await saveMembers(evangelists)
  console.log(`  저장: ${evangelistsSaved}/${evangelists.length}명\n`)

  await new Promise(r => setTimeout(r, 1000))

  // 3. 장로 목록
  const elders = await fetchElders()
  const eldersSaved = await saveMembers(elders)
  console.log(`  저장: ${eldersSaved}/${elders.length}명\n`)

  await new Promise(r => setTimeout(r, 1000))

  // 4. 교회직원 목록
  const staff = await fetchStaff()
  const staffSaved = await saveMembers(staff)
  console.log(`  저장: ${staffSaved}/${staff.length}명\n`)

  // 5. OCR 교정 패턴 등록
  await addOCRCorrections()

  // 통계 출력
  const totalMembers = pastors.length + evangelists.length + elders.length + staff.length
  const totalSaved = pastorsSaved + evangelistsSaved + eldersSaved + staffSaved

  console.log('\n═══════════════════════════════════════════════')
  console.log(`✅ 완료: 총 ${totalSaved}/${totalMembers}명 저장`)
  console.log('═══════════════════════════════════════════════')
}

main().catch(console.error)
