/**
 * 성경 청킹 유틸리티
 * - 청크 크기: 500자
 * - 오버랩: 20% (100자)
 * - 메타정보 포함 (총 768자 이하)
 */

import type { BibleChunk, BibleVerse } from '@/types'

// 청크 설정
const CHUNK_SIZE = 500 // 글자
const OVERLAP_RATIO = 0.2 // 20%
const OVERLAP_SIZE = Math.floor(CHUNK_SIZE * OVERLAP_RATIO) // 100자
const MAX_METADATA_SIZE = 268 // 500 + 268 = 768자

// 성경 약어
const BOOK_ABBR: Record<string, string> = {
  '창세기': '창', '출애굽기': '출', '레위기': '레', '민수기': '민', '신명기': '신',
  '여호수아': '수', '사사기': '삿', '룻기': '룻', '사무엘상': '삼상', '사무엘하': '삼하',
  '열왕기상': '왕상', '열왕기하': '왕하', '역대상': '대상', '역대하': '대하',
  '에스라': '스', '느헤미야': '느', '에스더': '에', '욥기': '욥', '시편': '시',
  '잠언': '잠', '전도서': '전', '아가': '아', '이사야': '사', '예레미야': '렘',
  '예레미야애가': '애', '에스겔': '겔', '다니엘': '단', '호세아': '호', '요엘': '욜',
  '아모스': '암', '오바댜': '옵', '요나': '욘', '미가': '미', '나훔': '나',
  '하박국': '합', '스바냐': '습', '학개': '학', '스가랴': '슥', '말라기': '말',
  '마태복음': '마', '마가복음': '막', '누가복음': '눅', '요한복음': '요',
  '사도행전': '행', '로마서': '롬', '고린도전서': '고전', '고린도후서': '고후',
  '갈라디아서': '갈', '에베소서': '엡', '빌립보서': '빌', '골로새서': '골',
  '데살로니가전서': '살전', '데살로니가후서': '살후', '디모데전서': '딤전',
  '디모데후서': '딤후', '디도서': '딛', '빌레몬서': '몬', '히브리서': '히',
  '야고보서': '약', '베드로전서': '벧전', '베드로후서': '벧후',
  '요한1서': '요일', '요한2서': '요이', '요한3서': '요삼', '유다서': '유',
  '요한계시록': '계'
}

// 등장인물 키워드
const CHARACTER_KEYWORDS: Record<string, string[]> = {
  '하나님': ['하나님', '여호와', '주', '전능자', '창조주', '아버지'],
  '예수': ['예수', '그리스도', '주님', '메시아', '구주', '어린양', '인자'],
  '성령': ['성령', '성신', '보혜사'],
  '아담': ['아담'], '하와': ['하와', '이브'], '노아': ['노아'],
  '아브라함': ['아브라함', '아브람'], '사라': ['사라', '사래'],
  '이삭': ['이삭'], '야곱': ['야곱', '이스라엘'], '요셉': ['요셉'],
  '모세': ['모세'], '다윗': ['다윗'], '솔로몬': ['솔로몬'],
  '엘리야': ['엘리야'], '엘리사': ['엘리사'],
  '이사야': ['이사야'], '예레미야': ['예레미야'],
  '에스겔': ['에스겔'], '다니엘': ['다니엘'],
  '베드로': ['베드로', '시몬'], '바울': ['바울', '사울'],
  '요한': ['요한'], '마리아': ['마리아'], '마르다': ['마르다']
}

// 주제 키워드
const THEME_KEYWORDS: Record<string, string[]> = {
  '창조': ['창조', '지으', '만드'],
  '구원': ['구원', '구하', '건지', '해방', '속량'],
  '사랑': ['사랑', '사랑하', '애정', '자비', '긍휼'],
  '믿음': ['믿음', '신뢰', '의지', '확신'],
  '희망': ['희망', '소망', '기대'],
  '평안': ['평안', '평강', '안식', '쉼'],
  '기쁨': ['기쁨', '즐거움', '기뻐', '즐거워'],
  '감사': ['감사', '찬송', '찬양', '영광'],
  '회개': ['회개', '돌이키', '뉘우치'],
  '용서': ['용서', '사하', '용납'],
  '순종': ['순종', '따르', '지키'],
  '기도': ['기도', '간구', '부르짖', '구하'],
  '지혜': ['지혜', '명철', '깨달', '슬기'],
  '의': ['의', '정의', '공의', '공평', '정직'],
  '인내': ['인내', '참', '견디', '기다리'],
  '겸손': ['겸손', '낮추'],
  '섬김': ['섬기', '종', '봉사'],
  '심판': ['심판', '벌', '진노'],
  '약속': ['약속', '언약', '맹세'],
  '영생': ['영생', '영원', '천국', '하늘나라']
}

// 감정 키워드
const EMOTION_KEYWORDS: Record<string, string[]> = {
  '위로': ['위로', '위안', '평안', '두려워하지'],
  '기쁨': ['기쁨', '즐거움', '기뻐', '즐거워'],
  '평강': ['평강', '평안', '고요', '안식'],
  '희망': ['희망', '소망', '기대'],
  '사랑': ['사랑', '자비', '긍휼'],
  '힘': ['힘', '능력', '강하', '용기'],
  '인도': ['인도', '길', '가르치', '인도하'],
  '감사': ['감사', '찬송', '찬양'],
  '치유': ['치료', '낫', '고치', '회복'],
  '용서': ['용서', '사하']
}

function findKeywords(text: string, keywords: Record<string, string[]>): string[] {
  const found: string[] = []
  for (const [key, values] of Object.entries(keywords)) {
    if (values.some(v => text.includes(v))) {
      found.push(key)
    }
  }
  return found
}

function extractKeywords(text: string): string[] {
  // 빈도 기반 키워드 추출 (간단 버전)
  const words = text.match(/[가-힣]{2,}/g) || []
  const freq: Record<string, number> = {}

  const stopwords = new Set(['이', '그', '저', '것', '수', '등', '및', '또'])

  for (const word of words) {
    if (!stopwords.has(word)) {
      freq[word] = (freq[word] || 0) + 1
    }
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word)
}

interface VersePosition {
  verseNum: number
  start: number
  end: number
}

export function createChunks(
  testament: string,
  bookName: string,
  bookNumber: number,
  chapter: number,
  verses: Record<number, string>
): BibleChunk[] {
  const chunks: BibleChunk[] = []
  const verseNums = Object.keys(verses).map(Number).sort((a, b) => a - b)

  if (verseNums.length === 0) return chunks

  // 전체 텍스트와 절 위치 매핑
  let fullText = ''
  const positions: VersePosition[] = []

  for (const verseNum of verseNums) {
    const start = fullText.length
    const verseText = verses[verseNum]
    fullText += verseText + ' '
    const end = fullText.length

    positions.push({ verseNum, start, end })
  }

  // 청킹
  let chunkId = 0
  let startPos = 0

  while (startPos < fullText.length) {
    const endPos = Math.min(startPos + CHUNK_SIZE, fullText.length)
    const chunkText = fullText.slice(startPos, endPos).trim()

    if (!chunkText) break

    // 청크에 포함된 절 찾기
    const versesInChunk = positions.filter(
      p => !(p.end <= startPos || p.start >= endPos)
    )

    if (versesInChunk.length === 0) {
      startPos = endPos
      continue
    }

    const verseStart = Math.min(...versesInChunk.map(v => v.verseNum))
    const verseEnd = Math.max(...versesInChunk.map(v => v.verseNum))

    // 메타정보 추출
    const characters = findKeywords(chunkText, CHARACTER_KEYWORDS).slice(0, 3)
    const themes = findKeywords(chunkText, THEME_KEYWORDS).slice(0, 3)
    const keywords = extractKeywords(chunkText).slice(0, 3)
    const emotions = findKeywords(chunkText, EMOTION_KEYWORDS).slice(0, 2)

    // 참조
    const bookAbbr = BOOK_ABBR[bookName] || bookName.slice(0, 2)
    const referenceFull = verseStart === verseEnd
      ? `${bookName} ${chapter}:${verseStart}`
      : `${bookName} ${chapter}:${verseStart}-${verseEnd}`
    const referenceShort = verseStart === verseEnd
      ? `${bookAbbr} ${chapter}:${verseStart}`
      : `${bookAbbr} ${chapter}:${verseStart}-${verseEnd}`

    // 메타정보 텍스트 생성
    const metaParts = [`[${referenceFull}]`]
    if (characters.length) metaParts.push(`등장인물: ${characters.join(', ')}`)
    if (themes.length) metaParts.push(`주제: ${themes.join(', ')}`)
    if (keywords.length) metaParts.push(`핵심: ${keywords.join(', ')}`)

    let metaText = metaParts.join(' | ')

    // 메타정보 길이 제한
    if (metaText.length > MAX_METADATA_SIZE) {
      metaText = metaText.slice(0, MAX_METADATA_SIZE - 3) + '...'
    }

    const contentWithMetadata = `${metaText}\n\n${chunkText}`

    // 청크 생성
    const chunk: BibleChunk = {
      id: `${testament[0]}${bookNumber.toString().padStart(2, '0')}_${chapter.toString().padStart(3, '0')}_${chunkId.toString().padStart(3, '0')}`,
      testament,
      bookName,
      bookAbbr,
      bookNumber,
      chapter,
      verseStart,
      verseEnd,
      referenceFull,
      referenceShort,
      content: chunkText,
      contentWithMetadata,
      characters,
      themes,
      keywords,
      emotions,
      charCount: chunkText.length,
      verseCount: versesInChunk.length
    }

    chunks.push(chunk)
    chunkId++

    // 다음 청크 (오버랩 적용)
    startPos = endPos - OVERLAP_SIZE

    if (endPos >= fullText.length) break
  }

  return chunks
}

// 전체 성경 청킹
export async function createAllChunks(bibleData: any): Promise<BibleChunk[]> {
  const allChunks: BibleChunk[] = []

  for (const testament of ['구약', '신약']) {
    const books = bibleData[testament]

    for (const [bookName, bookData] of Object.entries(books) as any) {
      const bookNumber = bookData.book_number
      const chapters = bookData.chapters

      for (const [chapterNum, verses] of Object.entries(chapters) as any) {
        const chunks = createChunks(
          testament,
          bookName,
          bookNumber,
          parseInt(chapterNum),
          verses
        )

        allChunks.push(...chunks)
      }
    }
  }

  return allChunks
}
