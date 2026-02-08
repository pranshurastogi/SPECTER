# SPECTER Web

Frontend for the SPECTER stealth address protocol. Built with React, Vite, and TypeScript.

See the [root README](../README.md) for full project documentation.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Requires the Rust backend running at `http://localhost:3001` (default). Set `VITE_API_BASE_URL` in `.env` to override.

## Pages

- **Setup** - Generate ML-KEM-768 keypairs, upload meta-address to IPFS, attach to ENS or SuiNS
- **Send** - Resolve a recipient name, generate stealth address, send from wallet or manually, verify and publish
- **Scan** - Scan announcements with viewing key, discover payments, export stealth private keys
- **Yellow** - Private trading via Yellow Network state channels (create channels, fund, send payments, settle to stealth addresses)
- **Use Cases** - Overview of SPECTER use cases and Yellow Network integration

## Tech

- **React + Vite + TypeScript**
- **TailwindCSS** + **Radix UI** for styling
- **Dynamic Labs** for EVM wallet connection
- **@mysten/dapp-kit** for Sui wallet connection
- **viem** for Ethereum transactions
- **Framer Motion** + **GSAP** for animations
- **Nitrolite SDK** for Yellow Network state channel operations

## Project structure

```
src/
├── pages/
│   ├── GenerateKeys.tsx    # Setup: keypair generation, IPFS upload, ENS/SuiNS attach
│   ├── SendPayment.tsx     # Send: resolve name, stealth address, wallet/manual send
│   ├── ScanPayments.tsx    # Scan: discover payments, export stealth keys
│   ├── YellowPage.tsx      # Yellow Network: channels, funding, payments, settlement
│   └── UseCasesPage.tsx    # Use cases overview
├── lib/
│   ├── api.ts              # Backend API client
│   ├── verifyTx.ts         # On-chain tx verification (ETH + Sui)
│   ├── ensSetText.ts       # ENS text record signing
│   ├── suinsSetContent.ts  # SuiNS content hash signing
│   ├── viemClient.ts       # Shared viem public client
│   ├── chainConfig.ts      # ETH chain configuration
│   ├── yellowService.ts    # Yellow Network WebSocket + session management
│   ├── nitroliteYellow.ts  # Nitrolite SDK: on-chain channel creation + auth
│   └── yellowBalances.ts   # Token balance fetching for Yellow channels
├── components/
│   ├── ui/                 # Radix-based UI primitives
│   └── layout/             # Header, Footer
└── main.tsx
```

## Scripts

```bash
npm run dev       # Development server
npm run build     # Production build
npm run test      # Run tests (vitest)
```
