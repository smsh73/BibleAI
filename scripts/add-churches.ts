/**
 * 교회 목록 추가 스크립트
 * 사용법: npx ts-node scripts/add-churches.ts
 */

const churches = [
  // 기존 교회 (이미 등록되어 있을 수 있음)
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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

  console.log(`총 ${churches.length}개 교회 추가 시작...\n`)

  let added = 0
  let updated = 0
  let failed = 0

  for (const church of churches) {
    try {
      const response = await fetch(`${baseUrl}/api/admin/church-crawler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addChurch',
          ...church
        })
      })

      const result = await response.json()

      if (result.success) {
        if (result.message?.includes('업데이트')) {
          updated++
          console.log(`✓ [업데이트] ${church.name} (${church.code})`)
        } else {
          added++
          console.log(`✓ [추가] ${church.name} (${church.code})`)
        }
      } else if (result.error?.includes('중복') || result.error?.includes('duplicate')) {
        updated++
        console.log(`○ [중복/스킵] ${church.name} (${church.code})`)
      } else {
        failed++
        console.log(`✗ [실패] ${church.name}: ${result.error}`)
      }
    } catch (error: any) {
      failed++
      console.log(`✗ [오류] ${church.name}: ${error.message}`)
    }
  }

  console.log(`\n===== 완료 =====`)
  console.log(`추가: ${added}개`)
  console.log(`업데이트: ${updated}개`)
  console.log(`실패: ${failed}개`)
}

// 직접 실행
addChurches().catch(console.error)

export { churches }
