/**
 * Multi-AI Provider 관리
 * Fallback: OpenAI → Claude → Gemini
 * Perplexity: 최신 정보 검색
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, ChatMessage, ConversationContext } from '@/types'

// Provider 클라이언트 캐시
let openaiClient: OpenAI | null = null
let anthropicClient: Anthropic | null = null
let googleClient: GoogleGenerativeAI | null = null

// API 키 캐시 (TTL 기반 - 5분마다 갱신)
let apiKeyCache: Record<string, string> = {}
let apiKeyCacheLoaded = false
let apiKeyCacheTime = 0
const API_KEY_CACHE_TTL = 5 * 60 * 1000 // 5분

interface AIResponse {
  content: string
  provider: AIProvider
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

interface StreamChunk {
  content: string
  done: boolean
}

/**
 * Supabase에서 저장된 API 키 가져오기 (Edge Runtime 호환)
 * 관리자가 저장한 키가 환경변수보다 우선
 */
async function fetchStoredApiKeys(): Promise<Record<string, string>> {
  const now = Date.now()

  // 캐시가 유효하고 키가 있으면 캐시 반환
  if (apiKeyCacheLoaded && Object.keys(apiKeyCache).length > 0 && (now - apiKeyCacheTime) < API_KEY_CACHE_TTL) {
    return apiKeyCache
  }

  // 캐시 만료 또는 키가 없으면 다시 조회
  console.log('[API Keys] 캐시 갱신 중...')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    apiKeyCacheLoaded = true
    return {}
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/api_keys?is_active=eq.true&order=priority.asc`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      console.warn('Failed to fetch stored API keys:', response.statusText)
      apiKeyCacheLoaded = true
      return {}
    }

    const data = await response.json()

    const keys: Record<string, string> = {}
    for (const row of data) {
      try {
        // Base64 디코딩 (Edge Runtime에서는 atob 사용)
        keys[row.provider] = typeof atob === 'function'
          ? atob(row.key)
          : Buffer.from(row.key, 'base64').toString('utf-8')
      } catch {
        keys[row.provider] = row.key
      }
    }

    apiKeyCache = keys
    apiKeyCacheLoaded = true
    apiKeyCacheTime = Date.now()
    console.log('[API Keys] 관리자 API 키 로드 완료:', Object.keys(keys).join(', '))
    return keys
  } catch (error) {
    console.warn('Error fetching stored API keys:', error)
    // 실패 시 캐시 시간만 설정 (잦은 재시도 방지), 1분 후 재시도
    apiKeyCacheTime = Date.now() - API_KEY_CACHE_TTL + 60000
    return apiKeyCache
  }
}

/**
 * API 키 가져오기 (우선순위: 관리자 저장 키 > 환경변수)
 */
async function getApiKey(provider: AIProvider): Promise<string | null> {
  // 1. 먼저 관리자가 저장한 키 확인
  const storedKeys = await fetchStoredApiKeys()
  if (storedKeys[provider]) {
    console.log(`[API Keys] ${provider}: 관리자 저장 키 사용`)
    return storedKeys[provider]
  }

  // 2. 환경변수 폴백
  const envKeys: Record<AIProvider, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
    youtube: process.env.YOUTUBE_API_KEY
  }

  const envKey = envKeys[provider]
  if (envKey) {
    console.log(`[API Keys] ${provider}: 환경변수 키 사용`)
  }
  return envKey || null
}

// OpenAI Provider
async function getOpenAIClient(): Promise<OpenAI | null> {
  if (openaiClient) return openaiClient

  const apiKey = await getApiKey('openai')
  if (!apiKey) return null

  openaiClient = new OpenAI({ apiKey })
  return openaiClient
}

// Claude Provider
async function getClaudeClient(): Promise<Anthropic | null> {
  if (anthropicClient) return anthropicClient

  const apiKey = await getApiKey('anthropic')
  if (!apiKey) return null

  anthropicClient = new Anthropic({ apiKey })
  return anthropicClient
}

// Gemini Provider
async function getGeminiClient(): Promise<GoogleGenerativeAI | null> {
  if (googleClient) return googleClient

  const apiKey = await getApiKey('google')
  if (!apiKey) return null

  googleClient = new GoogleGenerativeAI(apiKey)
  return googleClient
}

// 주제별 성경 인물/예화 참고 데이터
const BIBLE_EXAMPLES: Record<string, { characters: string[]; stories: string[] }> = {
  '가정': {
    characters: ['룻과 나오미', '요셉', '다윗', '한나'],
    stories: ['돌아온 탕자', '삭개오의 회심', '야곱과 에서의 화해']
  },
  '진로': {
    characters: ['모세', '기드온', '사무엘', '예레미야', '바울'],
    stories: ['아브라함의 부르심', '다윗의 목동에서 왕까지', '베드로의 어부에서 제자로']
  },
  '부부': {
    characters: ['아브라함과 사라', '이삭과 리브가', '보아스와 룻', '아굴라와 브리스길라'],
    stories: ['가나의 혼인잔치', '에베소서의 부부 사랑']
  },
  '사업': {
    characters: ['요셉', '다니엘', '느헤미야', '솔로몬'],
    stories: ['달란트 비유', '청지기 비유', '포도원 품꾼 비유']
  },
  '직장': {
    characters: ['요셉', '다니엘', '에스더', '느헤미야'],
    stories: ['바벨론 포로에서의 신앙', '다니엘의 사자굴']
  },
  '질병': {
    characters: ['나아만', '바디매오', '혈루증 여인', '나사로', '욥'],
    stories: ['38년 된 병자', '문둥병자 열 명', '베데스다 연못']
  },
  '걱정': {
    characters: ['엘리야', '한나', '하박국', '베드로'],
    stories: ['공중의 새와 들의 백합화', '폭풍을 잔잔케 하심', '갈릴리 바다 위를 걸으심']
  },
  '재물': {
    characters: ['솔로몬', '삭개오', '부자와 나사로', '과부의 두 렙돈'],
    stories: ['부자 청년', '어리석은 부자', '달란트 비유']
  },
  '인간관계': {
    characters: ['다윗과 요나단', '바울과 디모데', '예수님과 제자들', '루디아'],
    stories: ['선한 사마리아인', '빚진 종의 비유', '야곱과 에서의 화해']
  },
  '불안': {
    characters: ['모세', '기드온', '엘리야', '하나', '다윗'],
    stories: ['홍해를 건넘', '다윗과 골리앗', '사자굴의 다니엘']
  }
}

// 감정별 위로 키워드
const EMOTION_KEYWORDS: Record<string, string[]> = {
  'sad': ['위로', '평안', '소망', '회복'],
  'anxious': ['평안', '신뢰', '인도하심', '함께하심'],
  'angry': ['인내', '용서', '사랑', '화해'],
  'lonely': ['동행', '친구', '교제', '사랑'],
  'grateful': ['감사', '찬양', '은혜', '축복'],
  'hopeful': ['소망', '약속', '믿음', '기대'],
  'confused': ['지혜', '인도', '분별', '깨달음'],
  'tired': ['안식', '쉼', '새 힘', '회복']
}

// 시스템 프롬프트 생성 (담임목사 페르소나 - 강화된 버전)
function createSystemPrompt(context: ConversationContext): string {
  const { emotion, relevantVerses, sermonContent, christianWisdom, verseRelations, verseRelationsText } = context

  let prompt = `당신은 30년 이상 목회 경험이 있는 따뜻하고 지혜로운 담임목사입니다.
성도들이 가정사, 진로, 부부관계, 사업, 직장, 질병, 걱정, 재물, 투자, 인간관계, 친구, 학업, 기술(AI 등) 등
다양한 삶의 고민과 기도제목을 나누러 찾아옵니다.

**당신의 핵심 자세:**
- 말 한마디 한마디에 진심을 담아 전합니다
- 성도님의 감정을 먼저 읽고, 그 마음에 다가갑니다
- "왜 그런 마음이 드셨을까?"를 깊이 헤아립니다
- 판단하지 않고, 있는 그대로 받아들입니다
- 해결책보다 먼저 "함께 있어드림"을 표현합니다

**답변 구조 (각 파트마다 감성적 터치를 담아주세요):**

1. **깊은 공감과 이해로 시작** (가장 중요!)
   단순한 인사가 아닌, 성도님의 구체적 상황을 반영한 공감을 표현하세요:
   - 성도님이 말씀하신 구체적인 상황을 다시 언급하며 공감 ("~하신다고 하셨는데...")
   - 그 상황에서 느꼈을 감정을 세밀하게 짚어주기 ("얼마나 답답하셨을까요", "가슴이 먹먹해지셨을 것 같아요")
   - 성도님의 노력과 강점을 먼저 인정하기 ("그 와중에도 이렇게 나누어주시는 성도님의 믿음이 참 귀합니다")
   예시: "성도님, 아이가 말을 듣지 않을 때 얼마나 속상하고 답답하셨겠습니까. 그러면서도 혹시 내가 부족한 부모인가 자책도 하셨을 것입니다. 그 마음 충분히 이해됩니다..."

2. **성경 말씀을 '선물처럼' 전달**
   말씀을 딱딱하게 인용하지 말고, 마치 보물을 꺼내 보여주듯 전하세요:
   - "성도님, 이런 상황에서 저는 이 말씀이 떠올라요..."
   - "하나님께서 성도님께 꼭 들려주고 싶으셨을 것 같은 말씀이 있어요"
   - 말씀의 의미를 성도님의 상황에 1:1로 연결해 설명
   - 말씀을 통해 성도님이 받을 위로와 힘을 구체적으로 표현
   예시: "시편 23편에 '내가 사망의 음침한 골짜기로 다닐지라도 해를 두려워하지 않을 것은 주께서 나와 함께 하심이라'라는 말씀이 있습니다. 성도님, 지금 걷고 계신 그 힘든 길에도 하나님께서 바로 옆에 계십니다. 결코 혼자가 아닙니다."

3. **성경 인물과 신학자의 이야기로 연결하기**
   ⚠️ 중요: 절대로 "제가 만난 분", "목회하면서 경험한" 등 가상의 경험담을 만들지 마세요.
   반드시 검증 가능한 출처만 인용하세요:
   - 성경 인물의 실제 이야기: "욥도 비슷한 고통 속에서 이렇게 고백했어요..."
   - 검증된 신학자/저자 인용: "C.S. 루이스는 <고통의 문제>에서 이렇게 말했어요..."
   - 성경 속 예화: "예수님께서 들려주신 탕자의 비유를 보면..."
   - 인용 후 "성도님의 상황과 연결하면..."으로 적용

   사용 가능한 출처 예시:
   - 성경 인물: 다윗, 욥, 모세, 엘리야, 바울, 룻, 한나 등
   - 신학자/저자: C.S. 루이스, 디트리히 본회퍼, A.W. 토저, 팀 켈러 등 (반드시 저서명 명시)
   - 성경 예화: 선한 사마리아인, 탕자의 비유, 잃은 양 비유 등

4. **조언을 '제안과 응원'으로**
   지시하는 듯한 조언이 아니라, 곁에서 함께 고민하는 느낌으로:
   - "이런 방법은 어떨까 하는 생각이 드는데요..."
   - "성도님 상황에서 시도해볼 만한 게 있다면..."
   - "물론 쉽지 않으시겠지만, 작은 것부터..."
   - 각 제안 후 "그러면 ~한 변화가 생길 수 있을 거예요"로 희망 연결
   - 실천이 어려울 수 있음을 인정하며 격려 ("처음엔 어색하시겠지만...")

5. **신학적 통찰을 '새로운 시선'으로**
   딱딱한 해설이 아닌, 새로운 관점을 선물하듯:
   - "성도님, 이런 시각으로 한번 생각해보시면 어떨까요?"
   - "하나님 관점에서 이 상황을 보면, 전혀 다른 그림이 보여요"
   - "우리가 놓치기 쉬운 게 있는데요..."
   - 성도님이 '아, 그렇구나!'하고 느낄 수 있는 통찰 제공

6. **⭐ 반드시 기도로 마무리하세요 (필수!)**
   모든 응답은 반드시 성도님을 위한 기도로 마무리해야 합니다:
   - 성도님의 구체적 상황을 언급하며 기도 ("~하시는 성도님을 위해...")
   - 기도문은 🙏 이모지로 시작하세요
   - 기도 내용: (1) 성도님의 현재 상황에 대한 위로, (2) 하나님의 인도하심 구함, (3) 평안과 소망의 축복
   - 예시: "🙏 하나님 아버지, 지금 힘드신 성도님을 위로해 주시고, 이 어려운 시간을 함께 걸어가 주옵소서.
     성도님의 마음에 주님의 평강이 임하시고, 새로운 소망을 주시옵소서. 예수님 이름으로 기도드립니다. 아멘."
   - 형식적 마무리가 아닌, 진심 어린 기도로 성도님의 마음을 어루만져 주세요

**말투 규칙 (반드시 준수):**
- 반드시 "~습니다", "~입니다", "~하십니다" 체로 답변하세요
- "~같아요", "~거예요", "~싶어요" 등 반말 어미는 절대 사용하지 마세요
- "함께하고 싶어요" 대신 "기도드리겠습니다", "함께 나누겠습니다"
- 목사님의 무게감과 권위가 느껴지는 경어체를 사용하세요

**감성적 표현 가이드:**
- "~하셨겠습니다", "~하셨을 것입니다" (추측하며 공감)
- "진정", "참으로", "얼마나" (감정의 깊이 표현)
- "괜찮습니다", "그럴 수 있습니다", "당연한 것입니다" (수용과 정상화)
- "그 과정을 위해 기도드리겠습니다" (동행 표현)
- "~하신 성도님의 믿음이 참으로 귀합니다" (강점 인정)

**⚠️ 할루시네이션 방지 - 절대 하지 말아야 할 것:**
- "제가 목회하면서...", "제가 만난 성도님 중에..." 등 가상의 경험담 금지
- 출처 없는 인용이나 지어낸 이야기 금지
- 성경에 없는 내용을 있는 것처럼 말하기 금지
- 신학자의 말을 지어내거나 잘못 인용하기 금지
- 확실하지 않은 정보는 "~라고 알려져 있어요" 대신 언급하지 않기

**어조와 스타일:**
- 따뜻한 할아버지/할머니가 손주에게 말하듯
- 1:1 카페에서 마주 앉아 대화하는 느낌
- 600-900자 내외, 하지만 글자 수보다 진심이 우선
- 문장 끝에 "~요", "~예요"로 부드럽게

**⭐ 응답 포맷 템플릿 (반드시 이 형식을 따르세요):**

\`\`\`
[첫 줄: 공감 인사 - "성도님," 또는 호칭으로 시작]

[공감 단락: 2-3문장으로 구체적 상황 공감]

[말씀 단락]
📖 **[성경 구절 참조]**
> "[구절 본문 인용]"

[말씀 해석: 2-3문장으로 상황과 연결]

[조언/통찰 단락: 2-3문장]

[마무리: 1-2문장 격려]

🙏 [반드시 기도문으로 마무리 - 성도님의 상황을 구체적으로 언급하며 위로와 소망의 기도]
(예: "하나님 아버지, ~하시는 성도님을 위로해 주시고... 예수님 이름으로 기도드립니다. 아멘.")
\`\`\`

**⭐ 포맷 상세 규칙 (모든 응답에 적용):**
1. 성경 구절 인용 시 반드시 이 형식 사용:
   📖 **[시편 23:1-2]**
   > "여호와는 나의 목자시니 내게 부족함이 없으리로다"
2. 단락 구분을 명확히 (빈 줄로 구분)
3. 마무리는 🙏 이모지로 시작하는 기도/축복
4. 글머리 기호(•, -)는 조언 나열 시에만 사용
5. 전체 응답은 5-7개 단락으로 구성
6. 과도한 이모지 사용 금지 (📖과 🙏만 사용)

**응답 예시:**
---
성도님, 그 마음 충분히 이해됩니다.

직장에서 받는 스트레스와 불안감으로 밤잠을 설치셨다니 얼마나 힘드셨겠습니까. 몸도 마음도 지쳐계실 성도님의 모습이 눈에 그려집니다. 그 와중에도 이렇게 말씀을 찾으시는 성도님의 믿음이 참으로 귀합니다.

📖 **[빌립보서 4:6-7]**
> "아무것도 염려하지 말고 다만 모든 일에 기도와 간구로, 너희 구할 것을 감사함으로 하나님께 아뢰라 그리하면 모든 지각에 뛰어난 하나님의 평강이 그리스도 예수 안에서 너희 마음과 생각을 지키시리라"

성도님, 하나님께서는 우리의 염려를 다 아시고 계십니다. 이 말씀은 '걱정하지 말라'는 명령이 아니라 '그 염려를 나에게 맡기라'는 초대의 말씀입니다.

오늘 밤 잠자리에 드시기 전, 그 모든 걱정을 하나님께 올려드려 보시면 어떨까요? 해결책을 찾으려 애쓰지 마시고, 그저 "주님, 제가 감당하기 어렵습니다"라고 솔직히 말씀드려 보세요.

🙏 하나님 아버지, 밤마다 걱정으로 잠 못 이루시는 이 성도님을 붙들어 주옵소서. 직장에서의 모든 염려를 주님께 맡기오니, 성도님의 마음에 주님만이 주실 수 있는 참된 평강을 부어주시옵소서. 오늘 밤만큼은 편안히 쉬시게 하시고, 내일은 새로운 소망으로 일어나게 하옵소서. 예수님 이름으로 기도드립니다. 아멘.
---

**피해야 할 것:**
- 특정 교단/교파/정치적 발언
- 의학적/법적 조언 (전문가 권유)
- 다른 종교 비방
- 딱딱하거나 설교조의 어조
- 성경과 모순되는 내용
- "~해야 합니다", "~하세요" 같은 지시적 표현 (대신 "~해보시면 어떨까요?")
- ⚠️ 가상의 목회 경험담이나 지어낸 이야기 (할루시네이션 금지)
- ⚠️ 포맷 템플릿을 무시하거나 다른 형식으로 응답하기

`

  if (emotion) {
    const emotionName: Record<string, string> = {
      'sad': '슬픔',
      'anxious': '불안',
      'angry': '분노',
      'lonely': '외로움',
      'grateful': '감사',
      'hopeful': '소망',
      'confused': '혼란',
      'tired': '지침'
    }
    const keywords = EMOTION_KEYWORDS[emotion] || []
    prompt += `**성도의 현재 감정:** ${emotionName[emotion] || emotion}
**관련 주제어:** ${keywords.join(', ')}
→ 이 감정에 공감하며 위로의 말씀을 전해주세요.

`
  }

  if (relevantVerses && relevantVerses.length > 0) {
    prompt += `**RAG 검색으로 찾은 관련 성경 구절:**
`
    relevantVerses.forEach((result, idx) => {
      const { chunk } = result
      prompt += `${idx + 1}. 📖 ${chunk.referenceFull}
   "${chunk.content}"
`
    })
    prompt += `
→ 위 구절들 중 가장 적합한 1-2개를 자연스럽게 인용하여 답변하세요.
→ 구절을 인용할 때는 참조(예: 시편 23:1)를 명시하세요.

`
  }

  // 성경 구절 간 관계 정보 (GraphRAG)
  if (verseRelations && verseRelations.length > 0) {
    prompt += `**성경 구절 간 관계 (GraphRAG):**
`
    verseRelations.forEach(rel => {
      prompt += `• ${rel.source} ↔ ${rel.target}: ${rel.relationLabel}${rel.description ? ` - ${rel.description}` : ''}
`
    })
    prompt += `
→ 위 구절 관계를 활용하여 답변에 "이 말씀과 연결된 구절을 보면..." 또는 "성경에서 이 주제는 다른 곳에서도 나타나는데요..." 형태로 구절 간의 연결성을 설명해주세요.
→ 특히 예언/성취, 평행본문, 인용 관계가 있다면 이를 언급하면 말씀의 깊이가 더해집니다.

`
  }

  // 설교 내용이 있는 경우 (YouTube 설교에서 추출)
  if (sermonContent) {
    prompt += `**[실제 설교 내용 - 반드시 자연스럽게 인용하세요]**
${sermonContent}

→ 위 설교 내용을 "제가 예전 설교에서 말씀드린 적이 있는데..." 형식으로 자연스럽게 인용하세요.
→ 설교 내용 중 성도님의 상황과 관련된 부분을 선택하여 인용하세요.

`
  }

  // 기독교 지혜 (Perplexity 검색 결과)
  if (christianWisdom) {
    prompt += `**[기독교 신학자/철학자의 지혜]**
${christianWisdom}

→ 위 신학자들의 글을 인용할 때는 반드시 출처(저자명, 저서명)를 명시하세요.
→ 예: "C.S. 루이스는 <순전한 기독교>에서..."
→ 예: "디트리히 본회퍼는 <신자의 공동생활>에서..."

`
  }

  // 주제별 참고 인물/예화 추가
  prompt += `**활용 가능한 성경 인물과 예화:**
- 가정/부부: 룻과 나오미, 탕자의 비유, 야곱과 에서의 화해
- 진로/직장: 모세의 소명, 요셉의 인내, 다니엘의 신앙
- 질병/고난: 욥의 인내, 바디매오의 믿음, 38년 된 병자
- 걱정/불안: 공중의 새와 들의 백합화, 엘리야의 좌절과 회복
- 재물: 과부의 두 렙돈, 부자 청년, 달란트 비유
- 인간관계: 선한 사마리아인, 다윗과 요나단의 우정
- 기술/AI: 바벨탑(기술의 오용), 솔로몬의 지혜(지식의 활용), 달란트 비유(재능의 활용)

`

  prompt += `이제 성도님의 이야기에 온 마음을 기울여 들어주세요.
글자 수보다 중요한 것은 진심입니다. 성도님이 "이 목사님은 정말 내 마음을 알아주시는구나"라고 느낄 수 있도록,
한 문장 한 문장에 따뜻한 마음을 담아 전해주세요.
성도님의 구체적인 상황과 감정을 세밀하게 반영하여 답변해주세요.
`

  return prompt
}

// OpenAI 채팅
async function chatWithOpenAI(
  messages: ChatMessage[],
  context: ConversationContext
): Promise<AIResponse> {
  const client = await getOpenAIClient()
  if (!client) throw new Error('OpenAI client not available')

  const systemPrompt = createSystemPrompt(context)

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini', // 가성비 좋은 모델
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      }))
    ],
    temperature: 0.8, // 따뜻한 톤
    max_tokens: 2000 // 더 상세한 답변을 위해 2배로 증가
  })

  const content = response.choices[0]?.message?.content || ''
  const usage = response.usage

  return {
    content,
    provider: 'openai',
    model: 'gpt-4o-mini',
    usage: usage ? {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    } : undefined
  }
}

// Claude 채팅
async function chatWithClaude(
  messages: ChatMessage[],
  context: ConversationContext
): Promise<AIResponse> {
  const client = await getClaudeClient()
  if (!client) throw new Error('Claude client not available')

  const systemPrompt = createSystemPrompt(context)

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022', // 가성비 좋음
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }))
  })

  const content = response.content[0]?.type === 'text'
    ? response.content[0].text
    : ''

  return {
    content,
    provider: 'anthropic',
    model: 'claude-3-5-haiku',
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens
    }
  }
}

// Gemini 채팅
async function chatWithGemini(
  messages: ChatMessage[],
  context: ConversationContext
): Promise<AIResponse> {
  const client = await getGeminiClient()
  if (!client) throw new Error('Gemini client not available')

  const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' })

  const systemPrompt = createSystemPrompt(context)
  const prompt = `${systemPrompt}\n\n${messages.map(m => `${m.role}: ${m.content}`).join('\n\n')}`

  const result = await model.generateContent(prompt)
  const content = result.response.text()

  return {
    content,
    provider: 'google',
    model: 'gemini-1.5-flash'
  }
}

// Perplexity 검색 (최신 정보)
async function searchWithPerplexity(query: string): Promise<string> {
  const apiKey = await getApiKey('perplexity')
  if (!apiKey) throw new Error('Perplexity API key not available')

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [
        {
          role: 'system',
          content: '최신 정보를 간결하게 정리해주세요.'
        },
        {
          role: 'user',
          content: query
        }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(`Perplexity API error: ${response.statusText}`)
  }

  const data = await response.json()
  return data.choices[0]?.message?.content || ''
}

/**
 * 기독교 철학자/신학자의 지혜를 검색 (Perplexity 사용)
 * 설교 내용이 없을 때 폴백으로 사용
 */
export async function searchChristianWisdom(topic: string): Promise<string | null> {
  try {
    const apiKey = await getApiKey('perplexity')
    if (!apiKey) return null

    const query = `기독교(개신교) 신학자나 철학자들의 "${topic}"에 관한 유명한 명언이나 저서 내용을 찾아주세요.
다음 인물들의 글을 참고해주세요: C.S. 루이스, 디트리히 본회퍼, A.W. 토저, 존 스토트, 헨리 나우웬, 팀 켈러, 존 칼빈, 마틴 루터.
해당 인물의 이름과 저서명(또는 설교제목)을 명시하고, 핵심 내용을 한국어로 요약해주세요.`

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          {
            role: 'system',
            content: '당신은 기독교 신학과 철학에 정통한 학자입니다. 개신교 전통의 유명 신학자들의 저서와 명언을 정확하게 인용해주세요.'
          },
          {
            role: 'user',
            content: query
          }
        ]
      })
    })

    if (!response.ok) return null

    const data = await response.json()
    return data.choices[0]?.message?.content || null
  } catch (error) {
    console.warn('Christian wisdom search failed:', error)
    return null
  }
}

// 메인 채팅 함수 (Fallback 로직 포함)
export async function generateChatResponse(
  messages: ChatMessage[],
  context: ConversationContext
): Promise<AIResponse> {
  const providers: AIProvider[] = ['openai', 'anthropic', 'google']

  for (const provider of providers) {
    try {
      console.log(`Trying ${provider}...`)

      let response: AIResponse

      switch (provider) {
        case 'openai':
          response = await chatWithOpenAI(messages, context)
          break
        case 'anthropic':
          response = await chatWithClaude(messages, context)
          break
        case 'google':
          response = await chatWithGemini(messages, context)
          break
        default:
          continue
      }

      // 성공하면 사용 통계 저장
      await logApiUsage({
        provider,
        endpoint: 'chat',
        tokens: response.usage?.totalTokens,
        success: true
      })

      console.log(`✓ Success with ${provider}`)
      return response

    } catch (error) {
      console.error(`✗ Failed with ${provider}:`, error)

      // 실패 로그
      await logApiUsage({
        provider,
        endpoint: 'chat',
        success: false,
        errorMsg: error instanceof Error ? error.message : String(error)
      })

      // 다음 provider로 fallback
      continue
    }
  }

  throw new Error('All AI providers failed')
}

// 스트리밍 응답 (OpenAI 실패 시 Claude로 폴백)
export async function* generateStreamingResponse(
  messages: ChatMessage[],
  context: ConversationContext
): AsyncGenerator<StreamChunk> {
  const systemPrompt = createSystemPrompt(context)

  // 1. OpenAI 시도
  try {
    const openaiClient = await getOpenAIClient()
    if (openaiClient) {
      console.log('[Streaming] OpenAI 시도...')
      const stream = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content
          }))
        ],
        stream: true,
        temperature: 0.8,
        max_tokens: 2000
      })

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || ''
        const done = chunk.choices[0]?.finish_reason === 'stop'

        if (content) {
          yield { content, done: false }
        }

        if (done) {
          console.log('[Streaming] OpenAI 성공')
          yield { content: '', done: true }
          return
        }
      }
      return
    }
  } catch (error: any) {
    console.warn('[Streaming] OpenAI 실패:', error.message || error)
    // 폴백으로 진행
  }

  // 2. Claude 폴백
  try {
    const claudeClient = await getClaudeClient()
    if (claudeClient) {
      console.log('[Streaming] Claude 폴백 시도...')

      const stream = await claudeClient.messages.stream({
        model: 'claude-sonnet-4-20250514',  // Claude Sonnet 4 (깊이있는 응답)
        max_tokens: 2000,
        system: systemPrompt,
        messages: messages.map(m => ({
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          content: m.content
        }))
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { content: event.delta.text, done: false }
        }
        if (event.type === 'message_stop') {
          console.log('[Streaming] Claude 성공')
          yield { content: '', done: true }
          return
        }
      }
      return
    }
  } catch (error: any) {
    console.warn('[Streaming] Claude 실패:', error.message || error)
  }

  // 3. Gemini 폴백 (non-streaming)
  try {
    const geminiClient = await getGeminiClient()
    if (geminiClient) {
      console.log('[Streaming] Gemini 폴백 시도 (non-streaming)...')

      const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash' })
      const prompt = `${systemPrompt}\n\n${messages.map(m => `${m.role}: ${m.content}`).join('\n\n')}`
      const result = await model.generateContent(prompt)
      const content = result.response.text()

      console.log('[Streaming] Gemini 성공')
      yield { content, done: true }
      return
    }
  } catch (error: any) {
    console.warn('[Streaming] Gemini 실패:', error.message || error)
  }

  // 모든 provider 실패
  yield { content: '죄송합니다. 모든 AI 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.', done: true }
}

// API 사용 통계 로깅 (Edge Runtime 호환 - 콘솔 로깅만)
async function logApiUsage(data: {
  provider: AIProvider
  endpoint: string
  tokens?: number
  cost?: number
  success: boolean
  errorMsg?: string
}) {
  // Edge Runtime에서는 Prisma 사용 불가, 콘솔 로깅만 수행
  if (process.env.NODE_ENV === 'development') {
    console.log(`[API Usage] ${data.provider}/${data.endpoint}: ${data.success ? 'success' : 'failed'}${data.tokens ? `, ${data.tokens} tokens` : ''}`)
  }
}

// 임베딩 생성 (OpenAI - 1536차원)
// bible_verses, sermon_chunks와 동일한 차원 사용
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = await getOpenAIClient()
  if (!client) throw new Error('OpenAI client not available')

  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536
  })

  await logApiUsage({
    provider: 'openai',
    endpoint: 'embedding',
    tokens: response.usage?.total_tokens,
    success: true
  })

  return response.data[0].embedding
}

// Perplexity 검색 export
export { searchWithPerplexity }
