# Changelog

## 1.2.0 — 2026-11-18

- **Cradle & Familiar («Колыбель и Фамильяр») — Multimodal RP Companion & Dynasty System**:
  - **Turn-1 SFW Familiars & 1-Click Family Tree Adoption**: summon an SFW companion right from Turn 1 (*Spirit Fox*, *Shadow Raven*, *Dragon Whelp*, *Homunculus*, *Celestial Wisp*) or transfer any baby/hatchling from `Family Tree & Offspring` in one click with inherited personality traits derived from your active story meters (`obsession`, `sanity`, `trust`, `mana`, etc.) and biology mode.
  - **Tag-Free Growth & Zero-Punishment Care**: 4 life stages (`infant` → `child` → `teen` → `adult`), live HUD pill chip (`🐣 Name · Stage · 💛Mood%`), 4 care meters (*Fullness*, *Mood*, *Bond*, *Energy*) with offline Zero-Punishment floor (`>= 20`), and 5 tactile care actions (*Feed*, *Pet*, *Train*, *Play*, *Rest*) that arm natural RP hints for the next AI turn and roll back cleanly on message swipe/delete.
  - **Multimodal Embodiment via CLODEx**: generate stage-evolved portraits via **Nano Banana** (`/v1/images/generations`), animate 4-second loops via **Image-to-Video** (`/v1/videos`), and synthesize stage-aware voice reactions (*infant babble/purrs → child/teen/adult speech*) via `/v1/chat/completions` + `/v1/audio/speech` with personal `voiceId`.
  - **2nd-Generation Dynasty Graduation**: 1-click graduation exports a grown child or familiar into the **CCv2 Character & Lorebook Forge** to mint a standalone playable PNG Character Card V2 with a 5-entry childhood & lineage Lorebook.
- **Mobile 1-Row Tab Discipline & Chat-Scoped Media Isolation**:
  - Streamlined primary navigation into a crisp single-row 4-tab bar (`🧬 Tracker` | `🐣 Cradle` | `📜 Codex` | `🍌 Scene`) even on 390px mobile viewports, moving `⚒️ Forge` and `🔑 Key & Models` to compact header quick-buttons; isolated Tavo virtual media files with `scope: 'chat'` and added `message:updated` regeneration checkpoint rollback.
- **Per-Character Voice Binding & FinOps Auto-Spend Shield**:
  - Selecting or entering a voice in *Scene & Voice* now persists both `defaultVoice` and per-character `voiceMap[charName]`.
  - Added `maxAutoSpendUsd` (default `$0.25`) session budget guard in *Key & Models* that tracks automatic background spend (`autoSpeak` / `autoImageEvery`) and pauses auto-calls with a clear notice before exceeding your cap, plus clearer quote-based pricing display in model selectors.

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
