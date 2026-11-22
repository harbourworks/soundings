import google.generativeai as genai

model = genai.GenerativeModel("gemini-2.5-flash")


def summarise(note: str) -> str:
    result = model.generate_content(f"Summarise this note: {note}")
    return result.text
