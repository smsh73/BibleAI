/**
 * 교회 목록 직접 추가 스크립트 (Supabase 직접 사용)
 * 사용법: npx tsx scripts/add-churches-direct.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// .env.local 로드
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase 환경 변수가 설정되지 않았습니다.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const churches = [
  // 기존 교회 (중복 시 업데이트)
  { name: '안양제일교회', code: 'anyangjeil', homepage_url: 'https://www.anyangjeil.org/', denomination: '대한예수교장로회(통합)' },
  { name: '사랑의교회', code: 'sarang', homepage_url: 'https://www.sarang.org/', denomination: '대한예수교장로회(합동)' },
  { name: '온누리교회', code: 'onnuri', homepage_url: 'https://www.onnuri.org/', denomination: '대한예수교장로회(통합)' },
  { name: '여의도순복음교회', code: 'fgtv', homepage_url: 'https://www.fgtv.com/', denomination: '기독교대한하나님의성회' },
  { name: '명성교회', code: 'msch', homepage_url: 'http://www.msch.or.kr/', denomination: '대한예수교장로회(통합)' },
  { name: '광림교회', code: 'klmc', homepage_url: 'https://www.klmc.church/', denomination: '기독교대한감리회' },
  // 추가 교회
  { name: '금란교회', code: 'kumnan', homepage_url: 'https://www.kumnan.org/', denomination: '기독교대한감리회' },
  { name: '꽃동산교회', code: 'flowergarden', homepage_url: 'http://www.flowergarden.or.kr/', denomination: '대한예수교장로회(합동)' },
  { name: '남가주사랑의교회', code: 'sarangla', homepage_url: 'https://www.sarang.com/', denomination: 'PCA' },
  { name: '삼일교회', code: 'samil', homepage_url: 'https://www.samilchurch.com/', denomination: '대한예수교장로회(합동)' },
  { name: '새로남교회', code: 'saeronam', homepage_url: 'https://www.saeronam.or.kr/', denomination: '대한예수교장로회(합동)' },
  { name: '새문안교회', code: 'saemoonan', homepage_url: 'https://www.saemoonan.org/', denomination: '대한예수교장로회(통합)' },
  { name: '새에덴교회', code: 'saeeden', homepage_url: 'https://www.saeeden.kr/', denomination: '대한예수교장로회(합동)' },
  { name: '소망교회', code: 'somang', homepage_url: 'https://somang.net/', denomination: '대한예수교장로회(통합)' },
  { name: '수영로교회', code: 'sooyoungro', homepage_url: 'https://www.sooyoungro.org/', denomination: '대한예수교장로회(합동)' },
  { name: '숭의교회', code: 'sungui', homepage_url: 'http://www.sech.or.kr/', denomination: '기독교대한감리회' },
  { name: '신길교회', code: 'shingil', homepage_url: 'http://www.shingil.kr/', denomination: '기독교대한하나님의성회' },
  { name: '연세중앙교회', code: 'yonsei', homepage_url: 'https://www.yonsei.or.kr/', denomination: '기독교한국침례회' },
  { name: '영락교회', code: 'youngnak', homepage_url: 'https://www.youngnak.net/', denomination: '대한예수교장로회(통합)' },
  { name: '오륜교회', code: 'oryun', homepage_url: 'https://oryun.org/', denomination: '대한예수교장로회(합동)' },
  { name: '은혜와진리교회', code: 'gntc', homepage_url: 'https://gntc.net/', denomination: '기독교대한하나님의성회' },
  { name: '인천순복음교회', code: 'incheonfgtv', homepage_url: 'http://www.hyo7.com/', denomination: '기독교대한하나님의성회' },
  { name: '일산벧엘교회', code: 'bethel', homepage_url: 'http://bethel.or.kr/', denomination: '대한예수교장로회(합동)' },
  { name: '주안장로교회', code: 'juan', homepage_url: 'https://w3.juan.or.kr/', denomination: '대한예수교장로회(통합)' },
  { name: '지구촌교회', code: 'jiguchon', homepage_url: 'https://www.jiguchon.or.kr/', denomination: '기독교한국침례회' },
  { name: '충현교회', code: 'chunghyun', homepage_url: 'https://www.choonghyunchurch.or.kr/', denomination: '대한예수교장로회(합동)' },
]

async function addChurches() {
  console.log(`총 ${churches.length}개 교회 추가 시작...\n`)
  console.log(`Supabase URL: ${supabaseUrl}`)

  // 먼저 현재 등록된 교회 목록 확인
  const { data: existing, error: fetchError } = await supabase
    .from('churches')
    .select('code')

  if (fetchError) {
    console.error('기존 교회 조회 실패:', fetchError.message)
    // 테이블이 없을 수 있음 - 계속 진행
  }

  const existingCodes = new Set((existing || []).map((c: any) => c.code))
  console.log(`기존 등록 교회: ${existingCodes.size}개\n`)

  let added = 0
  let updated = 0
  let failed = 0

  for (const church of churches) {
    try {
      if (existingCodes.has(church.code)) {
        // 업데이트
        const { error } = await supabase
          .from('churches')
          .update({
            name: church.name,
            homepage_url: church.homepage_url,
            denomination: church.denomination,
            updated_at: new Date().toISOString()
          })
          .eq('code', church.code)

        if (error) {
          failed++
          console.log(`✗ [업데이트 실패] ${church.name}: ${error.message}`)
        } else {
          updated++
          console.log(`○ [업데이트] ${church.name} (${church.code})`)
        }
      } else {
        // 새로 추가
        const { error } = await supabase
          .from('churches')
          .insert({
            name: church.name,
            code: church.code,
            homepage_url: church.homepage_url,
            denomination: church.denomination,
            is_active: true
          })

        if (error) {
          if (error.message.includes('duplicate') || error.code === '23505') {
            updated++
            console.log(`○ [중복] ${church.name} (${church.code})`)
          } else {
            failed++
            console.log(`✗ [추가 실패] ${church.name}: ${error.message}`)
          }
        } else {
          added++
          console.log(`✓ [추가] ${church.name} (${church.code})`)
        }
      }
    } catch (error: any) {
      failed++
      console.log(`✗ [오류] ${church.name}: ${error.message}`)
    }
  }

  console.log(`\n===== 완료 =====`)
  console.log(`새로 추가: ${added}개`)
  console.log(`업데이트: ${updated}개`)
  console.log(`실패: ${failed}개`)

  // 최종 교회 목록 출력
  const { data: finalList } = await supabase
    .from('churches')
    .select('code, name, homepage_url')
    .order('name')

  console.log(`\n===== 등록된 교회 목록 (${finalList?.length || 0}개) =====`)
  finalList?.forEach((c: any, i: number) => {
    console.log(`${i + 1}. ${c.name} (${c.code}) - ${c.homepage_url}`)
  })
}

// 실행
addChurches().catch(console.error)
