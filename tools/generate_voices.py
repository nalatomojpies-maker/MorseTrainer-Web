"""One-off script: generates voice mp3 files into voices_<language>/ using edge-tts.
Existing files are skipped; delete a file to regenerate it. Optional argument: language code (pl/en)."""
import asyncio
import json
import sys
from pathlib import Path

import edge_tts

from morse_data import LANGUAGES, TRIM_FILENAME, voice_filename

BASE_DIR = Path(__file__).parent
TRIM_MARGIN_MS = 60


async def generate_language(language: str) -> None:
    voice, spoken_names, spelling = LANGUAGES[language]
    await generate_set(language, voice, spoken_names, f"voices_{language}")
    await generate_set(language, voice, {c: spoken for c, (_, spoken) in spelling.items()}, f"voices_{language}_spell")


async def generate_set(language: str, voice: str, spoken_names: dict[str, str], directory: str) -> None:
    output_dir = BASE_DIR / directory
    output_dir.mkdir(exist_ok=True)
    trim_path = output_dir / TRIM_FILENAME
    trims: dict[str, list[int]] = json.loads(trim_path.read_text()) if trim_path.exists() else {}
    for character, spoken in spoken_names.items():
        target = output_dir / voice_filename(character)
        if target.exists() and target.name in trims:
            continue
        audio = bytearray()
        start_ms, end_ms = 0, None
        stream = edge_tts.Communicate(spoken, voice, rate="-10%", boundary="WordBoundary").stream()
        async for chunk in stream:
            if chunk["type"] == "audio":
                audio += chunk["data"]
            elif chunk["type"] == "WordBoundary":  # offsets are in 100 ns ticks
                word_start = chunk["offset"] // 10_000
                word_end = (chunk["offset"] + chunk["duration"]) // 10_000
                start_ms = word_start if end_ms is None else start_ms
                end_ms = word_end
        target.write_bytes(bytes(audio))
        # edge-tts pads the mp3 with ~1 s of silence; remember where the speech really is
        trims[target.name] = [max(0, start_ms - TRIM_MARGIN_MS), (end_ms or 0) + TRIM_MARGIN_MS]
        print(f"[{language}] {character!r} -> {spoken} ({target.name}) {trims[target.name]}")
    trim_path.write_text(json.dumps(trims, indent=1))


async def main(languages: list[str]) -> None:
    for language in languages:
        await generate_language(language)


if __name__ == "__main__":
    requested = sys.argv[1:] or list(LANGUAGES)
    unknown = [code for code in requested if code not in LANGUAGES]
    if unknown:
        sys.exit(f"Unknown language: {unknown}. Available: {list(LANGUAGES)}")
    asyncio.run(main(requested))
