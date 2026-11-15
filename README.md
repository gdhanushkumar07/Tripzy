# 🌍 Tripzy — Your Journey, Intelligently Orchestrated

> **CBIT Hackathon Project Submission**  
> An intelligent, adaptive travel planning and execution platform that dynamically creates, verifies, and protects your itineraries against real-world disruptions.

---

## 🚀 Live Deployments & Project Media

* 🌐 **Production Web Application (Vercel):**  
  👉 **[https://tripzy-five-ashen.vercel.app/](https://tripzy-five-ashen.vercel.app/)**
* ⚡ **Production Backend & Intelligence Engine (Render):**  
  👉 **[https://tripzy-y6bi.onrender.com](https://tripzy-y6bi.onrender.com)**
* 🎬 **Project Explainer Video:**  
  Included directly in this repository root: **[`tripzy-explainer.mp4`](./tripzy-explainer.mp4)** *(High-definition video walkthrough of the complete Tripzy experience)*

---

## 💡 The Problem & Our Solution

### The Problem
Traditional travel planners are **static, fragile, and disconnected**. A traveller spends hours compiling a detailed schedule only for it to fall apart when real life happens:
* A delayed train or flight breaks the entire afternoon sequence.
* Sudden rain or high heat ruins outdoor monument visits.
* Unrealistic travel time assumptions lead to traveller fatigue and missed reservations.
* When disruptions strike, travellers are left frantically re-booking and manually recalculating itineraries on the fly.

### The Solution: Tripzy
**Tripzy** is not just an itinerary generator; it is an **intelligent travel orchestrator**. It plans the trip realistically, monitors execution in real time, and dynamically recalculates the schedule whenever disruptions occur.

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 Tripzy User Interface                  │
                  │  (React 19 · Vite · Tailwind · Cinematic Design · PWA) │
                  └───────────────────────────┬────────────────────────────┘
                                              │
                      ┌───────────────────────┴────────────────────────┐
                      ▼                                                ▼
     ┌──────────────────────────────────┐            ┌──────────────────────────────────┐
     │      Tripzy Platform Server      │            │   Tripzy Intelligence Engine     │
     │      (NestJS · SQLite · Auth)    │◄──────────►│     (Python 3.12 · FastAPI)      │
     │  - User Accounts & Sessions      │    HTTP    │  - 🧬 Travel DNA Profiler        │
     │  - Persistent Trip Store         │   Shared   │  - 🌊 Ripple Engine (Replanning) │
     │  - Booking Vault & File Storage  │    Key     │  - ⏱️ Time-Truth Feasibility      │
     │  - WebSockets & Reverse Proxies  │            │  - 🛡️ Shadow Itineraries (Plan B)│
     └──────────────────────────────────┘            └──────────────────────────────────┘
```

---

## ✨ Core Innovations & Key Features

### 1. 🧬 Travel DNA & Profiling
* Rather than asking for generic interests, Tripzy evaluates travellers using an interactive **12-question either/or Travel DNA swipe assessment**.
* Generates a 6-dimensional interest vector (Culture, Nature, Food, Adventure, Relaxation, Pace).
* Accommodates **group energy limits**: calculates pace and stamina based on the group's most vulnerable member (e.g., seniors or children), preventing over-exhaustion.

### 2. 🌊 The Ripple Engine (Dynamic Real-Time Replanning)
* When a disruption occurs (*e.g., train delayed by 90 minutes, sudden rain, traveller fatigue, or extended museum visit*), the **Ripple Engine** recalculates the rest of the day.
* **Deterministic & Smart**:
  * Hotel check-in or leisure downtime absorbs delays first.
  * Fixed commitments (flights, booked concerts, pre-paid tours) are preserved as rigid anchors.
  * Preserves "Golden Hour" sunset views and scheduled meal slots.
  * Presents an interactive **Diff Card** showing exactly what changed, allowing the traveller to accept or keep their original plan.

### 3. ⏱️ Time-Truth Feasibility Engine
* Eliminates the "hallucinated time" flaw of generic AI planners.
* Calculates actual road transit times using **OSRM (Open Source Routing Machine)**.
* Cross-references real operating hours, weekly closure schedules, crowd density patterns, and seasonal weather trends before finalizing any itinerary.

### 4. 🛡️ Shadow Itinerary (Plan B)
* Automatically generates contingency plans for weather-sensitive stops.
* If afternoon monsoon rain is forecasted, Tripzy suggests indoor cultural alternatives (*e.g., museum or palace galleries*) ready to swap with one tap.

### 5. 🤖 Interactive AI Live Companion
* A persistent trip copilot accessible on web and mobile.
* Grounded in the traveller's actual real-time schedule, location, and bookings.
* Answers natural language queries (*"Where can I find vegetarian food nearby?"*, *"What should I pack for tomorrow's weather?"*) using Gemini AI and Geoapify Places API.

### 6. 🎫 Smart Document Vault & OCR
* Travellers can upload boarding passes, train tickets, and hotel reservation PDFs/photos.
* Built-in **Tesseract OCR** extracts dates, confirmation numbers, and arrival times to automatically pin them into the active itinerary.

### 7. 🎒 Readiness Centre & Trip Wallet
* **Departure Checklist**: Auto-completes tasks as travel dates approach.
* **Smart Packing**: Curates luggage essentials adapted to expected destination weather.
* **Emergency Hub**: Offline-accessible local emergency numbers, hospital links, and embassy details.
* **Multi-Currency Budgeting**: Live currency conversion (European Central Bank rates via Frankfurter) and group expense splitting.

---

## 📂 Project Architecture & Directory Structure

The repository is organized into distinct, clean modules:

```
Tripzy/
├── backend/                  # Python 3.12 Intelligence Engine (FastAPI)
│   ├── app/
│   │   ├── engines/          # Travel DNA, Composer, Time-Truth, Ripple Engine
│   │   ├── routers/          # API endpoints (/api/tripzy/*)
│   │   └── data/             # Verified destination catalogues & benchmarks
│   ├── scripts/              # Seed scripts (seed_demo.py)
│   └── tests/                # 29 end-to-end pytest verification tests
│
├── platform/                 # Core Web Application & Backend Services
│   ├── client/               # Frontend Application (React 19, Vite, Tailwind CSS)
│   │   ├── src/pages/tripzy/ # Travel DNA, Plan, Intelligence, Live, Readiness pages
│   │   ├── src/tripzy/       # Companion, Timeline, Engine Bridge, UI components
│   │   └── public/           # Verified destination photography & PWA assets
│   ├── server/               # Platform Backend (NestJS, TypeScript, SQLite)
│   │   ├── src/nest/         # Auth (JWT + Google OIDC), Trips, Uploads, MCP
│   │   └── tests/            # Integration & unit test suites
│   └── shared/               # Shared TypeScript schemas, validation, and i18n
│
├── travel/                   # Multi-modal routing & transit workspace
│   ├── src/                  # Route view, commute planners, group split journeys
│   └── server/               # Micro-transit endpoints & GTFS integrations
│
├── Dockerfile                # Production multi-stage Dockerfile
├── DEPLOY.md                 # Production deployment & environment documentation
├── start.sh                  # One-command local startup script
└── tripzy-explainer.mp4      # High-definition submission video walkthrough
```

---

## 🛠️ How to Build and Run Locally

### Prerequisites
* **Node.js** v20+ and **npm**
* **Python** 3.12+
* *(Optional)* **Tesseract OCR** (`brew install tesseract` on macOS or `apt install tesseract-ocr` on Linux)

### 1. One-Command Quickstart
```bash
# 1. Clone the repository
git clone https://github.com/Accurate-Hackathon/CBIT-Nirvana.git
cd CBIT-Nirvana

# 2. Install dependencies & initialize environment
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cd ..
cd platform && npm install && cp server/.env.example.tripzy server/.env && cd ..

# 3. Launch all services together
./start.sh
```

The script will launch:
* 🌐 **Frontend**: `http://localhost:5173`
* 🔌 **Platform API**: `http://localhost:3001`
* 🧠 **Intelligence Engine**: `http://localhost:8000`

---

## 🔑 Judge Demo Account & Verification

Judges can test the platform instantly with our pre-seeded evaluation account:

| Detail | Credentials |
| :--- | :--- |
| **URL** | [https://tripzy-five-ashen.vercel.app/login](https://tripzy-five-ashen.vercel.app/login) |
| **Email** | `demo@tripzy.app` |
| **Password** | `Tripzy@2026` |
| **Profile** | Pre-configured Travel DNA + active multi-day demo trip with train booking |

*(You can also click **"Get Started"** or visit `/signup` to register a fresh account and experience the 12-question onboarding flow from scratch).*

---

## ⚙️ API Keys & Environment Configuration

Tripzy is engineered to be **fully functional out of the box** using public APIs (OSRM routing, Open-Meteo forecasts, Frankfurter currency rates). 

Optional API keys can be provided in `api-keys.env` or server environment variables:

| Environment Key | Provider | Capability Enabled |
| :--- | :--- | :--- |
| `OIDC_CLIENT_ID` / `_SECRET` | Google Cloud | "Continue with Google" OAuth 2.0 authentication |
| `GEOAPIFY_API_KEY` | Geoapify | Live Companion nearby recommendations (cafés, pharmacies, ATMs) |
| `LITEAPI_KEY` | LiteAPI | Live hotel inventory, pricing, and amenities comparison |
| `TRAVELPAYOUTS_TOKEN` | Travelpayouts | Real-time flight schedule and fare retrieval |
| `GEMINI_API_KEY` | Google Gemini | Generative trip narrative recap & open-ended conversational QA |

---

## 🧪 Automated Testing & Verification

Tripzy includes comprehensive test coverage across both backend and frontend layers:

```bash
# Run Python Intelligence Engine test suite (29 tests)
cd backend && .venv/bin/pytest tests/

# Run Server Vitest integration tests
cd platform && npm run test --workspace=server

# Run Frontend production build verification
cd platform && npm run build --workspace=client
```

**Verification Status:**
* ✅ **29/29 Python tests passing** (`test_companion.py`, `test_flow.py`, `test_platform.py`, `test_security.py`)
* ✅ **Client Vite production build:** 0 errors, full PWA precache generation
* ✅ **Server build:** 0 TypeScript compile errors

---

## 👥 Hackathon Team — CBIT Nirvana

* **Project:** Tripzy
* **Repository:** [Accurate-Hackathon/CBIT-Nirvana](https://github.com/Accurate-Hackathon/CBIT-Nirvana.git)
* **Live App:** [https://tripzy-five-ashen.vercel.app/](https://tripzy-five-ashen.vercel.app/)
