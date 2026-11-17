from ollama import Client

client = Client(host="http://models.internal:11434")


def keywords(question: str) -> str:
    res = client.generate(model="llama3.1", prompt=f"List the keywords in: {question}")
    return res.response
