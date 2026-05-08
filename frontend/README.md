# Loopchain frontend

Not scaffolded yet. Planned stack:

- Vite + React + TypeScript
- Privy SDK (Kernel smart wallet, EIP-7702 enabled in client config)
- viem for contract reads/writes
- Tone.js for the audio engine
- WebSocket subscription to MegaETH for live grid state

When ready, init from this directory:

```bash
pnpm create vite@latest . --template react-ts
pnpm add @privy-io/react-auth @zerodev/sdk @zerodev/permissions viem tone
```

See [`../docs/ux-architecture.md`](../docs/ux-architecture.md) and [`../docs/stack-and-7702.md`](../docs/stack-and-7702.md) for the architecture (the stack-and-7702 doc supersedes §3 of ux-architecture).
