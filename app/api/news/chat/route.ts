/**
 * 뉴스 Hybrid RAG 챗봇 API
 * POST /api/news/chat
 * - 뉴스 기사 탐색
 * - Q&A
 * - 인사이트 분석
 * - AI 응답: OpenAI > Claude > Gemini fallback
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createEmbedding } from '@/lib/news-extractor'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// API 키 캐시 (Supabase 저장 키 우선)
let apiKeyCache: Record<string, string> = {}
let apiKeyCacheTime = 0
const API_KEY_CACHE_TTL = 5 * 60 * 1000 // 5분

async function fetchStoredApiKeys(): Promise<Record<string, string>> {
  const now = Date.now()
  if (Object.keys(apiKeyCache).length > 0 && (now - apiKeyCacheTime) < API_KEY_CACHE_TTL) {
    return apiKeyCache
  }

  try {
    const { data } = await supabase
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
    console.log('[news/chat] API 키 로드:', Object.keys(keys).join(', '))
    return keys
  } catch (error) {
    console.warn('[news/chat] API 키 조회 실패:', error)
    return apiKeyCache
  }
}

async function getApiKey(provider: string): Promise<string | null> {
  const stored = await fetchStoredApiKeys()
  if (stored[provider]) {
    return stored[provider]
  }
  // 환경변수 폴백
  const envKeys: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY
  }
  return envKeys[provider] || null
}

// AI 클라이언트 (매번 새로 생성 - 키 변경 반영)
async function getOpenAI(): Promise<OpenAI | null> {
  const apiKey = await getApiKey('openai')
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}

async function getAnthropic(): Promise<Anthropic | null> {
  const apiKey = await getApiKey('anthropic')
  if (!apiKey) return null
  return new Anthropic({ apiKey })
}

async function getGenAI(): Promise<GoogleGenerativeAI | null> {
  const apiKey = await getApiKey('google')
  if (!apiKey) return null
  return new GoogleGenerativeAI(apiKey)
}

// Hybrid 검색 (벡터 + 키워드)
async function hybridSearch(
  query: string,
  options: {
    year?: number
    articleType?: string
    limit?: number
    threshold?: number
  } = {}
): Promise<any[]> {
  const { year, articleType, limit = 10, threshold = 0.4 } = options

  // 쿼리 임베딩
  const queryEmbedding = await createEmbedding(query)

  // 벡터 검색
  const { data: vectorResults, error } = await supabase.rpc('hybrid_search_news', {
    query_embedding: queryEmbedding,
    query_text: query,
    match_threshold: threshold,
    match_count: limit,
    year_filter: year || null,
    article_type_filter: articleType || null
  })

  if (error) {
    console.error('검색 오류:', error)
    return []
  }

  return vectorResults || []
}

// 시스템 프롬프트
const SYSTEM_PROMPT = `당신은 안양제일교회의 월간 신문 "열한시"의 기사를 분석하고 답변하는 AI 어시스턴트입니다.

역할:
1. 뉴스 탐색: 사용자가 원하는 주제의 기사를 찾아 요약해 드립니다.
2. Q&A: 교회 활동, 행사, 인물에 대한 질문에 답변합니다.
3. 인사이트 분석: 기사 내용을 분석하여 트렌드, 패턴, 주요 이슈를 파악합니다.

답변 원칙:
- 검색된 기사 내용을 바탕으로 정확하게 답변합니다.
- 출처(호수, 발행일)를 명시합니다.
- 기사에 없는 내용은 추측하지 않습니다.
- 친절하고 이해하기 쉽게 설명합니다.

응답 형식:
- 요약은 핵심 내용 위주로 간결하게
- 관련 기사가 여러 개면 목록으로 정리
- 날짜, 인물, 행사명은 정확히 표기`

// 사용자 의도 분석
function analyzeIntent(query: string): 'search' | 'qa' | 'insight' {
  const searchKeywords = ['찾아', '검색', '보여', '알려', '어디', '언제', '누가', '목록']
  const insightKeywords = ['분석', '트렌드', '패턴', '비교', '변화', '통계', '요약해']

  if (insightKeywords.some(k => query.includes(k))) return 'insight'
  if (searchKeywords.some(k => query.includes(k))) return 'search'
  return 'qa'
}

export async function POST(req: NextRequest) {
  try {
    const { messages, filters } = await req.json()

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 })
    }

    const userMessage = messages[messages.length - 1].content
    const intent = analyzeIntent(userMessage)

    // 검색 실행
    const searchResults = await hybridSearch(userMessage, {
      year: filters?.year,
      articleType: filters?.articleType,
      limit: 15,
      threshold: 0.35
    })

    // 컨텍스트 구성
    let context = ''
    if (searchResults.length > 0) {
      context = '관련 기사 내용:\n\n'
      searchResults.forEach((result, idx) => {
        context += `[기사 ${idx + 1}] ${result.issue_date} (제${result.issue_number}호, ${result.page_number}면)\n`
        context += `제목: ${result.article_title}\n`
        if (result.article_type) context += `유형: ${result.article_type}\n`
        context += `내용: ${result.chunk_text}\n`
        context += `(관련도: ${(result.similarity * 100).toFixed(0)}%)\n\n`
      })
    } else {
      context = '관련 기사를 찾지 못했습니다.'
    }

    // 스트리밍 응답 생성
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 검색 결과 먼저 전송
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'sources',
              sources: searchResults.slice(0, 5).map(r => ({
                articleId: r.article_id,
                issueDate: r.issue_date,
                issueNumber: r.issue_number,
                pageNumber: r.page_number,
                title: r.article_title,
                type: r.article_type,
                similarity: r.similarity,
                content: r.chunk_text
              }))
            })}\n\n`)
          )

          // 메시지 구성
          const userContent = `${context}\n\n사용자 질문: ${userMessage}\n\n위 기사 내용을 바탕으로 답변해주세요.`
          const previousMessages = messages.slice(0, -1).map((m: any) => ({
            role: m.role,
            content: m.content
          }))

          let provider = 'unknown'
          let streamSuccess = false

          // 1. OpenAI 시도
          try {
            console.log('[news/chat] OpenAI 스트리밍 시도')
            const openaiClient = await getOpenAI()
            if (!openaiClient) throw new Error('OpenAI client not available')
            const openaiResponse = await openaiClient.chat.completions.create({
              model: 'gpt-4o',
              max_tokens: 2048,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                ...previousMessages,
                { role: 'user', content: userContent }
              ],
              stream: true
            })

            provider = 'OpenAI'
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'provider', provider })}\n\n`)
            )

            for await (const chunk of openaiResponse) {
              const content = chunk.choices[0]?.delta?.content
              if (content) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                )
              }
            }
            streamSuccess = true
          } catch (openaiError: any) {
            console.log(`[news/chat] OpenAI 실패: ${openaiError.message?.substring(0, 50)}...`)
          }

          // 2. Claude 시도 (OpenAI 실패 시)
          if (!streamSuccess) {
            try {
              console.log('[news/chat] Claude 스트리밍 시도')
              const claudeClient = await getAnthropic()
              if (!claudeClient) throw new Error('Claude client not available')
              const claudeResponse = await claudeClient.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2048,
                system: SYSTEM_PROMPT,
                messages: [
                  ...previousMessages,
                  { role: 'user', content: userContent }
                ],
                stream: true
              })

              provider = 'Claude'
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'provider', provider })}\n\n`)
              )

              for await (const event of claudeResponse) {
                if (event.type === 'content_block_delta') {
                  const delta = event.delta as any
                  if (delta.text) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ content: delta.text })}\n\n`)
                    )
                  }
                }
              }
              streamSuccess = true
            } catch (claudeError: any) {
              console.log(`[news/chat] Claude 실패: ${claudeError.message?.substring(0, 50)}...`)
            }
          }

          // 3. Gemini 시도 (Claude도 실패 시)
          if (!streamSuccess) {
            try {
              console.log('[news/chat] Gemini 스트리밍 시도')
              const geminiClient = await getGenAI()
              if (!geminiClient) throw new Error('Gemini client not available')
              const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash' })

              // Gemini 메시지 형식으로 변환
              const geminiHistory = previousMessages.map((m: any) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
              }))

              const chat = model.startChat({
                history: geminiHistory,
                generationConfig: { maxOutputTokens: 2048 }
              })

              const geminiPrompt = `${SYSTEM_PROMPT}\n\n${userContent}`
              const result = await chat.sendMessageStream(geminiPrompt)

              provider = 'Gemini'
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'provider', provider })}\n\n`)
              )

              for await (const chunk of result.stream) {
                const text = chunk.text()
                if (text) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`)
                  )
                }
              }
              streamSuccess = true
            } catch (geminiError: any) {
              console.log(`[news/chat] Gemini 실패: ${geminiError.message?.substring(0, 50)}...`)
            }
          }

          // 모든 AI가 실패한 경우
          if (!streamSuccess) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                error: '모든 AI 서비스가 일시적으로 사용 불가능합니다. 잠시 후 다시 시도해주세요.'
              })}\n\n`)
            )
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error: any) {
          console.error('[news/chat] 스트리밍 오류:', error)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`)
          )
          controller.close()
        }
      }
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })

  } catch (error: any) {
    console.error('뉴스 챗봇 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// 통계 및 인사이트 조회
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || 'stats'

    if (type === 'stats') {
      // 연도별 기사 수
      const { data: yearStats } = await supabase
        .from('news_issues')
        .select('year')
        .eq('status', 'completed')

      const yearCounts: Record<number, number> = {}
      yearStats?.forEach(item => {
        yearCounts[item.year] = (yearCounts[item.year] || 0) + 1
      })

      // 기사 유형별 통계
      const { data: typeStats } = await supabase
        .from('news_articles')
        .select('article_type')

      const typeCounts: Record<string, number> = {}
      typeStats?.forEach(item => {
        const type = item.article_type || '기타'
        typeCounts[type] = (typeCounts[type] || 0) + 1
      })

      // 최다 언급 키워드
      const { data: keywords } = await supabase
        .from('news_articles')
        .select('keywords')
        .not('keywords', 'is', null)
        .limit(100)

      const keywordCounts: Record<string, number> = {}
      keywords?.forEach(item => {
        item.keywords?.forEach((k: string) => {
          keywordCounts[k] = (keywordCounts[k] || 0) + 1
        })
      })

      const topKeywords = Object.entries(keywordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)

      return NextResponse.json({
        success: true,
        stats: {
          byYear: yearCounts,
          byType: typeCounts,
          topKeywords
        }
      })
    }

    return NextResponse.json({ error: '알 수 없는 type입니다.' }, { status: 400 })

  } catch (error: any) {
    console.error('통계 조회 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
