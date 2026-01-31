'use client'

/**
 * YouTube 설교 스크립트 추출 페이지
 * - AI 자동 감지 후 수동 보정 UI 지원
 * - 플레이리스트 URL 자동 인식 지원
 * - 중복 동영상 자동 필터링
 */

import { useState, useEffect } from 'react'

interface ProcessedSermon {
  video_id: string
  video_title: string
  video_url: string
  speaker: string | null
  upload_date: string | null
  chunk_count: number
  sermon_duration: number | null
  created_at: string
}

interface TranscriptResult {
  success: boolean
  videoUrl: string
  method: string
  autoDetected?: boolean
  detectedBoundary?: {
    start: number
    end: number
    confidence: number
    reasoning: string
  } | null
  summary: {
    totalDuration: number
    totalSegments: number
    sermonDuration: number
    sermonSegments: number
  }
  sermonSection: {
    start: number
    end: number
    duration: number
    text: string
  } | null
  chunks: Array<{
    text: string
    startTime: number
    endTime: number
    duration: number
  }>
  totalChunks: number
  error?: string
}

interface PlaylistResult {
  success: boolean
  playlistId: string
  totalVideos: number
  processedVideos: number
  skippedVideos: number
  failedVideos: number
  results: Array<{
    videoId: string
    title: string
    status: 'processed' | 'skipped' | 'failed'
    chunksCreated?: number
    error?: string
  }>
}

// 플레이리스트 URL인지 확인
function isPlaylistUrl(url: string): boolean {
  return url.includes('list=') || url.includes('/playlist')
}

// MM:SS 형식을 초로 변환
function parseTimeToSeconds(timeStr: string): number | null {
  const trimmed = timeStr.trim()

  // MM:SS 형식
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    if (parts.length === 2) {
      const mins = parseInt(parts[0], 10)
      const secs = parseInt(parts[1], 10)
      if (!isNaN(mins) && !isNaN(secs) && mins >= 0 && secs >= 0 && secs < 60) {
        return mins * 60 + secs
      }
    }
    // HH:MM:SS 형식
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10)
      const mins = parseInt(parts[1], 10)
      const secs = parseInt(parts[2], 10)
      if (!isNaN(hours) && !isNaN(mins) && !isNaN(secs) && hours >= 0 && mins >= 0 && mins < 60 && secs >= 0 && secs < 60) {
        return hours * 3600 + mins * 60 + secs
      }
    }
    return null
  }

  // 숫자만 (초 단위)
  const secs = parseFloat(trimmed)
  return isNaN(secs) ? null : secs
}

// 초를 MM:SS 형식으로 변환
function formatTimeMMSS(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function YouTubePage() {
  const [videoUrl, setVideoUrl] = useState('https://youtu.be/Ygj_ueI1y-M?si=OSK_cH9SR-ZaG2We')
  const [useSTT, setUseSTT] = useState(true) // STT 사용 여부 (기본값: true)
  const [autoDetect, setAutoDetect] = useState(false) // 자동 감지 여부
  const [extractSermonOnly, setExtractSermonOnly] = useState(false)
  const [startTime, setStartTime] = useState('0') // 초 단위
  const [endTime, setEndTime] = useState('0') // 초 단위
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TranscriptResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 수동 보정 관련 상태
  const [showCorrection, setShowCorrection] = useState(false)
  const [correctedStart, setCorrectedStart] = useState('')
  const [correctedEnd, setCorrectedEnd] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const [correctionError, setCorrectionError] = useState<string | null>(null)

  // 플레이리스트 관련 상태
  const [isPlaylist, setIsPlaylist] = useState(false)
  const [playlistResult, setPlaylistResult] = useState<PlaylistResult | null>(null)
  const [maxVideos, setMaxVideos] = useState(5)
  const [saveToDatabase, setSaveToDatabase] = useState(true)

  // 플레이리스트 필터링 옵션
  const [dateRange, setDateRange] = useState<'1m' | '6m' | '1y' | '3y' | 'all'>('all')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

  // 처리된 설교 목록
  const [processedSermons, setProcessedSermons] = useState<ProcessedSermon[]>([])
  const [totalChunks, setTotalChunks] = useState(0)
  const [sermonsLoading, setSermonsLoading] = useState(true)

  // Task lock 상태
  const [taskLock, setTaskLock] = useState<{
    locked: boolean
    taskType?: string
    description?: string
    elapsedMinutes?: number
  }>({ locked: false })

  // 처리된 설교 목록 로드 (설교 작업 진행 중이면 주기적 갱신)
  useEffect(() => {
    async function fetchSermons() {
      try {
        const res = await fetch('/api/youtube/sermons')
        const data = await res.json()
        if (data.success) {
          setProcessedSermons(data.sermons)
          setTotalChunks(data.totalChunks)
        }
      } catch (err) {
        console.error('설교 목록 로드 실패:', err)
      } finally {
        setSermonsLoading(false)
      }
    }
    fetchSermons()

    // 설교 작업 진행 중이면 15초마다 목록 갱신
    if (taskLock.locked && taskLock.taskType === 'sermon') {
      const interval = setInterval(fetchSermons, 15000)
      return () => clearInterval(interval)
    }
  }, [taskLock.locked, taskLock.taskType])

  // Task lock 상태 확인
  useEffect(() => {
    async function checkTaskLock() {
      try {
        const res = await fetch('/api/admin/task-lock')
        const data = await res.json()
        setTaskLock(data)
      } catch (err) {
        console.warn('Task lock 확인 실패:', err)
      }
    }
    checkTaskLock()
    // 10초마다 폴링
    const interval = setInterval(checkTaskLock, 10000)
    return () => clearInterval(interval)
  }, [])

  // URL 변경 시 플레이리스트 여부 확인
  useEffect(() => {
    setIsPlaylist(isPlaylistUrl(videoUrl))
    setResult(null)
    setPlaylistResult(null)
    setError(null)
  }, [videoUrl])

  async function handleExtract() {
    setLoading(true)
    setError(null)
    setResult(null)
    setPlaylistResult(null)

    try {
      // 플레이리스트인 경우
      if (isPlaylist) {
        const res = await fetch('/api/youtube/playlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playlistUrl: videoUrl,
            autoDetect: true,
            saveToDatabase,
            maxVideos,
            dateRange,    // 기간 필터
            sortOrder,    // 정렬 순서
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || '플레이리스트 처리 실패')
        }

        setPlaylistResult(data)
        return
      }

      // 단일 동영상인 경우
      const requestBody: any = {
        videoUrl,
        useSTT,
        autoDetect,
        extractSermonOnly,
      }

      // 설교 구간만 추출하는 경우 시간 범위 추가 (자동 감지가 아닌 경우)
      if (extractSermonOnly && !autoDetect) {
        requestBody.startTime = parseFloat(startTime)
        requestBody.endTime = parseFloat(endTime)

        if (isNaN(requestBody.startTime) || isNaN(requestBody.endTime)) {
          throw new Error('시작 시간과 종료 시간은 숫자여야 합니다.')
        }

        if (requestBody.startTime >= requestBody.endTime) {
          throw new Error('종료 시간은 시작 시간보다 커야 합니다.')
        }
      }

      const res = await fetch('/api/youtube/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || '스크립트 추출 실패')
      }

      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // AI 감지 결과 보정 후 재추출
  async function handleCorrection() {
    const startSec = parseTimeToSeconds(correctedStart)
    const endSec = parseTimeToSeconds(correctedEnd)

    if (startSec === null) {
      setCorrectionError('시작 시간 형식이 올바르지 않습니다. (예: 39:06 또는 2346)')
      return
    }
    if (endSec === null) {
      setCorrectionError('종료 시간 형식이 올바르지 않습니다. (예: 78:57 또는 4737)')
      return
    }
    if (startSec >= endSec) {
      setCorrectionError('종료 시간은 시작 시간보다 커야 합니다.')
      return
    }

    setCorrecting(true)
    setCorrectionError(null)

    try {
      const res = await fetch('/api/youtube/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          useSTT: true,
          autoDetect: false,
          extractSermonOnly: true,
          startTime: startSec,
          endTime: endSec,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || '보정 후 재추출 실패')
      }

      // 보정된 결과에 원래 AI 감지 정보 + 보정 표시 추가
      setResult({
        ...data,
        autoDetected: true,
        detectedBoundary: result?.detectedBoundary ? {
          ...result.detectedBoundary,
          start: startSec,
          end: endSec,
          reasoning: `[수동 보정됨] 원래 AI 감지: ${formatTimeMMSS(result.detectedBoundary.start)} ~ ${formatTimeMMSS(result.detectedBoundary.end)}\n${result.detectedBoundary.reasoning}`,
        } : null,
      })

      setShowCorrection(false)
    } catch (err: any) {
      setCorrectionError(err.message)
    } finally {
      setCorrecting(false)
    }
  }

  // 보정 모드 시작 (AI 감지 결과로 초기값 설정)
  function startCorrection() {
    if (result?.detectedBoundary) {
      setCorrectedStart(formatTimeMMSS(result.detectedBoundary.start))
      setCorrectedEnd(formatTimeMMSS(result.detectedBoundary.end))
    }
    setCorrectionError(null)
    setShowCorrection(true)
  }

  return (
    <div className="relative flex flex-col min-h-screen overflow-hidden">
      {/* 배경 */}
      <div className="absolute inset-0 bg-white" />
      <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-white to-orange-50" />

      {/* 헤더 */}
      <header className="relative z-10 flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-amber-900">설교 추출</h1>
            </div>
            <nav className="flex items-center gap-3 text-sm text-gray-600 font-medium">
              <a href="/" className="hover:text-gray-900 hover:underline">홈</a>
              <span className="text-gray-300">|</span>
              <a href="/verse-map" className="hover:text-gray-900 hover:underline">성경지도</a>
              <span className="text-gray-300">|</span>
              <a href="/youtube" className="hover:text-gray-900 hover:underline">설교</a>
              <span className="text-gray-300">|</span>
              <a href="/news" className="hover:text-gray-900 hover:underline">신문</a>
              <span className="text-gray-300">|</span>
              <a href="/bulletin" className="hover:text-gray-900 hover:underline">주보</a>
              <span className="text-gray-300">|</span>
              <a href="/admin" className="hover:text-gray-900 hover:underline">관리</a>
            </nav>
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-4xl mx-auto p-6">
        {/* Task Lock 경고 배너 - 다른 작업 진행 중 */}
        {taskLock.locked && taskLock.taskType !== 'sermon' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6 flex items-center gap-3">
            <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-medium text-yellow-800">
                다른 작업이 진행 중입니다
              </p>
              <p className="text-sm text-yellow-700">
                {taskLock.taskType === 'news' && '뉴스 기사 추출'}
                {taskLock.taskType === 'bulletin' && '주보 추출'}
                {taskLock.taskType === 'bible' && '성경 임베딩'}
                {taskLock.description && ` - ${taskLock.description}`}
                {taskLock.elapsedMinutes !== undefined && ` (${taskLock.elapsedMinutes}분 경과)`}
              </p>
            </div>
          </div>
        )}

        {/* 설교 추출 진행 중 배너 */}
        {taskLock.locked && taskLock.taskType === 'sermon' && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-6 flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
              <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-amber-800">
                설교 추출 작업이 백그라운드에서 진행 중입니다
              </p>
              <p className="text-sm text-amber-700">
                {taskLock.description && `${taskLock.description}`}
                {taskLock.elapsedMinutes !== undefined && ` • ${taskLock.elapsedMinutes}분 경과`}
                {' • '}현재 {processedSermons.length}개 설교, {totalChunks.toLocaleString()}개 청크 완료
              </p>
              <p className="text-xs text-amber-600 mt-1">
                브라우저를 닫아도 작업은 계속됩니다. 완료될 때까지 기다려 주세요.
              </p>
            </div>
          </div>
        )}

        {/* 벡터 임베딩 완료된 설교 목록 */}
        <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">벡터 임베딩 완료된 설교</h2>
            <div className="flex items-center gap-4 text-sm">
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full">
                {processedSermons.length}개 설교
              </span>
              <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full">
                {totalChunks.toLocaleString()}개 청크
              </span>
            </div>
          </div>

          {sermonsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-gray-500">설교 목록 로딩 중...</span>
            </div>
          ) : processedSermons.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>아직 임베딩된 설교가 없습니다.</p>
              <p className="text-sm mt-1">아래에서 YouTube 설교를 추출해주세요.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {processedSermons.map((sermon, idx) => (
                <div
                  key={sermon.video_id}
                  className="flex items-center justify-between p-3 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors border border-amber-100"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{idx + 1}.</span>
                      <a
                        href={sermon.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-900 hover:text-amber-600 truncate"
                      >
                        {sermon.video_title}
                      </a>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {sermon.upload_date && (
                        <span>{new Date(sermon.upload_date).toLocaleDateString('ko-KR')}</span>
                      )}
                      {sermon.speaker && <span>• {sermon.speaker}</span>}
                      {sermon.sermon_duration && (
                        <span>• {Math.floor(sermon.sermon_duration / 60)}분</span>
                      )}
                    </div>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    <span className="px-2 py-1 bg-green-50 text-green-600 text-xs rounded border border-green-200">
                      {sermon.chunk_count}개 청크
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 입력 폼 */}
        <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6 mb-8">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700">
                YouTube 동영상 또는 플레이리스트 URL
              </label>
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full px-3 py-2 border border-amber-200 rounded-lg font-mono text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
                placeholder="https://youtu.be/... 또는 https://youtube.com/playlist?list=..."
              />
              {isPlaylist && (
                <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <span className="text-sm text-amber-700">플레이리스트 URL 감지됨</span>
                </div>
              )}
            </div>

            {/* 플레이리스트 옵션 */}
            {isPlaylist && (
              <div className="border-t border-amber-100 pt-4 space-y-4">
                <div className="text-base font-semibold text-gray-900">플레이리스트 처리 옵션</div>

                {/* 기간 필터 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">기간 필터</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: '1m', label: '최근 1개월' },
                      { value: '6m', label: '최근 6개월' },
                      { value: '1y', label: '최근 1년' },
                      { value: '3y', label: '최근 3년' },
                      { value: 'all', label: '전체' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDateRange(opt.value as typeof dateRange)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                          dateRange === opt.value
                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-500'
                            : 'bg-white text-gray-700 border-amber-200 hover:border-amber-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 정렬 순서 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">정렬 순서</label>
                  <div className="flex gap-2">
                    {[
                      { value: 'newest', label: '최신순 (최근 업로드부터)' },
                      { value: 'oldest', label: '오래된순 (과거 업로드부터)' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSortOrder(opt.value as typeof sortOrder)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                          sortOrder === opt.value
                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-500'
                            : 'bg-white text-gray-700 border-amber-200 hover:border-amber-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 개수 제한 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">처리할 동영상 수</label>
                  <div className="flex flex-wrap gap-2">
                    {[5, 10, 30, 50, 100].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setMaxVideos(num)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                          maxVideos === num
                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-500'
                            : 'bg-white text-gray-700 border-amber-200 hover:border-amber-500'
                        }`}
                      >
                        {num}개
                      </button>
                    ))}
                  </div>
                </div>

                {/* DB 저장 옵션 */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="saveToDb"
                    checked={saveToDatabase}
                    onChange={(e) => setSaveToDatabase(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                  />
                  <label htmlFor="saveToDb" className="text-sm font-medium text-gray-800">
                    벡터 임베딩하여 DB에 저장
                  </label>
                </div>

                <div className="bg-amber-50 p-3 rounded-lg text-sm text-amber-800 border border-amber-200">
                  <p>• 이미 처리된 동영상은 자동으로 건너뜁니다 (중복 방지)</p>
                  <p>• 25MB 초과 동영상은 자동 분할 처리됩니다</p>
                  <p className="mt-1 font-medium">
                    선택: {dateRange === 'all' ? '전체 기간' : `최근 ${dateRange === '1m' ? '1개월' : dateRange === '6m' ? '6개월' : dateRange === '1y' ? '1년' : '3년'}`},
                    {' '}{sortOrder === 'newest' ? '최신순' : '오래된순'},
                    {' '}{maxVideos}개 처리
                  </p>
                </div>
              </div>
            )}

            <div className="border-t border-amber-100 pt-4">
              <label className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  checked={useSTT}
                  onChange={(e) => setUseSTT(e.target.checked)}
                  className="w-4 h-4 text-amber-500 focus:ring-amber-500"
                />
                <span className="text-base font-medium text-gray-800">STT 사용 (Whisper API)</span>
              </label>
              <p className="text-sm text-gray-700 pl-6 mb-3">
                자막이 없는 동영상의 경우 STT를 사용하여 음성을 텍스트로 변환합니다.
                <br />
                비용: $0.006/분 (OpenAI Whisper API)
              </p>
            </div>

            {useSTT && (
              <div className="border-t border-amber-100 pt-4">
                <label className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={autoDetect}
                    onChange={(e) => {
                      setAutoDetect(e.target.checked)
                      if (e.target.checked) {
                        setExtractSermonOnly(false)
                      }
                    }}
                    className="w-4 h-4 text-amber-500 focus:ring-amber-500"
                  />
                  <span className="text-base font-medium text-gray-800">AI 자동 감지 (설교 구간)</span>
                </label>
                <p className="text-sm text-gray-700 pl-6 mb-3">
                  전체 동영상을 분석하여 설교 시작/종료 지점을 자동으로 찾습니다.
                  <br />
                  추가 비용: $0.001~0.01 (GPT-4o-mini)
                </p>
              </div>
            )}

            {!autoDetect && (
              <div className="border-t border-amber-100 pt-4">
                <label className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={extractSermonOnly}
                    onChange={(e) => setExtractSermonOnly(e.target.checked)}
                    className="w-4 h-4 text-amber-500 focus:ring-amber-500"
                  />
                  <span className="text-base font-medium text-gray-800">설교 구간만 추출 (수동)</span>
                </label>

                {extractSermonOnly && (
                <div className="grid grid-cols-2 gap-4 pl-6">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      시작 시간 (초)
                    </label>
                    <input
                      type="number"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="예: 120"
                      min="0"
                      step="1"
                    />
                    <div className="text-xs text-gray-500 mt-1">
                      {startTime && !isNaN(parseFloat(startTime))
                        ? `${formatTime(parseFloat(startTime))}`
                        : '0:00'}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      종료 시간 (초)
                    </label>
                    <input
                      type="number"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="예: 3600"
                      min="0"
                      step="1"
                    />
                    <div className="text-xs text-gray-500 mt-1">
                      {endTime && !isNaN(parseFloat(endTime))
                        ? `${formatTime(parseFloat(endTime))}`
                        : '0:00'}
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}

            <button
              onClick={handleExtract}
              disabled={loading || !videoUrl || taskLock.locked}
              className={`w-full px-4 py-3 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all ${
                isPlaylist
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600'
              }`}
            >
              {loading
                ? (isPlaylist ? '플레이리스트 처리 중...' : '추출 중...')
                : taskLock.locked && taskLock.taskType === 'sermon'
                  ? '설교 추출 진행 중...'
                  : taskLock.locked
                    ? '다른 작업 진행 중...'
                    : (isPlaylist ? `플레이리스트 처리 (최대 ${maxVideos}개)` : '스크립트 추출')
              }
            </button>
          </div>
        </div>

        {/* 에러 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-8">
            <p className="text-red-800">오류: {error}</p>
          </div>
        )}

        {/* 플레이리스트 결과 */}
        {playlistResult && (
          <div className="space-y-6 mb-8">
            {/* 요약 */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4 text-amber-900">
                플레이리스트 처리 결과
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-white p-3 rounded-lg border border-amber-200">
                  <div className="text-xs text-amber-600">전체</div>
                  <div className="text-2xl font-bold text-amber-900">{playlistResult.totalVideos}</div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-green-200">
                  <div className="text-xs text-green-600">처리됨</div>
                  <div className="text-2xl font-bold text-green-700">{playlistResult.processedVideos}</div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-gray-200">
                  <div className="text-xs text-gray-600">건너뜀 (중복)</div>
                  <div className="text-2xl font-bold text-gray-700">{playlistResult.skippedVideos}</div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-red-200">
                  <div className="text-xs text-red-600">실패</div>
                  <div className="text-2xl font-bold text-red-700">{playlistResult.failedVideos}</div>
                </div>
              </div>
            </div>

            {/* 동영상별 결과 */}
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4 text-gray-900">동영상별 처리 결과</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {playlistResult.results.map((video, idx) => (
                  <div
                    key={video.videoId}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      video.status === 'processed'
                        ? 'bg-green-50 border-green-200'
                        : video.status === 'skipped'
                        ? 'bg-gray-50 border-gray-200'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {idx + 1}. {video.title}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">{video.videoId}</div>
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      {video.status === 'processed' && (
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                          {video.chunksCreated}개 청크
                        </span>
                      )}
                      {video.status === 'skipped' && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                          이미 처리됨
                        </span>
                      )}
                      {video.status === 'failed' && (
                        <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded" title={video.error}>
                          실패
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 단일 동영상 결과 */}
        {result && (
          <div className="space-y-6">
            {/* AI 자동 감지 결과 */}
            {result.autoDetected && result.detectedBoundary && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
                <h2 className="text-xl font-bold mb-4 text-amber-900">
                  AI 자동 감지 결과
                </h2>
                <div className="space-y-3">
                  <div className="flex items-center gap-4 text-sm flex-wrap">
                    <span className="font-medium text-amber-800">감지된 설교 시작:</span>
                    <span className="font-mono bg-white px-3 py-1 rounded border border-amber-200 text-amber-900">
                      {formatTime(result.detectedBoundary.start)}
                    </span>
                    <span className="font-medium text-amber-800">종료:</span>
                    <span className="font-mono bg-white px-3 py-1 rounded border border-amber-200 text-amber-900">
                      {formatTime(result.detectedBoundary.end)}
                    </span>
                    <span className="font-medium text-amber-800">신뢰도:</span>
                    <span className="font-mono bg-white px-3 py-1 rounded border border-amber-200 text-amber-900">
                      {(result.detectedBoundary.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-amber-200">
                    <div className="text-sm text-amber-700 mb-2">판단 근거:</div>
                    <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-line">
                      {result.detectedBoundary.reasoning}
                    </p>
                  </div>

                  {/* 수동 보정 UI */}
                  {!showCorrection ? (
                    <button
                      onClick={startCorrection}
                      className="text-sm text-amber-600 hover:text-amber-800 underline"
                    >
                      감지 결과가 정확하지 않나요? 수동으로 보정하기
                    </button>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
                      <h3 className="text-sm font-semibold text-yellow-800 mb-3">
                        설교 구간 수동 보정
                      </h3>
                      <p className="text-xs text-yellow-700 mb-3">
                        정확한 설교 시작/종료 시간을 입력하세요. (MM:SS 또는 초 단위)
                      </p>

                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <label className="block text-xs text-yellow-700 mb-1">
                            시작 시간
                          </label>
                          <input
                            type="text"
                            value={correctedStart}
                            onChange={(e) => setCorrectedStart(e.target.value)}
                            className="w-full px-3 py-2 border border-yellow-300 rounded-lg text-sm font-mono text-gray-900 bg-white"
                            placeholder="예: 39:06"
                          />
                          {correctedStart && parseTimeToSeconds(correctedStart) !== null && (
                            <div className="text-xs text-yellow-600 mt-1">
                              = {parseTimeToSeconds(correctedStart)}초
                            </div>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs text-yellow-700 mb-1">
                            종료 시간
                          </label>
                          <input
                            type="text"
                            value={correctedEnd}
                            onChange={(e) => setCorrectedEnd(e.target.value)}
                            className="w-full px-3 py-2 border border-yellow-300 rounded-lg text-sm font-mono text-gray-900 bg-white"
                            placeholder="예: 78:57"
                          />
                          {correctedEnd && parseTimeToSeconds(correctedEnd) !== null && (
                            <div className="text-xs text-yellow-600 mt-1">
                              = {parseTimeToSeconds(correctedEnd)}초
                            </div>
                          )}
                        </div>
                      </div>

                      {correctionError && (
                        <div className="text-sm text-red-600 mb-3">
                          오류: {correctionError}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={handleCorrection}
                          disabled={correcting}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50 text-sm transition-colors"
                        >
                          {correcting ? '재추출 중...' : '보정하여 재추출'}
                        </button>
                        <button
                          onClick={() => setShowCorrection(false)}
                          disabled={correcting}
                          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 text-sm"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 요약 통계 */}
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4 text-gray-900">
                요약 통계 ({result.method})
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-amber-100 to-amber-50 p-4 rounded-xl border border-amber-200">
                  <div className="text-sm text-amber-600">전체 길이</div>
                  <div className="text-2xl font-bold text-amber-700">
                    {formatTime(result.summary.totalDuration)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-amber-100 to-amber-50 p-4 rounded-xl border border-amber-200">
                  <div className="text-sm text-amber-600">전체 세그먼트</div>
                  <div className="text-2xl font-bold text-amber-700">
                    {result.summary.totalSegments}개
                  </div>
                </div>
                <div className="bg-gradient-to-br from-green-100 to-green-50 p-4 rounded-xl border border-green-200">
                  <div className="text-sm text-green-600">설교 길이</div>
                  <div className="text-2xl font-bold text-green-700">
                    {formatTime(result.summary.sermonDuration)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-green-100 to-green-50 p-4 rounded-xl border border-green-200">
                  <div className="text-sm text-green-600">설교 세그먼트</div>
                  <div className="text-2xl font-bold text-green-700">
                    {result.summary.sermonSegments}개
                  </div>
                </div>
              </div>
            </div>

            {/* 설교 구간 */}
            {result.sermonSection && (
              <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-6">
                <h2 className="text-lg font-semibold mb-4 text-gray-900">감지된 설교 구간</h2>
                <div className="space-y-3">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-medium">시작:</span>
                    <span className="font-mono bg-amber-50 px-2 py-1 rounded border border-amber-200">
                      {formatTime(result.sermonSection.start)}
                    </span>
                    <span className="font-medium">종료:</span>
                    <span className="font-mono bg-amber-50 px-2 py-1 rounded border border-amber-200">
                      {formatTime(result.sermonSection.end)}
                    </span>
                    <span className="font-medium">길이:</span>
                    <span className="font-mono bg-green-50 px-2 py-1 rounded text-green-700 border border-green-200">
                      {formatTime(result.sermonSection.duration)}
                    </span>
                  </div>
                  <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                    <div className="text-sm text-amber-600 mb-2">미리보기 (처음 500자)</div>
                    <p className="text-sm leading-relaxed text-gray-800">{result.sermonSection.text}</p>
                  </div>
                </div>
              </div>
            )}

            {/* 청크 목록 */}
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4 text-gray-900">
                생성된 청크 ({result.totalChunks}개)
              </h2>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {result.chunks.slice(0, 10).map((chunk, idx) => (
                  <div key={idx} className="border border-amber-200 rounded-lg p-3 bg-amber-50/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">
                        청크 #{idx + 1}
                      </span>
                      <span className="text-xs text-gray-500 font-mono">
                        {formatTime(chunk.startTime)} - {formatTime(chunk.endTime)}
                        {' '}({Math.floor(chunk.duration)}초)
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {chunk.text.substring(0, 200)}
                      {chunk.text.length > 200 ? '...' : ''}
                    </p>
                    <div className="text-xs text-gray-400 mt-1">
                      {chunk.text.length}자
                    </div>
                  </div>
                ))}
                {result.chunks.length > 10 && (
                  <div className="text-center text-sm text-gray-500 py-2">
                    ... 외 {result.chunks.length - 10}개 청크
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 스타일 */}
      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
