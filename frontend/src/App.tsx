import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, RotateCcw, Volume2, VolumeX, Waves, CircleHelp, ArrowUp, Bot, Sparkles } from 'lucide-react'


type ChatMessage = { role: 'user' | 'assistant'; content: string }

const rawApiUrl = import.meta.env.VITE_API_URL || ''
const API_URL = rawApiUrl.endsWith('/') ? rawApiUrl.slice(0, -1) : rawApiUrl

const FALLBACK_PROMPTS = [
  'What should we know about your life story in a few sentences?',
  "What's your number one superpower?",
  "What are the top three areas you'd like to grow in?",
  'What misconception do your coworkers have about you?',
  'How do you push your boundaries and limits?',
  'Why should we hire you?',
  'Why do you want to join 100x?',
  'What motivates you?',
  'Tell me about a project you are proud of.',
  "What is your biggest weakness?",
  'How do you handle disagreements?',
  'What do you know about production LLM inference?',
  'How do you debug an AI agent?',
]

const INTRO =
  "Hello, I'm Shivani AI - my AI voice twin. I can talk about my journey, engineering work, strengths, and what I'm working toward. Ask me anything, or just say something naturally."

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: INTRO }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [error, setError] = useState('')

  const [conversationId, setConversationId] = useState<string>(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return 'default'
  })
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_PROMPTS)
  const [speed, setSpeed] = useState(0.96)
  const recognition = useRef<SpeechRecognition | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  type SpeechRecognition = {
    lang: string
    interimResults: boolean
    continuous: boolean
    onresult: ((event: any) => void) | null
    onerror: ((event: any) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
  }

  type SpeechWindow = Window & {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }

  useEffect(() => {
    if (!API_URL) return
    fetch(`${API_URL}/api/suggestions`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (data && Array.isArray(data.questions)) setSuggestions(data.questions)
      })
      .catch(() => undefined)
  }, [API_URL])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel()
      recognition.current?.stop()
    }
  }, [])

  function speak(text: string) {
    if (!voiceEnabled || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    if (typeof SpeechSynthesisUtterance === 'undefined') return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.rate = speed
    utterance.pitch = 1
    const voices = window.speechSynthesis.getVoices()
    const preferred = voices.find((v) => v.lang === 'en-US' && /female|samantha/i.test(v.name)) || voices.find((v) => v.lang === 'en-US') || null
    if (preferred) utterance.voice = preferred
    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }

  async function sendMessage(raw: string) {
    const question = raw.trim()
    if (!question || busy) return
    setError('')
    setInput('')
    setListening(false)
    window.speechSynthesis?.cancel()
    setSpeaking(false)
    const prior = messages.slice(-12)
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setBusy(true)
    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, conversation_id: conversationId, history: prior }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Something went wrong. Please try again.')
      const answer = String(data.reply || '').trim()
      if (!answer) throw new Error('The AI returned an empty reply. Please try again.')
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }])
      speak(answer)
      if (data.mode === 'demo') setError('Demo mode: add your Gemini API key on the backend to enable live answers.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to connect. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    window.speechSynthesis?.cancel()
    recognition.current?.stop()
    setListening(false)
    setSpeaking(false)
    setError('')
    setMessages([{ role: 'assistant', content: INTRO }])
    fetch(`${API_URL}/api/chat/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.conversation_id) setConversationId(data.conversation_id)
      })
      .catch(() => undefined)
  }

  function toggleMic() {
    if (listening) {
      recognition.current?.stop()
      setListening(false)
      return
    }
    const w = window as SpeechWindow
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Voice input is not supported in this browser. Please use the text box below.')
      return
    }
    const rec = new SpeechRecognition()
    recognition.current = rec
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (event) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript
      setInput(transcript)
      if (event.results[event.results.length - 1].isFinal) {
        rec.stop()
        setListening(false)
        void sendMessage(transcript)
      }
    }
    rec.onerror = () => {
      setListening(false)
      setError('I could not hear that clearly. Please try again or type your question.')
    }
    rec.onend = () => setListening(false)
    try {
      rec.start()
      setListening(true)
      setError('')
    } catch {
      setError('Microphone could not start. Check browser permissions and try again.')
    }
  }

  function toggleSpeed() {
    setSpeed((v) => (v === 0.85 ? 0.96 : v === 0.96 ? 1.1 : 0.85))
  }

  return (
    <>
    <div className='hero' id='top'>
      <div className='eyebrow'><Sparkles size={14} /> PERSONAL AI VOICE TWIN</div>
      <h1>One mind. <span>My story.</span><br />Your questions.</h1>
      <p className='subhead'>A conversational introduction to how I think, build, learn, and grow as an AI engineer.</p>
      <div className='status-line'>
        <span className='status-dot' /> AI connection ready<span className='status-separator'>·</span>English · Professional
      </div>
    </div>
    <div className='workspace'>
      <aside className='left-panel'>
        <div className={`orb-wrap ${listening ? 'is-listening' : speaking ? 'is-speaking' : ''}`}>
          <div className='orb-halo halo-one' />
          <div className='orb-halo halo-two' />
          <div className='orb'><Waves size={42} strokeWidth={1.35} /></div>
        </div>
        <div className='voice-state'>{listening ? 'I’m listening…' : speaking ? 'Speaking…' : busy ? 'Thinking through it…' : 'Ready when you are'}</div>
        <p className='voice-caption'>{listening ? 'Ask your question naturally.' : 'Tap the microphone to start a conversation.'}</p>
        <button className={'mic-button ' + (listening ? 'active' : '')} onClick={toggleMic} disabled={busy} aria-label={listening ? 'Stop listening' : 'Start voice input'}>
          {listening ? <MicOff size={21} /> : <Mic size={21} />}
          <span>{listening ? 'Stop listening' : 'Talk to me'}</span>
        </button>
        <button className='sound-toggle' onClick={() => { setVoiceEnabled((v) => !v); window.speechSynthesis?.cancel(); setSpeaking(false) }} title={voiceEnabled ? 'Mute spoken answers' : 'Enable spoken answers'}>{voiceEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}<span>{voiceEnabled ? 'Voice on' : 'Voice off'}</span></button>
        {voiceEnabled && (
          <div className='speed-row' role='group' aria-label='Speaking speed'>
            <button className={'speed-btn ' + (speed === 0.85 ? 'active' : '')} onClick={toggleSpeed} aria-label='Slower speech'>Slow</button>
            <button className={'speed-btn ' + (speed === 0.96 ? 'active' : '')} onClick={toggleSpeed} aria-label='Normal speech'>Normal</button>
            <button className={'speed-btn ' + (speed === 1.1 ? 'active' : '')} onClick={toggleSpeed} aria-label='Faster speech'>Fast</button>
            <span className='speed-label'>{speed.toFixed(2)}x</span>
          </div>
        )}
        <div className='privacy-note'><span className='privacy-lock' aria-hidden='true'>&#128274;</span> Microphone access is only used when you tap the button.</div>
      </aside>

      <section className='chat-panel' aria-label='Conversation'>
        <div className='chat-head'>
          <div>
            <div className='chat-title'>Conversation</div>
            <div className='chat-subtitle'>Ask me anything about my professional journey</div>
          </div>
          <button className='sound-toggle' onClick={reset} title='Start a new conversation' aria-label='Start a new conversation'><RotateCcw size={17} /><span>New</span></button>
        </div>
        <div className='messages'>
          {messages.map((m, i) => (
            <div className={`message-row ${m.role}`} key={i}>
              <div className='avatar'>{m.role === 'assistant' ? <Waves size={15} /> : 'S'}</div>
              <div className='bubble-wrap'>
                <div className='sender'>{m.role === 'assistant' ? 'SHIVANI AI' : 'YOU'}</div>
                <div className='bubble'>{m.content}</div>
                {m.role === 'assistant' && i > 0 && (
                  <button className='replay' onClick={() => speak(m.content)}><Volume2 size={13} /> Listen again</button>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className='message-row assistant'>
              <div className='avatar'><Waves size={15} /></div>
              <div className='bubble-wrap'>
                <div className='sender'>SHIVANI AI</div>
                <div className='bubble typing'><i /><i /><i /></div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {error && <div className='inline-error' role='status'>{error}</div>}
        <form className='composer' onSubmit={(e) => { e.preventDefault(); void sendMessage(input) }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder='Ask me a question...' aria-label='Type your question' maxLength={2000} />
          <button className='send-button' type='submit' disabled={!input.trim() || busy} aria-label='Send question'><ArrowUp size={19} /></button>
        </form>
        <div className='composer-hint'>Press Enter to send <span>·</span> Your conversation is not saved after you leave</div>
      </section>
    </div>

    <section className='suggestions'>
      <div className='section-heading'>
        <div>
          <div className='eyebrow small'><CircleHelp size={13} /> GET THE CONVERSATION STARTED</div>
          <h2>Curious about something?</h2>
        </div>
        <span className='suggestion-count'>{suggestions.length} SUGGESTED QUESTIONS</span>
      </div>
      <div className='prompt-grid'>
        {suggestions.map((p, i) => (
          <button key={p} className='prompt-card' onClick={() => void sendMessage(p)} disabled={busy}>
            <span className='prompt-number'>0{i + 1}</span>
            <span>{p}</span>
            <ArrowUp size={15} className='prompt-arrow' />
          </button>
        ))}
      </div>
    </section>

    <footer>
      <div className='footer-brand'><span className='brand-mark small-mark'><Bot size={15} /></span> SHIVANI.AI</div>
      <p>An AI representation of Shivani Bhandari · Built for the 100x Stage 1 assessment</p>
      <span className='disclaimer'>AI-generated responses based on a curated professional profile.</span>
    </footer>
  </>
  )
}
