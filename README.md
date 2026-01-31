# 🙏 AI Bible Chatbot 상담소

Next.js 15 풀스택 성경 AI 상담 플랫폼

## 주요 기능

✨ **고급 청킹**: 500자 청크, 20% 오버랩, 메타정보 포함
🎯 **768차원 임베딩**: OpenAI text-embedding-3-small (가성비 최적)
🔄 **Multi-API Fallback**: OpenAI → Claude → Gemini 자동 전환
🔍 **Perplexity 통합**: 최신 정보 검색
⚙️ **관리자 페이지**: API 키 관리 UI
💬 **실시간 스트리밍**: ChatGPT 스타일 응답

## 빠른 시작

```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수 설정 (.env.local)
cp .env.local.example .env.local

# 3. Prisma 설정
npx prisma generate
npx prisma db push

# 4. 개발 서버 실행
npm run dev
```

http://localhost:3000 접속

## 환경 변수

`.env.local` 파일:

```env
# Supabase (pgvector)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key

# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
PERPLEXITY_API_KEY=...
```

## Supabase 설정

SQL Editor에서 실행:

```sql
create extension vector;

create table bible_chunks (
  id text primary key,
  content text not null,
  content_with_metadata text not null,
  embedding vector(768),
  -- 메타데이터 생략
);

create index on bible_chunks
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);
```

## 사용 방법

1. **메인 페이지** `/`: 채팅 시작
2. **관리자** `/admin`: API 키 관리
3. **Fallback**: OpenAI 실패 → Claude → Gemini

## 프로젝트 구조

```
bible-chatbot/
├── app/
│   ├── page.tsx          # 채팅
│   ├── admin/page.tsx    # 관리자
│   └── api/
│       ├── chat/         # 채팅 API
│       └── admin/        # 관리자 API
├── lib/
│   ├── chunking.ts       # 청킹
│   ├── ai-providers.ts   # Multi-AI
│   └── supabase.ts       # 벡터 검색
└── types/index.ts        # 타입 정의
```

## 배포

```bash
vercel --prod
```

## 라이선스

MIT
