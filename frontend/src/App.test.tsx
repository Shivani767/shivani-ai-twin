import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

let mockFetch: any

class MockSpeechRecognition {
  static active: any = null
  lang = 'en-US'
  interimResults = false
  continuous = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  start = () => {}
  stop = () => {}
  constructor() {
    MockSpeechRecognition.active = this
  }
}

function createSpeechSynthesis() {
  return {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: vi.fn(() => []),
    onvoiceschanged: null,
  } as unknown as SpeechSynthesis
}

function setup() {
  const synthesis = createSpeechSynthesis()
  if (!mockFetch) {
    mockFetch = vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/health')) {
        return { status: 200, ok: true, json: async () => ({ configured: true, model: 'llama-3.3-70b-versatile' }) }
      }
      if (url.includes('/api/suggestions')) {
        return { status: 200, ok: true, json: async () => ({ questions: ['Test question?'], count: 1 }) }
      }
      if (url.includes('/api/chat/reset')) {
        return { status: 200, ok: true, json: async () => ({ conversation_id: 'reset-1', reset: true, ready: true }) }
      }
      if (url.includes('/api/chat')) {
        return { status: 200, ok: true, json: async () => ({ reply: 'Mocked answer.', conversation_id: 'conv-1', mode: 'groq' }) }
      }
      return { status: 200, ok: true, json: async () => ({}) }
    })
  }
  vi.stubGlobal('fetch', mockFetch)
  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechRecognition', MockSpeechRecognition)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: () => undefined })
  return { synthesis }
}

beforeEach(() => {
  vi.clearAllMocks()
  setup()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('renders the landing page and suggested questions', () => {
    setup()
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByText('PERSONAL AI VOICE TWIN')).toBeInTheDocument()
    expect(screen.getByText(/One mind/)).toBeInTheDocument()
    expect(screen.getAllByRole('button').length).toBeGreaterThan(5)
  })

  it('shows a friendly error when the AI backend is unavailable', async () => {
    const mockFetch = vi.fn(async () => ({
      status: 503,
      ok: false,
      json: async () => ({ detail: "I'm having trouble reaching my AI service right now. Please try again in a moment." }),
    }))
    vi.stubGlobal('fetch', mockFetch)
    render(<App />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'Hello')
    await userEvent.click(screen.getByRole('button', { name: /send question/i }))
    expect(await screen.findByText(/having trouble reaching/)).toBeInTheDocument()
  })

  it('sends a text message and speaks the answer aloud', async () => {
    const synthesis = createSpeechSynthesis()
    class MockSpeechSynthesisUtterance {}
    vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance)
    const mockFetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ reply: 'My superpower is ownership.', conversation_id: 'c1', mode: 'groq' }),
    }))
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('speechSynthesis', synthesis)
    render(<App />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'What is your superpower?{enter}')
    expect(await screen.findByText('My superpower is ownership.')).toBeInTheDocument()
    expect(synthesis.speak).toHaveBeenCalled()
  })

  it('can stop listening and resume with the microphone', async () => {
    render(<App />)
    const startBtn = screen.getByRole('button', { name: 'Start voice input' })
    await userEvent.click(startBtn)
    expect(startBtn).toHaveAttribute('aria-label', 'Stop listening')
    const stopped = screen.getByRole('button', { name: 'Stop listening' })
    await userEvent.click(stopped)
    expect(stopped).toHaveAttribute('aria-label', 'Start voice input')
  })

  it('simulates a voice transcript and sends it', async () => {
    const synthesis = createSpeechSynthesis()
    const mockFetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ reply: 'OK.', conversation_id: 'c2', mode: 'groq' }),
    }))
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('speechSynthesis', synthesis)
    render(<App />)
    const startBtn = screen.getByRole('button', { name: 'Start voice input' })
    await userEvent.click(startBtn)
    const event = {
      resultIndex: 0,
      results: [{ 0: { transcript: 'Tell me your superpower.' }, isFinal: true }],
    }
    MockSpeechRecognition.active!.onresult(event)
    expect(await screen.findByText('Tell me your superpower.')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/chat'), expect.anything())
  })

  it('resets the conversation when the New button is clicked', async () => {
    render(<App />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'First question?{enter}')
    const newBtn = screen.getByRole('button', { name: /new/i })
    await userEvent.click(newBtn)
    expect(await screen.findByText(/Hello, I/)).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/chat/reset'), expect.anything())
  })

  it('supports voice synthesis when available', () => {
    setup()
    render(<App />)
    expect(typeof window.speechSynthesis).toBe('object')
    expect(window.speechSynthesis?.cancel).toBeInstanceOf(Function)
  })

  it('renders the recruiter questions in the suggested grid', () => {
    setup()
    render(<App />)
    const cards = screen.getAllByRole('button', { name: /superpower/i })
    expect(cards.length).toBeGreaterThan(0)
  })
})
