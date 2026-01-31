/**
 * 주보 Hybrid RAG 챗봇 API
 * POST /api/bulletin/chat
 * - 주보 내용 탐색
 * - Q&A (예배, 행사, 기도제목 등)
 * - AI 응답: OpenAI > Claude > Gemini fallback
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// API 키 캐시
let apiKeyCache: Record<string, string> = {}
let apiKeyCacheTime = 0
const API_KEY_CACHE_TTL = 5 * 60 * 1000

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
    return keys
  } catch (error) {
    return apiKeyCache
  }
}

async function getApiKey(provider: string): Promise<string | null> {
  const stored = await fetchStoredApiKeys()
  if (stored[provider]) return stored[provider]

  const envKeys: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY
  }
  return envKeys[provider] || null
}

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

// 임베딩 생성
async function createEmbedding(text: string): Promise<number[]> {
  const openai = await getOpenAI()
  if (!openai) throw new Error('OpenAI API key not available')

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000),
    dimensions: 1536
  })
  return response.data[0].embedding
}

// Hybrid 검색
async function hybridSearch(
  query: string,
  options: {
    year?: number
    sectionType?: string
    limit?: number
    threshold?: number
  } = {}
): Promise<any[]> {
  const { year, sectionType, limit = 10, threshold = 0.4 } = options

  const queryEmbedding = await createEmbedding(query)

  const { data: vectorResults, error } = await supabase.rpc('hybrid_search_bulletin', {
    query_embedding: queryEmbedding,
    query_text: query,
    match_threshold: threshold,
    match_count: limit,
    year_filter: year || null,
    section_type_filter: sectionType || null
  })

  if (error) {
    console.error('검색 오류:', error)
    return []
  }

  return vectorResults || []
}

// 시스템 프롬프트
const SYSTEM_PROMPT = `당신은 안양제일교회의 주보를 분석하고 답변하는 AI 어시스턴트입니다.

역할:
1. 주보 탐색: 예배순서, 교회소식, 기도제목, 행사 안내 등을 찾아 안내합니다.
2. Q&A: 예배 시간, 행사 일정, 봉사자 정보 등에 대해 답변합니다.
3. 분석: 교회 활동 트렌드, 주요 이슈를 파악합니다.

답변 원칙:
- 검색된 주보 내용을 바탕으로 정확하게 답변합니다.
- 출처(날짜)를 명시합니다.
- 주보에 없는 내용은 추측하지 않습니다.
- 친절하고 이해하기 쉽게 설명합니다.

응답 형식:
- 요약은 핵심 내용 위주로 간결하게
- 관련 내용이 여러 개면 목록으로 정리
- 날짜, 시간, 장소는 정확히 표기`

export async function POST(req: NextRequest) {
  try {
    const { messages, filters } = await req.json()

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 })
    }

    const userMessage = messages[messages.length - 1].content

    // 검색 실행
    const searchResults = await hybridSearch(userMessage, {
      year: filters?.year,
      sectionType: filters?.sectionType,
      limit: 15,
      threshold: 0.35
    })

    // 컨텍스트 구성
    let context = ''
    if (searchResults.length > 0) {
      context = '관련 주보 내용:\n\n'
      searchResults.forEach((result, idx) => {
        context += `[주보 ${idx + 1}] ${result.bulletin_title} (${result.page_number}페이지)\n`
        context += `섹션: ${result.section_type}\n`
        if (result.title) context += `제목: ${result.title}\n`
        context += `내용: ${result.content}\n`
        context += `(관련도: ${(result.similarity * 100).toFixed(0)}%)\n\n`
      })
    } else {
      context = '관련 주보 내용을 찾지 못했습니다.'
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
                bulletinDate: r.bulletin_date,
                bulletinTitle: r.bulletin_title,
                pageNumber: r.page_number,
                sectionType: r.section_type,
                title: r.title,
                similarity: r.similarity,
                content: r.content
              }))
            })}\n\n`)
          )

          const userContent = `${context}\n\n사용자 질문: ${userMessage}\n\n위 주보 내용을 바탕으로 답변해주세요.`
          const previousMessages = messages.slice(0, -1).map((m: any) => ({
            role: m.role,
            content: m.content
          }))

          let provider = 'unknown'
          let streamSuccess = false

          // 1. OpenAI 시도
          try {
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
            console.log(`[bulletin/chat] OpenAI 실패: ${openaiError.message?.substring(0, 50)}...`)
          }

          // 2. Claude 시도
          if (!streamSuccess) {
            try {
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
              console.log(`[bulletin/chat] Claude 실패: ${claudeError.message?.substring(0, 50)}...`)
            }
          }

          // 3. Gemini 시도
          if (!streamSuccess) {
            try {
              const geminiClient = await getGenAI()
              if (!geminiClient) throw new Error('Gemini client not available')
              const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash' })

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
              console.log(`[bulletin/chat] Gemini 실패: ${geminiError.message?.substring(0, 50)}...`)
            }
          }

          if (!streamSuccess) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                error: '모든 AI 서비스가 일시적으로 사용 불가능합니다.'
              })}\n\n`)
            )
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error: any) {
          console.error('[bulletin/chat] 스트리밍 오류:', error)
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
    console.error('주보 챗봇 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
