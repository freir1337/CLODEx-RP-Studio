# CLODEx RP Studio (for Tavo AI & SillyTavern)

**AI Physiology & 18+ Biology Tracker + Cradle & Familiar (Multimodal Companion & Dynasty System) + Lore Navigator (Codex) + Live Scene Backgrounds, Video & Voice — powered by a single CLODEx API key.**

[Русская документация](README.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE)

---

## Highlights

- **Tag-Free Physiology & State Tracker:** Uses a fast background CLODEx model to extract JSON turn deltas while computing all cycle math, conception rolls, wound/bleeding states, and Fog-of-War masking deterministically in code — with automatic rollback checkpoints on message swipe, regeneration, or deletion.
- **Default SFW Vitals + Opt-in 18+ Biology:**
  - *Respiration, Pulse & Circulation* (heart rate, breath rate, blood loss %, active wounds, stamina, stress);
  - *Realistic Cycle & Pregnancy (40w)*, *Omegaverse Pro (36w)*, and *Oviposition & Nest Pro* behind an explicit 18+ toggle, with Modern, Medieval/Fantasy, and Omniscient disclosure modes plus Family Tree tracking.
- **Cradle & Familiar — Multimodal Companion & Dynasty (`v1.2`):** Summon an SFW familiar right from Turn 1 (*Spirit Fox, Shadow Raven, Dragon Whelp, Homunculus, Celestial Wisp*) or adopt any child/hatchling from your Family Tree in 1 click with inherited traits from story meters. Features Zero-Punishment care (`infant → child → teen → adult`), stage-evolved **Nano Banana** portraits, **Image-to-Video** loops, stage-aware **TTS** voice reactions, and 1-click graduation into a playable 2nd-generation **Character Card V2 + Lorebook PNG**.
- **Lore & Canon Navigator (Codex):** Ask about character card details, Dante's *Divine Comedy*, Biblical/Latin references, or medical realism without polluting chat history; insert quotes into input or arm a one-turn AI memory hint in one tap.
- **Live Scene Backgrounds, Video & Per-Character Voice:** Generate chat-scoped scene backgrounds with **Nano Banana** (`/v1/images/generations`), animate looping video backdrops via `/v1/videos` (Image-to-Video), and synthesize character replies via `/v1/audio/speech` with per-character `voiceMap` binding and a smart *dialogue-only* filter.
- **Custom Story Meters, 1-Click Forge & FinOps Shield (`v1.1–v1.2`):** Track custom stats & inventory, forge complete **CCv2 + Lorebook + Nano Banana PNG** cards, navigate cleanly via a mobile-first single-row 4-tab bar (390px-ready), and protect wallet balance with a configurable session auto-spend cap (`maxAutoSpendUsd`).

---

## Installation

- **Tavo AI (`v0.93.0+`):** Download **[CLODEx-RP-Studio-1.2.0.tpg](https://github.com/mereyabdenbekuly-ctrl/CLODEx-RP-Studio/releases/download/v1.2.0/CLODEx-RP-Studio-1.2.0.tpg)**, enable **Advanced Rendering**, import the `.tpg` package under **Plugins**, enter your `sk-...` key from `https://clodex.xyz`, and tap the top HUD pill in chat.
- **SillyTavern (`1.19.0+`):** Install via **Extensions → Install Extension** using `https://github.com/mereyabdenbekuly-ctrl/CLODEx-RP-Studio` (or download **[CLODEx-RP-Studio-SillyTavern-1.2.0.zip](https://github.com/mereyabdenbekuly-ctrl/CLODEx-RP-Studio/releases/download/v1.2.0/CLODEx-RP-Studio-SillyTavern-1.2.0.zip)** and unpack into `data/<user>/extensions/CLODEx-RP-Studio`). If `CLODEx for SillyTavern` is already installed, your API key is detected automatically.
