import google.generativeai as genai

model = genai.GenerativeModel("gemini-2.5-flash")


def warm_up() -> None:
    """Checks the model answers. The prompt is fixed text: nothing a user wrote is sent."""
    model.generate_content("ping")
