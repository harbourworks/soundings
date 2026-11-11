from openai import OpenAI

from app.config import settings

client = OpenAI(api_key=settings.openai_api_key)


def answer(question: str, context: str) -> str:
    completion = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "Answer only from the context."},
            {"role": "user", "content": f"Context: {context}\n\nQuestion: {question}"},
        ],
    )
    return completion.choices[0].message.content
