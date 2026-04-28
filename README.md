# DocChat AI — React + FastAPI

## Stack
- **Frontend**: React 18 + Vite (no UI library, plain CSS)
- **Backend**: FastAPI + Pure BM25 (rank-bm25) — zero HuggingFace, zero model downloads
- **LLM**: Llama 3.1-8B-Instant via Groq (free, fast)
- **Deploy**: Render (backend as web service, frontend as static site)

## Local Development

### 1. Backend
```bash
cd backend
pip install -r requirements.txt
cp ../.env .env           # make sure GROQ_API_KEY is set
uvicorn main:app --reload --port 8000
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev               # runs at http://localhost:5173
```
Vite proxies /api → localhost:8000 automatically.

## Deploy to Render

1. Push this repo to GitHub
2. Go to render.com → New → Blueprint → connect your repo
3. Render reads render.yaml and creates both services
4. In docchat-backend env vars: set `GROQ_API_KEY`
5. Deploy backend first, copy its URL
6. In docchat-frontend env vars: set `VITE_API_URL` to the backend URL
7. Deploy frontend — done

## Why no HuggingFace?
Replaced sentence-transformers with pure BM25 (rank-bm25).
- Zero model downloads → instant startup
- Works on Render free tier (512MB RAM)
- BM25 is highly competitive for document QA
- No cold start timeouts
