/**
 * Supabase 클라이언트 및 Hybrid RAG 벡터 검색
 * pgvector를 사용한 의미론적 검색 + 키워드 검색
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// 환경 변수
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

// 클라이언트 인스턴스
let _supabase: SupabaseClient | null = null
let _supabaseAdmin: SupabaseClient | null = null

// 공개 클라이언트 (브라우저용)
export function getSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null
  if (!_supabase) {
    _supabase = createClient(supabaseUrl, supabaseAnonKey)
  }
  return _supabase
}

// 관리자 클라이언트 (서버용)
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseServiceKey) return null
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  }
  return _supabaseAdmin
}

// 레거시 호환성
export const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null as any

// ============================================
// 타입 정의
// ============================================

export interface BibleVerse {
  id: number
  testament: '구약' | '신약'
  book_name: string
  book_number: number
  chapter: number
  verse: number
  content: string
  reference: string
  version_id?: string  // 성경 버전 (GAE, KRV, NIV 등)
  embedding?: number[]
}

export interface SearchResult {
  id: number
  testament: string
  book_name: string
  chapter: number
  verse: number
  content: string
  reference: string
  version_id?: string  // 성경 버전
  similarity?: number
  keyword_rank?: number
  combined_score?: number
}

export interface HybridSearchOptions {
  limit?: number
  vectorWeight?: number
  keywordWeight?: number
  testament?: '구약' | '신약'
  version?: string  // 성경 버전 필터 (GAE, KRV, NIV 등)
}

export interface BibleVersion {
  id: string
  name_korean: string
  name_english?: string
  language: string
  is_default: boolean
  is_active: boolean
}

// ============================================
// 임베딩 생성
// ============================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

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
    const error = await response.json()
    throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

// 배치 임베딩 생성
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  // OpenAI 배치 제한: 최대 2048개
  const batchSize = 2000
  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: batch
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`)
    }

    const data = await response.json()
    const embeddings = data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((item: any) => item.embedding)

    allEmbeddings.push(...embeddings)

    // Rate limit 방지
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  return allEmbeddings
}

// ============================================
// Hybrid RAG 검색
// ============================================

/**
 * 하이브리드 검색: 벡터(의미론적) + 키워드 검색 결합
 * @param query 검색 쿼리
 * @param options 검색 옵션 (limit, vectorWeight, keywordWeight, testament, version)
 */
export async function hybridSearchBible(
  query: string,
  options: HybridSearchOptions = {}
): Promise<SearchResult[]> {
  const {
    limit = 10,
    vectorWeight = 0.7,
    keywordWeight = 0.3,
    testament,
    version  // 버전 필터 추가
  } = options

  const client = getSupabaseAdmin() || getSupabase()
  if (!client) {
    console.warn('Supabase not configured, returning empty results')
    return []
  }

  try {
    // 1. 쿼리 임베딩 생성
    const queryEmbedding = await generateEmbedding(query)

    // 2. Hybrid 검색 RPC 호출 (버전 필터 포함)
    const { data, error } = await client.rpc('hybrid_search_bible', {
      query_embedding: queryEmbedding,
      query_text: query,
      match_count: limit,
      vector_weight: vectorWeight,
      keyword_weight: keywordWeight,
      filter_version: version || null  // 버전 필터 전달
    })

    if (error) {
      console.error('Hybrid search error:', error)
      throw error
    }

    // 3. 결과 필터링 (testament) - 클라이언트 사이드 추가 필터
    let results = data || []
    if (testament) {
      results = results.filter((r: any) => r.testament === testament)
    }

    return results.map((row: any) => ({
      id: row.id,
      testament: row.testament,
      book_name: row.book_name,
      chapter: row.chapter,
      verse: row.verse,
      content: row.content,
      reference: row.reference,
      version_id: row.version_id,  // 버전 ID 포함
      similarity: row.similarity,
      keyword_rank: row.keyword_rank,
      combined_score: row.combined_score
    }))

  } catch (error) {
    console.error('Hybrid search error:', error)
    return []
  }
}

/**
 * 순수 벡터 검색 (빠른 의미론적 검색)
 * @param query 검색 쿼리
 * @param options 검색 옵션 (limit, testament, version)
 */
export async function vectorSearchBible(
  query: string,
  options: { limit?: number; testament?: string; version?: string } = {}
): Promise<SearchResult[]> {
  const { limit = 10, testament, version } = options

  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return []

  try {
    const queryEmbedding = await generateEmbedding(query)

    const { data, error } = await client.rpc('vector_search_bible', {
      query_embedding: queryEmbedding,
      match_count: limit,
      filter_testament: testament || null,
      filter_version: version || null  // 버전 필터 추가
    })

    if (error) throw error

    return (data || []).map((row: any) => ({
      ...row,
      version_id: row.version_id  // 버전 ID 포함
    }))

  } catch (error) {
    console.error('Vector search error:', error)
    return []
  }
}

/**
 * 키워드 검색 (정확한 단어/구절 검색) - 직접 쿼리
 * 감정/주제 기반 확장 검색 지원
 */
export async function keywordSearchBible(
  query: string,
  options: { limit?: number } = {}
): Promise<SearchResult[]> {
  const { limit = 10 } = options

  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return []

  // 감정/주제 키워드 매핑 (사용자 쿼리 → 성경에서 찾을 수 있는 단어들)
  const emotionKeywords: Record<string, string[]> = {
    '힘들': ['위로', '평안', '도움', '은혜', '소망', '고난'],
    '외로': ['함께', '위로', '버리지', '고아', '과부'],
    '불안': ['두려워', '평안', '염려', '걱정', '믿음'],
    '슬픔': ['눈물', '슬픔', '위로', '애통', '소망'],
    '두려': ['두려워', '무서워', '평안', '용기', '담대'],
    '화가': ['분노', '노여움', '화', '용서', '사랑'],
    '걱정': ['염려', '근심', '평안', '믿음', '맡기'],
    '지쳤': ['쉬', '평안', '회복', '힘', '새롭'],
    '우울': ['위로', '소망', '빛', '기쁨', '평안'],
    '감사': ['감사', '찬양', '은혜', '축복', '기쁨'],
    '용서': ['용서', '사랑', '죄', '회개', '화해'],
    '사랑': ['사랑', '형제', '이웃', '계명', '은혜'],
    '믿음': ['믿음', '신뢰', '하나님', '약속', '의'],
    '소망': ['소망', '기대', '약속', '미래', '영생'],
    '평안': ['평안', '평화', '쉼', '안식', '위로']
  }

  try {
    // 1. 사용자 쿼리에서 감정/주제 키워드 추출
    let searchTerms: string[] = []

    for (const [emotion, bibleKeywords] of Object.entries(emotionKeywords)) {
      if (query.includes(emotion)) {
        searchTerms = [...searchTerms, ...bibleKeywords]
      }
    }

    // 2. 매핑된 키워드가 없으면 원본 쿼리에서 추출
    if (searchTerms.length === 0) {
      searchTerms = query.split(/\s+/).filter(k => k.length > 1)
    }

    // 3. 중복 제거
    searchTerms = [...new Set(searchTerms)]

    console.log('[keywordSearchBible] 검색 키워드:', searchTerms)

    // 4. 여러 키워드로 검색 시도
    let allResults: SearchResult[] = []

    for (const term of searchTerms.slice(0, 5)) { // 최대 5개 키워드로 검색
      const { data, error } = await client
        .from('bible_verses')
        .select('id, testament, book_name, chapter, verse, content, reference')
        .ilike('content', `%${term}%`)
        .limit(Math.ceil(limit / 2))

      if (error) {
        console.error(`Keyword search error for "${term}":`, error)
        continue
      }

      if (data && data.length > 0) {
        allResults = [...allResults, ...data.map(row => ({
          id: row.id,
          testament: row.testament,
          book_name: row.book_name,
          chapter: row.chapter,
          verse: row.verse,
          content: row.content,
          reference: row.reference,
          similarity: 0.5,
          keyword_rank: 1,
          combined_score: 0.5
        }))]
      }
    }

    // 5. 중복 제거 (reference 기준)
    const uniqueResults = allResults.filter((result, index, self) =>
      index === self.findIndex(r => r.reference === result.reference)
    )

    console.log('[keywordSearchBible] 검색 결과:', uniqueResults.length, '개')

    return uniqueResults.slice(0, limit)

  } catch (error) {
    console.error('Keyword search error:', error)
    return []
  }
}

/**
 * 주제별 성경 구절 검색 (사전 정의된 주제 활용)
 */
export async function searchByTopic(
  topic: string,
  options: { limit?: number } = {}
): Promise<SearchResult[]> {
  // 주제별 검색 쿼리 확장
  const topicQueries: Record<string, string> = {
    '위로': '슬픔 고통 위로 평안 소망 눈물',
    '감사': '감사 찬양 은혜 축복 기쁨',
    '용서': '용서 사랑 죄 회개 화해',
    '불안': '두려움 걱정 평안 믿음 하나님 지키심',
    '인내': '인내 시련 연단 믿음 소망',
    '지혜': '지혜 분별 명철 지식 깨달음',
    '사랑': '사랑 형제 이웃 사랑 계명',
    '믿음': '믿음 신뢰 의지 하나님 약속',
    '소망': '소망 기대 약속 미래 영생',
    '치유': '병 치유 건강 회복 고침'
  }

  const expandedQuery = topicQueries[topic] || topic

  return hybridSearchBible(expandedQuery, {
    ...options,
    vectorWeight: 0.6,
    keywordWeight: 0.4
  })
}

// ============================================
// 데이터 삽입/업데이트
// ============================================

/**
 * 성경 구절 삽입 (임베딩 포함)
 */
export async function insertBibleVerse(verse: Omit<BibleVerse, 'id'>): Promise<void> {
  const client = getSupabaseAdmin()
  if (!client) throw new Error('Supabase admin client not available')

  const embedding = await generateEmbedding(verse.content)

  const { error } = await client
    .from('bible_verses')
    .upsert({
      ...verse,
      embedding
    }, {
      onConflict: 'book_name,chapter,verse'
    })

  if (error) throw error
}

/**
 * 배치 성경 구절 삽입
 */
export async function insertBibleVersesBatch(
  verses: Omit<BibleVerse, 'id'>[],
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number }> {
  const client = getSupabaseAdmin()
  if (!client) throw new Error('Supabase admin client not available')

  const batchSize = 100
  let success = 0
  let failed = 0

  for (let i = 0; i < verses.length; i += batchSize) {
    const batch = verses.slice(i, i + batchSize)

    try {
      // 배치 임베딩 생성
      const contents = batch.map(v => v.content)
      const embeddings = await generateEmbeddingsBatch(contents)

      // 임베딩 추가
      const versesWithEmbeddings = batch.map((v, idx) => ({
        ...v,
        embedding: embeddings[idx]
      }))

      // Supabase 업로드
      const { error } = await client
        .from('bible_verses')
        .upsert(versesWithEmbeddings, {
          onConflict: 'book_name,chapter,verse'
        })

      if (error) {
        console.error(`Batch ${Math.floor(i / batchSize) + 1} failed:`, error)
        failed += batch.length
      } else {
        success += batch.length
      }

    } catch (error) {
      console.error(`Batch ${Math.floor(i / batchSize) + 1} error:`, error)
      failed += batch.length
    }

    onProgress?.(Math.min(i + batchSize, verses.length), verses.length)

    // Rate limit 방지
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return { success, failed }
}

// ============================================
// 유틸리티
// ============================================

/**
 * 임베딩 상태 확인
 */
export async function getEmbeddingStatus(): Promise<{
  total: number
  embedded: number
  pending: number
  percent: number
} | null> {
  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return null

  try {
    const { data, error } = await client
      .from('bible_verses')
      .select('id, embedding', { count: 'exact' })

    if (error) throw error

    const total = data?.length || 0
    const embedded = data?.filter(row => row.embedding !== null).length || 0

    return {
      total,
      embedded,
      pending: total - embedded,
      percent: total > 0 ? Math.round((embedded / total) * 100) : 0
    }

  } catch (error) {
    console.error('Get embedding status error:', error)
    return null
  }
}

/**
 * Supabase 연결 테스트
 */
export async function testSupabaseConnection(): Promise<{
  connected: boolean
  message: string
}> {
  const client = getSupabase()
  if (!client) {
    return { connected: false, message: 'Supabase client not configured' }
  }

  try {
    const { data, error } = await client
      .from('bible_verses')
      .select('id')
      .limit(1)

    if (error) {
      return { connected: false, message: error.message }
    }

    return { connected: true, message: `Connected. Sample data: ${JSON.stringify(data)}` }

  } catch (error: any) {
    return { connected: false, message: error.message || 'Unknown error' }
  }
}

// ============================================
// 설교 중복 체크 및 관리
// ============================================

/**
 * 이미 처리된 동영상인지 확인 (sermons 테이블 우선, sermon_chunks 폴백)
 */
export async function isVideoProcessed(videoId: string): Promise<boolean> {
  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return false

  try {
    // 1. sermons 테이블에서 완료된 것 확인
    const { data: sermonData, error: sermonError } = await client
      .from('sermons')
      .select('id, processing_status')
      .eq('video_id', videoId)
      .limit(1)

    if (!sermonError && sermonData && sermonData.length > 0) {
      // completed 상태인 경우에만 처리됨으로 간주
      if (sermonData[0].processing_status === 'completed') {
        return true
      }
    }

    // 2. 폴백: sermon_chunks 테이블 확인 (레거시 데이터)
    const { data, error } = await client
      .from('sermon_chunks')
      .select('id')
      .eq('video_id', videoId)
      .limit(1)

    if (error) {
      console.error('Video check error:', error)
      return false
    }

    return (data?.length || 0) > 0
  } catch (error) {
    console.error('Video check error:', error)
    return false
  }
}

/**
 * 여러 동영상 중 이미 처리된 것 필터링 (sermons + sermon_chunks 모두 확인)
 */
export async function filterProcessedVideos(videoIds: string[]): Promise<{
  processed: string[]
  pending: string[]
}> {
  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return { processed: [], pending: videoIds }

  try {
    const processedSet = new Set<string>()

    // 1. sermons 테이블에서 완료된 것 확인
    const { data: sermonsData, error: sermonsError } = await client
      .from('sermons')
      .select('video_id')
      .in('video_id', videoIds)
      .eq('processing_status', 'completed')

    if (!sermonsError && sermonsData) {
      sermonsData.forEach(d => processedSet.add(d.video_id))
    }

    // 2. sermon_chunks 테이블 확인 (레거시)
    const { data, error } = await client
      .from('sermon_chunks')
      .select('video_id')
      .in('video_id', videoIds)

    if (!error && data) {
      data.forEach(d => processedSet.add(d.video_id))
    }

    const processed = videoIds.filter(id => processedSet.has(id))
    const pending = videoIds.filter(id => !processedSet.has(id))

    return { processed, pending }
  } catch (error) {
    console.error('Filter videos error:', error)
    return { processed: [], pending: videoIds }
  }
}

/**
 * 모든 설교 데이터 삭제 (리셋)
 */
export async function resetAllSermonData(): Promise<{
  success: boolean
  deletedChunks: number
  deletedSermons: number
  error?: string
}> {
  const client = getSupabaseAdmin()
  if (!client) return { success: false, deletedChunks: 0, deletedSermons: 0, error: 'Supabase admin client not available' }

  try {
    // 1. sermon_chunks 카운트 조회
    const { count: chunksCount } = await client
      .from('sermon_chunks')
      .select('*', { count: 'exact', head: true })

    // 2. sermon_chunks 삭제
    const { error: chunksError } = await client
      .from('sermon_chunks')
      .delete()
      .neq('id', 0)

    if (chunksError) {
      console.error('Delete sermon_chunks error:', chunksError)
    }

    // 3. sermons 카운트 및 삭제 (테이블이 존재하는 경우)
    let sermonsCount = 0
    try {
      const { count, error: countError } = await client
        .from('sermons')
        .select('*', { count: 'exact', head: true })

      // 테이블이 없는 경우 에러 무시
      if (countError) {
        if (countError.message?.includes('Could not find') || countError.code === '42P01') {
          console.log('sermons table does not exist, skipping...')
        } else {
          console.error('Count sermons error:', countError)
        }
      } else {
        sermonsCount = count || 0

        const { error: sermonsError } = await client
          .from('sermons')
          .delete()
          .neq('id', 0)

        if (sermonsError) {
          // 테이블이 없는 경우 에러 무시
          if (sermonsError.message?.includes('Could not find') || sermonsError.code === '42P01') {
            console.log('sermons table does not exist, skipping delete...')
          } else {
            console.error('Delete sermons error:', sermonsError)
          }
        }
      }
    } catch (e) {
      // sermons 테이블이 없을 수 있음
      console.log('sermons table may not exist yet')
    }

    return {
      success: true,
      deletedChunks: chunksCount || 0,
      deletedSermons: sermonsCount
    }
  } catch (error: any) {
    console.error('Reset sermon data error:', error)
    return { success: false, deletedChunks: 0, deletedSermons: 0, error: error.message }
  }
}

/**
 * 처리된 모든 동영상 ID 조회
 */
export async function getProcessedVideoIds(): Promise<string[]> {
  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client
      .from('sermon_chunks')
      .select('video_id')

    if (error) {
      console.error('Get processed videos error:', error)
      return []
    }

    // 중복 제거
    return [...new Set(data?.map(d => d.video_id) || [])]
  } catch (error) {
    console.error('Get processed videos error:', error)
    return []
  }
}

/**
 * 설교 메타데이터 저장 (sermons 테이블)
 */
export async function saveSermonMetadata(
  metadata: SermonMetadata
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseAdmin()
  if (!client) return { success: false, error: 'Supabase admin client not available' }

  try {
    const { error } = await client
      .from('sermons')
      .upsert({
        video_id: metadata.videoId,
        video_url: metadata.videoUrl,
        video_title: metadata.videoTitle,
        sermon_start_time: metadata.sermonStartTime,
        sermon_end_time: metadata.sermonEndTime,
        sermon_duration: metadata.sermonDuration,
        full_transcript: metadata.fullTranscript,
        speaker: metadata.speaker,
        upload_date: metadata.uploadDate,
        channel_name: metadata.channelName,
        description: metadata.description,
        tags: metadata.tags,
        bible_references: metadata.bibleReferences,
        processing_status: 'processing'
      }, {
        onConflict: 'video_id'
      })

    if (error) {
      console.error('Save sermon metadata error:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Save sermon metadata error:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 설교 처리 완료 상태 업데이트
 */
export async function updateSermonStatus(
  videoId: string,
  status: 'completed' | 'failed',
  chunkCount?: number,
  errorMessage?: string
): Promise<void> {
  const client = getSupabaseAdmin()
  if (!client) return

  try {
    const updateData: Record<string, any> = {
      processing_status: status
    }
    if (chunkCount !== undefined) {
      updateData.chunk_count = chunkCount
    }
    if (errorMessage) {
      updateData.error_message = errorMessage
    }

    await client
      .from('sermons')
      .update(updateData)
      .eq('video_id', videoId)
  } catch (error) {
    console.error('Update sermon status error:', error)
  }
}

/**
 * 설교 청크 업로드 (video_url 포함)
 */
export async function uploadSermonChunks(
  videoId: string,
  videoTitle: string,
  chunks: Array<{ text: string; startTime: number; endTime: number }>,
  onProgress?: (current: number, total: number) => void,
  videoUrl?: string
): Promise<{ success: number; failed: number }> {
  const client = getSupabaseAdmin()
  if (!client) throw new Error('Supabase admin client not available')

  let success = 0
  let failed = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    try {
      // 임베딩 생성
      const embedding = await generateEmbedding(chunk.text)

      // Supabase에 저장 (video_url 포함)
      const insertData: Record<string, any> = {
        video_id: videoId,
        video_title: videoTitle,
        chunk_index: i,
        content: chunk.text,
        start_time: chunk.startTime,
        end_time: chunk.endTime,
        embedding
      }

      // video_url이 제공된 경우에만 추가
      if (videoUrl) {
        insertData.video_url = videoUrl
      }

      const { error } = await client
        .from('sermon_chunks')
        .insert(insertData)

      if (error) {
        console.error(`Chunk ${i} upload failed:`, error)
        failed++
      } else {
        success++
      }
    } catch (error) {
      console.error(`Chunk ${i} error:`, error)
      failed++
    }

    onProgress?.(i + 1, chunks.length)

    // Rate limit 방지
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  return { success, failed }
}

/**
 * 설교 청크 업로드 (재시도 로직 포함)
 * Rate limit 및 일시적 오류에 대해 지수 백오프로 재시도
 */
export async function uploadSermonChunksWithRetry(
  videoId: string,
  videoTitle: string,
  chunks: Array<{ text: string; startTime: number; endTime: number }>,
  onProgress?: (current: number, total: number) => void,
  videoUrl?: string,
  maxRetries: number = 3
): Promise<{ success: number; failed: number }> {
  const client = getSupabaseAdmin()
  if (!client) throw new Error('Supabase admin client not available')

  let success = 0
  let failed = 0
  const BATCH_SIZE = 5  // 한 번에 처리할 청크 수
  const BASE_DELAY = 500  // 기본 대기 시간 (ms)

  // 배치 단위로 처리
  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length)
    const batch = chunks.slice(batchStart, batchEnd)

    for (let i = 0; i < batch.length; i++) {
      const chunkIndex = batchStart + i
      const chunk = batch[i]
      let retryCount = 0
      let chunkSuccess = false

      while (retryCount < maxRetries && !chunkSuccess) {
        try {
          // 재시도 시 지수 백오프 대기
          if (retryCount > 0) {
            const delay = BASE_DELAY * Math.pow(2, retryCount)
            console.log(`[SermonChunks] 청크 ${chunkIndex} 재시도 ${retryCount}/${maxRetries}, ${delay}ms 대기`)
            await new Promise(resolve => setTimeout(resolve, delay))
          }

          // 임베딩 생성
          const embedding = await generateEmbedding(chunk.text)

          // Supabase에 저장
          const insertData: Record<string, any> = {
            video_id: videoId,
            video_title: videoTitle,
            chunk_index: chunkIndex,
            content: chunk.text,
            start_time: chunk.startTime,
            end_time: chunk.endTime,
            embedding
          }

          if (videoUrl) {
            insertData.video_url = videoUrl
          }

          const { error } = await client
            .from('sermon_chunks')
            .insert(insertData)

          if (error) {
            // 중복 키 에러는 성공으로 처리
            if (error.code === '23505') {
              console.log(`[SermonChunks] 청크 ${chunkIndex} 이미 존재 (스킵)`)
              chunkSuccess = true
              success++
            } else {
              throw error
            }
          } else {
            chunkSuccess = true
            success++
          }
        } catch (error: any) {
          retryCount++
          const isRateLimit = error.message?.includes('rate') ||
                             error.message?.includes('429') ||
                             error.message?.includes('Too Many')

          if (isRateLimit && retryCount < maxRetries) {
            // Rate limit 시 더 긴 대기
            console.warn(`[SermonChunks] Rate limit 감지, 청크 ${chunkIndex}`)
            await new Promise(resolve => setTimeout(resolve, 5000 * retryCount))
          } else if (retryCount >= maxRetries) {
            console.error(`[SermonChunks] 청크 ${chunkIndex} 최종 실패:`, error.message)
            failed++
          }
        }
      }

      onProgress?.(chunkIndex + 1, chunks.length)
    }

    // 배치 간 대기 (Rate limit 방지)
    if (batchEnd < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  return { success, failed }
}

// ============================================
// 설교 검색 함수
// ============================================

export interface SermonSearchResult {
  id: number
  video_id: string
  video_title: string
  video_url?: string
  chunk_index: number
  content: string
  start_time?: number
  end_time?: number
  speaker?: string
  upload_date?: string
  similarity?: number
  keyword_rank?: number
  combined_score?: number
}

// 설교 메타데이터 인터페이스
export interface SermonMetadata {
  videoId: string
  videoUrl: string
  videoTitle: string
  sermonStartTime?: number
  sermonEndTime?: number
  sermonDuration?: number
  fullTranscript?: string
  speaker?: string
  uploadDate?: string
  channelName?: string
  description?: string
  tags?: string[]
  bibleReferences?: string[]
}

/**
 * 설교 Hybrid 검색
 */
export async function hybridSearchSermons(
  query: string,
  options: { limit?: number } = {}
): Promise<SermonSearchResult[]> {
  const { limit = 5 } = options

  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return []

  try {
    const queryEmbedding = await generateEmbedding(query)

    const { data, error } = await client.rpc('hybrid_search_sermons', {
      query_embedding: queryEmbedding,
      query_text: query,
      match_count: limit,
      vector_weight: 0.7,
      keyword_weight: 0.3
    })

    if (error) {
      console.error('Sermon search error:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Sermon search error:', error)
    return []
  }
}

/**
 * 성경 + 설교 통합 검색
 */
export async function searchAll(
  query: string,
  options: { bibleLimit?: number; sermonLimit?: number } = {}
): Promise<{
  bibleResults: SearchResult[]
  sermonResults: SermonSearchResult[]
}> {
  const { bibleLimit = 5, sermonLimit = 3 } = options

  const [bibleResults, sermonResults] = await Promise.all([
    hybridSearchBible(query, { limit: bibleLimit }),
    hybridSearchSermons(query, { limit: sermonLimit })
  ])

  return { bibleResults, sermonResults }
}

// ============================================
// 레거시 호환 함수
// ============================================

import type { BibleChunk, SearchResult as LegacySearchResult } from '@/types'

export async function searchBibleVerses(
  query: string,
  options: {
    emotion?: string
    limit?: number
    threshold?: number
    version?: string  // 성경 버전 추가
  } = {}
): Promise<LegacySearchResult[]> {
  const { limit = 5, version } = options

  // 1. hybrid 검색 시도 (벡터 + 키워드, 버전 필터링)
  let results = await hybridSearchBible(query, { limit, version })

  // 2. hybrid 검색 실패 시 키워드 검색으로 폴백
  if (results.length === 0) {
    console.log('[searchBibleVerses] hybrid 검색 실패, 키워드 검색으로 폴백...')
    results = await keywordSearchBible(query, { limit })
  }

  // 레거시 형식으로 변환
  return results.map(row => ({
    chunk: {
      id: String(row.id),
      testament: row.testament as '구약' | '신약',
      bookName: row.book_name,
      bookAbbr: row.book_name.substring(0, 2),
      bookNumber: 0,
      chapter: row.chapter,
      verseStart: row.verse,
      verseEnd: row.verse,
      referenceFull: row.reference,
      referenceShort: row.reference,
      content: row.content,
      contentWithMetadata: `${row.reference}: ${row.content}`,
      characters: [],
      themes: [],
      keywords: [],
      emotions: [],
      charCount: row.content.length,
      verseCount: 1
    },
    similarity: row.combined_score || row.similarity || 0,
    distance: 1 - (row.combined_score || row.similarity || 0)
  }))
}

// ============================================
// API 키 관리
// ============================================

export interface StoredApiKey {
  id: string
  provider: string
  key: string
  is_active: boolean
  priority: number
  created_at: string
  updated_at: string
}

/**
 * 관리자 페이지에서 저장한 API 키 조회
 * Edge Runtime에서는 사용할 수 없으므로 Node.js 런타임에서만 사용
 */
export async function getStoredApiKey(provider: string): Promise<string | null> {
  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return null

  try {
    const { data, error } = await client
      .from('api_keys')
      .select('key, is_active')
      .eq('provider', provider)
      .eq('is_active', true)
      .single()

    if (error || !data) return null

    // Base64 복호화
    try {
      return Buffer.from(data.key, 'base64').toString('utf-8')
    } catch {
      return data.key
    }
  } catch (error) {
    console.error(`Get API key error for ${provider}:`, error)
    return null
  }
}

/**
 * 모든 활성화된 API 키 조회
 */
export async function getAllStoredApiKeys(): Promise<Record<string, string>> {
  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return {}

  try {
    const { data, error } = await client
      .from('api_keys')
      .select('provider, key')
      .eq('is_active', true)
      .order('priority', { ascending: true })

    if (error || !data) return {}

    const keys: Record<string, string> = {}
    for (const row of data) {
      try {
        keys[row.provider] = Buffer.from(row.key, 'base64').toString('utf-8')
      } catch {
        keys[row.provider] = row.key
      }
    }

    return keys
  } catch (error) {
    console.error('Get all API keys error:', error)
    return {}
  }
}

// 청크 업로드 (레거시)
export async function uploadChunks(chunks: BibleChunk[]) {
  console.warn('uploadChunks is deprecated. Use insertBibleVersesBatch instead.')

  const client = getSupabaseAdmin()
  if (!client) throw new Error('Supabase admin client not available')

  const batchSize = 100

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)

    const contents = batch.map(chunk => chunk.contentWithMetadata)
    const embeddings = await generateEmbeddingsBatch(contents)

    const chunksWithEmbeddings = batch.map((chunk, idx) => ({
      id: chunk.id,
      testament: chunk.testament,
      book_name: chunk.bookName,
      book_abbr: chunk.bookAbbr,
      book_number: chunk.bookNumber,
      chapter: chunk.chapter,
      verse_start: chunk.verseStart,
      verse_end: chunk.verseEnd,
      reference_full: chunk.referenceFull,
      reference_short: chunk.referenceShort,
      content: chunk.content,
      content_with_metadata: chunk.contentWithMetadata,
      characters: chunk.characters,
      themes: chunk.themes,
      keywords: chunk.keywords,
      emotions: chunk.emotions,
      char_count: chunk.charCount,
      verse_count: chunk.verseCount,
      embedding: embeddings[idx]
    }))

    const { error } = await client
      .from('bible_chunks')
      .upsert(chunksWithEmbeddings)

    if (error) {
      console.error(`Batch ${i / batchSize + 1} failed:`, error)
    } else {
      console.log(`Batch ${i / batchSize + 1} uploaded (${batch.length} chunks)`)
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

// ============================================
// GraphRAG - 성경 구절 관계 그래프
// ============================================

export interface VerseRelation {
  relatedReference: string
  relationType: string
  strength: number
  description: string
  direction: 'outgoing' | 'incoming'
}

export interface ConnectedVerse {
  reference: string
  depth: number
  relationType: string | null
  relationDescription: string | null
  path: string[]
}

export interface VerseTheme {
  reference: string
  theme: string
  confidence: number
}

export interface GraphNode {
  id: string
  reference: string
  content?: string
  themes?: string[]
  depth: number
  isCenter?: boolean
}

export interface GraphEdge {
  source: string
  target: string
  relationType: string
  strength: number
  description?: string
}

export interface VerseGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  centerReference: string
  _timings?: Record<string, number>  // 디버깅용 타이밍 정보
}

/**
 * 구절의 직접 연결된 관계 가져오기
 */
export async function getVerseRelations(reference: string): Promise<VerseRelation[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client.rpc('get_verse_relations', {
      verse_ref: reference
    })

    if (error) {
      console.error('Get verse relations error:', error)
      return []
    }

    return (data || []).map((row: any) => ({
      relatedReference: row.related_reference,
      relationType: row.relation_type,
      strength: row.strength,
      description: row.description,
      direction: row.direction
    }))
  } catch (error) {
    console.error('Get verse relations error:', error)
    return []
  }
}

/**
 * BFS로 연결된 구절 그래프 탐색
 */
export async function getConnectedVerses(
  reference: string,
  maxDepth: number = 2,
  maxResults: number = 20
): Promise<ConnectedVerse[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client.rpc('get_connected_verses', {
      start_reference: reference,
      max_depth: maxDepth,
      max_results: maxResults
    })

    if (error) {
      console.error('Get connected verses error:', error)
      return []
    }

    return (data || []).map((row: any) => ({
      reference: row.reference,
      depth: row.depth,
      relationType: row.relation_type,
      relationDescription: row.relation_description,
      path: row.path
    }))
  } catch (error) {
    console.error('Get connected verses error:', error)
    return []
  }
}

/**
 * 특정 주제의 구절들 가져오기
 */
export async function getVersesByTheme(
  theme: string,
  minConfidence: number = 0.7,
  maxResults: number = 10
): Promise<VerseTheme[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client.rpc('get_verses_by_theme', {
      target_theme: theme,
      min_confidence: minConfidence,
      max_results: maxResults
    })

    if (error) {
      console.error('Get verses by theme error:', error)
      return []
    }

    return (data || []).map((row: any) => ({
      reference: row.reference,
      theme: row.theme,
      confidence: row.confidence
    }))
  } catch (error) {
    console.error('Get verses by theme error:', error)
    return []
  }
}

/**
 * 구절의 주제 태그 가져오기
 */
export async function getVerseThemes(reference: string): Promise<string[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client
      .from('verse_themes')
      .select('theme')
      .eq('reference', reference)
      .order('confidence', { ascending: false })

    if (error) return []
    return (data || []).map(row => row.theme)
  } catch {
    return []
  }
}

/**
 * 구절 내용 가져오기 (bible_chunks 또는 bible_verses 테이블에서)
 * @param reference 구절 참조 (예: "요한복음 3:16")
 * @param version 성경 버전 (예: "GAE", "NIV") - bible_verses 조회 시 사용
 */
export async function getVerseContent(reference: string, version?: string): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null

  try {
    // bible_chunks 테이블에서 먼저 시도
    const { data, error } = await client
      .from('bible_chunks')
      .select('content')
      .eq('reference_full', reference)
      .limit(1)
      .single()

    if (!error && data) return data.content

    // bible_verses 테이블에서 시도 (버전 필터 포함)
    let verseQuery = client
      .from('bible_verses')
      .select('content')
      .eq('reference', reference)

    // 버전 필터 적용 (GAE의 경우 version_id가 'GAE'이거나 null)
    if (version) {
      if (version === 'GAE') {
        verseQuery = verseQuery.or('version_id.eq.GAE,version_id.is.null')
      } else {
        verseQuery = verseQuery.eq('version_id', version)
      }
    }

    const { data: verseData } = await verseQuery.limit(1).single()

    return verseData?.content || null
  } catch {
    return null
  }
}

/**
 * GraphRAG: 시각화용 전체 그래프 데이터 생성
 * 중심 구절에서 BFS로 연결된 구절들을 탐색하고 그래프 구조 생성
 *
 * 최적화: 배치 쿼리로 N+1 문제 해결
 * @param centerReference 중심 구절 참조
 * @param maxDepth BFS 탐색 깊이
 * @param version 성경 버전 필터 (기본값: GAE)
 */
export async function buildVerseGraph(
  centerReference: string,
  maxDepth: number = 2,
  version: string = 'GAE'
): Promise<VerseGraph> {
  const timings: Record<string, number> = {}
  const startTotal = Date.now()

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const visitedRefs = new Set<string>()

  const client = getSupabase()
  if (!client) {
    return { nodes: [], edges: [], centerReference }
  }

  // 1. BFS로 연결된 구절 탐색 (가장 먼저 실행)
  const startBFS = Date.now()
  const connectedVerses = await getConnectedVerses(centerReference, maxDepth, 30)
  timings['1_getConnectedVerses'] = Date.now() - startBFS

  // 모든 필요한 구절 참조 수집
  const allRefs = [centerReference, ...connectedVerses.map(c => c.reference)]
  const uniqueRefs = [...new Set(allRefs)]

  // 2-3. 병렬로 콘텐츠와 주제 조회
  const startParallel = Date.now()

  const [chunksData, themesData] = await Promise.all([
    // bible_chunks에서 콘텐츠 조회
    client
      .from('bible_chunks')
      .select('reference_full, content')
      .in('reference_full', uniqueRefs)
      .then(res => res.data),

    // verse_themes에서 주제 조회
    client
      .from('verse_themes')
      .select('reference, theme')
      .in('reference', uniqueRefs)
      .order('confidence', { ascending: false })
      .then(res => res.data)
  ])

  // 콘텐츠 맵 생성
  const contentMap = new Map<string, string>()
  if (chunksData) {
    chunksData.forEach(row => contentMap.set(row.reference_full, row.content))
  }

  // 누락된 콘텐츠는 bible_verses에서 조회 (필요시에만, 버전 필터 포함)
  const missingRefs = uniqueRefs.filter(ref => !contentMap.has(ref))
  if (missingRefs.length > 0) {
    // 1. 단일 절 참조 먼저 조회 (버전 필터 포함)
    let versesQuery = client
      .from('bible_verses')
      .select('reference, content')
      .in('reference', missingRefs)

    // 버전 필터 적용 (GAE의 경우 version_id가 'GAE'이거나 null)
    if (version === 'GAE') {
      versesQuery = versesQuery.or('version_id.eq.GAE,version_id.is.null')
    } else {
      versesQuery = versesQuery.eq('version_id', version)
    }

    const { data: versesData } = await versesQuery

    if (versesData) {
      versesData.forEach(row => contentMap.set(row.reference, row.content))
    }

    // 2. 여전히 누락된 참조 중 범위 형식 처리 (예: "마태복음 7:13-14")
    const stillMissing = missingRefs.filter(ref => !contentMap.has(ref))
    for (const ref of stillMissing) {
      // 범위 형식 파싱: "책이름 장:시작절-끝절"
      const rangeMatch = ref.match(/^(.+)\s+(\d+):(\d+)-(\d+)$/)
      if (rangeMatch) {
        const [, bookName, chapter, startVerse, endVerse] = rangeMatch
        const chapterNum = parseInt(chapter)
        const startNum = parseInt(startVerse)
        const endNum = parseInt(endVerse)

        // 범위 내 개별 절 조회 (버전 필터 포함)
        let rangeQuery = client
          .from('bible_verses')
          .select('verse, content')
          .eq('book_name', bookName)
          .eq('chapter', chapterNum)
          .gte('verse', startNum)
          .lte('verse', endNum)

        // 버전 필터 적용
        if (version === 'GAE') {
          rangeQuery = rangeQuery.or('version_id.eq.GAE,version_id.is.null')
        } else {
          rangeQuery = rangeQuery.eq('version_id', version)
        }

        const { data: rangeVerses } = await rangeQuery.order('verse')

        if (rangeVerses && rangeVerses.length > 0) {
          // 개별 절 내용을 결합
          const combinedContent = rangeVerses
            .map(v => `[${v.verse}절] ${v.content}`)
            .join(' ')
          contentMap.set(ref, combinedContent)
        }
      }
    }
  }

  // 주제 맵 생성
  const themesMap = new Map<string, string[]>()
  if (themesData) {
    themesData.forEach(row => {
      if (!themesMap.has(row.reference)) {
        themesMap.set(row.reference, [])
      }
      themesMap.get(row.reference)!.push(row.theme)
    })
  }

  timings['2_batchGetContentAndThemes'] = Date.now() - startParallel

  // 3. 노드 생성 (이제 DB 호출 없음)
  const startNodes = Date.now()

  // 중심 노드 추가
  nodes.push({
    id: centerReference,
    reference: centerReference,
    content: contentMap.get(centerReference) || undefined,
    themes: themesMap.get(centerReference) || [],
    depth: 0,
    isCenter: true
  })
  visitedRefs.add(centerReference)

  // 연결된 노드 추가
  for (const connected of connectedVerses) {
    if (!visitedRefs.has(connected.reference)) {
      nodes.push({
        id: connected.reference,
        reference: connected.reference,
        content: contentMap.get(connected.reference) || undefined,
        themes: themesMap.get(connected.reference) || [],
        depth: connected.depth
      })
      visitedRefs.add(connected.reference)
    }
  }
  timings['3_createNodes'] = Date.now() - startNodes

  // 4. 엣지 추가: 모든 노드 쌍에 대해 관계 확인 (병렬 쿼리)
  const startEdges = Date.now()
  const refArray = Array.from(visitedRefs)

  // 병렬로 source와 target 조회
  const [sourceRelations, targetRelations] = await Promise.all([
    client
      .from('verse_relations')
      .select('source_reference, target_reference, relation_type, strength, description')
      .in('source_reference', refArray)
      .then(res => res.data),
    client
      .from('verse_relations')
      .select('source_reference, target_reference, relation_type, strength, description')
      .in('target_reference', refArray)
      .then(res => res.data)
  ])

  // 두 결과 병합 (중복 제거)
  const relationsMap = new Map<string, any>()
  for (const rel of [...(sourceRelations || []), ...(targetRelations || [])]) {
    const key = `${rel.source_reference}-${rel.target_reference}`
    if (!relationsMap.has(key)) {
      relationsMap.set(key, rel)
    }
  }
  const relations = Array.from(relationsMap.values())

  if (relations) {
    for (const rel of relations) {
      if (visitedRefs.has(rel.source_reference) && visitedRefs.has(rel.target_reference)) {
        edges.push({
          source: rel.source_reference,
          target: rel.target_reference,
          relationType: rel.relation_type,
          strength: rel.strength,
          description: rel.description
        })
      }
    }
  }
  timings['4_getEdges'] = Date.now() - startEdges

  // 5. 같은 주제 노드들 연결 (DB 호출 없음)
  const startThemeEdges = Date.now()
  const themeNodeMap = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.themes) {
      for (const theme of node.themes) {
        if (!themeNodeMap.has(theme)) {
          themeNodeMap.set(theme, [])
        }
        themeNodeMap.get(theme)!.push(node.reference)
      }
    }
  }

  const existingEdges = new Set(edges.map(e => `${e.source}-${e.target}`))
  for (const [theme, refs] of themeNodeMap) {
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const edgeKey1 = `${refs[i]}-${refs[j]}`
        const edgeKey2 = `${refs[j]}-${refs[i]}`
        if (!existingEdges.has(edgeKey1) && !existingEdges.has(edgeKey2)) {
          edges.push({
            source: refs[i],
            target: refs[j],
            relationType: 'thematic',
            strength: 0.5,
            description: `공통 주제: ${theme}`
          })
          existingEdges.add(edgeKey1)
        }
      }
    }
  }
  timings['5_themeEdges'] = Date.now() - startThemeEdges
  timings['total'] = Date.now() - startTotal

  // 타이밍 로그 출력
  console.log('=== buildVerseGraph Timings ===')
  console.log(`Reference: ${centerReference}, Depth: ${maxDepth}, Nodes: ${nodes.length}`)
  Object.entries(timings).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}ms`)
  })
  console.log('===============================')

  return {
    nodes,
    edges,
    centerReference,
    _timings: timings  // 타이밍 정보 포함
  }
}

/**
 * 벡터 유사도 기반 관계 자동 생성 (의미적 연결)
 * @param reference 구절 참조
 * @param threshold 유사도 임계값
 * @param limit 결과 수
 * @param version 성경 버전 필터 (기본값: GAE)
 */
export async function findSemanticRelations(
  reference: string,
  threshold: number = 0.85,
  limit: number = 5,
  version: string = 'GAE'
): Promise<{ reference: string; similarity: number }[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    // 먼저 해당 구절의 임베딩 가져오기
    const { data: sourceData } = await client
      .from('bible_chunks')
      .select('embedding')
      .eq('reference_full', reference)
      .limit(1)
      .single()

    if (!sourceData?.embedding) return []

    // 유사한 구절 검색 (버전 필터를 RPC에서 지원하지 않으면 클라이언트 사이드 필터)
    const { data, error } = await client.rpc('match_bible_chunks', {
      query_embedding: sourceData.embedding,
      match_threshold: threshold,
      match_count: (limit + 1) * 3  // 버전 필터링 후에도 충분한 결과를 얻기 위해 더 많이 가져옴
    })

    if (error) return []

    // 클라이언트 사이드에서 버전 필터링
    // (bible_chunks는 version_id가 없으므로 별도 조회 필요 없음, 관계는 GAE 기준으로 저장됨)
    return (data || [])
      .filter((row: any) => row.reference_full !== reference)
      .slice(0, limit)
      .map((row: any) => ({
        reference: row.reference_full,
        similarity: row.similarity
      }))
  } catch {
    return []
  }
}

// ============================================
// 성경 메타데이터 (인물, 장소, 사건)
// ============================================

export interface BiblePerson {
  id: string
  nameKorean: string
  nameEnglish?: string
  gender?: string
  testament?: string
  description?: string
}

export interface BiblePlace {
  id: string
  nameKorean: string
  nameEnglish?: string
  placeType?: string
  latitude?: number
  longitude?: number
  description?: string
}

export interface BibleEvent {
  id: string
  nameKorean: string
  nameEnglish?: string
  eventType?: string
  testament?: string
  startReference?: string
  endReference?: string
  description?: string
  significance?: string
}

/**
 * 구절에 등장하는 인물 가져오기
 */
export async function getVersePeople(reference: string): Promise<BiblePerson[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client.rpc('get_verse_people', {
      verse_ref: reference
    })

    if (error) return []

    return (data || []).map((row: any) => ({
      id: row.person_id,
      nameKorean: row.name_korean,
      role: row.role
    }))
  } catch {
    return []
  }
}

/**
 * 구절에 언급된 장소 가져오기
 */
export async function getVersePlaces(reference: string): Promise<BiblePlace[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client.rpc('get_verse_places', {
      verse_ref: reference
    })

    if (error) return []

    return (data || []).map((row: any) => ({
      id: row.place_id,
      nameKorean: row.name_korean
    }))
  } catch {
    return []
  }
}

/**
 * 인물 정보 가져오기
 */
export async function getPerson(personId: string): Promise<BiblePerson | null> {
  const client = getSupabase()
  if (!client) return null

  try {
    const { data, error } = await client
      .from('bible_people')
      .select('*')
      .eq('id', personId)
      .single()

    if (error || !data) return null

    return {
      id: data.id,
      nameKorean: data.name_korean,
      nameEnglish: data.name_english,
      gender: data.gender,
      testament: data.testament,
      description: data.description
    }
  } catch {
    return null
  }
}

/**
 * 인물 관련 구절 가져오기
 */
export async function getPersonVerses(
  personId: string,
  maxResults: number = 10
): Promise<{ reference: string; role: string; context: string }[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client.rpc('get_person_verses', {
      p_person_id: personId,
      max_results: maxResults
    })

    if (error) return []

    return data || []
  } catch {
    return []
  }
}

/**
 * 관련 인물 네트워크 가져오기 (가족, 동역자 등)
 */
export async function getRelatedPeople(
  personId: string
): Promise<{ id: string; nameKorean: string; relationship: string }[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client.rpc('get_related_people', {
      p_person_id: personId
    })

    if (error) return []

    return (data || []).map((row: any) => ({
      id: row.related_person_id,
      nameKorean: row.name_korean,
      relationship: row.relationship
    }))
  } catch {
    return []
  }
}

/**
 * 장소 정보 가져오기
 */
export async function getPlace(placeId: string): Promise<BiblePlace | null> {
  const client = getSupabase()
  if (!client) return null

  try {
    const { data, error } = await client
      .from('bible_places')
      .select('*')
      .eq('id', placeId)
      .single()

    if (error || !data) return null

    return {
      id: data.id,
      nameKorean: data.name_korean,
      nameEnglish: data.name_english,
      placeType: data.place_type,
      latitude: data.latitude,
      longitude: data.longitude,
      description: data.description
    }
  } catch {
    return null
  }
}

/**
 * 사건 정보 가져오기
 */
export async function getEvent(eventId: string): Promise<BibleEvent | null> {
  const client = getSupabase()
  if (!client) return null

  try {
    const { data, error } = await client
      .from('bible_events')
      .select('*')
      .eq('id', eventId)
      .single()

    if (error || !data) return null

    return {
      id: data.id,
      nameKorean: data.name_korean,
      nameEnglish: data.name_english,
      eventType: data.event_type,
      testament: data.testament,
      startReference: data.start_reference,
      endReference: data.end_reference,
      description: data.description,
      significance: data.significance
    }
  } catch {
    return null
  }
}

/**
 * 사건에 참여한 인물 가져오기
 */
export async function getEventPeople(
  eventId: string
): Promise<{ person: BiblePerson; role: string }[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client
      .from('event_people')
      .select(`
        role,
        bible_people (
          id,
          name_korean,
          name_english,
          gender,
          testament,
          description
        )
      `)
      .eq('event_id', eventId)

    if (error || !data) return []

    return data.map((row: any) => ({
      person: {
        id: row.bible_people.id,
        nameKorean: row.bible_people.name_korean,
        nameEnglish: row.bible_people.name_english,
        gender: row.bible_people.gender,
        testament: row.bible_people.testament,
        description: row.bible_people.description
      },
      role: row.role
    }))
  } catch {
    return []
  }
}

/**
 * 사건이 발생한 장소 가져오기
 */
export async function getEventPlaces(
  eventId: string
): Promise<{ place: BiblePlace; role: string }[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client
      .from('event_places')
      .select(`
        role,
        bible_places (
          id,
          name_korean,
          name_english,
          place_type,
          latitude,
          longitude,
          description
        )
      `)
      .eq('event_id', eventId)

    if (error || !data) return []

    return data.map((row: any) => ({
      place: {
        id: row.bible_places.id,
        nameKorean: row.bible_places.name_korean,
        nameEnglish: row.bible_places.name_english,
        placeType: row.bible_places.place_type,
        latitude: row.bible_places.latitude,
        longitude: row.bible_places.longitude,
        description: row.bible_places.description
      },
      role: row.role
    }))
  } catch {
    return []
  }
}

/**
 * 인물로 검색
 */
export async function searchPeople(
  query: string,
  limit: number = 10
): Promise<BiblePerson[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client
      .from('bible_people')
      .select('*')
      .or(`name_korean.ilike.%${query}%,name_english.ilike.%${query}%`)
      .limit(limit)

    if (error || !data) return []

    return data.map((row: any) => ({
      id: row.id,
      nameKorean: row.name_korean,
      nameEnglish: row.name_english,
      gender: row.gender,
      testament: row.testament,
      description: row.description
    }))
  } catch {
    return []
  }
}

/**
 * 장소로 검색
 */
export async function searchPlaces(
  query: string,
  limit: number = 10
): Promise<BiblePlace[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client
      .from('bible_places')
      .select('*')
      .or(`name_korean.ilike.%${query}%,name_english.ilike.%${query}%`)
      .limit(limit)

    if (error || !data) return []

    return data.map((row: any) => ({
      id: row.id,
      nameKorean: row.name_korean,
      nameEnglish: row.name_english,
      placeType: row.place_type,
      latitude: row.latitude,
      longitude: row.longitude,
      description: row.description
    }))
  } catch {
    return []
  }
}

/**
 * 사건으로 검색
 */
export async function searchEvents(
  query: string,
  limit: number = 10
): Promise<BibleEvent[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    const { data, error } = await client
      .from('bible_events')
      .select('*')
      .or(`name_korean.ilike.%${query}%,name_english.ilike.%${query}%`)
      .limit(limit)

    if (error || !data) return []

    return data.map((row: any) => ({
      id: row.id,
      nameKorean: row.name_korean,
      nameEnglish: row.name_english,
      eventType: row.event_type,
      testament: row.testament,
      startReference: row.start_reference,
      endReference: row.end_reference,
      description: row.description,
      significance: row.significance
    }))
  } catch {
    return []
  }
}

/**
 * 여러 구절의 관계를 한 번에 가져오기 (채팅 응답용)
 * 각 구절이 어떤 관계로 연결되어 있는지 설명 생성
 */
export async function getVersesRelationsForChat(
  references: string[]
): Promise<{
  relations: Array<{
    source: string
    target: string
    relationType: string
    relationLabel: string
    description?: string
  }>
  explanationText: string
}> {
  const client = getSupabase()
  if (!client || references.length === 0) {
    return { relations: [], explanationText: '' }
  }

  const RELATION_LABELS: Record<string, string> = {
    prophecy_fulfillment: '예언/성취',
    parallel: '평행본문',
    quotation: '인용',
    thematic: '주제적 연결',
    narrative: '서사적 연결',
    theological: '신학적 연결',
    semantic: '의미적 유사'
  }

  try {
    // 주어진 구절들 사이의 관계 조회
    const refList = references.map(r => `"${r}"`).join(',')
    const { data, error } = await client
      .from('verse_relations')
      .select('source_reference, target_reference, relation_type, strength, description')
      .or(`source_reference.in.(${refList}),target_reference.in.(${refList})`)

    if (error || !data) {
      return { relations: [], explanationText: '' }
    }

    // 결과 필터링: 두 구절 모두 주어진 references에 포함된 것만
    const refSet = new Set(references)
    const filteredRelations = data.filter(rel =>
      refSet.has(rel.source_reference) && refSet.has(rel.target_reference)
    )

    const relations = filteredRelations.map(rel => ({
      source: rel.source_reference,
      target: rel.target_reference,
      relationType: rel.relation_type,
      relationLabel: RELATION_LABELS[rel.relation_type] || rel.relation_type,
      description: rel.description
    }))

    // 설명 텍스트 생성
    let explanationText = ''
    if (relations.length > 0) {
      const explanations: string[] = []
      for (const rel of relations) {
        explanations.push(
          `• ${rel.source} ↔ ${rel.target}: ${rel.relationLabel}${rel.description ? ` (${rel.description})` : ''}`
        )
      }
      explanationText = `\n\n📖 **성경 구절 관계:**\n${explanations.join('\n')}`
    }

    return { relations, explanationText }
  } catch {
    return { relations: [], explanationText: '' }
  }
}

/**
 * 주제 마스터 목록 가져오기
 */
export async function getThemesMaster(
  category?: string
): Promise<{ id: string; nameKorean: string; nameEnglish: string; category: string }[]> {
  const client = getSupabase()
  if (!client) return []

  try {
    let query = client
      .from('bible_themes_master')
      .select('id, name_korean, name_english, category')

    if (category) {
      query = query.eq('category', category)
    }

    const { data, error } = await query.order('category').order('name_korean')

    if (error || !data) return []

    return data.map((row: any) => ({
      id: row.id,
      nameKorean: row.name_korean,
      nameEnglish: row.name_english,
      category: row.category
    }))
  } catch {
    return []
  }
}

// ============================================
// 성경 버전 관리
// ============================================

/**
 * 활성화된 성경 버전 목록 가져오기
 */
export async function getBibleVersions(): Promise<BibleVersion[]> {
  const client = getSupabase()
  if (!client) {
    // DB가 없으면 기본 버전 반환
    return [{
      id: 'GAE',
      name_korean: '개역개정',
      name_english: 'Korean Revised Version (New)',
      language: 'ko',
      is_default: true,
      is_active: true
    }]
  }

  try {
    const { data, error } = await client
      .from('bible_versions')
      .select('id, name_korean, name_english, language, is_default, is_active')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('id')

    if (error || !data || data.length === 0) {
      // 테이블이 없거나 빈 경우 기본 버전 반환
      return [{
        id: 'GAE',
        name_korean: '개역개정',
        name_english: 'Korean Revised Version (New)',
        language: 'ko',
        is_default: true,
        is_active: true
      }]
    }

    return data
  } catch {
    return [{
      id: 'GAE',
      name_korean: '개역개정',
      name_english: 'Korean Revised Version (New)',
      language: 'ko',
      is_default: true,
      is_active: true
    }]
  }
}

/**
 * 기본 성경 버전 가져오기
 */
export async function getDefaultBibleVersion(): Promise<string> {
  const versions = await getBibleVersions()
  const defaultVersion = versions.find(v => v.is_default)
  return defaultVersion?.id || 'GAE'
}

// ============================================
// 뉴스 검색
// ============================================

export interface NewsSearchResult {
  id: string
  issue_number: number
  issue_date: string
  article_type: string
  title: string
  content: string
  similarity: number
}

/**
 * 뉴스 기사 Hybrid 검색
 */
export async function hybridSearchNews(
  query: string,
  options: { limit?: number; year?: number } = {}
): Promise<NewsSearchResult[]> {
  const { limit = 5, year } = options

  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return []

  try {
    const queryEmbedding = await generateEmbedding(query)

    const { data, error } = await client.rpc('hybrid_search_news', {
      query_embedding: queryEmbedding,
      query_text: query,
      match_threshold: 0.4,
      match_count: limit,
      year_filter: year || null,
      article_type_filter: null
    })

    if (error) {
      console.error('[supabase] News search error:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('[supabase] News search error:', error)
    return []
  }
}

// ============================================
// 주보 검색
// ============================================

export interface BulletinSearchResult {
  id: string
  bulletin_date: string
  bulletin_title: string
  page_number: number
  section_type: string
  title: string
  content: string
  similarity: number
}

/**
 * 주보 Hybrid 검색
 */
export async function hybridSearchBulletin(
  query: string,
  options: { limit?: number; year?: number; sectionType?: string } = {}
): Promise<BulletinSearchResult[]> {
  const { limit = 5, year, sectionType } = options

  const client = getSupabaseAdmin() || getSupabase()
  if (!client) return []

  try {
    const queryEmbedding = await generateEmbedding(query)

    const { data, error } = await client.rpc('hybrid_search_bulletin', {
      query_embedding: queryEmbedding,
      query_text: query,
      match_threshold: 0.4,
      match_count: limit,
      year_filter: year || null,
      section_type_filter: sectionType || null
    })

    if (error) {
      console.error('[supabase] Bulletin search error:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('[supabase] Bulletin search error:', error)
    return []
  }
}
