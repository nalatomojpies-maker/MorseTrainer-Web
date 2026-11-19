"""Morse code table and Polish spoken names of characters."""

LETTERS: dict[str, str] = {
    "a": ".-", "b": "-...", "c": "-.-.", "d": "-..", "e": ".", "f": "..-.",
    "g": "--.", "h": "....", "i": "..", "j": ".---", "k": "-.-", "l": ".-..",
    "m": "--", "n": "-.", "o": "---", "p": ".--.", "q": "--.-", "r": ".-.",
    "s": "...", "t": "-", "u": "..-", "v": "...-", "w": ".--", "x": "-..-",
    "y": "-.--", "z": "--..",
}

DIGITS: dict[str, str] = {
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
    "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
}

PUNCTUATION: dict[str, str] = {
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "!": "-.-.--", ":": "---...",
    ";": "-.-.-.", "-": "-....-", "/": "-..-.", "(": "-.--.", ")": "-.--.-",
    "'": ".----.", '"': ".-..-.", "@": ".--.-.", "=": "-...-", "+": ".-.-.",
}

MORSE: dict[str, str] = {**LETTERS, **DIGITS, **PUNCTUATION}

SPOKEN_NAMES_PL: dict[str, str] = {
    "a": "a", "b": "be", "c": "ce", "d": "de", "e": "e", "f": "ef",
    "g": "gie", "h": "ha", "i": "i", "j": "jot", "k": "ka", "l": "el",
    "m": "em", "n": "en", "o": "o", "p": "pe", "q": "ku", "r": "er",
    "s": "es", "t": "te", "u": "u", "v": "fał", "w": "wu", "x": "iks",
    "y": "igrek", "z": "zet",
    "0": "zero", "1": "jeden", "2": "dwa", "3": "trzy", "4": "cztery",
    "5": "pięć", "6": "sześć", "7": "siedem", "8": "osiem", "9": "dziewięć",
    ".": "kropka", ",": "przecinek", "?": "pytajnik", "!": "wykrzyknik",
    ":": "dwukropek", ";": "średnik", "-": "myślnik", "/": "ukośnik",
    "(": "nawias otwierający", ")": "nawias zamykający", "'": "apostrof",
    '"': "cudzysłów", "@": "małpa", "=": "równa się", "+": "plus",
}


# Short spelled names like "pe" get read as two syllables/letters ("pe e") by the TTS;
# a single capital letter is read as the Polish letter name.
SPOKEN_NAMES_PL.update({letter: letter.upper() for letter in "abcdefghiklmnoprstu"})

SPOKEN_NAMES_EN: dict[str, str] = {
    # single capital letters: the English voice reads them as letter names (a, bee, see...)
    **{letter: letter.upper() for letter in "abcdefghijklmnopqrstuvwxyz"},
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
    ".": "period", ",": "comma", "?": "question mark", "!": "exclamation mark",
    ":": "colon", ";": "semicolon", "-": "dash", "/": "slash",
    "(": "open parenthesis", ")": "close parenthesis", "'": "apostrophe",
    '"': "quote", "@": "at sign", "=": "equals", "+": "plus",
}

# Spelling alphabets: Polish first names and the NATO alphabet (letters only).
# value = (label shown in the cheat sheet, text sent to the TTS; Polish voice needs Polish spelling)
SPELLING_PL: dict[str, tuple[str, str]] = {
    "a": ("Adam", "Adam"), "b": ("Barbara", "Barbara"), "c": ("Celina", "Celina"),
    "d": ("Dorota", "Dorota"), "e": ("Ewa", "Ewa"), "f": ("Filip", "Filip"),
    "g": ("Grażyna", "Grażyna"), "h": ("Henryk", "Henryk"), "i": ("Ignacy", "Ignacy"),
    "j": ("Jadwiga", "Jadwiga"), "k": ("Karol", "Karol"), "l": ("Ludwik", "Ludwik"),
    "m": ("Maria", "Maria"), "n": ("Natalia", "Natalia"), "o": ("Olga", "Olga"),
    "p": ("Paweł", "Paweł"), "q": ("Quebec", "Kebek"), "r": ("Roman", "Roman"),
    "s": ("Stefan", "Stefan"), "t": ("Tadeusz", "Tadeusz"), "u": ("Urszula", "Urszula"),
    "v": ("Victor", "Wiktor"), "w": ("Wanda", "Wanda"), "x": ("Ksawery", "Ksawery"),
    "y": ("Yokohama", "Jokohama"), "z": ("Zygmunt", "Zygmunt"),
}

SPELLING_EN: dict[str, tuple[str, str]] = {
    letter: (word, word) for letter, word in zip("abcdefghijklmnopqrstuvwxyz", [
        "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India",
        "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo",
        "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "X-ray", "Yankee", "Zulu"])
}

# language code -> (edge-tts voice, spoken names, spelling alphabet)
# files go to voices_<code>/ (names) and voices_<code>_spell/ (spelling alphabet)
LANGUAGES: dict[str, tuple[str, dict[str, str], dict[str, tuple[str, str]]]] = {
    "pl": ("pl-PL-MarekNeural", SPOKEN_NAMES_PL, SPELLING_PL),
    "en": ("en-US-GuyNeural", SPOKEN_NAMES_EN, SPELLING_EN),
}


TRIM_FILENAME = "trim.json"  # per voices dir: {mp3 name: [speech start ms, speech end ms]}


def voice_filename(character: str) -> str:
    return f"{ord(character):04x}.mp3"
