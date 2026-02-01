/**
 * 교회 홈페이지 크롤링 및 구조 분석 모듈
 *
 * 기능:
 * 1. 홈페이지 구조 자동 분석 (AI 기반)
 * 2. 메뉴/서브페이지/게시판 감지
 * 3. Dictionary/Taxonomy/Metadata 추출
 * 4. 다중 교회 템플릿 지원
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import * as cheerio from 'cheerio'

// Supabase 클라이언트
let supabase: ReturnType<typeof createClient> | null = null

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
    )
  }
  return supabase
}

// API 클라이언트
let openai: OpenAI | null = null
let anthropic: Anthropic | null = null

async function getOpenAI(): Promise<OpenAI> {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openai
}

async function getAnthropic(): Promise<Anthropic> {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropic
}

// ============ 인터페이스 ============

export interface PageInfo {
  url: string
  title: string
  pageType: 'main' | 'menu' | 'submenu' | 'content' | 'board' | 'popup' | 'external'
  depth: number
  parentUrl?: string
  children?: PageInfo[]
  contentType?: 'static' | 'board' | 'gallery' | 'video' | 'list' | 'form'
  extractedData?: any
}

export interface SiteStructure {
  church: {
    name: string
    code: string
    url: string
  }
  navigation: PageInfo[]
  boards: PageInfo[]
  specialPages: PageInfo[]
  metadata: {
    totalPages: number
    maxDepth: number
    hasLogin: boolean
    hasMobileVersion: boolean
    technologies: string[]
  }
}

export interface DictionaryEntry {
  term: string
  category: string
  subcategory?: string
  definition?: string
  aliases?: string[]
  relatedTerms?: string[]
  metadata?: any
  sourceUrl?: string
}

export interface TaxonomyNode {
  name: string
  type: string
  children?: TaxonomyNode[]
  metadata?: any
}

export interface CrawlResult {
  success: boolean
  churchId: number
  structure?: SiteStructure
  dictionary?: DictionaryEntry[]
  taxonomy?: TaxonomyNode[]
  errors?: string[]
  crawlTime: number
}

// ============ HTML 페칭 ============

/**
 * URL에서 HTML 가져오기
 */
async function fetchHTML(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow'
    })

    if (!response.ok) {
      console.error(`[Crawler] HTTP ${response.status}: ${url}`)
      return null
    }

    const html = await response.text()
    return html
  } catch (error: any) {
    console.error(`[Crawler] 페치 실패: ${url}`, error.message)
    return null
  }
}

/**
 * URL 정규화
 */
function normalizeUrl(url: string, baseUrl: string): string {
  try {
    // 상대 경로 처리
    if (url.startsWith('/')) {
      const base = new URL(baseUrl)
      return `${base.protocol}//${base.host}${url}`
    }
    // 절대 경로 확인
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    // 프로토콜 없는 경우
    if (url.startsWith('//')) {
      return `https:${url}`
    }
    // 상대 경로
    return new URL(url, baseUrl).href
  } catch {
    return url
  }
}

/**
 * 같은 도메인인지 확인
 */
function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    const urlObj = new URL(url)
    const baseObj = new URL(baseUrl)
    return urlObj.hostname === baseObj.hostname
  } catch {
    return false
  }
}

// ============ HTML 파싱 ============

/**
 * 네비게이션 메뉴 추출
 */
function extractNavigation(html: string, baseUrl: string): PageInfo[] {
  const $ = cheerio.load(html)
  const navigation: PageInfo[] = []

  // 일반적인 네비게이션 선택자들
  const navSelectors = [
    'nav', 'header nav', '#gnb', '.gnb', '#nav', '.nav',
    '#menu', '.menu', '.main-menu', '.main_menu',
    '#header nav', '.header nav', '.navigation',
    'ul.depth1', 'ul.lnb', 'ul.gnb'
  ]

  for (const selector of navSelectors) {
    const nav = $(selector).first()
    if (nav.length === 0) continue

    // 1차 메뉴 추출
    nav.find('> ul > li, > li').each((i, el) => {
      const $li = $(el)
      const $link = $li.find('> a').first()
      const href = $link.attr('href')
      const title = $link.text().trim()

      if (!title || title.length === 0) return

      const menuItem: PageInfo = {
        url: href ? normalizeUrl(href, baseUrl) : '',
        title,
        pageType: 'menu',
        depth: 1,
        children: []
      }

      // 2차 메뉴 추출
      $li.find('> ul > li, > .sub > li, > .submenu > li').each((j, subEl) => {
        const $subLi = $(subEl)
        const $subLink = $subLi.find('> a').first()
        const subHref = $subLink.attr('href')
        const subTitle = $subLink.text().trim()

        if (!subTitle || subTitle.length === 0) return

        const subMenuItem: PageInfo = {
          url: subHref ? normalizeUrl(subHref, baseUrl) : '',
          title: subTitle,
          pageType: 'submenu',
          depth: 2,
          parentUrl: menuItem.url,
          children: []
        }

        // 3차 메뉴 추출
        $subLi.find('> ul > li').each((k, sub2El) => {
          const $sub2Li = $(sub2El)
          const $sub2Link = $sub2Li.find('> a').first()
          const sub2Href = $sub2Link.attr('href')
          const sub2Title = $sub2Link.text().trim()

          if (sub2Title && sub2Title.length > 0) {
            subMenuItem.children?.push({
              url: sub2Href ? normalizeUrl(sub2Href, baseUrl) : '',
              title: sub2Title,
              pageType: 'content',
              depth: 3,
              parentUrl: subMenuItem.url
            })
          }
        })

        menuItem.children?.push(subMenuItem)
      })

      navigation.push(menuItem)
    })

    if (navigation.length > 0) break
  }

  return navigation
}

/**
 * 게시판 감지
 */
function detectBoards(html: string, baseUrl: string): PageInfo[] {
  const $ = cheerio.load(html)
  const boards: PageInfo[] = []

  // 게시판 URL 패턴
  const boardPatterns = [
    /\/board\//i, /\/bbs\//i, /\/notice/i, /\/news/i,
    /\/gallery/i, /\/photo/i, /\/video/i,
    /board\.php/i, /bbs\.php/i, /list\.php/i
  ]

  $('a[href]').each((i, el) => {
    const href = $(el).attr('href')
    if (!href) return

    const fullUrl = normalizeUrl(href, baseUrl)
    if (!isSameDomain(fullUrl, baseUrl)) return

    for (const pattern of boardPatterns) {
      if (pattern.test(fullUrl)) {
        const title = $(el).text().trim() || fullUrl.split('/').pop() || '게시판'

        // 중복 체크
        if (!boards.find(b => b.url === fullUrl)) {
          boards.push({
            url: fullUrl,
            title,
            pageType: 'board',
            depth: 0,
            contentType: 'board'
          })
        }
        break
      }
    }
  })

  return boards
}

/**
 * 페이지 메타데이터 추출
 */
function extractPageMetadata(html: string): any {
  const $ = cheerio.load(html)

  return {
    title: $('title').text().trim(),
    description: $('meta[name="description"]').attr('content') || '',
    keywords: $('meta[name="keywords"]').attr('content') || '',
    ogTitle: $('meta[property="og:title"]').attr('content') || '',
    ogImage: $('meta[property="og:image"]').attr('content') || '',
    favicon: $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href') || '',
    charset: $('meta[charset]').attr('charset') || 'utf-8',
    viewport: $('meta[name="viewport"]').attr('content') || ''
  }
}

// ============ AI 분석 ============

/**
 * AI를 사용하여 홈페이지 구조 분석
 */
async function analyzeStructureWithAI(html: string, url: string): Promise<{
  structure: any
  dictionary: DictionaryEntry[]
  taxonomy: TaxonomyNode[]
}> {
  const prompt = `다음은 한국 교회 홈페이지의 HTML입니다. 이 사이트의 구조를 분석해주세요.

URL: ${url}
HTML (일부):
${html.substring(0, 15000)}

다음 정보를 JSON 형식으로 추출해주세요:

1. **navigation**: 메인 네비게이션 메뉴 구조
   - 1차, 2차, 3차 메뉴 계층 구조
   - 각 메뉴의 URL, 제목

2. **dictionary**: 교회 관련 용어/사전
   - 인물: 목사, 장로, 전도사 이름과 직분
   - 장소: 예배당, 교육관, 홀 등
   - 부서/사역: 교구, 선교회, 청년부 등
   - 행사: 정기 행사, 특별 행사 등

3. **taxonomy**: 조직 분류 체계
   - 조직 구조 (교구 > 구역 > 속회)
   - 사역 분류 (예배, 교육, 선교 등)

4. **metadata**: 사이트 메타정보
   - 교회명
   - 로고 URL
   - 연락처
   - 주소
   - 기술 스택 (사용된 프레임워크 등)

JSON 형식으로만 응답해주세요:
{
  "navigation": [...],
  "dictionary": [...],
  "taxonomy": [...],
  "metadata": {...}
}`

  try {
    const client = await getAnthropic()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }]
    })

    const textBlock = response.content.find(block => block.type === 'text')
    const content = textBlock ? (textBlock as any).text : '{}'

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (error) {
    console.error('[Crawler] AI 분석 실패:', error)
  }

  return { structure: null, dictionary: [], taxonomy: [] }
}

/**
 * 특정 페이지에서 인물 정보 추출
 */
async function extractPeopleFromPage(html: string, pageUrl: string, category: string): Promise<DictionaryEntry[]> {
  const prompt = `다음 HTML에서 교회 인물 정보를 추출해주세요.

URL: ${pageUrl}
카테고리: ${category}
HTML:
${html.substring(0, 10000)}

각 인물에 대해 다음 정보를 추출해주세요:
- 이름
- 직분/직책
- 소속 부서
- 연락처 (있는 경우)
- 담당 업무 (있는 경우)

JSON 배열 형식으로 응답:
[
  {
    "term": "이름",
    "category": "인물",
    "subcategory": "직분",
    "definition": "소속/담당",
    "metadata": { "phone": "...", "email": "..." }
  }
]`

  try {
    const client = await getOpenAI()
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000
    })

    const content = response.choices[0].message.content || '[]'
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const people = JSON.parse(jsonMatch[0])
      return people.map((p: any) => ({
        ...p,
        sourceUrl: pageUrl
      }))
    }
  } catch (error) {
    console.error('[Crawler] 인물 추출 실패:', error)
  }

  return []
}

// ============ 크롤링 메인 함수 ============

/**
 * 교회 홈페이지 전체 크롤링
 */
export async function crawlChurchWebsite(
  churchCode: string,
  options?: {
    maxDepth?: number
    maxPages?: number
    extractPeople?: boolean
    extractBoards?: boolean
  }
): Promise<CrawlResult> {
  const startTime = Date.now()
  const errors: string[] = []

  const maxDepth = options?.maxDepth ?? 3
  const maxPages = options?.maxPages ?? 100

  // 1. 교회 정보 조회
  const { data: church, error: churchError } = await getSupabase()
    .from('churches')
    .select('*')
    .eq('code', churchCode)
    .single()

  if (churchError || !church) {
    return {
      success: false,
      churchId: 0,
      errors: [`교회를 찾을 수 없습니다: ${churchCode}`],
      crawlTime: Date.now() - startTime
    }
  }

  console.log(`[Crawler] ${church.name} 크롤링 시작: ${church.homepage_url}`)

  // 2. 메인 페이지 크롤링
  const mainHtml = await fetchHTML(church.homepage_url)
  if (!mainHtml) {
    return {
      success: false,
      churchId: church.id,
      errors: ['메인 페이지 접근 실패'],
      crawlTime: Date.now() - startTime
    }
  }

  // 3. HTML 파싱으로 기본 구조 추출
  const navigation = extractNavigation(mainHtml, church.homepage_url)
  const boards = detectBoards(mainHtml, church.homepage_url)
  const metadata = extractPageMetadata(mainHtml)

  console.log(`[Crawler] 메뉴 ${navigation.length}개, 게시판 ${boards.length}개 발견`)

  // 4. AI 분석으로 상세 구조 추출
  const aiAnalysis = await analyzeStructureWithAI(mainHtml, church.homepage_url)

  // 5. 구조 결합
  const structure: SiteStructure = {
    church: {
      name: church.name,
      code: church.code,
      url: church.homepage_url
    },
    navigation: navigation.length > 0 ? navigation : (aiAnalysis.structure?.navigation || []),
    boards,
    specialPages: [],
    metadata: {
      totalPages: navigation.reduce((acc, m) => acc + 1 + (m.children?.length || 0), 0),
      maxDepth,
      hasLogin: mainHtml.includes('login') || mainHtml.includes('로그인'),
      hasMobileVersion: mainHtml.includes('mobile') || metadata.viewport.includes('width=device-width'),
      technologies: detectTechnologies(mainHtml)
    }
  }

  // 6. 인물 정보 추출 (선택적)
  let dictionary: DictionaryEntry[] = aiAnalysis.dictionary || []

  if (options?.extractPeople) {
    // 목사 페이지 크롤링
    const pastorPages = findPeoplePages(navigation, ['목사', '담임', '교역자', '사역자'])
    for (const page of pastorPages.slice(0, 5)) {
      const html = await fetchHTML(page.url)
      if (html) {
        const people = await extractPeopleFromPage(html, page.url, '목사')
        dictionary.push(...people)
      }
    }
  }

  // 7. DB 저장
  await saveCrawlResult(church.id, structure, dictionary, aiAnalysis.taxonomy || [])

  // 8. 크롤링 로그 저장
  await getSupabase().from('church_crawl_logs').insert({
    church_id: church.id,
    crawl_type: 'full',
    status: 'completed',
    pages_crawled: structure.metadata.totalPages,
    items_extracted: dictionary.length,
    started_at: new Date(startTime).toISOString(),
    completed_at: new Date().toISOString(),
    result_summary: { navigation: navigation.length, boards: boards.length, dictionary: dictionary.length }
  })

  return {
    success: true,
    churchId: church.id,
    structure,
    dictionary,
    taxonomy: aiAnalysis.taxonomy || [],
    errors,
    crawlTime: Date.now() - startTime
  }
}

/**
 * 기술 스택 감지
 */
function detectTechnologies(html: string): string[] {
  const technologies: string[] = []

  // 프레임워크/라이브러리 감지
  if (html.includes('jQuery') || html.includes('jquery')) technologies.push('jQuery')
  if (html.includes('React') || html.includes('react')) technologies.push('React')
  if (html.includes('Vue') || html.includes('vue')) technologies.push('Vue.js')
  if (html.includes('Angular') || html.includes('ng-')) technologies.push('Angular')
  if (html.includes('bootstrap')) technologies.push('Bootstrap')
  if (html.includes('tailwind')) technologies.push('Tailwind CSS')

  // CMS 감지
  if (html.includes('wordpress') || html.includes('wp-content')) technologies.push('WordPress')
  if (html.includes('gnuboard') || html.includes('bbs.php')) technologies.push('그누보드')
  if (html.includes('xpress') || html.includes('xe.min')) technologies.push('XpressEngine')
  if (html.includes('cafe24')) technologies.push('Cafe24')

  return technologies
}

/**
 * 인물 관련 페이지 찾기
 */
function findPeoplePages(navigation: PageInfo[], keywords: string[]): PageInfo[] {
  const pages: PageInfo[] = []

  function search(items: PageInfo[]) {
    for (const item of items) {
      for (const keyword of keywords) {
        if (item.title.includes(keyword)) {
          pages.push(item)
          break
        }
      }
      if (item.children) {
        search(item.children)
      }
    }
  }

  search(navigation)
  return pages
}

/**
 * 크롤링 결과 DB 저장
 */
async function saveCrawlResult(
  churchId: number,
  structure: SiteStructure,
  dictionary: DictionaryEntry[],
  taxonomy: TaxonomyNode[]
): Promise<void> {
  const db = getSupabase()

  // 기존 구조 삭제
  await db.from('church_site_structure').delete().eq('church_id', churchId)
  await db.from('church_dictionary').delete().eq('church_id', churchId)
  await db.from('church_taxonomy').delete().eq('church_id', churchId)

  // 네비게이션 저장
  async function saveNavigation(items: PageInfo[], parentId: number | null, depth: number) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      const { data, error } = await db.from('church_site_structure').insert({
        church_id: churchId,
        parent_id: parentId,
        page_type: item.pageType,
        title: item.title,
        url: item.url,
        depth,
        sort_order: i,
        content_type: item.contentType || 'static',
        has_children: (item.children?.length || 0) > 0
      }).select('id').single()

      if (!error && data && item.children && item.children.length > 0) {
        await saveNavigation(item.children, data.id, depth + 1)
      }
    }
  }

  await saveNavigation(structure.navigation, null, 0)

  // 게시판 저장
  for (let i = 0; i < structure.boards.length; i++) {
    const board = structure.boards[i]
    await db.from('church_site_structure').insert({
      church_id: churchId,
      page_type: 'board',
      title: board.title,
      url: board.url,
      depth: 0,
      sort_order: i,
      content_type: 'board',
      has_children: false
    })
  }

  // 사전 저장
  for (const entry of dictionary) {
    await db.from('church_dictionary').insert({
      church_id: churchId,
      term: entry.term,
      category: entry.category,
      subcategory: entry.subcategory,
      definition: entry.definition,
      aliases: entry.aliases || [],
      related_terms: entry.relatedTerms || [],
      metadata: entry.metadata,
      source_url: entry.sourceUrl
    })
  }

  // 분류 체계 저장
  async function saveTaxonomy(nodes: TaxonomyNode[], parentId: number | null, depth: number, basePath: string) {
    for (const node of nodes) {
      const path = basePath ? `${basePath}/${node.name}` : `/${node.name}`

      const { data, error } = await db.from('church_taxonomy').insert({
        church_id: churchId,
        parent_id: parentId,
        name: node.name,
        taxonomy_type: node.type,
        depth,
        path,
        metadata: node.metadata
      }).select('id').single()

      if (!error && data && node.children && node.children.length > 0) {
        await saveTaxonomy(node.children, data.id, depth + 1, path)
      }
    }
  }

  await saveTaxonomy(taxonomy, null, 0, '')
}

// ============ 조회 함수 ============

/**
 * 교회 구조 조회
 */
export async function getChurchStructure(churchCode: string): Promise<SiteStructure | null> {
  const { data: church } = await getSupabase()
    .from('churches')
    .select('id, name, code, homepage_url')
    .eq('code', churchCode)
    .single()

  if (!church) return null

  // 구조 조회
  const { data: structure } = await getSupabase()
    .from('church_site_structure')
    .select('*')
    .eq('church_id', church.id)
    .order('depth')
    .order('sort_order')

  if (!structure) return null

  // 계층 구조로 변환
  const navigation = buildTree(structure.filter(s => s.page_type !== 'board'))
  const boards = structure.filter(s => s.page_type === 'board').map(b => ({
    url: b.url || '',
    title: b.title,
    pageType: 'board' as const,
    depth: 0,
    contentType: b.content_type
  }))

  return {
    church: { name: church.name, code: church.code, url: church.homepage_url },
    navigation,
    boards,
    specialPages: [],
    metadata: {
      totalPages: structure.length,
      maxDepth: Math.max(...structure.map(s => s.depth)),
      hasLogin: false,
      hasMobileVersion: true,
      technologies: []
    }
  }
}

/**
 * 교회 사전 조회
 */
export async function getChurchDictionary(
  churchCode: string,
  category?: string
): Promise<DictionaryEntry[]> {
  const { data: church } = await getSupabase()
    .from('churches')
    .select('id')
    .eq('code', churchCode)
    .single()

  if (!church) return []

  let query = getSupabase()
    .from('church_dictionary')
    .select('*')
    .eq('church_id', church.id)

  if (category) {
    query = query.eq('category', category)
  }

  const { data } = await query.order('category').order('term')

  return (data || []).map(d => ({
    term: d.term,
    category: d.category,
    subcategory: d.subcategory,
    definition: d.definition,
    aliases: d.aliases,
    relatedTerms: d.related_terms,
    metadata: d.metadata,
    sourceUrl: d.source_url
  }))
}

/**
 * 교회 목록 조회
 */
export async function getChurches(): Promise<Array<{
  id: number
  name: string
  code: string
  homepageUrl: string
  lastCrawled?: string
}>> {
  const { data: churches } = await getSupabase()
    .from('churches')
    .select('id, name, code, homepage_url')
    .eq('is_active', true)
    .order('name')

  if (!churches) return []

  // 마지막 크롤링 시간 조회
  const result = []
  for (const church of churches) {
    const { data: log } = await getSupabase()
      .from('church_crawl_logs')
      .select('completed_at')
      .eq('church_id', church.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()

    result.push({
      id: church.id,
      name: church.name,
      code: church.code,
      homepageUrl: church.homepage_url,
      lastCrawled: log?.completed_at
    })
  }

  return result
}

/**
 * 트리 구조 빌드
 */
function buildTree(items: any[]): PageInfo[] {
  const map = new Map<number, PageInfo & { id: number }>()
  const roots: PageInfo[] = []

  // 맵 생성
  for (const item of items) {
    map.set(item.id, {
      id: item.id,
      url: item.url || '',
      title: item.title,
      pageType: item.page_type,
      depth: item.depth,
      contentType: item.content_type,
      children: []
    })
  }

  // 트리 구성
  for (const item of items) {
    const node = map.get(item.id)!
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children!.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}
