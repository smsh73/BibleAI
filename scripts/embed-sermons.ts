/**
 * YouTube 플레이리스트에서 설교 스크립트 추출 및 벡터 임베딩
 *
 * 사용법:
 *   npx tsx scripts/embed-sermons.ts
 *
 * 환경 변수 필요:
 *   - OPENAI_API_KEY
 *   - SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Required environment variables are missing')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// YouTube 플레이리스트 URL
const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLJR3b9DmwxmTCOzuH_AUV5rfv_qime3tB'

interface VideoInfo {
  videoId: string
  title: string
  url: string
}

interface SermonChunk {
  video_id: string
  video_title: string
  video_url: string
  chunk_index: number
  start_time: number | null
  end_time: number | null
  content: string
  embedding?: number[]
}

// 플레이리스트에서 비디오 ID 추출
async function getPlaylistVideos(playlistUrl: string, limit: number = 5): Promise<VideoInfo[]> {
  console.log(`\n📋 플레이리스트에서 비디오 목록 가져오는 중...`)

  // YouTube 플레이리스트 페이지 HTML에서 비디오 ID 추출
  const playlistId = playlistUrl.match(/list=([^&]+)/)?.[1]
  if (!playlistId) {
    throw new Error('Invalid playlist URL')
  }

  // YouTube Data API 없이 플레이리스트 파싱 (제한적)
  // 실제 환경에서는 YouTube Data API v3 사용 권장
  const response = await fetch(playlistUrl)
  const html = await response.text()

  // HTML에서 비디오 ID 추출 (간단한 정규식)
  const videoIdMatches = html.match(/watch\?v=([a-zA-Z0-9_-]{11})/g) || []
  const uniqueVideoIds = [...new Set(videoIdMatches.map(m => m.replace('watch?v=', '')))]

  const videos: VideoInfo[] = uniqueVideoIds.slice(0, limit).map(videoId => ({
    videoId,
    title: `설교 영상 ${videoId}`, // 실제 제목은 나중에 업데이트
    url: `https://www.youtube.com/watch?v=${videoId}`
  }))

  console.log(`✅ ${videos.length}개 비디오 발견`)
  videos.forEach((v, i) => console.log(`   ${i + 1}. ${v.videoId}`))

  return videos
}

// YouTube 자막/스크립트 추출 (youtube-transcript 라이브러리 사용)
async function getVideoTranscript(videoId: string): Promise<{ text: string; segments: any[] } | null> {
  try {
    // 간단한 자막 추출 시도 (여러 방법)
    const transcriptUrl = `https://www.youtube.com/watch?v=${videoId}`

    // 실제로는 youtube-transcript 패키지나 API 사용
    // 여기서는 기존 API 엔드포인트 활용
    const response = await fetch('http://localhost:3000/api/youtube/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: transcriptUrl,
        useSTT: false // 자막 우선
      })
    })

    if (!response.ok) {
      console.log(`   ⚠️ 자막 추출 실패, 건너뜀`)
      return null
    }

    const data = await response.json()
    return {
      text: data.transcript || '',
      segments: data.segments || []
    }
  } catch (error) {
    console.log(`   ⚠️ 스크립트 추출 오류:`, error)
    return null
  }
}

// 텍스트를 청크로 분할
function splitIntoChunks(text: string, maxChunkSize: number = 500): string[] {
  const sentences = text.split(/[.!?。]\s*/)
  const chunks: string[] = []
  let currentChunk = ''

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
      chunks.push(currentChunk.trim())
      currentChunk = sentence
    } else {
      currentChunk += (currentChunk ? '. ' : '') + sentence
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks.filter(c => c.length > 50) // 너무 짧은 청크 제외
}

// 임베딩 생성
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text
    })
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

// 배치 임베딩 생성
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts
    })
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`)
  }

  const data = await response.json()
  return data.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((item: any) => item.embedding)
}

// 설교 청크 업로드
async function uploadSermonChunks(chunks: SermonChunk[]): Promise<void> {
  const batchSize = 50

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)

    // 임베딩 생성
    const texts = batch.map(c => c.content)
    const embeddings = await generateEmbeddingsBatch(texts)

    // 임베딩 추가
    const chunksWithEmbeddings = batch.map((chunk, idx) => ({
      ...chunk,
      embedding: embeddings[idx]
    }))

    // Supabase 업로드
    const { error } = await supabase
      .from('sermon_chunks')
      .upsert(chunksWithEmbeddings, {
        onConflict: 'video_id,chunk_index'
      })

    if (error) {
      console.error(`   ❌ 업로드 오류:`, error.message)
    } else {
      console.log(`   ✅ ${batch.length}개 청크 업로드 완료`)
    }

    // Rate limit 방지
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

// 샘플 설교 데이터 (테스트용)
const SAMPLE_SERMONS = [
  {
    videoId: 'sample_1',
    title: '2024년 1월 7일 주일설교 - 새해 첫 말씀',
    content: `오늘 말씀의 제목은 "새해 첫 걸음"입니다.
    새해가 시작되었습니다. 성도 여러분, 지난 한 해 동안 어떤 일들이 있으셨나요?
    힘든 일도 있었고, 기쁜 일도 있었을 것입니다.
    성경 시편 37편 5절에서 "네 길을 여호와께 맡기라 그를 의지하면 그가 이루시리라"고 말씀하십니다.
    우리가 새해에 무엇을 계획하든, 가장 중요한 것은 하나님께 맡기는 것입니다.
    요셉을 보십시오. 그는 형들에게 팔려가고, 억울하게 감옥에 갇혔지만,
    결국 하나님의 계획 안에서 이집트의 총리가 되었습니다.
    우리의 삶도 마찬가지입니다. 지금 힘드시더라도, 하나님께서 더 큰 그림을 그리고 계십니다.
    기도합시다. 하나님, 새해에도 우리와 함께해 주시옵소서.`
  },
  {
    videoId: 'sample_2',
    title: '2024년 1월 14일 주일설교 - 믿음의 여정',
    content: `오늘은 히브리서 11장의 믿음의 사람들에 대해 나누겠습니다.
    아브라함은 어디로 가는지도 모르면서 하나님의 부르심에 순종했습니다.
    성도 여러분, 우리의 믿음은 어떤가요? 때로는 불확실한 미래가 두렵지 않으신가요?
    하지만 기억하십시오. 믿음은 바라는 것들의 실상이요, 보이지 않는 것들의 증거입니다.
    모세도 바로의 궁전을 버리고 하나님의 백성과 함께 고난받기를 선택했습니다.
    이것이 진정한 믿음입니다. 눈에 보이는 것보다 하나님의 약속을 더 귀하게 여기는 것입니다.
    이번 주에 한번 이렇게 해보시는 것은 어떠하신지요?
    매일 아침 일어나서 "주님, 오늘도 제 발걸음을 인도해 주세요"라고 기도해보세요.
    작은 순종부터 시작하면, 하나님께서 더 큰 일을 보여주실 것입니다.`
  },
  {
    videoId: 'sample_3',
    title: '2024년 1월 21일 주일설교 - 두려움을 이기는 힘',
    content: `여호수아 1장 9절 말씀을 함께 읽겠습니다.
    "내가 네게 명령한 것이 아니냐 강하고 담대하라 두려워하지 말며 놀라지 말라
    네가 어디로 가든지 네 하나님 여호와가 너와 함께 하느니라"
    성도님들, 혹시 지금 두려움에 사로잡혀 계신 분이 계신가요?
    직장에서의 불안, 건강에 대한 걱정, 자녀에 대한 염려...
    하나님께서는 이런 우리에게 "두려워하지 말라"고 말씀하십니다.
    다윗이 골리앗 앞에 섰을 때, 그는 두렵지 않았을까요? 물론 두려웠을 것입니다.
    하지만 그는 자신의 힘이 아닌, 하나님의 이름으로 나아갔습니다.
    우리도 마찬가지입니다. 두려움이 밀려올 때, 하나님의 약속을 붙잡으십시오.
    아마 이러한 묵상이 도움이 되시리라 생각이 됩니다.`
  },
  {
    videoId: 'sample_4',
    title: '2024년 1월 28일 주일설교 - 사랑의 계명',
    content: `마태복음 22장에서 예수님은 가장 큰 계명이 무엇이냐는 질문에 대답하셨습니다.
    "네 마음을 다하고 목숨을 다하고 뜻을 다하여 주 너의 하나님을 사랑하라"
    그리고 둘째 계명은 "네 이웃을 네 자신같이 사랑하라"입니다.
    성도님들, 우리는 하나님을 사랑한다고 말하면서도, 이웃 사랑에는 인색할 때가 있습니다.
    선한 사마리아인의 비유를 기억하십니까?
    강도 만난 사람을 지나친 제사장과 레위인, 그리고 멈추어 돌봐준 사마리아인.
    진정한 이웃은 누구입니까? 도움이 필요한 사람 앞에 멈추는 사람입니다.
    이번 주에 주변에 힘든 분이 계시면, 작은 격려의 말 한마디 건네보시는 것은 어떨까요?
    하나님께서 보시기에 그것이 진정한 예배입니다.`
  },
  {
    videoId: 'sample_5',
    title: '2024년 2월 4일 주일설교 - 기도의 능력',
    content: `오늘은 기도에 대해 나누고자 합니다. 야고보서 5장 16절 말씀입니다.
    "의인의 간구는 역사하는 힘이 큼이니라"
    엘리야가 기도했을 때 하늘에서 비가 내렸습니다.
    한나가 눈물로 기도했을 때 사무엘을 얻었습니다.
    다니엘이 창을 열고 기도했을 때 사자굴에서 지켜주셨습니다.
    성도님들, 기도는 하나님과의 대화입니다.
    힘든 일이 있을 때, 걱정이 될 때, 감사할 때, 기쁠 때, 언제나 기도하십시오.
    제가 목회를 하면서 많은 기도 응답을 보았습니다.
    불치병 선고를 받았던 분이 기도 후 완치되신 일,
    사업이 어려웠던 분이 기도 후 새로운 길이 열린 일...
    포기하지 마시고 계속 기도하십시오. 하나님은 살아계십니다.
    한번 매일 정해진 시간에 기도해보시는 것은 어떠하신지요?`
  }
]

// 메인 실행
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('        설교 스크립트 벡터 임베딩')
  console.log('═══════════════════════════════════════════════')

  const command = process.argv[2] || 'sample'

  switch (command) {
    case 'sample':
      // 샘플 데이터로 테스트
      console.log('\n📚 샘플 설교 데이터 처리 중...')

      const allChunks: SermonChunk[] = []

      for (const sermon of SAMPLE_SERMONS) {
        console.log(`\n🎬 처리 중: ${sermon.title}`)

        const textChunks = splitIntoChunks(sermon.content, 400)
        console.log(`   📝 ${textChunks.length}개 청크 생성`)

        textChunks.forEach((chunk, idx) => {
          allChunks.push({
            video_id: sermon.videoId,
            video_title: sermon.title,
            video_url: `https://www.youtube.com/watch?v=${sermon.videoId}`,
            chunk_index: idx,
            start_time: null,
            end_time: null,
            content: chunk
          })
        })
      }

      console.log(`\n📤 총 ${allChunks.length}개 청크 업로드 중...`)
      await uploadSermonChunks(allChunks)

      console.log('\n✅ 샘플 설교 임베딩 완료!')
      break

    case 'playlist':
      // 실제 플레이리스트에서 추출 (서버 실행 필요)
      console.log('\n⚠️ 이 기능은 Next.js 서버가 실행 중이어야 합니다.')
      console.log('   먼저 npm run dev를 실행하세요.')

      try {
        const videos = await getPlaylistVideos(PLAYLIST_URL, 5)

        const playlistChunks: SermonChunk[] = []

        for (const video of videos) {
          console.log(`\n🎬 처리 중: ${video.title}`)

          const transcript = await getVideoTranscript(video.videoId)
          if (!transcript) continue

          const textChunks = splitIntoChunks(transcript.text, 400)
          console.log(`   📝 ${textChunks.length}개 청크 생성`)

          textChunks.forEach((chunk, idx) => {
            playlistChunks.push({
              video_id: video.videoId,
              video_title: video.title,
              video_url: video.url,
              chunk_index: idx,
              start_time: null,
              end_time: null,
              content: chunk
            })
          })
        }

        if (playlistChunks.length > 0) {
          console.log(`\n📤 총 ${playlistChunks.length}개 청크 업로드 중...`)
          await uploadSermonChunks(playlistChunks)
          console.log('\n✅ 플레이리스트 설교 임베딩 완료!')
        }
      } catch (error) {
        console.error('\n❌ 플레이리스트 처리 오류:', error)
      }
      break

    case 'status':
      // 상태 확인
      const { data: sermonData, error } = await supabase
        .from('sermon_chunks')
        .select('video_id, video_title', { count: 'exact' })

      if (error) {
        console.error('상태 확인 오류:', error.message)
        break
      }

      const uniqueVideos = [...new Set(sermonData?.map(s => s.video_id) || [])]

      console.log('\n📊 설교 임베딩 상태:')
      console.log(`   - 총 청크 수: ${sermonData?.length || 0}개`)
      console.log(`   - 고유 영상 수: ${uniqueVideos.length}개`)

      if (sermonData && sermonData.length > 0) {
        console.log('\n📋 임베딩된 설교 목록:')
        const titleMap = new Map<string, string>()
        sermonData.forEach(s => titleMap.set(s.video_id, s.video_title))
        titleMap.forEach((title, videoId) => {
          console.log(`   - ${title} (${videoId})`)
        })
      }
      break

    default:
      console.log(`
사용법:
  npx tsx scripts/embed-sermons.ts [command]

명령어:
  sample    샘플 설교 데이터 임베딩 (기본값)
  playlist  YouTube 플레이리스트에서 추출 (서버 필요)
  status    현재 임베딩 상태 확인
      `)
  }

  console.log('\n═══════════════════════════════════════════════')
}

main().catch(console.error)
