"""Builds web/data.js (tables + base64 voice clips cut to the speech) and web/icon-*.png
from the Python app's data, so both versions share one source of truth. Run from this folder."""
import base64
import json
import struct
import zlib
from pathlib import Path

from morse_data import DIGITS, LANGUAGES, LETTERS, MORSE, PUNCTUATION, TRIM_FILENAME, voice_filename

BASE_DIR = Path(__file__).parent
WEB_DIR = BASE_DIR.parent  # this script lives in web/tools/
MP3_HEADER = bytes.fromhex("fff364")  # MPEG-2 Layer III, 48 kbps mono, as produced by edge-tts
BYTES_PER_MS = 6  # 48 kbps
FRAME_BYTES = 144
TAIL_MS = 100  # extra audio kept after the speech so the decoder never cuts the last sound


def load_clips(directory: str) -> dict[str, dict]:
    trims = json.loads((BASE_DIR / directory / TRIM_FILENAME).read_text())
    clips: dict[str, dict] = {}
    for character in MORSE:
        path = BASE_DIR / directory / voice_filename(character)
        if not path.exists():
            continue
        data = path.read_bytes()
        if not data.startswith(MP3_HEADER):
            raise ValueError(f"Unexpected mp3 format: {path}")
        start_ms, end_ms = trims[path.name]
        cut_bytes = -(-(end_ms + TAIL_MS) * BYTES_PER_MS // FRAME_BYTES) * FRAME_BYTES  # round up to a frame
        clips[character] = {"b64": base64.b64encode(data[:cut_bytes]).decode(), "start": start_ms, "end": end_ms}
    return clips


def build_data() -> dict:
    data: dict = {
        "morse": MORSE, "letters": list(LETTERS), "digits": list(DIGITS), "punctuation": list(PUNCTUATION),
        "languages": {}, "clips": {},
    }
    for language, (_voice, spoken_names, spelling) in LANGUAGES.items():
        data["languages"][language] = {
            "names": {c: name for c, name in spoken_names.items() if c not in LETTERS},
            "spelling": {c: label for c, (label, _spoken) in spelling.items()},
        }
        data["clips"][language] = load_clips(f"voices_{language}")
        data["clips"][f"{language}_spell"] = load_clips(f"voices_{language}_spell")
    return data


def write_png(path: Path, size: int) -> None:
    """Simple icon: dark square with the Morse code of 'MT' (-- -) as light bars."""
    background, bar = (24, 40, 72), (240, 244, 250)
    unit = size // 12
    rows = [  # (top y, [(start unit, length in units)])
        (size // 3 - unit // 2, [(2, 3), (7, 3)]),  # M = - -
        (2 * size // 3 - unit // 2, [(2, 3)]),  # T = -
    ]
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # PNG filter: none
        active = [spans for top, spans in rows if top <= y < top + unit]
        for x in range(size):
            inside = bool(active) and any(start * unit <= x < (start + length) * unit for start, length in active[0])
            raw += bytes(bar if inside else background)

    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    WEB_DIR.mkdir(exist_ok=True)
    payload = json.dumps(build_data(), ensure_ascii=False, separators=(",", ":"))
    (WEB_DIR / "data.js").write_text(f"window.MT_DATA={payload};\n", encoding="utf-8")
    for icon_size in (192, 512):
        write_png(WEB_DIR / f"icon-{icon_size}.png", icon_size)
    print(f"data.js: {len(payload) / 1024:.0f} KiB")
