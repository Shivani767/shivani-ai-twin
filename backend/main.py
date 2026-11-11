import os
import asyncio
import time
import uuid
from collections import defaultdict, deque
from typing import Literal

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from persona import SYSTEM_PROMPT, PROFILE, SUGGESTIONS

APP_NAME = "Shivani AI"
MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

app = FastAPI(title=APP_NAME, version="1.0.0", description="Personal AI voice twin assessment app")

ALLOWED_ORIGINS = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Conversation-Id"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = Field(default=None, max_length=64)
    history: list[Message] = Field(default_factory=list, max_length=12)


class ResetRequest(BaseModel):
    conversation_id: str | None = Field(default=None, max_length=64)


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    model: str
    mode: Literal["groq", "demo"]


# ---------------------------------------------------------------------------
# Conversation memory (in-memory, session-level). Not a persistence layer.
# ---------------------------------------------------------------------------
CONVERSATIONS = {}
MAX_MESSAGE_CAP = 36
MAX_HISTORY_CHARS = 1600


def _trim_history(messages: list[Message]) -> list[Message]:
    out: list[Message] = []
    total = 0
    for m in reversed(messages):
        block = f"{m.role.upper()}: {m.content}"
        if total + len(block) > MAX_HISTORY_CHARS and out:
            break
        out.append(m)
        total += len(block)
    out.reverse()
    return out


def get_conversation(cid: str) -> list[Message] | None:
    return CONVERSATIONS.get(cid)


def save_conversation(cid: str, messages: list[Message]) -> None:
    CONVERSATIONS[cid] = _trim_history(messages)


def build_contents(history: list[Message], question: str) -> str:
    turns = [f"{m.role.upper()}: {m.content}" for m in history[-8:]]
    turns.append(f"USER: {question}")
    return "\n\n".join(turns)


def _to_dict(profile):
    return {key: value for key, value in profile}


# ---------------------------------------------------------------------------
# Rate limiting (in-memory guardrail)
# ---------------------------------------------------------------------------
def rate_limit(request: Request, limit: int = 20, window_seconds: int = 60) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    bucket = _Hits[ip]
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="A little too much activity. Please wait a minute and try again.")
    bucket.append(now)


_Hits: dict[str, deque] = defaultdict(deque)


# ---------------------------------------------------------------------------
# Groq client (isolated for timeouts and testability)
# ---------------------------------------------------------------------------
def _sync_generate(api_key: str, history: list, question: str, model: str) -> str:
    from groq import Groq

    client = Groq(api_key=api_key)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in history:
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": question})

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.55,
        top_p=0.9,
        max_completion_tokens=500,
    )
    text = (response.choices[0].message.content or "").strip()
    if not text:
        raise RuntimeError("The model returned an empty response")
    return text


async def _call_groq_with_key(api_key: str, history: list, question: str, model: str) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_generate, api_key, history, question, model)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    configured = bool(os.getenv("GROQ_API_KEY"))
    return {"status": "healthy", "configured": configured, "model": MODEL}


@app.get("/api/profile")
def profile():
    return _to_dict(PROFILE)


@app.get("/api/suggestions")
def suggestions():
    return {"questions": SUGGESTIONS, "count": len(SUGGESTIONS)}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, request: Request):
    rate_limit(request)
    question = payload.message.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Please enter a question.")

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        conversation_id = payload.conversation_id or uuid.uuid4().hex
        return ChatResponse(
            reply=(
                "I'm Shivani's AI voice twin, but the live AI service hasn't been "
                "configured on this server yet, so I'm in demo mode. Please ask the "
                "assessment owner to add your Groq API key."
            ),
            conversation_id=conversation_id,
            model=MODEL,
            mode="demo",
        )

    conversation_id = payload.conversation_id or uuid.uuid4().hex
    history = get_conversation(conversation_id)
    if history is None:
        history = []
        CONVERSATIONS[conversation_id] = history

    # Convert history to dicts for the Groq API
    history_dicts = [{"role": m.role, "content": m.content} for m in history]
    history.append(Message(role="user", content=question))

    try:
        answer = await asyncio.wait_for(
            _call_groq_with_key(api_key, history_dicts, question, MODEL), timeout=30
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="The AI took too long to answer. Please try again.")
    except Exception as exc:
        # Log details server-side only; never leak to the browser.
        print(f"Groq request failed: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=503,
            detail="I'm having trouble reaching my AI service right now. Please try again in a moment.",
        ) from exc

    history.append(Message(role="assistant", content=answer))
    save_conversation(conversation_id, history)
    return ChatResponse(reply=answer, conversation_id=conversation_id, model=MODEL, mode="groq")


@app.post("/api/chat/reset")
def reset_chat(payload: ResetRequest = Body(default=None)):
    conversation_id = payload.conversation_id if payload is not None else None
    if conversation_id:
        CONVERSATIONS.pop(conversation_id, None)
    return {"conversation_id": uuid.uuid4().hex, "reset": True, "ready": True}
