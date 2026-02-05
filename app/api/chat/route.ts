/**
 * 채팅 API (스트리밍 지원)
 * POST /api/chat
 *
 * 개선된 기능:
 * - 설교 벡터 검색 (YouTube 설교에서 추출한 내용)
 * - 기독교 철학자/신학자 지혜 검색 (Perplexity 폴백)
 * - 더 깊은 공감과 구체적인 조언 제공
 */

import { NextRequest, NextResponse } from 'next/server'
import { searchBibleVerses, hybridSearchSermons, hybridSearchNews, hybridSearchBulletin, getVersesRelationsForChat, lookupVersesByReferences } from '@/lib/supabase'
import { generateStreamingResponse, searchChristianWisdom } from '@/lib/ai-providers'
import type { ChatMessage, EmotionType } from '@/types'

export const runtime = 'edge' // Edge runtime for streaming

interface ChatRequest {
  messages: ChatMessage[]
  emotion?: EmotionType
  version?: string  // 성경 버전 (GAE, KRV, NIV 등)
  language?: 'ko' | 'en'  // UI 언어 (한국어/영어)
  simpleMode?: boolean  // 간단 응답 모드 (인사, 짧은 메시지)
}

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json()
    const { messages, emotion, version, language, simpleMode } = body

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages are required' },
        { status: 400 }
      )
    }

    // 마지막 사용자 메시지
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()

    if (!lastUserMessage) {
      return NextResponse.json(
        { error: 'No user message found' },
        { status: 400 }
      )
    }

    // 간단 응답 모드인 경우 검색 건너뛰기
    let relevantVerses: any[] = []
    let sermonContent: string | null = null
    let sermonResults: Array<{
      video_id: string
      video_title: string
      video_url?: string
      content: string
      start_time?: number
      end_time?: number
      speaker?: string
      upload_date?: string
      combined_score?: number
    }> = []
    let newsContent: string | null = null
    let bulletinContent: string | null = null
    let christianWisdom: string | null = null
    let verseRelations: { relations: any[]; explanationText: string } = { relations: [], explanationText: '' }

    if (simpleMode) {
      // 간단 응답 모드: 검색 건너뛰고 바로 짧은 응답 생성
      console.log('[Chat API] 간단 응답 모드 - 검색 건너뜀')
    } else {
      // 1. 관련 성경 구절 검색 (버전 필터링 포함)
      relevantVerses = await searchBibleVerses(
        lastUserMessage.content,
        { emotion, limit: 5, version }  // version 전달
      )

      // 2. 설교 내용 검색 (YouTube 설교에서 추출한 벡터)
      try {
        sermonResults = await hybridSearchSermons(lastUserMessage.content, { limit: 3 })
        if (sermonResults && sermonResults.length > 0) {
          sermonContent = sermonResults
            .map((s, i) => {
              // 날짜 포맷팅
              const dateInfo = s.upload_date
                ? new Date(s.upload_date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
                : ''
              // 시간 정보
              const timeInfo = s.start_time
                ? ` (${formatTime(s.start_time)} ~ ${formatTime(s.end_time || s.start_time)})`
                : ''
              // 설교자 정보
              const speakerInfo = s.speaker ? ` - ${s.speaker}` : ''
              // 메타정보 조합
              const metaInfo = [dateInfo, speakerInfo].filter(Boolean).join('')
              const headerInfo = metaInfo ? ` [${metaInfo}]` : ''

              return `[설교 ${i + 1}] ${s.video_title}${headerInfo}${timeInfo}:\n"${s.content.substring(0, 300)}..."`
            })
            .join('\n\n')
          console.log('[Chat API] 설교 내용 발견:', sermonResults.length, '개')
          console.log('[Chat API] sermonContent 길이:', sermonContent?.length || 0, '자')
          console.log('[Chat API] sermonContent 샘플:', sermonContent?.substring(0, 200))
        }
      } catch (e) {
        console.warn('[Chat API] 설교 검색 실패:', e)
      }

      // 3. 뉴스 기사 검색 (교회신문)
      try {
        const newsResults = await hybridSearchNews(lastUserMessage.content, { limit: 3 })
        if (newsResults && newsResults.length > 0) {
          newsContent = newsResults
            .map((n, i) => `[기사 ${i + 1}] ${n.title} (${n.issue_date}):\n"${n.content.substring(0, 250)}..."`)
            .join('\n\n')
          console.log('[Chat API] 뉴스 기사 발견:', newsResults.length, '개')
        }
      } catch (e) {
        console.warn('[Chat API] 뉴스 검색 실패:', e)
      }

      // 4. 주보 내용 검색
      try {
        const bulletinResults = await hybridSearchBulletin(lastUserMessage.content, { limit: 3 })
        if (bulletinResults && bulletinResults.length > 0) {
          bulletinContent = bulletinResults
            .map((b, i) => `[주보 ${i + 1}] ${b.bulletin_title} - ${b.section_type}${b.title ? ` (${b.title})` : ''}:\n"${b.content.substring(0, 250)}..."`)
            .join('\n\n')
          console.log('[Chat API] 주보 내용 발견:', bulletinResults.length, '개')
        }
      } catch (e) {
        console.warn('[Chat API] 주보 검색 실패:', e)
      }

      // 5. 설교/뉴스/주보가 없으면 기독교 지혜 검색 (Perplexity 폴백)
      if (!sermonContent && !newsContent && !bulletinContent) {
        try {
          // 사용자 메시지에서 주제 추출
          const topic = extractTopic(lastUserMessage.content)
          christianWisdom = await searchChristianWisdom(topic)
          if (christianWisdom) {
            console.log('[Chat API] 기독교 지혜 검색 성공')
          }
        } catch (e) {
          console.warn('[Chat API] 기독교 지혜 검색 실패:', e)
        }
      }

      // 6. 성경 구절 간 관계 조회
      try {
        const verseRefs = relevantVerses.map((r: any) => r.chunk.referenceFull)
        if (verseRefs.length > 1) {
          verseRelations = await getVersesRelationsForChat(verseRefs)
          if (verseRelations.relations.length > 0) {
            console.log('[Chat API] 구절 관계 발견:', verseRelations.relations.length, '개')
          }
        }
      } catch (e) {
        console.warn('[Chat API] 구절 관계 조회 실패:', e)
      }
    }

    // 7. 컨텍스트 구성
    const context = {
      emotion,
      previousMessages: messages.slice(-10), // 최근 10개 메시지
      relevantVerses,
      sermonContent,
      newsContent,
      bulletinContent,
      christianWisdom,
      verseRelations: verseRelations.relations,
      verseRelationsText: verseRelations.explanationText,
      simpleMode,  // 간단 응답 모드 플래그 전달
      language: language || 'ko'  // UI 언어 (기본값: 한국어)
    }

    // 6. 스트리밍 응답 생성
    const encoder = new TextEncoder()

    // 성경 구절 정보 미리 준비
    const versesInfo = {
      type: 'verses',
      verses: relevantVerses.map(r => ({
        reference: r.chunk.referenceFull,
        content: r.chunk.content
      })),
      relations: verseRelations.relations,
      relationsText: verseRelations.explanationText
    }

    // 설교 참조 정보 준비
    const sermonsInfo = {
      type: 'sermons',
      sermons: sermonResults.map(s => ({
        videoId: s.video_id,
        videoTitle: s.video_title,
        videoUrl: s.video_url || `https://www.youtube.com/watch?v=${s.video_id}`,
        speaker: s.speaker,
        uploadDate: s.upload_date,
        startTime: s.start_time,
        endTime: s.end_time
      }))
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 먼저 성경 구절 정보 전송 (스트리밍 시작 전)
          if (versesInfo.verses.length > 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(versesInfo)}\n\n`)
            )
            console.log('[Chat API] 구절 정보 전송:', versesInfo.verses.length, '개')
          }

          // 설교 참조 정보 전송
          if (sermonsInfo.sermons.length > 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(sermonsInfo)}\n\n`)
            )
            console.log('[Chat API] 설교 정보 전송:', sermonsInfo.sermons.length, '개')
          }

          // 전체 AI 응답 텍스트 수집
          let fullResponseText = ''

          for await (const chunk of generateStreamingResponse(messages, context)) {
            const data = JSON.stringify(chunk)
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))

            // 응답 텍스트 축적
            if (chunk.content) {
              fullResponseText += chunk.content
            }

            if (chunk.done) {
              // AI 응답 완료 후: 인용된 구절 추출 및 verses_update 전송
              try {
                const quotedRefs = extractQuotedVerses(fullResponseText)
                if (quotedRefs.length > 0) {
                  console.log('[Chat API] AI 인용 구절 추출:', quotedRefs)
                  const lookedUpVerses = await lookupVersesByReferences(quotedRefs)
                  if (lookedUpVerses.length > 0) {
                    const versesUpdate = {
                      type: 'verses_update',
                      verses: lookedUpVerses
                    }
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(versesUpdate)}\n\n`)
                    )
                    console.log('[Chat API] verses_update 전송:', lookedUpVerses.length, '개')
                  }
                }
              } catch (e) {
                console.warn('[Chat API] verses_update 처리 실패:', e)
              }

              controller.close()
              break
            }
          }
        } catch (error) {
          console.error('Streaming error:', error)
          const errorData = JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            done: true
          })
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })

  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * 초를 MM:SS 형식으로 변환
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * AI 응답 텍스트에서 인용된 성경 구절 참조를 추출
 * "잠언 3:5-6", "시편 23:1", "마태복음 6:25-34" 등의 패턴 매칭
 */
function extractQuotedVerses(text: string): string[] {
  const patterns = [
    // 한국어 성경 참조: "잠언 3:5-6", "시편 23:1", "마태복음 6:25"
    /(?:창세기|출애굽기|레위기|민수기|신명기|여호수아|사사기|룻기|사무엘상|사무엘하|열왕기상|열왕기하|역대상|역대하|에스라|느헤미야|에스더|욥기|시편|잠언|전도서|아가|이사야|예레미야|예레미야애가|에스겔|다니엘|호세아|요엘|아모스|오바댜|요나|미가|나훔|하박국|스바냐|학개|스가랴|말라기|마태복음|마가복음|누가복음|요한복음|사도행전|로마서|고린도전서|고린도후서|갈라디아서|에베소서|빌립보서|골로새서|데살로니가전서|데살로니가후서|디모데전서|디모데후서|디도서|빌레몬서|히브리서|야고보서|베드로전서|베드로후서|요한일서|요한이서|요한삼서|유다서|요한계시록)\s*\d+:\d+(?:\s*[-–~]\s*\d+)?/g,
    // 약어 형태: "잠 3:5", "시 23:1", "마 6:25"
    /(?:창|출|레|민|신|수|삿|룻|삼상|삼하|왕상|왕하|대상|대하|스|느|에|욥|시|잠|전|아|사|렘|애|겔|단|호|욜|암|옵|욘|미|나|합|습|학|슥|말|마|막|눅|요|행|롬|고전|고후|갈|엡|빌|골|살전|살후|딤전|딤후|딛|몬|히|약|벧전|벧후|요일|요이|요삼|유|계)\s*\d+:\d+(?:\s*[-–~]\s*\d+)?/g
  ]

  const references = new Set<string>()

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern)
    for (const match of matches) {
      references.add(match[0].trim())
    }
  }

  return Array.from(references)
}

/**
 * 사용자 메시지에서 주제 추출
 */
function extractTopic(message: string): string {
  // 키워드 기반 주제 추출
  const topics: Record<string, string[]> = {
    '불안': ['불안', '걱정', '두려움', '무서움', '긴장'],
    '외로움': ['외로움', '혼자', '고독', '친구 없'],
    '슬픔': ['슬픔', '슬퍼', '우울', '힘들', '눈물'],
    '분노': ['화', '분노', '짜증', '억울'],
    '가정': ['가정', '부모', '자녀', '아이', '가족', '남편', '아내'],
    '진로': ['진로', '미래', '직업', '취업', '일자리'],
    '직장': ['직장', '회사', '상사', '동료', '업무'],
    '건강': ['건강', '아프', '병', '질병', '치료'],
    '재정': ['돈', '재정', '빚', '경제', '투자'],
    '인간관계': ['관계', '갈등', '싸움', '친구'],
    '믿음': ['믿음', '신앙', '기도', '교회'],
    '감사': ['감사', '축복', '기쁨', '행복'],
    'AI와 기술': ['AI', '인공지능', '기술', '로봇', '자동화']
  }

  const lowerMessage = message.toLowerCase()

  for (const [topic, keywords] of Object.entries(topics)) {
    for (const keyword of keywords) {
      if (lowerMessage.includes(keyword)) {
        return topic
      }
    }
  }

  // 기본값
  return '삶의 고민과 위로'
}
