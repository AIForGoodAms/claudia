from pydantic import BaseModel


class Segment(BaseModel):
    pcm: bytes                      # 16 kHz mono PCM16
    sample_rate: int = 16000


class Transcript(BaseModel):
    text: str
    lang: str


class Candidate(BaseModel):
    text: str
    glosses: list[str]


class Match(BaseModel):
    symbol_id: int
    label: str
    image_path: str
    score: float


class SymbolCard(BaseModel):
    id: int
    label: str
    image_url: str | None = None    # None when as_text is True
    confidence: float
    as_text: bool = False           # below threshold → render the gloss as text


class Option(BaseModel):
    option_id: int
    text: str
    symbols: list[SymbolCard]


class Persona(BaseModel):
    profile: str
    reading_level: str | None = None


class Pick(BaseModel):
    context_text: str
    selected_text: str


class Utterance(BaseModel):
    text: str
    lang: str
