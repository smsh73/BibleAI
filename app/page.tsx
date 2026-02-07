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
import ResponsiveNav from '@/components/ResponsiveNav'

interface VerseReference {
  reference: string
  content: string
}

interface SermonReference {
  videoId: string
  videoTitle: string
  videoUrl: string
  speaker?: string
  uploadDate?: string
  startTime?: number
  endTime?: number
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
        className="text-amber-600 hover:text-amber-800 underline decoration-amber-200 hover:decoration-amber-400 transition-colors font-medium"
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

// 간단한 인사/짧은 메시지 감지 함수
function isSimpleMessage(text: string): boolean {
  const trimmed = text.trim()

  // 5자 이하인 경우
  if (trimmed.length <= 5) return true

  // 기호만 있는 경우
  if (/^[.,!?;:~@#$%^&*()_+\-=\[\]{}|\\'"<>/\s]+$/.test(trimmed)) return true

  // 인사말 패턴
  const greetingPatterns = [
    /^(안녕|하이|헬로|hello|hi|hey|반가워|반갑|좋은\s*(아침|저녁|하루)|굿모닝|굿나잇)/i,
    /^(감사합니다|고마워|고맙습니다|ㄱㅅ|ㅎㅇ|ㅂㅇ)/i,
    /^(네|예|응|ㅇㅇ|ㅇㅋ|ok|okay|yes|no|아니|아니요)/i,
    /^(안녕하세요|안녕하십니까|처음 뵙겠습니다)/i
  ]

  for (const pattern of greetingPatterns) {
    if (pattern.test(trimmed)) return true
  }

  return false
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
  const [sermonReferences, setSermonReferences] = useState<SermonReference[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const latestVersesRef = useRef<VerseReference[]>([])  // 최신 구절 추적 (미디어 생성용)

  // 미디어 생성 상태 (위로 이미지 + 팟캐스트 오디오)
  const [comfortImage, setComfortImage] = useState<string | null>(null)
  const [podcastAudio, setPodcastAudio] = useState<string | null>(null)
  const [mediaLoading, setMediaLoading] = useState<{ image: boolean; audio: boolean }>({
    image: false,
    audio: false
  })

  // 성경 버전 상태 - 기본값 설정으로 즉시 표시
  const [selectedVersion, setSelectedVersion] = useState<string>('GAE')
  const [availableVersions, setAvailableVersions] = useState<{
    id: string
    name_korean: string
    name_english?: string
    language: string
    is_default: boolean
  }[]>([
    { id: 'GAE', name_korean: '개역개정', name_english: 'Korean Revised', language: 'ko', is_default: true }
  ])

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

    // 간단한 인사/짧은 메시지 체크
    const isSimple = isSimpleMessage(input.trim())

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
          version: selectedVersion,  // 선택된 성경 버전 전달
          language,  // UI 언어 전달 (en/ko)
          simpleMode: isSimple  // 간단 응답 모드 플래그
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
                latestVersesRef.current = data.verses
              } else if (data.type === 'verses_update') {
                // AI 응답 완료 후 인용된 구절로 업데이트
                setVerseReferences(data.verses)
                latestVersesRef.current = data.verses
                console.log('[page] verses_update 수신:', data.verses.length, '개')
              } else if (data.type === 'sermons') {
                setSermonReferences(data.sermons)
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
      // 응답 완료 후 미디어 자동 생성 (간단한 메시지가 아닌 경우만)
      // latestVersesRef를 사용하여 verses_update로 갱신된 최신 구절 반영
      if (assistantMessage && !isSimple) {
        generateMedia(userMessage.content, assistantMessage, latestVersesRef.current)
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

  // 위로 이미지 다운로드 함수
  const handleDownloadImage = async () => {
    if (!comfortImage) return

    try {
      // 캔버스 생성
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const img = new window.Image()
      img.crossOrigin = 'anonymous'

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = reject
        img.src = comfortImage
      })

      // 캔버스 크기 설정
      canvas.width = img.width
      canvas.height = img.height

      // 이미지 그리기
      ctx.drawImage(img, 0, 0)

      // 구절 오버레이 그리기 (있는 경우)
      if (verseReferences.length > 0) {
        const verse = verseReferences[0]
        const padding = canvas.width * 0.04
        const overlayHeight = canvas.height * 0.18

        // 그라데이션 오버레이
        const gradient = ctx.createLinearGradient(0, canvas.height - overlayHeight, 0, canvas.height)
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
        gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.4)')
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.7)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, canvas.height - overlayHeight, canvas.width, overlayHeight)

        // 구절 내용 텍스트
        const verseContent = verse.content.length > 80
          ? verse.content.substring(0, 80) + '...'
          : verse.content
        const fontSize = Math.max(14, canvas.width * 0.025)

        ctx.font = `${fontSize}px serif`
        ctx.fillStyle = 'white'
        ctx.textAlign = 'center'
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
        ctx.shadowBlur = 4

        // 텍스트 줄바꿈 처리
        const maxWidth = canvas.width - padding * 2
        const words = `"${verseContent}"`.split(' ')
        const lines: string[] = []
        let currentLine = ''

        for (const word of words) {
          const testLine = currentLine + (currentLine ? ' ' : '') + word
          const metrics = ctx.measureText(testLine)
          if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine)
            currentLine = word
          } else {
            currentLine = testLine
          }
        }
        if (currentLine) lines.push(currentLine)

        // 구절 텍스트 그리기
        const lineHeight = fontSize * 1.4
        const totalTextHeight = lines.length * lineHeight + fontSize * 0.8
        let y = canvas.height - padding - totalTextHeight

        for (const line of lines) {
          ctx.fillText(line, canvas.width / 2, y)
          y += lineHeight
        }

        // 참조 텍스트
        ctx.font = `${fontSize * 0.75}px sans-serif`
        ctx.fillStyle = '#fecdd3' // rose-200
        ctx.fillText(`— ${verse.reference}`, canvas.width / 2, y + fontSize * 0.3)
      }

      // 다운로드
      const link = document.createElement('a')
      const dateStr = new Date().toISOString().split('T')[0]
      const reference = verseReferences.length > 0
        ? verseReferences[0].reference.replace(/[:\s]/g, '-')
        : 'comfort'
      link.download = `위로이미지-${reference}-${dateStr}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (error) {
      console.error('이미지 다운로드 실패:', error)
      // Fallback: 원본 이미지 직접 다운로드
      const link = document.createElement('a')
      link.download = `위로이미지-${new Date().toISOString().split('T')[0]}.png`
      link.href = comfortImage
      link.click()
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

      {/* 따뜻한 그라데이션 블롭 배경 (성경 탭에서만) */}
      {activeTab === 'bible' && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* 중앙 따뜻한 빛 그라데이션 */}
          <div
            className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(251,191,36,0.4) 0%, rgba(251,146,60,0.3) 35%, rgba(253,224,71,0.15) 65%, transparent 100%)',
              filter: 'blur(30px)',
            }}
          />
          {/* 예수님 실루엣 - 그라데이션 안에 은은하게 */}
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <JesusSilhouette
              className="w-[280px] h-[320px] select-none"
              opacity={0.15}
            />
          </div>
        </div>
      )}

      {/* 뉴스 탭 배경 */}
      {activeTab === 'news' && (
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/50" />
      )}

      {/* 주보 탭 배경 */}
      {activeTab === 'bulletin' && (
        <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 via-white to-emerald-50/50" />
      )}

      {/* 메인 컨텐츠 */}
      <div className="relative flex flex-col h-full z-10">
        {/* 헤더 */}
        <header className="flex-shrink-0 px-4 py-3 bg-white/90 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between">
              {/* 좌측: 검색 아이콘 (데코용) */}
              <div className="w-8">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {/* 중앙: 토글 스위치 탭 - 모바일에서는 아이콘, 데스크톱에서는 텍스트 */}
              <div className="flex items-center bg-gray-100 rounded-full p-1">
                <button
                  onClick={() => setActiveTab('bible')}
                  className={`px-2 sm:px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
                    activeTab === 'bible'
                      ? 'bg-white text-amber-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title={language === 'en' ? 'Bible Counseling' : '성경 상담'}
                >
                  {/* 성경 아이콘 */}
                  <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  <span className="hidden sm:inline">{language === 'en' ? 'Bible' : '성경 상담'}</span>
                </button>
                <button
                  onClick={() => setActiveTab('news')}
                  className={`px-2 sm:px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
                    activeTab === 'news'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title={language === 'en' ? 'News' : '열한시'}
                >
                  {/* 신문 아이콘 */}
                  <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  <span className="hidden sm:inline">{language === 'en' ? 'News' : '열한시'}</span>
                </button>
                <button
                  onClick={() => setActiveTab('bulletin')}
                  className={`px-2 sm:px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
                    activeTab === 'bulletin'
                      ? 'bg-white text-green-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title={language === 'en' ? 'Bulletin' : '주보'}
                >
                  {/* 주보/문서 아이콘 */}
                  <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="hidden sm:inline">{language === 'en' ? 'Bulletin' : '주보'}</span>
                </button>
              </div>

              {/* 우측: 네비게이션 */}
              <ResponsiveNav />
            </div>
          </div>
        </header>

        {/* =============== 성경 상담 탭 =============== */}
        {activeTab === 'bible' && (
          <>
            {/* 메시지 목록 */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="max-w-4xl mx-auto space-y-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center pt-8 pb-8 animate-fade-in">
                    {/* 타이틀 */}
                    <h2 className="text-2xl font-bold text-gray-800 mb-6">{t('bible.title')}</h2>

                    {/* 성경 버전 선택 - 토글 스타일 */}
                    {availableVersions.length > 0 && (
                      <div className="flex items-center gap-2 mb-4 bg-white/80 rounded-full px-3 py-1.5 shadow-sm border border-gray-100">
                        <span className="text-amber-600 text-sm font-medium">{t('bible.versionLabel')}</span>
                        <select
                          value={selectedVersion}
                          onChange={(e) => handleVersionChange(e.target.value)}
                          className="bg-transparent text-amber-700 text-sm font-medium focus:outline-none cursor-pointer"
                        >
                          {availableVersions.map(v => (
                            <option key={v.id} value={v.id}>
                              {language === 'en' ? (v.name_english || v.name_korean) : v.name_korean}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* 제안 버튼 - 필 스타일 + 화살표 */}
                    <div className="flex flex-col items-start gap-2 w-full max-w-sm mt-4">
                      {[
                        { key: 'hard', ko: '마음이 힘들어요', en: t('bible.suggestions.hard') },
                        { key: 'grateful', ko: '감사하고 싶어요', en: t('bible.suggestions.grateful') },
                        { key: 'forgive', ko: '용서가 어려워요', en: t('bible.suggestions.forgive') },
                        { key: 'anxious', ko: '미래가 불안해요', en: t('bible.suggestions.anxious') }
                      ].map((suggestion, idx) => (
                        <button
                          key={suggestion.key}
                          onClick={() => setInput(language === 'en' ? suggestion.en : suggestion.ko)}
                          className="flex items-center justify-between w-full px-5 py-3 bg-white/90 hover:bg-amber-50 border border-gray-200 hover:border-amber-300 rounded-full text-left text-gray-800 font-medium transition-all shadow-sm hover:shadow group"
                          style={{ animationDelay: `${idx * 0.05}s` }}
                        >
                          <span>{language === 'en' ? suggestion.en : suggestion.ko}</span>
                          <svg className="w-4 h-4 text-gray-400 group-hover:text-amber-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ))}
                    </div>

                    {/* 마음 상태 선택 - 필 버튼 스타일 */}
                    {showEmotionSelector && (
                      <div className="mt-6 w-full max-w-sm">
                        <p className="text-sm text-gray-500 mb-2 text-center">{language === 'en' ? 'How are you feeling?' : '오늘 마음은 어떠세요?'}</p>
                        <div className="flex flex-wrap justify-center gap-2">
                          {EMOTIONS.map((e) => (
                            <button
                              key={e.value}
                              onClick={() => setEmotion(emotion === e.value ? undefined : e.value)}
                              className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                                emotion === e.value
                                  ? 'bg-amber-100 border-amber-400 text-amber-700'
                                  : 'bg-white/80 border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50'
                              }`}
                            >
                              {language === 'en' ? e.labelEn : e.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
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
                            ? 'bg-amber-500 text-white rounded-2xl rounded-br-sm'
                            : 'bg-white/95 text-gray-800 rounded-2xl rounded-bl-sm shadow-sm border border-amber-100/70'
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
                    <div className="bg-white/95 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-amber-100/70">
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
                        <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <span className="text-sm font-medium text-amber-700">참조 구절</span>
                        <span className="text-xs text-amber-500">({verseReferences.length}개)</span>
                      </div>
                      <a
                        href={`/verse-map?reference=${encodeURIComponent(verseReferences[0]?.reference || '')}`}
                        className="text-xs text-amber-500 hover:text-amber-700 flex items-center gap-1 transition-colors"
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
                          className="block bg-white/90 rounded-xl p-3 hover:bg-amber-50/60 hover:shadow-md transition-all cursor-pointer group border border-amber-100/70"
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 w-6 h-6 bg-amber-100/80 rounded-full flex items-center justify-center text-xs font-bold text-amber-600">
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-amber-800 text-sm group-hover:text-amber-600 transition-colors">
                                  {verse.reference}
                                </span>
                                <svg className="w-3.5 h-3.5 text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

                {/* 관련 설교 영상 참조 - 답변 완료 후에만 표시 */}
                {!loading && sermonReferences.length > 0 && messages.length > 0 && (
                  <div className="animate-fade-in mt-4">
                    {/* 헤더 */}
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
                        </svg>
                        <span className="text-sm font-medium text-red-800">관련 설교</span>
                        <span className="text-xs text-red-500">({sermonReferences.length}개)</span>
                      </div>
                      <a
                        href="/youtube"
                        className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                        전체 설교 보기
                      </a>
                    </div>

                    {/* 설교 목록 */}
                    <div className="space-y-2">
                      {sermonReferences.map((sermon, idx) => (
                        <a
                          key={idx}
                          href={sermon.startTime
                            ? `${sermon.videoUrl}&t=${sermon.startTime}`
                            : sermon.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block bg-white/90 rounded-xl p-3 hover:bg-red-50 hover:shadow-md transition-all cursor-pointer group border border-red-100"
                        >
                          <div className="flex items-start gap-3">
                            {/* 썸네일 */}
                            <div className="flex-shrink-0 w-24 h-14 bg-gray-200 rounded-lg overflow-hidden relative">
                              <img
                                src={`https://img.youtube.com/vi/${sermon.videoId}/mqdefault.jpg`}
                                alt={sermon.videoTitle}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
                                <svg className="w-8 h-8 text-white/90" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                              </div>
                              {sermon.startTime && (
                                <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
                                  {Math.floor(sermon.startTime / 60)}:{(sermon.startTime % 60).toString().padStart(2, '0')}
                                </span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-gray-900 text-sm group-hover:text-red-700 transition-colors line-clamp-2">
                                  {sermon.videoTitle}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                {sermon.speaker && (
                                  <span className="text-red-600 font-medium">{sermon.speaker}</span>
                                )}
                                {sermon.uploadDate && (
                                  <span>{sermon.uploadDate}</span>
                                )}
                              </div>
                            </div>
                            <svg className="w-4 h-4 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
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
                      <div className="bg-white/95 rounded-xl p-4 border border-amber-100/70 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm font-medium text-amber-700">
                            {language === 'en' ? 'Expressing Heart' : '마음 표현'}
                          </span>
                        </div>
                        {mediaLoading.image ? (
                          <div className="flex items-center justify-center h-48 bg-amber-50/60 rounded-lg">
                            <div className="text-center">
                              <div className="animate-spin w-8 h-8 border-4 border-amber-300 border-t-transparent rounded-full mx-auto mb-2" />
                              <p className="text-sm text-amber-500">
                                {language === 'en' ? 'Generating image...' : '이미지를 생성하고 있습니다...'}
                              </p>
                            </div>
                          </div>
                        ) : comfortImage ? (
                          <div className="relative w-full max-w-md mx-auto">
                            <img
                              src={comfortImage}
                              alt="Comfort image"
                              className="w-full rounded-lg shadow-md"
                            />
                            {/* 구절 오버레이 */}
                            {verseReferences.length > 0 && (
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent p-4 rounded-b-lg">
                                <p className="text-white text-center font-serif text-sm leading-relaxed drop-shadow-lg">
                                  "{verseReferences[0].content.length > 80
                                    ? verseReferences[0].content.substring(0, 80) + '...'
                                    : verseReferences[0].content}"
                                </p>
                                <p className="text-amber-200 text-center text-xs mt-1 font-medium drop-shadow">
                                  — {verseReferences[0].reference}
                                </p>
                              </div>
                            )}
                            {/* 다운로드 버튼 */}
                            <button
                              onClick={handleDownloadImage}
                              className="absolute top-2 right-2 p-2 bg-white/90 hover:bg-white rounded-full shadow-md transition-all hover:scale-105"
                              title={language === 'en' ? 'Download image' : '이미지 다운로드'}
                            >
                              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* 팟캐스트 오디오 */}
                    {(podcastAudio || mediaLoading.audio) && (
                      <div className="bg-white/95 rounded-xl p-4 border border-amber-100/70 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                          <span className="text-sm font-medium text-amber-700">
                            {language === 'en' ? 'Pastor\'s Message' : '목사님 음성 메시지'}
                          </span>
                        </div>
                        {mediaLoading.audio ? (
                          <div className="flex items-center justify-center h-16 bg-amber-50/60 rounded-lg">
                            <div className="flex items-center gap-2">
                              <div className="animate-spin w-6 h-6 border-3 border-amber-300 border-t-transparent rounded-full" />
                              <p className="text-sm text-amber-500">
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

            {/* 입력 영역 - 이미지 스타일 */}
            <div className="flex-shrink-0 px-4 py-3 bg-white/80 backdrop-blur-sm border-t border-gray-100">
              <form onSubmit={handleBibleSubmit} className="max-w-4xl mx-auto">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 flex items-center bg-white border border-gray-200 rounded-full px-4 py-2 shadow-sm focus-within:border-amber-300 focus-within:ring-2 focus-within:ring-amber-100">
                    <div className="w-6 h-6 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center mr-3">
                      <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                      </svg>
                    </div>
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (input.trim() && !loading) {
                            handleBibleSubmit(e)
                          }
                        }
                      }}
                      placeholder={t('bible.inputPlaceholder')}
                      className="flex-1 bg-transparent focus:outline-none text-gray-900 placeholder-gray-400 text-base resize-none min-h-[24px] max-h-[80px]"
                      disabled={loading}
                      rows={1}
                      style={{ height: 'auto', overflow: 'hidden' }}
                      ref={(el) => {
                        if (el) {
                          el.style.height = 'auto'
                          el.style.height = Math.min(el.scrollHeight, 80) + 'px'
                        }
                      }}
                    />
                    <button
                      type="submit"
                      disabled={loading || !input.trim()}
                      className="w-8 h-8 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white rounded-full disabled:bg-gray-200 disabled:cursor-not-allowed transition-colors ml-2"
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
                </div>
              </form>
            </div>
          </>
        )}

        {/* =============== 뉴스 AI 탭 =============== */}
        {activeTab === 'news' && (
          <>
            {/* 메시지 목록 */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="max-w-4xl mx-auto space-y-4">
                {newsMessages.length === 0 ? (
                  /* 초기 화면 - 성경 상담 탭과 동일한 스타일 */
                  <div className="flex flex-col items-center pt-8 pb-8 animate-fade-in">
                    {/* 타이틀 */}
                    <h2 className="text-2xl font-bold text-gray-800 mb-6">{t('news.title')}</h2>

                    {/* 연도 필터 - 토글 스타일 */}
                    <div className="flex items-center gap-2 mb-4 bg-white/80 rounded-full px-3 py-1.5 shadow-sm border border-gray-100">
                      <span className="text-indigo-600 text-sm font-medium">{t('news.yearLabel')}</span>
                      <select
                        value={yearFilter || ''}
                        onChange={(e) => setYearFilter(e.target.value ? parseInt(e.target.value) : undefined)}
                        className="bg-transparent text-indigo-700 text-sm font-medium focus:outline-none cursor-pointer"
                      >
                        <option value="">{t('news.allYears')}</option>
                        {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map(year => (
                          <option key={year} value={year}>{year}{language === 'ko' ? '년' : ''}</option>
                        ))}
                      </select>
                    </div>

                    {/* 제안 버튼 - 필 스타일 + 화살표 */}
                    <div className="flex flex-col items-start gap-2 w-full max-w-sm mt-4">
                      {newsSuggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => setNewsInput(suggestion)}
                          className="flex items-center justify-between w-full px-5 py-3 bg-white/90 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-300 rounded-full text-left text-gray-800 font-medium transition-all shadow-sm hover:shadow group"
                          style={{ animationDelay: `${idx * 0.05}s` }}
                        >
                          <span>{suggestion}</span>
                          <svg className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
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

                    {/* 로딩 - 기도손 애니메이션 */}
                    {newsLoading && !newsMessages.find(m => m.role === 'assistant' && m.content) && (
                      <div className="flex justify-start animate-fade-in">
                        <div className="bg-white/95 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-indigo-100/70">
                          <PrayingHandsLoader />
                        </div>
                      </div>
                    )}

                    <div ref={newsMessagesEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* 입력 영역 - 성경 탭과 동일한 스타일 */}
            <div className="flex-shrink-0 px-4 py-3 bg-white/80 backdrop-blur-sm border-t border-gray-100">
              <form onSubmit={handleNewsSubmit} className="max-w-4xl mx-auto">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 flex items-center bg-white border border-gray-200 rounded-full px-4 py-2 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                    <div className="w-6 h-6 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-full flex items-center justify-center mr-3">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                      </svg>
                    </div>
                    <textarea
                      value={newsInput}
                      onChange={(e) => setNewsInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (newsInput.trim() && !newsLoading) {
                            handleNewsSubmit(e)
                          }
                        }
                      }}
                      placeholder={t('news.inputPlaceholder')}
                      className="flex-1 bg-transparent focus:outline-none text-gray-900 placeholder-gray-400 text-base resize-none min-h-[24px] max-h-[80px]"
                      disabled={newsLoading}
                      rows={1}
                      style={{ height: 'auto', overflow: 'hidden' }}
                      ref={(el) => {
                        if (el) {
                          el.style.height = 'auto'
                          el.style.height = Math.min(el.scrollHeight, 80) + 'px'
                        }
                      }}
                    />
                    <button
                      type="submit"
                      disabled={newsLoading || !newsInput.trim()}
                      className="w-8 h-8 flex items-center justify-center bg-indigo-500 hover:bg-indigo-600 text-white rounded-full disabled:bg-gray-200 disabled:cursor-not-allowed transition-colors ml-2"
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
                </div>
              </form>
            </div>
          </>
        )}

        {/* =============== 주보 AI 탭 =============== */}
        {activeTab === 'bulletin' && (
          <>
            {/* 메시지 목록 */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="max-w-4xl mx-auto space-y-4">
                {bulletinMessages.length === 0 ? (
                  /* 초기 화면 - 성경 상담 탭과 동일한 스타일 */
                  <div className="flex flex-col items-center pt-8 pb-8 animate-fade-in">
                    {/* 타이틀 */}
                    <h2 className="text-2xl font-bold text-gray-800 mb-6">{t('bulletin.title')}</h2>

                    {/* 제안 버튼 - 필 스타일 + 화살표 */}
                    <div className="flex flex-col items-start gap-2 w-full max-w-sm mt-4">
                      {bulletinSuggestions.map((suggestion, idx) => (
                        <button
                          key={suggestion}
                          onClick={() => setBulletinInput(suggestion)}
                          className="flex items-center justify-between w-full px-5 py-3 bg-white/90 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-full text-left text-gray-800 font-medium transition-all shadow-sm hover:shadow group"
                          style={{ animationDelay: `${idx * 0.05}s` }}
                        >
                          <span>{suggestion}</span>
                          <svg className="w-4 h-4 text-gray-400 group-hover:text-green-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* 채팅 메시지 */
                  <div className="space-y-4">
                    {bulletinMessages.map((message, idx) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}
                        style={{ animationDelay: `${idx * 0.03}s` }}
                      >
                        <div
                          className={`max-w-[85%] px-4 py-3 ${
                            message.role === 'user'
                              ? 'bg-green-500 text-white rounded-2xl rounded-br-sm'
                              : 'bg-white/95 text-gray-800 rounded-2xl rounded-bl-sm shadow-sm border border-green-100/70'
                          }`}
                        >
                          <div className="whitespace-pre-wrap leading-relaxed text-base">
                            {message.content}
                          </div>

                          {/* 출처 */}
                          {message.sources && message.sources.length > 0 && (
                            <div className="mt-3 pt-2 border-t border-green-200/50">
                              <p className="text-xs text-green-600 mb-1.5 font-medium">참조 주보:</p>
                              <div className="space-y-1">
                                {message.sources.slice(0, 3).map((source: any, idx: number) => (
                                  <div
                                    key={idx}
                                    className="text-xs bg-green-50 text-green-800 rounded-lg px-2 py-1"
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

                    {/* 로딩 - 기도손 애니메이션 */}
                    {bulletinLoading && !bulletinMessages.find(m => m.role === 'assistant' && m.content) && (
                      <div className="flex justify-start animate-fade-in">
                        <div className="bg-white/95 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-green-100/70">
                          <PrayingHandsLoader />
                        </div>
                      </div>
                    )}

                    <div ref={bulletinMessagesEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* 입력 영역 - 성경 탭과 동일한 스타일 */}
            <div className="flex-shrink-0 px-4 py-3 bg-white/80 backdrop-blur-sm border-t border-gray-100">
              <form onSubmit={handleBulletinSubmit} className="max-w-4xl mx-auto">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 flex items-center bg-white border border-gray-200 rounded-full px-4 py-2 shadow-sm focus-within:border-green-300 focus-within:ring-2 focus-within:ring-green-100">
                    <div className="w-6 h-6 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center mr-3">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <textarea
                      value={bulletinInput}
                      onChange={(e) => setBulletinInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (bulletinInput.trim() && !bulletinLoading) {
                            handleBulletinSubmit(e)
                          }
                        }
                      }}
                      placeholder={t('bulletin.inputPlaceholder')}
                      className="flex-1 bg-transparent focus:outline-none text-gray-900 placeholder-gray-400 text-base resize-none min-h-[24px] max-h-[80px]"
                      disabled={bulletinLoading}
                      rows={1}
                      style={{ height: 'auto', overflow: 'hidden' }}
                      ref={(el) => {
                        if (el) {
                          el.style.height = 'auto'
                          el.style.height = Math.min(el.scrollHeight, 80) + 'px'
                        }
                      }}
                    />
                    <button
                      type="submit"
                      disabled={bulletinLoading || !bulletinInput.trim()}
                      className="w-8 h-8 flex items-center justify-center bg-green-500 hover:bg-green-600 text-white rounded-full disabled:bg-gray-200 disabled:cursor-not-allowed transition-colors ml-2"
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
