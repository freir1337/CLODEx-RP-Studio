# CLODEx RP Studio (for Tavo AI & SillyTavern)

**AI Physiology & 18+ Biology Tracker + Lore & Canon Navigator (Codex) + Live Scene Backgrounds & Video Loops (Nano Banana + I2V) — powered by a single CLODEx API key.**

[Русская документация](README.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE)

---

## Highlights

- **Tag-Free Physiology & State Tracker:** Uses a fast background CLODEx model to extract JSON turn deltas while computing all cycle math, conception rolls, wound/bleeding states, and Fog-of-War masking deterministically in code — with automatic rollback checkpoints on message swipe or deletion.
- **Default SFW Vitals + Opt-in 18+ Biology:**
  - *Respiration, Pulse & Circulation* (heart rate, breath rate, blood loss %, active wounds, stamina, stress);
  - *Realistic Cycle & Pregnancy (40w)*, *Omegaverse Pro (36w)*, and *Oviposition & Nest Pro* behind an explicit 18+ toggle, with Modern, Medieval/Fantasy, and Omniscient disclosure modes plus Family Tree tracking.
- **Lore & Canon Navigator (Codex):** Ask about character card details, Dante's *Divine Comedy*, Biblical/Latin references, or medical realism without polluting chat history; insert quotes into input or arm a one-turn AI memory hint in one tap.
- **Live Scene Backgrounds, Video & Character Voice:** Generate scene backgrounds with **Nano Banana** (`/v1/images/generations`), animate them into looping video backdrops via `/v1/videos` (Image-to-Video), and synthesize character replies via `/v1/audio/speech` with a smart *dialogue-only* filter.
- **Custom Story Meters, Inventory & 1-Click Character Forge (`v1.1`):** Track custom stats (Obsession, Sanity, Mana, Trust) & inventory with swipe rollback, or forge complete **Character Card V2 + Lorebook + Nano Banana PNG** cards in one click.

---

## Installation

- **Tavo AI (`v0.93.0+`):** Download **[CLODEx-RP-Studio-1.1.0.tpg](https://github.com/mereyabdenbekuly-ctrl/CLODEx-RP-Studio/releases/download/v1.1.0/CLODEx-RP-Studio-1.1.0.tpg)**, enable **Advanced Rendering**, import the `.tpg` package under **Plugins**, enter your `sk-...` key from `https://clodex.xyz`, and tap the top HUD pill in chat.
- **SillyTavern (`1.19.0+`):** Install via **Extensions → Install Extension** using `https://github.com/mereyabdenbekuly-ctrl/CLODEx-RP-Studio` (or download **[CLODEx-RP-Studio-SillyTavern-1.1.0.zip](https://github.com/mereyabdenbekuly-ctrl/CLODEx-RP-Studio/releases/download/v1.1.0/CLODEx-RP-Studio-SillyTavern-1.1.0.zip)** and unpack into `data/<user>/extensions/CLODEx-RP-Studio`). If `CLODEx for SillyTavern` is already installed, your API key is detected automatically.
