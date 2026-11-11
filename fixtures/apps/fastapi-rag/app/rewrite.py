from mistralai import Mistral

client = Mistral()


def rewrite(question: str) -> str:
    res = client.chat.complete(
        model="mistral-small-latest",
        messages=[{"role": "user", "content": f"Rewrite as a search query: {question}"}],
    )
    return res.choices[0].message.content
