/**
 * 설교 기반 강해 API
 * POST /api/sermon-commentary
 * - 특정 성경 구절에 대한 목사님의 설교 내용 기반 강해 생성
 * - 3단계 검색: bible_references 직접 매칭 → 본문 키워드 → 벡터 유사도
 * - AI Fallback: OpenAI → Claude → Gemini → Perplexity
 * - 할루시네이션 금지: 설교 추출 내용에 근거한 답변만
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

// API 키 관리
let apiKeyCache: Record<string, string> = {}
let apiKeyCacheTime = 0
const API_KEY_CACHE_TTL = 5 * 60 * 1000

async function fetchStoredApiKeys(): Promise<Record<string, string>> {
  const now = Date.now()
  if (Object.keys(apiKeyCache).length > 0 && (now - apiKeyCacheTime) < API_KEY_CACHE_TTL) {
    return apiKeyCache
  }

  try {
    const { data } = await getSupabase()
      .from('api_keys')
      .select('provider, key')
      .eq('is_active', true)

    const keys: Record<string, string> = {}
    for (const row of data || []) {
      try {
        keys[row.provider] = Buffer.from(row.key, 'base64').toString('utf-8')
      } catch {
        keys[row.provider] = row.key
      }
    }

    apiKeyCache = keys
    apiKeyCacheTime = Date.now()
    return keys
  } catch {
    return apiKeyCache
  }
}

async function getApiKey(provider: string): Promise<string | null> {
  const stored = await fetchStoredApiKeys()
  if (stored[provider]) return stored[provider]

  const envKeys: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY
  }
  return envKeys[provider] || null
}

// 임베딩 생성
async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = await getApiKey('openai')
  if (!apiKey) throw new Error('OpenAI API key not available')
  const openai = new OpenAI({ apiKey })
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000),
    dimensions: 1536
  })
  return response.data[0].embedding
}

// 성경 구절 참조 정규화 (다양한 표기 변형 생성)
function normalizeReference(reference: string): string[] {
  const variants: string[] = [reference]

  // "요한복음 3:16" → ["요한복음 3:16", "요한복음 3장 16절", "요 3:16", "John 3:16"]
  const match = reference.match(/^(.+?)\s*(\d+)\s*[:장]\s*(\d+)/)
  if (match) {
    const [, book, chapter, verse] = match
    variants.push(`${book} ${chapter}장 ${verse}절`)
    variants.push(`${book} ${chapter}:${verse}`)
    variants.push(`${book}${chapter}:${verse}`)

    // 약어 매핑
    const abbrevMap: Record<string, string[]> = {
      '창세기': ['창', 'Gen'],
      '출애굽기': ['출', 'Exo'],
      '레위기': ['레', 'Lev'],
      '민수기': ['민', 'Num'],
      '신명기': ['신', 'Deu'],
      '여호수아': ['수', 'Jos'],
      '사사기': ['삿', 'Jdg'],
      '룻기': ['룻', 'Rut'],
      '사무엘상': ['삼상', '1Sa'],
      '사무엘하': ['삼하', '2Sa'],
      '열왕기상': ['왕상', '1Ki'],
      '열왕기하': ['왕하', '2Ki'],
      '역대상': ['대상', '1Ch'],
      '역대하': ['대하', '2Ch'],
      '에스라': ['스', 'Ezr'],
      '느헤미야': ['느', 'Neh'],
      '에스더': ['에', 'Est'],
      '욥기': ['욥', 'Job'],
      '시편': ['시', 'Psa'],
      '잠언': ['잠', 'Pro'],
      '전도서': ['전', 'Ecc'],
      '아가': ['아', 'Sol'],
      '이사야': ['사', 'Isa'],
      '예레미야': ['렘', 'Jer'],
      '예레미야애가': ['애', 'Lam'],
      '에스겔': ['겔', 'Eze'],
      '다니엘': ['단', 'Dan'],
      '호세아': ['호', 'Hos'],
      '요엘': ['욜', 'Joe'],
      '아모스': ['암', 'Amo'],
      '오바댜': ['옵', 'Oba'],
      '요나': ['욘', 'Jon'],
      '미가': ['미', 'Mic'],
      '나훔': ['나', 'Nah'],
      '하박국': ['합', 'Hab'],
      '스바냐': ['습', 'Zep'],
      '학개': ['학', 'Hag'],
      '스가랴': ['슥', 'Zec'],
      '말라기': ['말', 'Mal'],
      '마태복음': ['마', 'Mat', '마태'],
      '마가복음': ['막', 'Mar', '마가'],
      '누가복음': ['눅', 'Luk', '누가'],
      '요한복음': ['요', 'Joh', '요한'],
      '사도행전': ['행', 'Act'],
      '로마서': ['롬', 'Rom'],
      '고린도전서': ['고전', '1Co'],
      '고린도후서': ['고후', '2Co'],
      '갈라디아서': ['갈', 'Gal'],
      '에베소서': ['엡', 'Eph'],
      '빌립보서': ['빌', 'Phi'],
      '골로새서': ['골', 'Col'],
      '데살로니가전서': ['살전', '1Th'],
      '데살로니가후서': ['살후', '2Th'],
      '디모데전서': ['딤전', '1Ti'],
      '디모데후서': ['딤후', '2Ti'],
      '디도서': ['딛', 'Tit'],
      '빌레몬서': ['몬', 'Phm'],
      '히브리서': ['히', 'Heb'],
      '야고보서': ['약', 'Jam'],
      '베드로전서': ['벧전', '1Pe'],
      '베드로후서': ['벧후', '2Pe'],
      '요한일서': ['요일', '1Jo'],
      '요한이서': ['요이', '2Jo'],
      '요한삼서': ['요삼', '3Jo'],
      '유다서': ['유', 'Jud'],
      '요한계시록': ['계', 'Rev'],
    }

    const bookName = book.trim()
    if (abbrevMap[bookName]) {
      for (const abbr of abbrevMap[bookName]) {
        variants.push(`${abbr} ${chapter}:${verse}`)
        variants.push(`${abbr}${chapter}:${verse}`)
      }
    }
    // 역방향: 약어가 입력된 경우 전체 이름 추가
    for (const [fullName, abbrs] of Object.entries(abbrevMap)) {
      if (abbrs.includes(bookName)) {
        variants.push(`${fullName} ${chapter}:${verse}`)
        variants.push(`${fullName} ${chapter}장 ${verse}절`)
      }
    }
  }

  return [...new Set(variants)]
}

// 1단계: bible_references 배열에서 직접 매칭하는 설교 찾기
async function searchByBibleReferences(reference: string): Promise<any[]> {
  try {
    const variants = normalizeReference(reference)
    console.log(`[sermon-commentary] bible_references 검색 변형:`, variants.slice(0, 5))

    // bible_references 배열에서 해당 구절을 포함하는 설교 찾기
    const { data: sermons, error } = await getSupabase()
      .from('sermons')
      .select('video_id, video_title, video_url, speaker, upload_date, bible_references')
      .eq('processing_status', 'completed')

    if (error || !sermons) return []

    // bible_references 배열에 변형 중 하나라도 포함하는 설교 필터링
    const matchedSermons = sermons.filter((s: any) => {
      if (!s.bible_references || !Array.isArray(s.bible_references)) return false
      return s.bible_references.some((ref: string) => {
        const refLower = ref.toLowerCase().trim()
        return variants.some(v => {
          const vLower = v.toLowerCase().trim()
          // 완전 일치 또는 포함 관계 체크
          return refLower === vLower ||
            refLower.includes(vLower) ||
            vLower.includes(refLower)
        })
      })
    })

    if (matchedSermons.length === 0) return []

    console.log(`[sermon-commentary] bible_references 매칭 설교 ${matchedSermons.length}개 발견`)

    // 매칭된 설교의 청크 가져오기
    const videoIds = matchedSermons.map((s: any) => s.video_id)
    const { data: chunks, error: chunkError } = await getSupabase()
      .from('sermon_chunks')
      .select('id, video_id, video_title, video_url, chunk_index, content, start_time, end_time')
      .in('video_id', videoIds)
      .order('chunk_index', { ascending: true })

    if (chunkError || !chunks) return []

    // 설교 메타데이터 합치기 + 구절 키워드가 포함된 청크 우선
    const refKeywords = extractKeywords(reference)
    return chunks
      .map((c: any) => {
        const sermon = matchedSermons.find((s: any) => s.video_id === c.video_id)
        const contentLower = (c.content || '').toLowerCase()
        const keywordHits = refKeywords.filter(kw => contentLower.includes(kw.toLowerCase())).length
        return {
          ...c,
          speaker: sermon?.speaker,
          upload_date: sermon?.upload_date,
          similarity: 1.0, // 직접 매칭이므로 최고 점수
          keyword_rank: keywordHits > 0 ? 1.0 : 0.5,
          combined_score: keywordHits > 0 ? 1.0 : 0.8,
          match_type: 'bible_references'
        }
      })
      .sort((a: any, b: any) => b.combined_score - a.combined_score)
      .slice(0, 10) // 직접 매칭 설교에서 최대 10개 청크

  } catch (error) {
    console.error('[sermon-commentary] bible_references 검색 실패:', error)
    return []
  }
}

// 구절에서 키워드 추출
function extractKeywords(reference: string): string[] {
  const match = reference.match(/^(.+?)\s*(\d+)\s*[:장]\s*(\d+)/)
  if (!match) return [reference]

  const [, book, chapter, verse] = match
  return [
    reference,
    book.trim(),
    `${chapter}장`,
    `${chapter}:${verse}`,
    `${chapter}장 ${verse}절`
  ]
}

// 2단계: 본문 내 구절 언급 검색 (키워드 기반)
async function searchByContentKeywords(reference: string): Promise<any[]> {
  try {
    const variants = normalizeReference(reference)
    // 핵심 검색어만 사용 (너무 많으면 느림)
    const searchTerms = variants.slice(0, 3)

    const allResults: any[] = []

    for (const term of searchTerms) {
      const { data, error } = await getSupabase()
        .from('sermon_chunks')
        .select('id, video_id, video_title, video_url, chunk_index, content, start_time, end_time')
        .ilike('content', `%${term}%`)
        .limit(5)

      if (!error && data) {
        allResults.push(...data)
      }
    }

    if (allResults.length === 0) return []

    // 중복 제거
    const uniqueResults = allResults.reduce((acc: any[], item: any) => {
      if (!acc.find((a: any) => a.id === item.id)) acc.push(item)
      return acc
    }, [])

    // 설교 메타데이터 가져오기
    const videoIds = [...new Set(uniqueResults.map((r: any) => r.video_id))]
    const { data: sermons } = await getSupabase()
      .from('sermons')
      .select('video_id, speaker, upload_date')
      .in('video_id', videoIds)

    const sermonMap = new Map((sermons || []).map((s: any) => [s.video_id, s]))

    return uniqueResults.map((c: any) => {
      const sermon = sermonMap.get(c.video_id)
      return {
        ...c,
        speaker: sermon?.speaker,
        upload_date: sermon?.upload_date,
        similarity: 0.7,
        keyword_rank: 1.0,
        combined_score: 0.7,
        match_type: 'content_keyword'
      }
    }).slice(0, 5)

  } catch (error) {
    console.error('[sermon-commentary] 본문 키워드 검색 실패:', error)
    return []
  }
}

// 3단계: 벡터 유사도 검색 (확장된 쿼리)
async function searchByVectorSimilarity(reference: string, verseContent?: string): Promise<any[]> {
  try {
    // 쿼리 텍스트를 구절 내용으로 확장하여 더 정확한 임베딩 생성
    const expandedQuery = verseContent
      ? `${reference} - "${verseContent}"`
      : reference

    const queryEmbedding = await createEmbedding(expandedQuery)

    const { data, error } = await getSupabase().rpc('hybrid_search_sermons', {
      query_embedding: queryEmbedding,
      query_text: reference,
      match_count: 10,
      vector_weight: 0.7,
      keyword_weight: 0.3
    })

    if (error) {
      console.error('[sermon-commentary] 벡터 검색 오류:', error)
      return []
    }

    // 관련성 임계값 적용
    const MIN_SCORE = 0.25
    const filtered = (data || [])
      .filter((r: any) => (r.combined_score || 0) >= MIN_SCORE)
      .map((r: any) => ({ ...r, match_type: 'vector_similarity' }))

    console.log(`[sermon-commentary] 벡터 검색: ${data?.length || 0}개 중 ${filtered.length}개 통과 (threshold: ${MIN_SCORE})`)

    return filtered
  } catch (error) {
    console.error('[sermon-commentary] 벡터 검색 실패:', error)
    return []
  }
}

// 통합 검색: 3단계를 합쳐서 중복 제거 + 우선순위 정렬
async function searchSermonsByReference(reference: string, verseContent?: string): Promise<any[]> {
  console.log(`[sermon-commentary] 3단계 검색 시작: "${reference}"${verseContent ? ` (본문: ${verseContent.substring(0, 30)}...)` : ''}`)

  // 1단계: bible_references 직접 매칭 (가장 정확)
  const directMatches = await searchByBibleReferences(reference)
  console.log(`[sermon-commentary] 1단계 (bible_references): ${directMatches.length}개`)

  // 직접 매칭 결과가 충분하면 바로 반환
  if (directMatches.length >= 3) {
    return deduplicateAndRank(directMatches, []).slice(0, 8)
  }

  // 2단계: 본문 키워드 매칭
  const keywordMatches = await searchByContentKeywords(reference)
  console.log(`[sermon-commentary] 2단계 (본문 키워드): ${keywordMatches.length}개`)

  // 1+2단계로 충분하면 반환
  const combined12 = deduplicateAndRank(directMatches, keywordMatches)
  if (combined12.length >= 3) {
    return combined12.slice(0, 8)
  }

  // 3단계: 벡터 유사도 (확장 쿼리)
  const vectorMatches = await searchByVectorSimilarity(reference, verseContent)
  console.log(`[sermon-commentary] 3단계 (벡터 유사도): ${vectorMatches.length}개`)

  const allResults = deduplicateAndRank(
    [...directMatches, ...keywordMatches],
    vectorMatches
  )

  console.log(`[sermon-commentary] 최종 검색 결과: ${allResults.length}개`)
  return allResults.slice(0, 8)
}

// 중복 제거 + 우선순위 정렬
function deduplicateAndRank(primary: any[], secondary: any[]): any[] {
  const seen = new Set<number>()
  const result: any[] = []

  // 1순위: 직접 매칭 / 키워드 매칭 (이미 높은 combined_score)
  for (const item of primary) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      result.push(item)
    }
  }

  // 2순위: 벡터 유사도
  for (const item of secondary) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      result.push(item)
    }
  }

  // combined_score 내림차순 정렬
  return result.sort((a, b) => (b.combined_score || 0) - (a.combined_score || 0))
}

// 시스템 프롬프트 (강화)
const SYSTEM_PROMPT = `당신은 안양제일교회의 목사님이 설교하신 내용을 바탕으로 성경 강해를 전해주는 AI 어시스턴트입니다.

역할:
- 주어진 설교 내용만을 근거로 해당 성경 구절에 대한 강해를 전달합니다.
- 목사님의 설교 스타일을 존중하면서 내용을 정리합니다.

절대 규칙:
1. 아래에 제공된 [설교 1], [설교 2] 등의 내용에 없는 것은 절대 만들어내지 마세요 (할루시네이션 금지)
2. 제공된 설교 내용을 직접 인용하거나 요약하세요
3. 출처는 반드시 아래 제공된 설교의 제목과 날짜만 사용하세요. 제공되지 않은 설교를 언급하지 마세요.
4. 해당 구절과 직접적으로 관련된 내용만 강해하세요. 관련성이 낮은 설교 내용은 무시하세요.

답변 형식:
- 친절하고 이해하기 쉽게 설명
- 2-3문단으로 간결하게 정리
- 설교 제목과 날짜를 출처로 표기 (반드시 아래 제공된 설교 목록에서만)
- 핵심 메시지를 강조`

export async function POST(req: NextRequest) {
  try {
    const { reference, verseContent } = await req.json()

    if (!reference) {
      return NextResponse.json({ error: 'reference is required' }, { status: 400 })
    }

    console.log(`[sermon-commentary] 구절 "${reference}" 강해 검색 시작`)

    // 1. 3단계 통합 설교 검색
    const sermonResults = await searchSermonsByReference(reference, verseContent)

    if (!sermonResults || sermonResults.length === 0) {
      console.log(`[sermon-commentary] "${reference}" 관련 설교 없음`)
      return NextResponse.json({ found: false })
    }

    // 매칭 유형별 로깅
    const matchTypes = sermonResults.reduce((acc: Record<string, number>, r: any) => {
      acc[r.match_type || 'unknown'] = (acc[r.match_type || 'unknown'] || 0) + 1
      return acc
    }, {})
    console.log(`[sermon-commentary] ${sermonResults.length}개 청크 (유형: ${JSON.stringify(matchTypes)})`)

    // 2. 설교별로 그룹핑하여 중복 설교 제거 (같은 설교의 여러 청크 → 하나의 설교로)
    const sermonGroups = new Map<string, { chunks: any[], sermon: any }>()
    for (const r of sermonResults) {
      const key = r.video_id || r.video_title
      if (!sermonGroups.has(key)) {
        sermonGroups.set(key, {
          chunks: [],
          sermon: {
            video_id: r.video_id,
            video_title: r.video_title,
            video_url: r.video_url,
            speaker: r.speaker,
            upload_date: r.upload_date,
            best_score: r.combined_score,
            match_type: r.match_type,
            start_time: r.start_time
          }
        })
      }
      sermonGroups.get(key)!.chunks.push(r)
      // 최고 점수 업데이트
      if (r.combined_score > sermonGroups.get(key)!.sermon.best_score) {
        sermonGroups.get(key)!.sermon.best_score = r.combined_score
        sermonGroups.get(key)!.sermon.match_type = r.match_type
      }
    }

    // 3. 컨텍스트 구성 (설교별로 그룹핑)
    const sortedGroups = [...sermonGroups.values()]
      .sort((a, b) => b.sermon.best_score - a.sermon.best_score)

    const context = sortedGroups.map((group, i) => {
      const { sermon, chunks } = group
      const title = sermon.video_title || '제목 없음'
      const speaker = sermon.speaker || ''
      const date = sermon.upload_date || ''
      // 같은 설교의 여러 청크를 합쳐서 컨텍스트 구성
      const combinedContent = chunks
        .sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0))
        .map((c: any) => c.content)
        .join('\n')
      return `[설교 ${i + 1}] ${title}${speaker ? ` (${speaker})` : ''}${date ? ` - ${date}` : ''}\n"${combinedContent}"`
    }).join('\n\n')

    const userPrompt = `다음 설교 내용을 바탕으로 "${reference}" 구절에 대한 강해를 전해주세요.

${context}

중요: 위에 제공된 [설교 1]~[설교 ${sortedGroups.length}]의 내용만 사용하세요.
위 설교에 없는 내용은 절대 추가하지 마세요.
"${reference}"에 대한 목사님의 강해를 친절하고 이해하기 쉽게 정리해주세요.`

    // 4. AI 응답 생성 (4단계 fallback)
    let commentary = ''
    let provider = ''

    // OpenAI
    try {
      const apiKey = await getApiKey('openai')
      if (!apiKey) throw new Error('No OpenAI key')
      const openai = new OpenAI({ apiKey })
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      })
      commentary = response.choices[0]?.message?.content || ''
      provider = 'OpenAI'
      console.log(`[sermon-commentary] OpenAI 응답 생성 완료`)
    } catch (e: any) {
      console.log(`[sermon-commentary] OpenAI 실패: ${e.message?.substring(0, 50)}`)
    }

    // Claude
    if (!commentary) {
      try {
        const apiKey = await getApiKey('anthropic')
        if (!apiKey) throw new Error('No Anthropic key')
        const anthropic = new Anthropic({ apiKey })
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
        const textBlock = response.content.find(b => b.type === 'text')
        commentary = textBlock ? (textBlock as any).text : ''
        provider = 'Claude'
        console.log(`[sermon-commentary] Claude 응답 생성 완료`)
      } catch (e: any) {
        console.log(`[sermon-commentary] Claude 실패: ${e.message?.substring(0, 50)}`)
      }
    }

    // Gemini
    if (!commentary) {
      try {
        const apiKey = await getApiKey('google')
        if (!apiKey) throw new Error('No Google key')
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
        const result = await model.generateContent(`${SYSTEM_PROMPT}\n\n${userPrompt}`)
        commentary = result.response.text()
        provider = 'Gemini'
        console.log(`[sermon-commentary] Gemini 응답 생성 완료`)
      } catch (e: any) {
        console.log(`[sermon-commentary] Gemini 실패: ${e.message?.substring(0, 50)}`)
      }
    }

    // Perplexity
    if (!commentary) {
      try {
        const apiKey = await getApiKey('perplexity')
        if (!apiKey) throw new Error('No Perplexity key')
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'sonar',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt }
            ],
            max_tokens: 1024
          })
        })
        const data = await response.json()
        commentary = data.choices?.[0]?.message?.content || ''
        provider = 'Perplexity'
        console.log(`[sermon-commentary] Perplexity 응답 생성 완료`)
      } catch (e: any) {
        console.log(`[sermon-commentary] Perplexity 실패: ${e.message?.substring(0, 50)}`)
      }
    }

    if (!commentary) {
      return NextResponse.json({
        found: true,
        error: '모든 AI 서비스가 일시적으로 사용 불가능합니다.'
      }, { status: 503 })
    }

    // 출처 정보 (설교 그룹별, 중복 제거)
    const sources = sortedGroups.slice(0, 3).map(group => ({
      title: group.sermon.video_title,
      speaker: group.sermon.speaker,
      date: group.sermon.upload_date,
      videoUrl: group.sermon.video_url,
      startTime: group.sermon.start_time,
      matchType: group.sermon.match_type,
      score: group.sermon.best_score
    }))

    return NextResponse.json({
      found: true,
      commentary,
      provider,
      sources
    })

  } catch (error: any) {
    console.error('[sermon-commentary] 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
