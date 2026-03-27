# 🌐 OfflineNet — QR-Based Emergency Communication System

## 🚨 Problem Statement

In war zones and disaster scenarios, **internet and communication infrastructure often fail**.

This leads to:

* No access to emergency updates
* Inability to share critical information
* Lack of coordination for food, medical aid, and evacuation
* Spread of misinformation without verification

There is a need for a **fully offline, decentralized communication system** that works without servers or internet.

---

## 💡 Solution

OfflineNet is an **offline-first emergency communication network** where:

* 📱 Devices act as nodes
* 👥 Humans act as routers
* 🧾 Messages act as packets
* 🔲 QR codes act as the transport layer

### 🔁 Core Idea:

Messages are created → converted into QR → scanned by another device → stored locally → propagated further.

✅ No internet required
✅ No server dependency
✅ Works in complete network blackout

---

## 🧰 Tech Stack

### Frontend

* React 18
* Vite

### Core Libraries

* `qrcode` → QR generation
* `html5-qrcode` → QR scanning
* `uuid` → Unique message IDs

### Storage

* localStorage (offline persistence)

### Browser APIs

* Camera (QR scanning)
* Canvas (QR rendering)

---

## 📁 File Structure

```
/
├── package.json
├── README.md
│
├── /utils
│   ├── messageSchema.js     # Message creation & validation
│   ├── storage.js           # Local storage + deduplication
│   └── qrCodec.js           # Encode/decode messages (Base64)
│
└── /components
    ├── App.jsx              # Main app controller
    ├── MessageCreator.jsx   # Create message form
    ├── QRGenerator.jsx      # Generate QR code
    ├── QRScanner.jsx        # Scan QR code
    └── MessageFeed.jsx      # Display messages
```

---

## 🔄 Data Flow

### 📱 Device A (Sender)

User creates message
↓
Message is validated
↓
UUID generated
↓
Saved to localStorage
↓
Encoded into Base64
↓
Converted to QR code
↓
User shares QR

---

### 📱 Device B (Receiver)

User scans QR
↓
QR → Base64 decoded
↓
JSON parsed
↓
Schema validated
↓
Duplicate check
↓
Hop count incremented
↓
Saved to localStorage
↓
Displayed in feed

---

## ⚙️ Setup Instructions

### ✅ Prerequisites

* Node.js 16+
* Modern browser (camera required for scanning)

---

### 📦 Installation

```bash
npm install
```

---

### ▶️ Run Development Server

```bash
npm run dev
```

---

### 🏗️ Build for Production

```bash
npm run build
```

---

### 📷 Browser Permissions

* Camera access is required for QR scanning
* Browser will prompt on first use

---

## 🎯 Key Features

* 🔌 Fully offline (no backend)
* 🔁 QR-based message transfer
* 🧠 Structured message schema
* 🔄 Hop count tracking (network propagation)
* 🚫 Duplicate prevention
* 📊 Local message feed

---

## 🧠 System Insight

This system behaves like a **distributed network without internet**:

* Each phone stores and forwards data
* Messages spread physically across devices
* Information persists even without connectivity

---

## 🚀 Future Enhancements

* IndexedDB (scalable storage)
* AI classification (Claude / LLM)
* Trust scoring system
* Encryption for sensitive messages

---

## 📄 License

MIT — Free for humanitarian and emergency use

---

**Built for resilience. Designed for real-world crises.**
