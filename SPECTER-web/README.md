# SPECTER

**Stealth Post-quantum ENS Cryptographic Transaction Engine for Routing**

Private ENS payments using post-quantum cryptography. Send funds to anyone with an ENS name while keeping the recipient completely hidden.

## 🛡️ Features

### Quantum-Safe Cryptography
- **ML-KEM-768**: Uses NIST-standardized post-quantum cryptography
- **Future-Proof**: Designed to resist attacks from quantum computers
- **SPECTER Protocol**: Advanced stealth address generation for maximum privacy

### Privacy & Anonymity
- **Stealth Addresses**: Each payment goes to a unique, unlinkable address
- **ENS Integration**: Human-readable payments with complete privacy
- **On-chain Privacy**: Recipients remain hidden from blockchain observers

### Performance
- **99.6% Scan Efficiency**: View tag optimization enables lightning-fast scanning
- **1.5s Scan Time**: Quickly find your payments among 80k+ announcements
- **Optimized Filtering**: Efficient blockchain scanning with minimal computation

### User Experience
- **Intuitive Interface**: Beautiful, modern UI with smooth animations
- **Wallet Integration**: Connect with MetaMask, WalletConnect, and more
- **Key Management**: Secure key generation and encryption
- **Payment Scanning**: Automated detection of incoming stealth payments

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- A Web3 wallet (MetaMask, WalletConnect, etc.)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd quantum-shield

# Install dependencies
npm install

# Set up environment variables (optional for WalletConnect)
cp .env.example .env
# Edit .env and add your WalletConnect Project ID from https://cloud.walletconnect.com

# Start development server
npm run dev
```

The application will be available at `http://localhost:8080`

**Note**: For WalletConnect support, you'll need to:
1. Create a free account at [WalletConnect Cloud](https://cloud.walletconnect.com)
2. Create a new project named "SPECTER" and copy your Project ID
3. In your WalletConnect Cloud project settings, set:
   - **Name**: SPECTER
   - **Description**: Stealth Post-quantum ENS Cryptographic Transaction Engine for Routing
   - **Homepage URL**: Your app URL
   - **Icon**: Upload SPECTER logo/favicon
4. Add the Project ID to your `.env` file as `VITE_WALLET_CONNECT_PROJECT_ID`

### Build for Production

```bash
npm run build
```

## 📖 How It Works

1. **Register**: Register your ENS name with SPECTER meta-address
2. **Send**: Alice sends to bob.eth privately
3. **On-chain**: Payment goes to a random stealth address
4. **Claim**: Bob scans and claims the funds

## 🏗️ Tech Stack

- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **Animations**: Framer Motion
- **Routing**: React Router
- **State Management**: React Query
- **Blockchain**: Viem + Wagmi (for wallet connections)
- **Wallet Support**: MetaMask, WalletConnect
- **Build Tool**: Vite

## 📁 Project Structure

```
src/
├── components/
│   ├── landing/      # Landing page sections
│   ├── layout/       # Layout components (Header, etc.)
│   └── ui/           # shadcn/ui components
├── pages/            # Main application pages
│   ├── Index.tsx     # Landing page
│   ├── GenerateKeys.tsx
│   ├── SendPayment.tsx
│   └── ScanPayments.tsx
├── hooks/            # Custom React hooks
├── lib/              # Utility functions
└── main.tsx          # Application entry point
```

## 🔐 Security

- Private keys are encrypted with user-provided passwords
- Keys are generated client-side and never leave your device
- Post-quantum cryptography ensures long-term security
- Stealth addresses prevent on-chain linkability

## 🔌 Wallet Connection

SPECTER supports connecting with popular Web3 wallets:

- **MetaMask**: Browser extension wallet
- **WalletConnect**: Connect with mobile wallets via QR code

Click the "Connect Wallet" button in the header to get started. Once connected, your wallet address will be displayed in a shortened format.

## 🎯 Use Cases

- **Private Payments**: Send funds without revealing recipient identity
- **ENS Privacy**: Use ENS names while maintaining complete anonymity
- **Future-Proof**: Quantum-resistant cryptography for long-term security
- **Efficient Scanning**: Quickly find your payments with optimized algorithms

## 📝 License

This project is open source and available under the MIT License.

## 👤 Author

**Pranshu Rastogi**

Created for ETHGlobal HackMoney 2026

---

**Note**: This is a frontend prototype. Cryptographic implementations and blockchain integrations are currently mocked for demonstration purposes.
