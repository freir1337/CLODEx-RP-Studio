# Changelog

## 1.1.0 — 2026-11-18

- **Character Voice (CLODEx TTS) for Tavo AI & SillyTavern**: `/v1/audio/voices` catalog loader, per-character voice binding, one-tap `Speak Character Reply` action in Tavo's message bar, and a smart *Dialogue-Only* filter that strips `*asterisk actions*` so only spoken lines are synthesized.
- **Custom Story Meters & Inventory Builder**: one-click preset packs (*Dark Romance: Obsession/Sin/Trust*, *Fantasy RPG: Sanity/Mana/Gold*, *Detective: Suspicion/Clues*), custom user-defined sliders pinned to the HUD pill, per-character inventory tags, automatic AI turn updates, and full rollback on message swipe/deletion.
- **1-Click Character & Lorebook Forge**: generates a complete **Character Card V2** with multi-entry keyword Lorebook (`character_book`) + **Nano Banana** portrait, embeds the CCv2 JSON directly into the PNG `chara` `tEXt` chunk, and imports into Tavo AI (`tavo.character.import`) or SillyTavern / exports as a shareable PNG card.

## 1.0.0 — 2026-11-18

- Shared RP simulation core for **Tavo AI** (`.tpg` Manifest v2) and **SillyTavern 1.19+** powered by CLODEx API (`https://clodex.xyz`).
- **Physiology & Vitals Tracker** (enabled by default): heart rate, respiration rate/type, circulation, blood loss percentage, wounds/bleeding, stamina, stress, calendar dates, and anti-rollback timeskip tracking with swipe/delete checkpoints.
- **18+ Biology Modules** (opt-in toggle):
  - *Realistic Cycle & Pregnancy* (40w, contraception, hidden conception rolls, Modern/Medieval/Omniscient AI Fog-of-War, ultrasound milestones, natural & C-section delivery, postpartum recovery, Family Tree);
  - *Omegaverse Pro* (36w, Omega/Alpha/Beta/Enigma dynamics, pheromone scent & intensity, suppressants, heat/rut cycles, temporary & permanent bond marks);
  - *Oviposition & Nest Pro* (clutch fertilization, per-egg or full-clutch laying, nest warmth incubation speed, shell cracking, hatching into Family Tree).
- **Lore & Canon Navigator (Codex)**: in-chat sidecar consultant with presets (*Card & Chat Lore Keeper*, *Bible, Latin & Dante / "Biblical Mistral"*, *Medicine & Trauma*, *Custom*) plus one-click composer insertion and next-turn AI memory injection.
- **Live Scene Background & Video Loop**: Nano Banana / CLODEx image generation (`/v1/images/generations`) applied to the chat background plus Image-to-Video (`/v1/videos`) ambient looping backdrop with resumable `taskId` tracking and live wallet balance.
