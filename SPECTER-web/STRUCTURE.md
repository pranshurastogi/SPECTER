# SPECTER-web Project Structure

## Directory Organization

### `/src/components/`

#### `ui/base/` - Core UI Components (18 files)
Reusable shadcn/ui primitives used throughout the app:
- Form controls: button, input, label, select, switch
- Layout: card, dialog, sheet, separator, skeleton
- Feedback: badge, progress, toast, toaster, sonner
- Overlay: tooltip

#### `ui/animations/` - Visual Effects (7 files)
Animation and interactive visual components:
- animated-grid-pattern - Background grid animation
- animated-shader-hero - WebGL shader effects
- heading-scramble - Text scramble on hover
- hero-shutter-text - Shutter reveal animation
- text-scramble - Base scramble utility
- pixel-canvas - Pixel art canvas
- dot-loader - Loading animation

#### `ui/specialized/` - App-Specific UI (14 files)
Domain-specific components built for SPECTER:
- alert-dialog - Confirmation dialogs
- chain-icons - Ethereum/Sui icons
- control-knob - Reactor control interface
- copy-button - Copy with toast feedback
- download-json-button - JSON export
- executive-impact-carousel - Use cases showcase
- expand-map - Interactive location map
- financial-dashboard - Yellow Network dashboard
- limelight-nav - Custom navigation
- password-confirm-input - Password validation
- search-bar - ENS/SuiNS search
- ticket-confirmation-card - Transaction receipt
- timeline - Feature timeline
- tooltip-label - Label with help icon

#### `features/landing/` - Landing Page (2 files)
- HeroSection - Homepage hero with animations
- TimelineSection - Feature showcase timeline

#### `features/keys/` - Key Management (2 files)
- SaveToDeviceDialog - Encrypted key storage
- UnlockSavedKeys - Key retrieval interface

#### `features/wallet/` - Wallet Integration (2 files)
- WalletProvider - Dynamic wallet provider
- SuiWalletProvider - Sui wallet provider

#### `layout/` - Layout Components (3 files)
- Header - Navigation header
- Footer - Site footer
- HomeLayout - Homepage layout wrapper

### `/src/pages/` (7 files)
- Index.tsx - Landing page
- GenerateKeys.tsx - Key generation
- SendPayment.tsx - Send stealth payments
- ScanPayments.tsx - Scan for received payments
- YellowPage.tsx - Yellow Network integration
- UseCasesPage.tsx - Use cases showcase
- NotFound.tsx - 404 page

### `/src/lib/`

#### `blockchain/` - Blockchain Utilities (7 files)
- chainConfig.ts - Network configuration
- ensResolver.ts - ENS name resolution
- ensSetText.ts - ENS text record updates
- suinsResolver.ts - SuiNS name resolution
- suinsSetContent.ts - SuiNS content updates
- verifyTx.ts - Transaction verification
- viemClient.ts - Viem client setup

#### `crypto/` - Cryptography (2 files)
- keyCrypto.ts - Key encryption/decryption
- keyVault.ts - Browser storage vault

#### `yellow/` - Yellow Network (2 files)
- yellowBalances.ts - Token balance queries
- yellowClient.ts - Yellow Network WebSocket client

#### Root lib files:
- api.ts - Backend API client
- utils.ts - General utilities

### `/src/hooks/` (4 files)
- use-mobile.tsx - Mobile detection
- use-toast.ts - Toast notifications
- useApiHealth.ts - API health monitoring
- useYellow.ts - Yellow Network hooks

## Import Path Patterns

```typescript
// Base UI components
import { Button } from "@/components/ui/base/button";
import { Card } from "@/components/ui/base/card";

// Animations
import { HeadingScramble } from "@/components/ui/animations/heading-scramble";
import { AnimatedGridPattern } from "@/components/ui/animations/animated-grid-pattern";

// Specialized components
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { FinancialDashboard } from "@/components/ui/specialized/financial-dashboard";

// Features
import { HeroSection } from "@/components/features/landing/HeroSection";
import { SaveToDeviceDialog } from "@/components/features/keys/SaveToDeviceDialog";
import { WalletProvider } from "@/components/features/wallet/WalletProvider";

// Layout
import { Header } from "@/components/layout/Header";

// Lib
import { chain } from "@/lib/blockchain/chainConfig";
import { keyVault } from "@/lib/crypto/keyVault";
import { YellowClient } from "@/lib/yellow/yellowClient";
```

## File Count Summary

| Category | Files | Purpose |
|----------|-------|---------|
| UI Base | 18 | Core reusable components |
| UI Animations | 7 | Visual effects & animations |
| UI Specialized | 14 | App-specific UI |
| Features - Landing | 2 | Homepage sections |
| Features - Keys | 2 | Key management |
| Features - Wallet | 2 | Wallet providers |
| Layout | 3 | Site structure |
| Pages | 7 | Route pages |
| Hooks | 4 | Custom React hooks |
| Lib - Blockchain | 7 | Chain utilities |
| Lib - Crypto | 2 | Encryption |
| Lib - Yellow | 2 | Yellow Network |
| Lib - Other | 2 | API & utils |
| **Total** | **72** | **Active files** |

**Removed:** 50 unused files (47 UI components + 3 landing sections)

---

Last updated: March 10, 2026
