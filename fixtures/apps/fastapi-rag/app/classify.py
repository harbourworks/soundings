from groq import Groq

client = Groq()


def topic(question: str) -> str:
    res = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": f"One-word topic for: {question}"}],
    )
    return res.choices[0].message.content
