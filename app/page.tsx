'use client'

/**
 * AI Bible Chatbot - 메인 페이지
 * 탭 기반 인터페이스: 성경 상담 / 뉴스 AI
 */

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { EMOTIONS, type EmotionType, type ChatMessage } from '@/types'
import JesusSilhouette from '@/components/JesusSilhouette'
import { useLanguage } from '@/contexts/LanguageContext'
import { PrayingHandsIcon, WaveText, PrayingHandsLoader } from '@/components/LoadingAnimations'

interface VerseReference {
  reference: string
  content: string
}

interface NewsSource {
  articleId?: number
  issueDate: string
  issueNumber: number
  pageNumber: number
  title: string
  type: string
  similarity: number
  content?: string
}

interface NewsChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: NewsSource[]
  provider?: string
}

type TabType = 'bible' | 'news' | 'bulletin'

// 성경 책 이름 목록 (정규식 패턴용)
const BIBLE_BOOKS = [
  '창세기', '출애굽기', '레위기', '민수기', '신명기',
  '여호수아', '사사기', '룻기', '사무엘상', '사무엘하',
  '열왕기상', '열왕기하', '역대상', '역대하', '에스라',
  '느헤미야', '에스더', '욥기', '시편', '잠언',
  '전도서', '아가', '이사야', '예레미야', '예레미야애가',
  '에스겔', '다니엘', '호세아', '요엘', '아모스',
  '오바댜', '요나', '미가', '나훔', '하박국',
  '스바냐', '학개', '스가랴', '말라기',
  '마태복음', '마가복음', '누가복음', '요한복음', '사도행전',
  '로마서', '고린도전서', '고린도후서', '갈라디아서', '에베소서',
  '빌립보서', '골로새서', '데살로니가전서', '데살로니가후서',
  '디모데전서', '디모데후서', '디도서', '빌레몬서', '히브리서',
  '야고보서', '베드로전서', '베드로후서', '요한일서', '요한이서',
  '요한삼서', '유다서', '요한계시록'
]

// 성경 구절 참조를 링크로 변환하는 함수
function parseBibleReferences(text: string): React.ReactNode[] {
  // 성경 구절 패턴:
  // 1. 책이름 장:절(-절) 형식 (예: 창세기 15:1, 시편 23:1-6)
  // 2. 책이름 장장 절절 형식 (예: 창세기 15장 1절, 시편 23장 1-6절)
  // 3. 책이름 장:절, 장:절 형식 (예: 창세기 1:1, 2:3)
  // 4. 책이름 장 형식 (예: 시편 23장)
  const bookPattern = BIBLE_BOOKS.join('|')

  // 포괄적인 성경 구절 패턴
  // - 콜론 형식: 창세기 15:1, 창세기 15:1-6
  // - 한글 형식: 창세기 15장 1절, 창세기 15장 1-6절, 창세기 15장
  // - 장만 있는 경우: 시편 23편, 잠언 3장
  const versePattern = new RegExp(
    `(${bookPattern})\\s*(\\d+)(?::(\\d+)(?:-(\\d+))?(?:,\\s*(\\d+)(?:-(\\d+))?)*|장\\s*(?:(\\d+)(?:-(\\d+))?절)?|편\\s*(?:(\\d+)(?:-(\\d+))?절)?)?`,
    'g'
  )

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match

  while ((match = versePattern.exec(text)) !== null) {
    // 책 이름만 있는 경우 스킵 (예: "창세기" 만 단독으로 있는 경우)
    if (!match[2]) continue

    // 매치 전 텍스트
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    // 성경 구절 링크
    const fullReference = match[0]

    // URL용 표준화된 참조 생성 (창세기 15:1 형식)
    const book = match[1]
    const chapter = match[2]
    // 콜론 형식: match[3]이 절, match[4]가 끝절
    // 한글 형식: match[7]이 절, match[8]이 끝절
    // 편 형식: match[9]가 절, match[10]이 끝절
    const verse = match[3] || match[7] || match[9]
    const endVerse = match[4] || match[8] || match[10]

    let standardRef: string
    if (verse) {
      standardRef = endVerse
        ? `${book} ${chapter}:${verse}-${endVerse}`
        : `${book} ${chapter}:${verse}`
    } else {
      // 장만 있는 경우
      standardRef = `${book} ${chapter}:1`
    }

    const verseMapUrl = `/verse-map?reference=${encodeURIComponent(standardRef)}`

    parts.push(
      <a
        key={`${match.index}-${fullReference}`}
        href={verseMapUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-amber-700 hover:text-amber-900 underline decoration-amber-300 hover:decoration-amber-500 transition-colors font-medium"
        title={`${fullReference} 구절 맵에서 보기`}
      >
        {fullReference}
      </a>
    )

    lastIndex = match.index + match[0].length
  }

  // 남은 텍스트
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

// 뉴스 상세 팝업 컴포넌트 - 통일된 스타일
function NewsDetailPopup({
  news,
  onClose
}: {
  news: NewsSource | null
  onClose: () => void
}) {
  const [fullContent, setFullContent] = useState<string>('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [chunkCount, setChunkCount] = useState(0)

  // 기사 전문 로드
  useEffect(() => {
    if (news?.articleId) {
      setLoadingContent(true)
      setFullContent('')

      fetch(`/api/news/article?id=${news.articleId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.article) {
            setFullContent(data.article.content)
            setChunkCount(data.article.chunkCount)
          }
        })
        .catch(err => {
          console.error('기사 로드 실패:', err)
        })
        .finally(() => {
          setLoadingContent(false)
        })
    }
  }, [news?.articleId])

  if (!news) return null

  const displayContent = fullContent || news.content

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden shadow-2xl animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 - 단색 인디고 배경으로 단순화 */}
        <div className="bg-indigo-600 text-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 bg-white/20 rounded text-xs font-medium">
                  제{news.issueNumber}호
                </span>
                <span className="px-2 py-0.5 bg-white/20 rounded text-xs font-medium">
                  {news.pageNumber}면
                </span>
                {news.type && (
                  <span className="px-2 py-0.5 bg-indigo-500 rounded text-xs font-medium">
                    {news.type}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold leading-tight">{news.title}</h2>
              <p className="text-indigo-200 text-sm mt-1">{news.issueDate}</p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div className="p-5 overflow-y-auto max-h-[50vh]">
          {loadingContent ? (
            <div className="flex items-center justify-center py-8">
              <PrayingHandsIcon className="w-7 h-7 text-indigo-600 mr-3" />
              <WaveText text="기사를 불러오는 중..." className="text-indigo-600 text-sm font-medium" />
            </div>
          ) : displayContent ? (
            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed text-base">
              {displayContent}
            </p>
          ) : (
            <p className="text-gray-500 italic text-sm">
              기사 전문은 열한시 신문 원본을 확인해주세요.
            </p>
          )}
        </div>

        {/* 푸터 */}
        <div className="bg-indigo-50 px-5 py-3 flex items-center justify-between border-t border-indigo-100">
          <span className="text-xs text-indigo-600">
            {chunkCount > 1 ? `${chunkCount}개 섹션` : `관련도 ${(news.similarity * 100).toFixed(0)}%`}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-indigo-700 hover:text-indigo-900 font-medium transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

// 관련 뉴스 카드 컴포넌트 - 성경 구절 카드와 동일한 스타일
function NewsCard({
  news,
  onClick,
  index = 0
}: {
  news: NewsSource
  onClick: () => void
  index?: number
}) {
  return (
    <button
      onClick={onClick}
      className="block w-full text-left bg-white/90 rounded-xl p-3 hover:bg-indigo-50 hover:shadow-md transition-all cursor-pointer group border border-indigo-100"
    >
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center text-xs font-bold text-indigo-700">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-indigo-900 text-sm group-hover:text-indigo-700 transition-colors line-clamp-1">
              {news.title}
            </span>
            <svg className="w-3.5 h-3.5 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            {news.issueDate} · 제{news.issueNumber}호 · {news.pageNumber}면
            {news.type && <span className="text-indigo-600 ml-1">· {news.type}</span>}
          </p>
        </div>
      </div>
    </button>
  )
}

export default function Home() {
  // 다국어 지원
  const { language, t, setLanguageByBibleVersion } = useLanguage()

  // 탭 상태
  const [activeTab, setActiveTab] = useState<TabType>('bible')

  // 성경 상담 상태
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [emotion, setEmotion] = useState<EmotionType | undefined>()
  const [loading, setLoading] = useState(false)
  const [showEmotionSelector, setShowEmotionSelector] = useState(true)
  const [verseReferences, setVerseReferences] = useState<VerseReference[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 미디어 생성 상태 (위로 이미지 + 팟캐스트 오디오)
  const [comfortImage, setComfortImage] = useState<string | null>(null)
  const [podcastAudio, setPodcastAudio] = useState<string | null>(null)
  const [mediaLoading, setMediaLoading] = useState<{ image: boolean; audio: boolean }>({
    image: false,
    audio: false
  })

  // 성경 버전 상태
  const [selectedVersion, setSelectedVersion] = useState<string>('GAE')
  const [availableVersions, setAvailableVersions] = useState<{
    id: string
    name_korean: string
    name_english?: string
    language: string
    is_default: boolean
  }[]>([])

  // 뉴스 AI 상태
  const [newsMessages, setNewsMessages] = useState<NewsChatMessage[]>([])
  const [newsInput, setNewsInput] = useState('')
  const [newsLoading, setNewsLoading] = useState(false)
  const [yearFilter, setYearFilter] = useState<number | undefined>()
  const [selectedNews, setSelectedNews] = useState<NewsSource | null>(null)
  const newsMessagesEndRef = useRef<HTMLDivElement>(null)

  // 주보 AI 상태
  const [bulletinMessages, setBulletinMessages] = useState<NewsChatMessage[]>([])
  const [bulletinInput, setBulletinInput] = useState('')
  const [bulletinLoading, setBulletinLoading] = useState(false)
  const [bulletinYearFilter, setBulletinYearFilter] = useState<number | undefined>()
  const bulletinMessagesEndRef = useRef<HTMLDivElement>(null)

  // 성경 버전 목록 로드 (100% 완료된 버전만, 최초 1회만 실행)
  useEffect(() => {
    fetch('/api/bible/versions')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          // completedVersions 사용 (100% 임베딩 완료된 버전만)
          const versions = data.completedVersions || data.versions || []
          setAvailableVersions(versions)
          if (data.defaultVersion) {
            setSelectedVersion(data.defaultVersion)
            setLanguageByBibleVersion(data.defaultVersion)
          }
        }
      })
      .catch(err => console.error('버전 목록 로드 실패:', err))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 성경 버전 변경 핸들러
  const handleVersionChange = (versionId: string) => {
    setSelectedVersion(versionId)
    setLanguageByBibleVersion(versionId)
  }

  // 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    newsMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [newsMessages])

  useEffect(() => {
    bulletinMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bulletinMessages])

  // 성경 상담 제출
  async function handleBibleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      createdAt: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setShowEmotionSelector(false)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          emotion,
          version: selectedVersion  // 선택된 성경 버전 전달
        })
      })

      if (!response.ok) throw new Error('API error')

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No reader')

      let assistantMessage = ''
      const assistantId = (Date.now() + 1).toString()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === 'verses') {
                setVerseReferences(data.verses)
              } else if (data.content) {
                assistantMessage += data.content

                setMessages(prev => {
                  const existing = prev.find(m => m.id === assistantId)
                  if (existing) {
                    return prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: assistantMessage }
                        : m
                    )
                  } else {
                    return [
                      ...prev,
                      {
                        id: assistantId,
                        role: 'assistant' as const,
                        content: assistantMessage,
                        createdAt: new Date()
                      }
                    ]
                  }
                })
              }
            } catch (e) {
              console.error('Parse error:', e)
            }
          }
        }
      }
      // 응답 완료 후 미디어 자동 생성
      if (assistantMessage) {
        generateMedia(userMessage.content, assistantMessage, verseReferences)
      }
    } catch (error) {
      console.error('Chat error:', error)
      alert('오류가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  // 위로 이미지 및 팟캐스트 오디오 생성
  async function generateMedia(question: string, answer: string, verses: VerseReference[]) {
    // 이전 미디어 초기화
    setComfortImage(null)
    setPodcastAudio(null)

    const verseRefs = verses.map(v => v.reference)

    // 이미지와 오디오 병렬 생성
    setMediaLoading({ image: true, audio: true })

    // 이미지 생성
    fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        answer,
        verseReferences: verseRefs,
        emotion
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setComfortImage(data.imageUrl)
        }
      })
      .catch(err => console.error('Image generation error:', err))
      .finally(() => setMediaLoading(prev => ({ ...prev, image: false })))

    // 오디오 생성
    fetch('/api/generate-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        answer,
        verseReferences: verseRefs
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setPodcastAudio(data.audioUrl)
        }
      })
      .catch(err => console.error('Audio generation error:', err))
      .finally(() => setMediaLoading(prev => ({ ...prev, audio: false })))
  }

  // 뉴스 AI 챗봇 제출
  async function handleNewsSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!newsInput.trim() || newsLoading) return

    const userMessage: NewsChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: newsInput.trim()
    }

    setNewsMessages(prev => [...prev, userMessage])
    setNewsInput('')
    setNewsLoading(true)

    try {
      const response = await fetch('/api/news/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...newsMessages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          filters: { year: yearFilter }
        })
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No reader')

      let assistantMessage = ''
      let sources: NewsSource[] = []
      let provider = ''
      const assistantId = (Date.now() + 1).toString()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6)
            if (dataStr === '[DONE]') continue

            try {
              const data = JSON.parse(dataStr)

              if (data.type === 'sources') {
                sources = data.sources
              } else if (data.type === 'provider') {
                provider = data.provider
              } else if (data.content) {
                assistantMessage += data.content

                setNewsMessages(prev => {
                  const existing = prev.find(m => m.id === assistantId)
                  if (existing) {
                    return prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: assistantMessage, sources, provider }
                        : m
                    )
                  } else {
                    return [
                      ...prev,
                      {
                        id: assistantId,
                        role: 'assistant' as const,
                        content: assistantMessage,
                        sources,
                        provider
                      }
                    ]
                  }
                })
              }
            } catch (e) {
              // 파싱 오류 무시
            }
          }
        }
      }
    } catch (error) {
      console.error('News chat error:', error)
      setNewsMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '죄송합니다. 오류가 발생했습니다. 다시 시도해주세요.'
        }
      ])
    } finally {
      setNewsLoading(false)
    }
  }

  // 추천 질문
  const newsSuggestions = [
    '최근 부흥회 소식',
    '2024년 성탄절 행사',
    '선교 관련 기사',
    '청년부 활동'
  ]

  // 주보 AI 제출
  async function handleBulletinSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!bulletinInput.trim() || bulletinLoading) return

    const userMessage: NewsChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: bulletinInput.trim()
    }

    setBulletinMessages(prev => [...prev, userMessage])
    setBulletinInput('')
    setBulletinLoading(true)

    try {
      const response = await fetch('/api/bulletin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...bulletinMessages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          filters: { year: bulletinYearFilter }
        })
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No reader')

      let assistantMessage = ''
      let sources: any[] = []
      let provider = ''
      const assistantId = (Date.now() + 1).toString()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6)
            if (dataStr === '[DONE]') continue

            try {
              const data = JSON.parse(dataStr)

              if (data.type === 'sources') {
                sources = data.sources
              } else if (data.type === 'provider') {
                provider = data.provider
              } else if (data.content) {
                assistantMessage += data.content

                setBulletinMessages(prev => {
                  const existing = prev.find(m => m.id === assistantId)
                  if (existing) {
                    return prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: assistantMessage, sources, provider }
                        : m
                    )
                  } else {
                    return [
                      ...prev,
                      {
                        id: assistantId,
                        role: 'assistant' as const,
                        content: assistantMessage,
                        sources,
                        provider
                      }
                    ]
                  }
                })
              }
            } catch (e) {
              // 파싱 오류 무시
            }
          }
        }
      }
    } catch (error) {
      console.error('Bulletin chat error:', error)
      setBulletinMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '죄송합니다. 오류가 발생했습니다. 다시 시도해주세요.'
        }
      ])
    } finally {
      setBulletinLoading(false)
    }
  }

  // 주보 추천 질문
  const bulletinSuggestions = [
    '이번 주 예배 순서',
    '교회 소식 알려줘',
    '기도 제목',
    '다음 주 행사'
  ]

  return (
    <div className="relative flex flex-col h-screen overflow-hidden">
      {/* 뉴스 상세 팝업 */}
      <NewsDetailPopup news={selectedNews} onClose={() => setSelectedNews(null)} />

      {/* 배경 */}
      <div className="absolute inset-0 bg-white" />
      <div className={`absolute inset-0 transition-colors duration-500 ${
        activeTab === 'bible'
          ? 'bg-gradient-to-b from-transparent via-amber-50/10 to-orange-100/20'
          : activeTab === 'news'
          ? 'bg-gradient-to-br from-indigo-50 via-white to-purple-50'
          : 'bg-gradient-to-br from-green-50 via-white to-emerald-50'
      }`} />

      {/* 예수님 실루엣 배경 (성경 탭에서만) - 팔 벌려 환영하시는 모습 */}
      {activeTab === 'bible' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
          <JesusSilhouette
            className="w-[380px] h-[420px] select-none"
            opacity={0.15}
          />
        </div>
      )}

      {/* 메인 컨텐츠 */}
      <div className="relative flex flex-col h-full z-10">
        {/* 헤더 + 탭 */}
        <header className="flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {activeTab === 'news' && (
                  <div className="w-8 h-8 relative">
                    <Image
                      src="/images/yeolhansi-logo.svg"
                      alt="열한시"
                      fill
                      className="object-contain"
                    />
                  </div>
                )}
                {activeTab === 'bulletin' && (
                  <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                )}
                <h1 className={`text-lg font-semibold transition-colors ${
                  activeTab === 'bible' ? 'text-amber-900' : activeTab === 'news' ? 'text-indigo-900' : 'text-green-900'
                }`}>
                  {activeTab === 'bible' ? t('bible.title') : activeTab === 'news' ? t('news.title') : t('bulletin.title')}
                </h1>
              </div>
              <nav className="flex items-center gap-3 text-sm text-gray-600 font-medium">
                <a href="/" className="hover:text-gray-900 hover:underline">{t('common.home')}</a>
                <span className="text-gray-300">|</span>
                <a href="/verse-map" className="hover:text-gray-900 hover:underline">{t('common.verseMap')}</a>
                <span className="text-gray-300">|</span>
                <a href="/youtube" className="hover:text-gray-900 hover:underline">{t('common.sermon')}</a>
                <span className="text-gray-300">|</span>
                <a href="/news" className="hover:text-gray-900 hover:underline">{t('common.news')}</a>
                <span className="text-gray-300">|</span>
                <a href="/bulletin" className="hover:text-gray-900 hover:underline">{t('common.bulletin')}</a>
                <span className="text-gray-300">|</span>
                <a href="/admin" className="hover:text-gray-900 hover:underline">{t('common.admin')}</a>
              </nav>
            </div>

            {/* 탭 버튼 */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('bible')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  activeTab === 'bible'
                    ? 'bg-white text-amber-800 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {language === 'en' ? 'Bible' : '성경 상담'}
              </button>
              <button
                onClick={() => setActiveTab('news')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  activeTab === 'news'
                    ? 'bg-white text-indigo-800 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {language === 'en' ? 'News' : '열한시'}
              </button>
              <button
                onClick={() => setActiveTab('bulletin')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  activeTab === 'bulletin'
                    ? 'bg-white text-green-800 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {language === 'en' ? 'Bulletin' : '주보'}
              </button>
            </div>
          </div>
        </header>

        {/* =============== 성경 상담 탭 =============== */}
        {activeTab === 'bible' && (
          <>
            {/* 성경 버전 + 감정 선택 */}
            {showEmotionSelector && messages.length === 0 && (
              <div className="flex-shrink-0 px-4 py-1">
                <div className="max-w-4xl mx-auto space-y-1">
                  {/* 성경 버전 선택 */}
                  {availableVersions.length > 1 && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-amber-700 font-medium">{t('bible.versionLabel')}</span>
                      <select
                        value={selectedVersion}
                        onChange={(e) => handleVersionChange(e.target.value)}
                        className="px-2 py-0.5 bg-white/80 border border-amber-200 rounded text-amber-800 text-sm focus:outline-none focus:border-amber-400 cursor-pointer"
                      >
                        {availableVersions.map(v => (
                          <option key={v.id} value={v.id}>
                            {language === 'en' ? (v.name_english || v.name_korean) : v.name_korean}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* 감정 선택 */}
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm">
                    <span className="text-amber-700 font-medium mr-1">{language === 'en' ? 'Feeling:' : '마음:'}</span>
                    {EMOTIONS.map((e, i) => (
                      <span key={e.value} className="inline-flex items-center">
                        <button
                          onClick={() => setEmotion(emotion === e.value ? undefined : e.value)}
                          className={`transition-colors ${
                            emotion === e.value
                              ? 'text-amber-800 font-bold underline underline-offset-2'
                              : 'text-amber-700 hover:text-amber-900'
                          }`}
                        >
                          {language === 'en' ? e.labelEn : e.label}
                        </button>
                        {i < EMOTIONS.length - 1 && <span className="text-amber-400 mx-1">·</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 메시지 목록 */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="max-w-4xl mx-auto space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center pt-20 pb-8 animate-fade-in">
                    <p className="text-amber-900 text-xl font-semibold mb-2">{t('bible.greeting')}</p>
                    <p className="text-amber-700 text-base mb-8">{t('bible.greetingSubtitle')}</p>

                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-base">
                      {[
                        { key: 'hard', ko: '마음이 힘들어요', en: t('bible.suggestions.hard') },
                        { key: 'grateful', ko: '감사하고 싶어요', en: t('bible.suggestions.grateful') },
                        { key: 'forgive', ko: '용서가 어려워요', en: t('bible.suggestions.forgive') },
                        { key: 'anxious', ko: '미래가 불안해요', en: t('bible.suggestions.anxious') }
                      ].map((suggestion) => (
                        <button
                          key={suggestion.key}
                          onClick={() => setInput(language === 'en' ? suggestion.en : suggestion.ko)}
                          className="text-amber-700 hover:text-amber-900 hover:underline underline-offset-2 transition-colors font-medium"
                        >
                          {language === 'en' ? suggestion.en : suggestion.ko}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((message, idx) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}
                      style={{ animationDelay: `${idx * 0.03}s` }}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-3 ${
                          message.role === 'user'
                            ? 'bg-amber-600 text-white rounded-2xl rounded-br-sm'
                            : 'bg-white/95 text-gray-800 rounded-2xl rounded-bl-sm shadow-sm border border-amber-100'
                        }`}
                      >
                        <div className="whitespace-pre-wrap leading-relaxed text-base">
                          {message.role === 'assistant'
                            ? parseBibleReferences(message.content)
                            : message.content
                          }
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {/* 로딩 - 기도손 애니메이션 */}
                {loading && !messages.find(m => m.role === 'assistant' && m.content) && (
                  <div className="flex justify-start animate-fade-in">
                    <div className="bg-white/95 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-amber-100">
                      <PrayingHandsLoader />
                    </div>
                  </div>
                )}

                {/* 성경 구절 참조 - 답변 완료 후에만 표시 */}
                {!loading && verseReferences.length > 0 && messages.length > 0 && (
                  <div className="animate-fade-in mt-4">
                    {/* 헤더 */}
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <span className="text-sm font-medium text-amber-800">참조 구절</span>
                        <span className="text-xs text-amber-500">({verseReferences.length}개)</span>
                      </div>
                      <a
                        href={`/verse-map?reference=${encodeURIComponent(verseReferences[0]?.reference || '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        관계 보기
                      </a>
                    </div>

                    {/* 구절 목록 */}
                    <div className="space-y-2">
                      {verseReferences.map((verse, idx) => (
                        <a
                          key={idx}
                          href={`/verse-map?reference=${encodeURIComponent(verse.reference)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block bg-white/90 rounded-xl p-3 hover:bg-amber-50 hover:shadow-md transition-all cursor-pointer group border border-amber-100"
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 w-6 h-6 bg-amber-100 rounded-full flex items-center justify-center text-xs font-bold text-amber-700">
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-amber-900 text-sm group-hover:text-amber-700 transition-colors">
                                  {verse.reference}
                                </span>
                                <svg className="w-3.5 h-3.5 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </div>
                              <p className="text-sm text-gray-700 leading-relaxed">{verse.content}</p>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* 위로 미디어 섹션 (이미지 + 오디오) */}
                {!loading && messages.length > 0 && (comfortImage || podcastAudio || mediaLoading.image || mediaLoading.audio) && (
                  <div className="animate-fade-in mt-6 space-y-4">
                    {/* 위로 이미지 */}
                    {(comfortImage || mediaLoading.image) && (
                      <div className="bg-white/95 rounded-xl p-4 border border-amber-100 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm font-medium text-amber-800">
                            {language === 'en' ? 'Expressing Heart' : '마음 표현'}
                          </span>
                        </div>
                        {mediaLoading.image ? (
                          <div className="flex items-center justify-center h-48 bg-amber-50 rounded-lg">
                            <div className="text-center">
                              <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto mb-2" />
                              <p className="text-sm text-amber-600">
                                {language === 'en' ? 'Generating image...' : '이미지를 생성하고 있습니다...'}
                              </p>
                            </div>
                          </div>
                        ) : comfortImage ? (
                          <img
                            src={comfortImage}
                            alt="Comfort image"
                            className="w-full max-w-md mx-auto rounded-lg shadow-md"
                          />
                        ) : null}
                      </div>
                    )}

                    {/* 팟캐스트 오디오 */}
                    {(podcastAudio || mediaLoading.audio) && (
                      <div className="bg-white/95 rounded-xl p-4 border border-amber-100 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                          <span className="text-sm font-medium text-amber-800">
                            {language === 'en' ? 'Pastor\'s Message' : '목사님 음성 메시지'}
                          </span>
                        </div>
                        {mediaLoading.audio ? (
                          <div className="flex items-center justify-center h-16 bg-amber-50 rounded-lg">
                            <div className="flex items-center gap-2">
                              <div className="animate-spin w-6 h-6 border-3 border-amber-500 border-t-transparent rounded-full" />
                              <p className="text-sm text-amber-600">
                                {language === 'en' ? 'Generating audio...' : '오디오를 생성하고 있습니다...'}
                              </p>
                            </div>
                          </div>
                        ) : podcastAudio ? (
                          <audio
                            controls
                            src={podcastAudio}
                            className="w-full"
                          >
                            Your browser does not support the audio element.
                          </audio>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* 입력 영역 */}
            <div className="flex-shrink-0 px-4 py-3 bg-white/50">
              <form onSubmit={handleBibleSubmit} className="max-w-4xl mx-auto">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t('bible.inputPlaceholder')}
                    className="flex-1 px-4 py-3 bg-white border border-amber-300 rounded-full focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 text-gray-900 placeholder-amber-500 text-base"
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="w-10 h-10 flex items-center justify-center bg-amber-600 hover:bg-amber-700 text-white rounded-full disabled:bg-amber-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? (
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}

        {/* =============== 뉴스 AI 탭 =============== */}
        {activeTab === 'news' && (
          <>
            {/* 필터 바 - 성경 버전 선택과 동일한 스타일 */}
            {newsMessages.length === 0 && (
              <div className="flex-shrink-0 px-4 py-1">
                <div className="max-w-4xl mx-auto">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-indigo-700 font-medium">{t('news.yearLabel')}</span>
                    <select
                      value={yearFilter || ''}
                      onChange={(e) => setYearFilter(e.target.value ? parseInt(e.target.value) : undefined)}
                      className="px-2 py-0.5 bg-white/80 border border-indigo-200 rounded text-indigo-800 text-sm focus:outline-none focus:border-indigo-400 cursor-pointer"
                    >
                      <option value="">{t('news.allYears')}</option>
                      {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map(year => (
                        <option key={year} value={year}>{year}{language === 'ko' ? '년' : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* 채팅 영역 */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="max-w-4xl mx-auto">
                {newsMessages.length === 0 ? (
                  /* 초기 화면 - 성경 상담 탭과 동일한 스타일 */
                  <div className="text-center pt-20 pb-8 animate-fade-in">
                    <div className="w-16 h-16 relative mx-auto mb-4">
                      <Image
                        src="/images/yeolhansi-logo.svg"
                        alt={language === 'en' ? 'Church News' : '열한시 로고'}
                        fill
                        className="object-contain"
                      />
                    </div>
                    <p className="text-indigo-900 text-xl font-semibold mb-2">{t('news.title')}</p>
                    <p className="text-indigo-700 text-base mb-8">{t('news.greeting')}</p>

                    {/* 추천 질문 - 본문은 한국어 유지 */}
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-base">
                      {newsSuggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => setNewsInput(suggestion)}
                          className="text-indigo-700 hover:text-indigo-900 hover:underline underline-offset-2 transition-colors font-medium"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* 채팅 메시지 - 성경 상담 탭과 동일한 스타일 */
                  <div className="space-y-4 py-2">
                    {newsMessages.map((message, idx) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}
                        style={{ animationDelay: `${idx * 0.03}s` }}
                      >
                        {message.role === 'user' ? (
                          /* 사용자 메시지 - 성경 탭과 동일한 rounded-br-sm */
                          <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-3">
                            <p className="whitespace-pre-wrap leading-relaxed text-base">{message.content}</p>
                          </div>
                        ) : (
                          /* AI 메시지 */
                          <div className="flex-1 space-y-3 max-w-[85%]">
                            {/* 응답 내용 */}
                            <div className="bg-white/95 border border-indigo-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                              <div className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                {parseBibleReferences(message.content)}
                              </div>
                              {message.provider && (
                                <div className="mt-2 pt-2 border-t border-indigo-50">
                                  <span className="text-xs text-gray-400">
                                    Powered by {message.provider}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* 관련 뉴스 목록 */}
                            {message.sources && message.sources.length > 0 && (
                              <div className="animate-fade-in mt-3">
                                <div className="flex items-center gap-2 mb-2 px-1">
                                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                  </svg>
                                  <span className="text-sm font-medium text-indigo-800">관련 기사</span>
                                  <span className="text-xs text-indigo-500">({message.sources.length}건)</span>
                                </div>
                                <div className="space-y-2">
                                  {message.sources.map((source, sourceIdx) => (
                                    <NewsCard
                                      key={sourceIdx}
                                      news={source}
                                      index={sourceIdx}
                                      onClick={() => setSelectedNews(source)}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* 로딩 표시 - 기도손 애니메이션 */}
                    {newsLoading && !newsMessages.find(m => m.role === 'assistant' && m.content) && (
                      <div className="flex justify-start animate-fade-in">
                        <div className="bg-white/95 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-amber-100">
                          <div className="flex items-center gap-3">
                            <PrayingHandsIcon className="w-6 h-6 text-amber-600" />
                            <WaveText text="기사를 찾고 있습니다..." className="text-sm text-amber-600 font-medium" />
                          </div>
                        </div>
                      </div>
                    )}

                    <div ref={newsMessagesEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* 입력 영역 - 성경 탭과 동일한 스타일 */}
            <div className="flex-shrink-0 px-4 py-3 bg-white/50">
              <form onSubmit={handleNewsSubmit} className="max-w-4xl mx-auto">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={newsInput}
                    onChange={(e) => setNewsInput(e.target.value)}
                    placeholder={t('news.inputPlaceholder')}
                    className="flex-1 px-4 py-3 bg-white border border-indigo-300 rounded-full focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 text-gray-900 placeholder-indigo-500 text-base"
                    disabled={newsLoading}
                  />
                  <button
                    type="submit"
                    disabled={newsLoading || !newsInput.trim()}
                    className="w-10 h-10 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-full disabled:bg-indigo-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {newsLoading ? (
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}

        {/* =============== 주보 AI 탭 =============== */}
        {activeTab === 'bulletin' && (
          <>
            {/* 채팅 영역 */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="max-w-4xl mx-auto">
                {bulletinMessages.length === 0 ? (
                  /* 초기 화면 */
                  <div className="flex flex-col items-center justify-center h-full min-h-[50vh] animate-fade-in">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center mb-4 shadow-lg">
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('bulletin.title')}</h2>
                    <p className="text-gray-600 text-sm mb-6">{t('bulletin.greeting')}</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {bulletinSuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => setBulletinInput(suggestion)}
                          className="px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-sm hover:bg-green-200 transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* 채팅 메시지 */
                  <div className="space-y-4 pb-4">
                    {bulletinMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}
                      >
                        <div
                          className={`max-w-[85%] ${
                            message.role === 'user'
                              ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 shadow-sm'
                              : 'bg-white border border-green-100 shadow-sm text-gray-900 rounded-2xl rounded-bl-sm px-4 py-3'
                          }`}
                        >
                          <div className="whitespace-pre-wrap text-sm leading-relaxed">
                            {message.content}
                          </div>

                          {/* 출처 */}
                          {message.sources && message.sources.length > 0 && (
                            <div className="mt-3 pt-2 border-t border-green-200">
                              <p className="text-xs text-green-600 mb-1.5">참조 주보:</p>
                              <div className="space-y-1">
                                {message.sources.slice(0, 3).map((source: any, idx: number) => (
                                  <div
                                    key={idx}
                                    className="text-xs bg-green-50 text-green-800 rounded px-2 py-1"
                                  >
                                    [{source.bulletinTitle}] {source.sectionType}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    {bulletinLoading && (
                      <div className="flex justify-start animate-slide-up">
                        <div className="bg-white border border-green-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">📖</span>
                            <span className="text-sm text-green-600">주보를 찾고 있습니다...</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div ref={bulletinMessagesEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* 입력 영역 */}
            <div className="flex-shrink-0 border-t border-green-100 bg-gradient-to-t from-green-50 to-white px-4 py-3">
              <form onSubmit={handleBulletinSubmit} className="max-w-4xl mx-auto">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={bulletinInput}
                    onChange={(e) => setBulletinInput(e.target.value)}
                    placeholder={t('bulletin.inputPlaceholder')}
                    className="flex-1 px-4 py-3 bg-white border border-green-300 rounded-full focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-200 text-gray-900 placeholder-green-500 text-base"
                    disabled={bulletinLoading}
                  />
                  <button
                    type="submit"
                    disabled={bulletinLoading || !bulletinInput.trim()}
                    className="w-10 h-10 flex items-center justify-center bg-green-600 hover:bg-green-700 text-white rounded-full disabled:bg-green-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {bulletinLoading ? (
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>

      {/* 커스텀 스타일 */}
      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }

        .animate-slide-up {
          animation: slide-up 0.3s ease-out forwards;
        }

        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .overflow-y-auto::-webkit-scrollbar {
          width: 6px;
        }

        .overflow-y-auto::-webkit-scrollbar-track {
          background: transparent;
        }

        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: rgba(100, 100, 100, 0.2);
          border-radius: 3px;
        }

        .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: rgba(100, 100, 100, 0.4);
        }
      `}</style>
    </div>
  )
}
