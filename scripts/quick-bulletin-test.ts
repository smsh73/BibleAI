/**
 * 빠른 주보 VLM 테스트
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const boardId = 66638

async function test() {
  console.log('📥 주보 이미지 가져오는 중...')

  // 주보 상세 페이지에서 이미지 URL 추출
  const detailUrl = `https://www.anyangjeil.org/Board/Detail/65/${boardId}`
  const response = await fetch(detailUrl)
  const html = await response.text()

  // 이미지 URL 추출
  const imgRegex = /src="(https:\/\/data\.dimode\.co\.kr[^"]+\.jpg)\s*"/g
  const matches = [...html.matchAll(imgRegex)]

  if (matches.length === 0) {
    console.log('❌ 이미지를 찾을 수 없습니다.')
    return
  }

  const firstImageUrl = matches[0][1].trim()
  console.log('첫 번째 이미지:', firstImageUrl)

  // 이미지 다운로드
  const imgResponse = await fetch(firstImageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.anyangjeil.org/'
    }
  })

  if (!imgResponse.ok) {
    console.log('❌ 이미지 다운로드 실패:', imgResponse.status)
    return
  }

  const imageBuffer = Buffer.from(await imgResponse.arrayBuffer())
  console.log('✅ 이미지 크기:', (imageBuffer.length / 1024).toFixed(1) + 'KB')

  // VLM 추출 테스트
  const { extractBulletinWithVLM } = await import('../lib/bulletin-ocr')

  console.log('\n🤖 VLM 추출 시작...')
  const startTime = Date.now()
  const result = await extractBulletinWithVLM(imageBuffer.toString('base64'), 'image/jpeg')

  console.log('\n=== VLM 결과 ===')
  console.log('성공:', result.success)
  console.log('제공자:', result.provider)
  console.log('소요 시간:', result.duration + 'ms')
  console.log('섹션 수:', result.data.sections?.length || 0)
  console.log('교정 수:', result.corrections?.length || 0)

  if (result.data.sections && result.data.sections.length > 0) {
    console.log('\n섹션 목록:')
    for (const section of result.data.sections) {
      console.log('  -', section.type, ':', section.title || '(제목 없음)')
    }
  }

  if (result.data.proper_nouns?.names?.length > 0) {
    console.log('\n인식된 이름:', result.data.proper_nouns.names.join(', '))
  }

  if (result.data.sections?.[0]?.content) {
    console.log('\n첫 섹션 내용 (300자):')
    console.log(result.data.sections[0].content.substring(0, 300))
  }
}

test().catch(console.error)
