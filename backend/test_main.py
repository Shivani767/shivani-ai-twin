import os
import unittest
from fastapi.testclient import TestClient

import main
from main import (
    app,
    Message,
    build_contents,
    get_conversation,
    _sync_generate,
    CONVERSATIONS,
)


class BaseTestCase(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        main.CONVERSATIONS.clear()
        # A unique key so real Groq logic is not triggered.
        main.os.environ["GROQ_API_KEY"] = "test-key-not-for-production"

    def tearDown(self):
        main.CONVERSATIONS.clear()
        if "GROQ_API_KEY" in main.os.environ:
            del main.os.environ["GROQ_API_KEY"]


class TestHealth(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        main.CONVERSATIONS.clear()

    def test_health_returns_ok(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "healthy")

    def test_health_default_model_is_llama_3_3_70b_versatile(self):
        r = self.client.get("/health")
        self.assertEqual(r.json()["model"], "llama-3.3-70b-versatile")


class TestProfile(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        main.CONVERSATIONS.clear()

    def test_profile_returns_name(self):
        r = self.client.get("/api/profile")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["name"], "Shivani Bhandari")
        self.assertIn("skills", r.json())


class TestSuggestions(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_suggestions_returns_questions(self):
        r = self.client.get("/api/suggestions")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertGreaterEqual(len(body["questions"]), 13)
        self.assertIn("What should we know about your life story", body["questions"][0])


class TestChatPayload(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_payload_accepts_question(self):
        payload = main.ChatRequest(message="What is your superpower?")
        self.assertEqual(payload.message, "What is your superpower?")

    def test_payload_rejects_empty_message(self):
        payload = main.ChatRequest(message="   ")
        self.assertEqual(payload.message.strip(), "")


class TestChatEndpoints(BaseTestCase):
    def test_empty_message_rejected(self):
        r = self.client.post("/api/chat", json={"message": "   "})
        self.assertEqual(r.status_code, 422)

    def test_oversized_message_rejected(self):
        r = self.client.post("/api/chat", json={"message": "x" * 2001})
        self.assertEqual(r.status_code, 422)

    def test_missing_api_key_uses_demo_mode(self):
        old_getenv = main.os.getenv
        main.os.getenv = lambda key, default=None: None
        try:
            r = self.client.post("/api/chat", json={"message": "Tell me about yourself."})
            self.assertEqual(r.status_code, 200)
            body = r.json()
            self.assertEqual(body["mode"], "demo")
            self.assertIn("demo", body["reply"].lower())
            self.assertNotIn("test-key", body["reply"])
        finally:
            main.os.getenv = old_getenv

    def test_chat_uses_mock_groq(self):
        calls = []

        def fake_generate(api_key, history, question, model):
            calls.append((api_key, history, question, model))
            return "This is a mocked ground truth answer."

        main._sync_generate = fake_generate
        try:
            r = self.client.post(
                "/api/chat",
                json={"message": "What is your superpower?", "conversation_id": "conv-1"},
            )
            self.assertEqual(r.status_code, 200)
            body = r.json()
            self.assertEqual(body["mode"], "groq")
            self.assertEqual(body["conversation_id"], "conv-1")
            self.assertEqual(body["reply"], "This is a mocked ground truth answer.")
            self.assertEqual(len(calls), 1)
            self.assertTrue(get_conversation("conv-1"))
        finally:
            main._sync_generate = _sync_generate

    def test_conversation_context_is_preserved(self):
        def fake_generate(api_key, history, question, model):
            if "prior question" in question:
                return "Respond A (carries context)."
            return "Respond B (isolated)."

        main._sync_generate = fake_generate
        try:
            r1 = self.client.post(
                "/api/chat",
                json={"message": "Prior question about my background?", "conversation_id": "conv-2"},
            )
            self.assertEqual(r1.status_code, 200)
            self.assertEqual(r1.json()["reply"], "Respond B (isolated).")

            r2 = self.client.post(
                "/api/chat",
                json={"message": "Follow up: prior question", "conversation_id": "conv-2"},
            )
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(r2.json()["reply"], "Respond A (carries context).")
        finally:
            main._sync_generate = _sync_generate

    def test_conversation_reset_clears_memory(self):
        self.client.post(
            "/api/chat",
            json={"message": "Hello", "conversation_id": "conv-3"},
        )
        self.assertIsNotNone(get_conversation("conv-3"))
        r = self.client.post("/api/chat/reset", json={"conversation_id": "conv-3"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["reset"])
        self.assertIsNone(get_conversation("conv-3"))

    def test_groq_error_returns_friendly_503(self):
        main._sync_generate = lambda api_key, history, question, model: (_ for _ in ()).throw(
            RuntimeError("boom")
        )
        try:
            r = self.client.post(
                "/api/chat",
                json={"message": "Tell me about your work.", "conversation_id": "conv-4"},
            )
            self.assertEqual(r.status_code, 503)
            self.assertNotIn("boom", r.json()["detail"])
            self.assertNotIn("test-key", r.json()["detail"])
        finally:
            main._sync_generate = _sync_generate

    def test_secret_not_leaked_in_response(self):
        main._sync_generate = lambda api_key, history, question, model: "leak-free answer"
        try:
            r = self.client.post(
                "/api/chat",
                json={"message": "Hi", "conversation_id": "conv-5"},
            )
            body = r.json()
            self.assertNotIn("GROQ_API_KEY", str(body))
            self.assertNotIn("test-key-not-for-production", str(body))
        finally:
            main._sync_generate = _sync_generate

    def test_cors_headers_present(self):
        r = self.client.options("/health", headers={"Origin": "https://example.com", "Access-Control-Request-Method": "GET"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("access-control-allow-origin"), "*")

    def test_conversation_id_persists_context_after_reset(self):
        def fake_generate(api_key, history, question, model):
            return "ack"

        main._sync_generate = fake_generate
        try:
            self.client.post(
                "/api/chat",
                json={"message": "First message", "conversation_id": "conv-6"},
            )
            self.client.post(
                "/api/chat",
                json={"message": "Second message", "conversation_id": "conv-6"},
            )
            self.assertEqual(len(get_conversation("conv-6")), 4)
        finally:
            main._sync_generate = _sync_generate


if __name__ == "__main__":
    unittest.main()
