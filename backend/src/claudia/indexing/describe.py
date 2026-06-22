def compose(keywords, meaning):
    joined = ", ".join(k.strip() for k in keywords if k and k.strip())
    if meaning and meaning.strip():
        return f"{joined} — {meaning.strip()}"
    return joined
