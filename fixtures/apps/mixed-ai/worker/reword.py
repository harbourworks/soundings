import os

from groq import Groq
from openai import OpenAI


def reword(draft: str) -> str:
    # Groq speaks the same API as OpenAI, so either client can serve this call.
    client = Groq() if os.environ.get("USE_GROQ") == "1" else OpenAI()
    res = client.chat.completions.create(
        model=os.environ.get("REWORD_MODEL", "gpt-4o-mini"),
        messages=[{"role": "user", "content": f"Reword this politely: {draft}"}],
    )
    return res.choices[0].message.content
