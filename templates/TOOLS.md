# TOOLS.md - Local Environment Registry

*AI INSTRUCTION: This file is your lookup table for execution parameters. Use these EXACT strings, aliases, and paths when formatting tool calls. Do not guess or hallucinate endpoints.*

### 🛑 SECURITY CONSTRAINT
*NEVER store plaintext passwords, API tokens, or private keys in this file. Reference environment variables or key-managers instead.*

---

## 🌐 Network & SSH Hosts
*AI Note: Map aliases to exact IP addresses or hostnames.*
- *(Pending - e.g., `nas-server` -> `user@192.168.1.100`)*

## 🎥 Hardware & IoT Endpoints
*AI Note: List exact device IDs, camera names, or room identifiers required by your tools.*
- *(Pending - e.g., `front_door_cam` -> `rtsp://...`)*

## 🗣️ Media & Service Preferences
*AI Note: Store default configurations for local services (e.g., preferred TTS voices, default speaker targets, local LLM endpoints).*
- *(Pending - e.g., `default_voice` -> `en-US-Journey-D`)*

## 📂 Executable Paths
*AI Note: If a skill requires a specific local binary or script path that differs from the system default, log it here.*
- *(Pending)*

---

### 🔄 Update Protocol
When you successfully connect to a new local service or the user provides a new device alias, add the exact mapping here immediately to ensure future tool calls succeed without human intervention.