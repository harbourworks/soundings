from anthropic import Anthropic
from openai import OpenAI

claude = Anthropic()
gpt = OpenAI()


def health_check() -> str:
    msg = claude.messages.create(
        model="claude-haiku-5-5",
        max_tokens=8,
        messages=[{"role": "user", "content": "fixed health check"}],
    )
    return msg.content[0].text


def ask(question: str) -> str:
    res = gpt.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": question}],
    )
    return res.choices[0].message.content
