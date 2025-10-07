import json
import re
from copy import deepcopy
from typing import Any, Dict, List, Tuple, Optional

# --- Regex helpers for math spans / dollar & display normalization ---
_MATH_INLINE_RE       = re.compile(r"""\\\((?:.|\n)*?\\\)""", re.MULTILINE)
_DISPLAY_BRACKET_RE   = re.compile(r"""\\\[(.*?)\\\]""", re.DOTALL)
_DISPLAY_DOLLAR_RE    = re.compile(r"""\$\$(.*?)\$\$""", re.DOTALL)
_INLINE_DOLLAR_RE     = re.compile(r"""(?<!\$)\$(.+?)\$(?!\$)""", re.DOTALL)

# Simple finder for "\ce" tokens (we'll parse from there)
_CE_HEAD_RE = re.compile(r"""\\ce\b""")

def _ranges(regex: re.Pattern, text: str) -> List[range]:
    return [range(m.start(), m.end()) for m in regex.finditer(text)]

def _inside_any(pos: int, spans: List[range]) -> bool:
    return any(pos in sp for sp in spans)

def _find_matching_bracket(text: str, i: int, open_ch: str, close_ch: str) -> Optional[int]:
    """
    Return index (inclusive) of the matching closing bracket for text[i] == open_ch.
    Handles simple escaping like '\]' or '\}'.
    """
    assert text[i] == open_ch
    depth = 0
    j = i
    while j < len(text):
        ch = text[j]
        if ch == "\\":
            j += 2  # skip escaped next char
            continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return None  # unbalanced

def _find_ce_spans(text: str) -> List[Tuple[int, int]]:
    """
    Return list of (start, end) character spans for *balanced* \ce{ ... } tokens.
    Supports optional \ce[ ... ]{ ... }.
    The end index is exclusive.
    """
    spans: List[Tuple[int, int]] = []
    for m in _CE_HEAD_RE.finditer(text):
        j = m.end()  # position after '\ce'
        # skip spaces
        while j < len(text) and text[j].isspace():
            j += 1
        # optional [ ... ]
        if j < len(text) and text[j] == '[':
            close_sq = text.find(']', j + 1)
            # handle escaped ']' inside; if we want to be safer, scan char-by-char:
            if close_sq == -1:
                # fallback to robust scan
                close_sq = _find_matching_bracket(text, j, '[', ']') or -1
            if close_sq == -1:
                continue  # malformed; skip this occurrence
            j = close_sq + 1
            while j < len(text) and text[j].isspace():
                j += 1
        # now must have { ... }
        if j >= len(text) or text[j] != '{':
            continue
        close_curly = _find_matching_bracket(text, j, '{', '}')
        if close_curly is None:
            continue  # malformed; skip
        # include entire token span from '\ce' to the closing '}'
        spans.append((m.start(), close_curly + 1))
    return spans

def normalize_latex_in_text(text: str) -> str:
    """Ensure all LaTeX is wrapped in \( ... \); wrap bare \( \ce{...} \) (balanced) only if outside math."""
    if not text or not isinstance(text, str):
        return text

    # 1) Normalize display math and dollar math to inline \( ... \)
    text = _DISPLAY_BRACKET_RE.sub(r"\\(\1\\)", text)
    text = _DISPLAY_DOLLAR_RE.sub(r"\\(\1\\)", text)
    text = _INLINE_DOLLAR_RE.sub(r"\\(\1\\)", text)

    # 2) Identify existing \( ... \) spans (to prevent double wrapping)
    math_spans = _ranges(_MATH_INLINE_RE, text)

    # 3) Find all balanced \ce{...} spans
    ce_spans = _find_ce_spans(text)

    # 4) Wrap only those \ce{...} outside any math span
    pieces = []
    last = 0
    for start, end in ce_spans:
        if _inside_any(start, math_spans):
            continue  # already inside \( ... \)
        pieces.append(text[last:start])
        pieces.append(r"\(" + text[start:end] + r"\)")
        last = end
    if pieces:
        pieces.append(text[last:])
        text = "".join(pieces)

    # 5) Tidy spaces just inside delimiters: \(  X  \) -> \( X \)
    text = re.sub(r"\\\(\s+", r"\\(", text)
    text = re.sub(r"\s+\\\)", r"\\)", text)

    return text

def normalize_all_latex(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Walk any JSON-like structure and normalize all strings."""
    data = deepcopy(payload)

    def _walk(x: Any) -> Any:
        if isinstance(x, dict):
            return {k: _walk(v) for k, v in x.items()}
        if isinstance(x, list):
            return [_walk(v) for v in x]
        if isinstance(x, str):
            return normalize_latex_in_text(x)
        return x

    return _walk(data)


# ---------- Example usage ----------
if __name__ == "__main__":
    # Suppose `raw_json` is the dict from your message (already loaded).
    raw_json = json.loads(
r'''
{
  "questions": [
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Calculate the amount of \\(\\ce{Cu}\\) deposited by a current of 0.2 ampere in 50 minute. ECE of \\ce{Cu} is \\(0.3269 \\times 10^{-6}\\) kg coulomb\\(^{-1}\\).",
      "image": null,
      "qOptions": ["0.0196 g", "0.196 g", "1.96 g", "0.296 g"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Molten \\ce{AlCl3} is electrolysed with a current of 0.5 ampere to produce 27 g \\ce{Al}. How many equivalents of \\ce{Al} are formed?",
      "image": null,
      "qOptions": ["1", "2", "3", "6"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Molten \\ce{AlCl3} is electrolysed with a current of 0.5 ampere to produce 27 g \\ce{Al}. How many g-atoms of \\ce{Al} are formed?",
      "image": null,
      "qOptions": ["0.5", "1", "2", "3"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Molten \\ce{AlCl3} is electrolysed with a current of 0.5 ampere to produce 27 g \\ce{Al}. How many electrons are used?",
      "image": null,
      "qOptions": ["\\(N\\)", "\\(2N\\)", "\\(3N\\)", "\\(6N\\)"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Molten \\ce{AlCl3} is electrolysed with a current of 0.5 ampere to produce 27 g \\ce{Al}. How much faradays are used?",
      "image": null,
      "qOptions": ["\\(1F\\)", "\\(2F\\)", "\\(3F\\)", "\\(6F\\)"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Molten \\ce{AlCl3} is electrolysed with a current of 0.5 ampere to produce 27 g \\ce{Al}. How long did current pass (in seconds)?",
      "image": null,
      "qOptions": ["579000", "57900", "600000", "333000"],
      "qAnswer": "A"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Molten \\ce{AlCl3} is electrolysed with a current of 0.5 ampere to produce 27 g \\ce{Al}. How many litre of \\ce{Cl2} at STP are formed?",
      "image": null,
      "qOptions": ["22.4", "11.2", "33.6", "16.8"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Ammonium perchlorate, \\ce{NH4ClO4}, is produced commercially from \\ce{NaClO4}. Sodium perchlorate is obtained commercially by the electrolysis of hot \\ce{NaCl} solution as, \\[\\ce{NaCl + 4H2O -> NaClO4 + 4H2}\\] How many faradays are required to produce 1.0 kg of \\ce{NH4ClO4}?",
      "image": null,
      "qOptions": [
        "64.0 faraday",
        "68.085 faraday",
        "72.1 faraday",
        "50.0 faraday"
      ],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "A certain quantity of current deposits 0.54 g of \\ce{Ag} from \\ce{AgNO3} solution. What volume of \\ce{H2} will the same quantity of electricity liberate at 27 \\(^\\circ\\)C and 750 mm Hg pressure?",
      "image": null,
      "qOptions": ["62.39 mL", "26.39 mL", "6.239 mL", "82.39 mL"],
      "qAnswer": "A"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Calculate coulombic charge on one electron. Given that \\(1\\,F=96500\\,\\text{C}\\) and Avogadro's number \\(=6.023\\times 10^{23}\\).",
      "image": null,
      "qOptions": [
        "\\(1.6\\times10^{-18}\\) C",
        "\\(1.6\\times10^{-19}\\) C",
        "\\(1.6\\times10^{-20}\\) C",
        "\\(9.6\\times10^{-19}\\) C"
      ],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How many faradays of charge would be required to reduce 21.0 g of \\ce{Na2[CdCl4]} to metallic cadmium? (At. wt. of \\ce{Cd}=112.4) Current efficiency is 100%.",
      "image": null,
      "qOptions": [
        "0.041 faraday",
        "0.14 faraday",
        "0.28 faraday",
        "1.4 faraday"
      ],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "If the current strength is 7.5 ampere, how much time will be needed to obtain the cadmium in the previous question?",
      "image": null,
      "qOptions": [
        "19.98 minute",
        "29.98 minute",
        "39.98 minute",
        "59.96 minute"
      ],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How many mole of \\ce{O2} can be obtained by electrolysis of 90 g \\ce{H2O}?",
      "image": null,
      "qOptions": ["1.25 mole", "2.5 mole", "5.0 mole", "3.0 mole"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "In a lead storage battery, the anode reaction is: \\[\\ce{Pb + H2SO4 -> PbSO4 + 2H+ + 2e}\\] How many g of \\ce{Pb} would be used up for battery use for 100 ampere hour?",
      "image": null,
      "qOptions": ["38.64 g", "386.4 g", "486.4 g", "268.4 g"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "A deposit of 5 g \\ce{Cu} in 1930 minute from a solution of \\ce{Cu^{2+}} ion is obtained in electrolysis. What is the strength of current in ampere?",
      "image": null,
      "qOptions": ["1.31 A", "0.131 A", "0.0131 A", "0.310 A"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How many g of \\ce{Cu} will be deposited if the same charge as in the previous question is passed through a \\ce{Cu+} ion solution?",
      "image": null,
      "qOptions": ["5 g", "6.35 g", "10 g", "20 g"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Lactic acid, \\ce{HC3H5O3}, produced in 1 g sample of muscle tissue was titrated using phenolphthalein as indicator against \\ce{OH-} ions obtained by electrolysis of water. If electrolysis was made for 115 second using 15.6 mA current to reach the end point, what was the percentage of lactic acid in muscle tissue?",
      "image": null,
      "qOptions": ["1.673%", "0.01673%", "0.1673%", "0.2673%"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How many electrons per second pass through a cross-section of wire carrying a current of 0.04 ampere?",
      "image": null,
      "qOptions": [
        "\\(2.5\\times10^{18}\\)",
        "\\(2.5\\times10^{17}\\)",
        "\\(2.5\\times10^{16}\\)",
        "\\(1.6\\times10^{17}\\)"
      ],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Find the charge in coulomb on 27 g of \\ce{Al^{3+}} ions.",
      "image": null,
      "qOptions": [
        "\\(2.894\\times10^{5}\\) C",
        "\\(9.648\\times10^{4}\\) C",
        "\\(8.682\\times10^{5}\\) C",
        "\\(1.447\\times10^{5}\\) C"
      ],
      "qAnswer": "A"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Calculate the quantity of electricity (in coulomb) required to liberate enough \\ce{H2} at the cathode during electrolysis of acidified water so that it can fill a balloon of capacity 10 L at a pressure of 1.5 atm at 27\\(^\\circ\\)C.",
      "image": null,
      "qOptions": [
        "\\(1.175\\times10^{5}\\) C",
        "\\(8.50\\times10^{4}\\) C",
        "\\(2.35\\times10^{5}\\) C",
        "\\(5.88\\times10^{4}\\) C"
      ],
      "qAnswer": "A"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "If the \\ce{O2} liberated in the above process is completely used in burning methane, calculate the volume of \\ce{CH4} at STP which is burnt.",
      "image": null,
      "qOptions": ["2.24 L", "3.41 L", "4.48 L", "1.12 L"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "What current strength must be passed for 30 minute through 0.1 M solution of \\ce{Bi(NO3)3} to have complete deposition of metal from 30 mL solution?",
      "image": null,
      "qOptions": ["0.242 A", "0.4825 A", "0.965 A", "0.120 A"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How much time is required for complete decomposition of 2 mole of water using a current of 2 ampere?",
      "image": null,
      "qOptions": [
        "\\(9.65\\times10^{4}\\) s",
        "\\(1.93\\times10^{5}\\) s",
        "\\(3.86\\times10^{5}\\) s",
        "\\(4.83\\times10^{4}\\) s"
      ],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Anthracene (\\(\\ce{C14H10}\\)) can be oxidised anodically to anthraquinone (\\(\\ce{C14H8O2}\\)). What weight of anthraquinone can be produced by passage of a current of 1 ampere for 60 minute if current efficiency is 80\\%?",
      "image": null,
      "qOptions": ["0.8346 g", "1.0346 g", "1.8346 g", "0.5346 g"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Current is passed through a cathode where the reaction is \\(\\ce{5e^- + MnO4^- + 8H^+ -> Mn^{2+} + 4H2O}\\). All the permanganate present in 15.0 mL of solution has been reduced after a current of 0.600 A has passed for 603 s. What was the original concentration of permanganate?",
      "image": null,
      "qOptions": ["0.10 M", "0.05 M", "0.005 M", "0.5 M"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "30 mL of 0.13 M \\ce{NiSO4} is electrolysed using a current of 360 mA for 35.3 minute. How much \\ce{Ni} would have been plated out if current efficiency was only 60\\%? (At. wt. of \\ce{Ni} = 58.7)",
      "image": null,
      "qOptions": ["0.093 g", "0.1391 g", "0.291 g", "0.059 g"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Lake Cayuga has a volume of water estimated to be \\(8.2\\times10^{12}\\) L. A power station produces electricity at a rate of \\(1.5\\times10^{6}\\) coulomb per second at appropriate voltage. How long would it take to electrolyse the lake?",
      "image": null,
      "qOptions": [
        "\\(1.86\\times10^{4}\\) year",
        "\\(1.86\\times10^{5}\\) year",
        "\\(1.86\\times10^{6}\\) year",
        "\\(1.86\\times10^{3}\\) year"
      ],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "If a current of 0.3 ampere is drawn from a Daniel cell for 1 hour, what would be the change in weights of electrodes? (At. wt. of \\ce{Cu}=63.5 and \\ce{Zn}=65.37)",
      "image": null,
      "qOptions": [
        "\\(+\\)0.356 g \\ce{Cu} deposited, \\(-\\)0.366 g \\ce{Zn} dissolved",
        "\\(+\\)0.266 g \\ce{Cu} deposited, \\(-\\)0.356 g \\ce{Zn} dissolved",
        "\\(+\\)0.456 g \\ce{Cu} deposited, \\(-\\)0.266 g \\ce{Zn} dissolved",
        "\\(+\\)0.366 g \\ce{Cu} deposited, \\(-\\)0.356 g \\ce{Zn} dissolved"
      ],
      "qAnswer": "A"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "A solution of metal salt was electrolysed with a current of 0.1 ampere for 160 minute. \\ce{Ni} deposited at cathode was found 0.2950 g. What is the charge on metal ion? (Atomic weight of metal is 58.71.)",
      "image": null,
      "qOptions": ["+1", "+2", "+3", "+4"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "0.5 faraday of electricity was passed to deposit all the copper present in 500 mL of \\ce{CuSO4} solution. What was the molarity of this solution?",
      "image": null,
      "qOptions": ["0.25 M", "0.50 M", "1.00 M", "0.10 M"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "1 g metal \\(\\ce{M^{2+}}\\) was discharged by the passage of \\(1.81\\times10^{22}\\) electrons. What is the atomic weight of the metal?",
      "image": null,
      "qOptions": ["56.7", "66.7", "74.7", "86.7"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How many molecules of \\ce{Cl2} would be deposited from molten \\ce{NaCl} in one minute by a current of 300 milli-ampere?",
      "image": null,
      "qOptions": [
        "\\(5.61\\times10^{18}\\)",
        "\\(5.61\\times10^{19}\\)",
        "\\(5.61\\times10^{20}\\)",
        "\\(1.12\\times10^{19}\\)"
      ],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "In starting a car, the battery delivers roughly 50 A. During the 5 s that might take to start a car, how many gram total of \\ce{Pb} and \\ce{PbO2} are consumed in the battery? (Cell reaction: \\(\\ce{Pb + PbO2 + 2H2SO4 -> 2PbSO4 + 2H2O}\\))",
      "image": null,
      "qOptions": ["0.2577 g", "0.5777 g", "1.5777 g", "0.9077 g"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "If the car were run strictly from batteries, how many gram total of \\ce{Pb} and \\ce{PbO2} would be consumed per km if 50 A made it go at 5 km per hour?",
      "image": null,
      "qOptions": ["73.19 g", "83.19 g", "93.19 g", "63.19 g"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "A Daniel cell has a \\ce{Zn} plate weighing 131.0 g and 5 L of 0.5 M \\ce{CuSO4}. If the cell delivers a steady current of 2 A, how long would the cell run? (\\(\\ce{Zn}=65.5,\\ \\ce{Cu}=63.5\\))",
      "image": null,
      "qOptions": ["25.31 hr", "38.61 hr", "53.61 hr", "65.31 hr"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Electrolysis of \\ce{NaCl(aq)} gives \\ce{NaOH} at cathode. Assuming 100% current efficiency, determine the quantity of electricity required to convert 10 g \\ce{NaCl} into \\ce{NaOH}.",
      "image": null,
      "qOptions": ["9645 C", "16495.7 C", "32991 C", "8248 C"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "An oxide of a metal (at. wt. 56) contains 30% oxygen by weight. The oxide is converted into chloride and the solution electrolysed. If a current of 0.965 A is passed for 5 h, how many grams of the metal are deposited at the cathode?",
      "image": null,
      "qOptions": ["2.36 g", "3.36 g", "4.36 g", "1.36 g"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "For the metal in the previous question, what is the valency?",
      "image": null,
      "qOptions": ["1", "2", "3", "4"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "For the metal in the previous question, what is the formula of the oxide?",
      "image": null,
      "qOptions": [
        "\\(\\ce{MO}\\)",
        "\\(\\ce{M2O}\\)",
        "\\(\\ce{M2O3}\\)",
        "\\(\\ce{MO2}\\)"
      ],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "The same charge is passed through acidulated water and \\ce{SnCl2(aq)}. What total volume of dry detonating gases at NTP are evolved from water when 1 g tin is deposited on the other electrode?",
      "image": null,
      "qOptions": ["188 mL", "282 mL", "376 mL", "224 mL"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "When 8040 C of electricity is passed through molten \\(\\ce{MF2}\\), 3.652 g of metal is deposited. What is the atomic weight of the metal?",
      "image": null,
      "qOptions": ["75.6", "87.66", "96.5", "63.5"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How many electrons pass through the cell in the above deposition of metal from \\(\\ce{MF2}\\)?",
      "image": null,
      "qOptions": [
        "\\(5\\times10^{21}\\)",
        "\\(5\\times10^{22}\\)",
        "\\(5\\times10^{23}\\)",
        "\\(2.5\\times10^{22}\\)"
      ],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "In preparing per disulphuric acid \\(\\ce{H2S2O8}\\) electrolytically from \\ce{H2SO4}, 0.87 g \\ce{H2} and 3.36 g \\ce{O2} are generated at STP as byproducts. Calculate the total quantity of current passed through the solution.",
      "image": null,
      "qOptions": ["62955 C", "73955 C", "83955 C", "93955 C"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Also report the weight of \\(\\ce{H2S2O8}\\) formed in the above process.",
      "image": null,
      "qOptions": ["33.65 g", "43.65 g", "53.65 g", "23.65 g"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "Elements \\(A\\) (atomic mass 112) and \\(B\\) (atomic mass 27) form chlorides. Equal quantities of electricity deposit 5.6 g of \\(A\\) and 0.9 g of \\(B\\). If the valency of \\(B\\) is 3, what is the valency of \\(A\\)?",
      "image": null,
      "qOptions": ["1", "2", "3", "4"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "The reaction \\(\\ce{Cl2(g) + SO2(g) + 2H2O(l) -> 2Cl^{-}(aq) + 3H^{+} + HSO4^{-}(aq)}\\) proceeds readily in aqueous solution. (a) Give the half-cell reactions.",
      "image": null,
      "qOptions": [
        "Anode: \\(\\ce{SO2 + 2H2O -> HSO4^- + 3H^+ + 2e^-}\\); Cathode: \\(\\ce{Cl2 + 2e^- -> 2Cl^-}\\)",
        "Anode: \\(\\ce{SO2 + H2O -> HSO4^- + H^+ + 2e^-}\\); Cathode: \\(\\ce{Cl2 -> 2Cl^- + 2e^-}\\)",
        "Anode: \\(\\ce{HSO4^- + 3H^+ + 2e^- -> SO2 + 2H2O}\\); Cathode: \\(\\ce{2Cl^- -> Cl2 + 2e^-}\\)",
        "Anode: \\(\\ce{SO2 + 2H2O -> SO4^{2-} + 4H^+ + 2e^-}\\); Cathode: \\(\\ce{Cl2 + 2e^- -> 2Cl^-}\\)"
      ],
      "qAnswer": "A"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "The reaction \\(\\ce{Cl2(g) + SO2(g) + 2H2O(l) -> 2Cl^{-}(aq) + 3H^{+} + HSO4^{-}(aq)}\\) proceeds readily in aqueous solution. (b) Design the cell (cell notation).",
      "image": null,
      "qOptions": [
        "\\(\\ce{Pt | SO2 | H2SO4 || HCl | Cl2 | Pt}\\)",
        "\\(\\ce{Pt | SO2 | HCl || H2SO4 | Cl2 | Pt}\\)",
        "\\(\\ce{Pt | Cl2 | H2SO4 || HCl | SO2 | Pt}\\)",
        "\\(\\ce{Pt | SO2 | H2SO4 || Cl2 | HCl | Pt}\\)"
      ],
      "qAnswer": "A"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "The reaction \\(\\ce{Cl2(g) + SO2(g) + 2H2O(l) -> 2Cl^{-}(aq) + 3H^{+} + HSO4^{-}(aq)}\\) proceeds readily in aqueous solution. (c) If a cell initially holds 1 mole of \\ce{Cl2}, for how many days could it sustain a current of 0.05 A, assuming the cell becomes inoperative when 90% of the initial \\ce{Cl2} has been used up?",
      "image": null,
      "qOptions": ["20.1 day", "30.2 day", "40.2 day", "50.2 day"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "A 100 W, 110 V incandescent lamp is connected in series with an electrolytic cell containing \\ce{CdSO4} solution. What weight of \\ce{Cd} will be deposited by the current flowing for 10 hr? (At. wt. of Cd = 112.4)",
      "image": null,
      "qOptions": ["9.06 g", "12.06 g", "19.06 g", "29.06 g"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "A lead storage battery (electrolyte \\ce{H2SO4}) is charged for 100 hr and the specific gravity rises from 1.11 g mL\\(^{-1}\\) (15.7% \\ce{H2SO4} by weight) to 1.28 g mL\\(^{-1}\\) (36.9% \\ce{H2SO4} by weight). If the battery holds 2 L of liquid, calculate the average current used for charging. Assume volume remains constant.",
      "image": null,
      "qOptions": ["0.83 A", "1.23 A", "1.63 A", "2.03 A"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "\\ce{H2O2} is prepared via successive reactions, the first being electrolytic to form \\(\\ce{(NH4)2S2O8}\\). What current must be used in the first reaction to yield 100 g pure \\ce{H2O2} per hour if current efficiency is 50%?",
      "image": null,
      "qOptions": ["215.35 A", "315.35 A", "415.35 A", "115.35 A"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How many coulomb must be applied to a cell for the electrolysis production of 245 g \\ce{NaClO3} from \\ce{NaClO3}? The anode efficiency for the desired reaction is 60%.",
      "image": null,
      "qOptions": [
        "\\(4.83\\times10^{5}\\) C",
        "\\(5.43\\times10^{5}\\) C",
        "\\(6.43\\times10^{5}\\) C",
        "\\(7.43\\times10^{5}\\) C"
      ],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How long must a current of 0.5 A be passed through 50 mL of a 0.010 M \\ce{NaCl} solution in order to make its pH 12, assuming no volume change?",
      "image": null,
      "qOptions": ["46.5 s", "76.5 s", "96.5 s", "126.5 s"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "In the reduction of nitrobenzene to aniline in a cathodic cell, a current of 26.5 A is passed for 1 h and 12.76 g of aniline is produced. Determine the current efficiency.",
      "image": null,
      "qOptions": ["73.27%", "83.27%", "93.27%", "63.27%"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "How long must a current of 3 A be passed through a solution of \\ce{AgNO3} to coat a metal surface of 80 cm\\(^2\\) with a thickness of 0.005 mm? (Density of \\ce{Ag} = 10.5 g cm\\(^{-3}\\))",
      "image": null,
      "qOptions": ["95.09 s", "125.09 s", "155.09 s", "205.09 s"],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "A current of 80 \\(\\mu\\)A is passed through \\ce{AgNO3} for 32 min using Pt electrodes and a single-atom-thick layer is deposited covering 86% of a 601.7 cm\\(^2\\) cathode. Calculate the area covered by one \\ce{Ag} atom.",
      "image": null,
      "qOptions": [
        "\\(5.4\\times10^{-17}\\) cm\\(^2\\)",
        "\\(5.4\\times10^{-16}\\) cm\\(^2\\)",
        "\\(5.4\\times10^{-15}\\) cm\\(^2\\)",
        "\\(5.4\\times10^{-14}\\) cm\\(^2\\)"
      ],
      "qAnswer": "B"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "A current of 15 A is used to plate \\ce{Ni} from \\ce{NiSO4} bath. Both \\ce{H2} and \\ce{Ni} are formed at the cathode; current efficiency for \\ce{Ni^{2+}} reduction is 60%. How many grams of \\ce{Ni} are plated per hour?",
      "image": null,
      "qOptions": ["6.85 g", "8.85 g", "9.85 g", "12.85 g"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "In the above \\ce{Ni} plating, what is the thickness of plating if the cathode consists of a sheet of 4 cm\\(^2\\) coated on both sides? Density of \\ce{Ni} is 8.9 g mL\\(^{-1}\\).",
      "image": null,
      "qOptions": ["0.098 cm", "0.118 cm", "0.138 cm", "0.158 cm"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "In the above \\ce{Ni} plating, what volume of \\ce{H2} is formed per hour at STP?",
      "image": null,
      "qOptions": ["1.51 L", "2.01 L", "2.51 L", "3.01 L"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "In the above \\ce{Ni} plating, what volume of \\ce{O2} is formed per hour at STP?",
      "image": null,
      "qOptions": ["2.13 L", "2.83 L", "3.13 L", "3.83 L"],
      "qAnswer": "C"
    },
    {
      "qType": "SMCQ",
      "passageId": null,
      "qText": "A current of 0.193 A is passed through 100 mL of 0.2 M \\ce{NaCl} for 1 h. Calculate the pH of the solution after electrolysis if current efficiency is 90%. Assume no volume change.",
      "image": null,
      "qOptions": ["11.82", "12.12", "12.82", "13.12"],
      "qAnswer": "C"
    }
  ]
}
'''
    )
    normalized = normalize_all_latex(raw_json)
    print(json.dumps(normalized, ensure_ascii=False, indent=2))
    pass
