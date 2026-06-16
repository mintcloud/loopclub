import { useEffect, useState, useCallback, useRef } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets'
import { encodeFunctionData, formatUnits, maxUint256, decodeEventLog } from 'viem'
import { Grid, type CellStatus } from './Grid'
import { CellPopover } from './CellPopover'
import { RowToolsPopover } from './RowToolsPopover'
import { ContributorStrip } from './ContributorStrip'
import { RenewStrip } from './RenewStrip'
import { Library, type LoopRecord } from './Library'
import { useMyCells } from './useMyCells'
import {
  config,
  megaethMainnet,
  LOOP_DURATION_SECONDS,
  STEPS,
  SYNTH_CELL_START,
  SYNTH_PITCH_DEFAULT,
  DEFAULT_TOGGLE_LOOPS,
  MAX_TOGGLE_LOOPS,
  type CellTier,
} from './config'
import { loopclubAbi, usdmAbi } from './abi'
import { publicClient, usingWebSocket } from './viemClient'
import logoUrl from '../../design-system/assets/loopclub-logo.png'
import { useLiveGrid } from './useLiveGrid'
import { useSessionKey, type SessionKey } from './useSessionKey'
import { fromLink, litCells, synthPitches, LinkError } from 'loopclub-loopgen'
import type { ClickPhase } from './useClickTier'
import { startAudio, stopAudio, setLiveState, setSnapshot, onStep, previewCell } from './audio'

// The live grid streams from chain events; only wallet/price state is polled.
const WALLET_POLL_MS = 5000

// sessionStorage slot for the dismissed "connect first" nudge (shipping
// sequence Part 1). Per-tab-session so the nudge reappears on a fresh visit.
const CONNECT_NUDGE_DISMISSED = 'loopclub.connectnudge.dismissed.v1'

// A single call inside a batched smart-wallet UserOperation.
type Call = { to: `0x${string}`; data: `0x${string}` }

export function App() {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const { client: smartWalletClient } = useSmartWallets()

  const grid = useLiveGrid()

  const [usdmBalance, setUsdmBalance] = useState<bigint>(0n)
  // usdmBalance starts at 0n and only becomes real after the first chain read
  // resolves — which can take tens of seconds behind a slow/rate-limited RPC.
  // `balanceLoaded` gates the pre-flight "not enough balance" guards so they
  // don't fire against that placeholder zero and block every rent on startup.
  const [balanceLoaded, setBalanceLoaded] = useState(false)
  const [allowance, setAllowance] = useState<bigint>(0n)
  const [basePrice, setBasePrice] = useState<bigint>(1n * 10n ** 18n) // default 1 USDm; refreshed from chain
  const [rentPerLoop, setRentPerLoop] = useState<bigint>(4n * 10n ** 15n) // default 0.004 USDm/loop; refreshed from chain
  const [openCell, setOpenCell] = useState<{
    id: number
    rect: DOMRect
    occupied?: { who: string; loopsLeft: number }
  } | null>(null)
  const [openRow, setOpenRow] = useState<{ track: number; rect: DOMRect } | null>(null)
  const [showFund, setShowFund] = useState(false)
  // "Jam with Claude" discovery: explains how to connect the loopclub MCP so a
  // loop built in a Claude chat opens straight into this app via a ?jam= link.
  const [showJamHelp, setShowJamHelp] = useState(false)
  const [playingStep, setPlayingStep] = useState<number>(-1)
  // Auto-on: the app opens with audio engaged so the playhead and cells
  // start moving the instant the AudioContext can resume (which happens on
  // the user's first interaction — see the gesture useEffect below).
  const [audioOn, setAudioOn] = useState(true)
  // The AudioContext can only be resumed from inside (or shortly after) a
  // user gesture. Until that gesture lands, defer the startAudio() call —
  // calling it pre-gesture creates a sequencer on a suspended context, and
  // when the gesture arrives the engine looks "running" so we never resume.
  const [hasGestured, setHasGestured] = useState(false)
  // Cells a tools popover (row fill / renew) is previewing — drawn on the grid
  // with a "will-be-activated" highlight so the click target is visible.
  const [previewCells, setPreviewCells] = useState<number[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playback, setPlayback] = useState<LoopRecord | null>(null)
  // "Jam with Claude" preview: a not-yet-committed loop decoded from a ?jam=
  // link, held BESIDE the live grid (like `playback`, never written into it).
  // Read-only — the user auditions it, picks a duration, and rents the free
  // cells via the existing rentBatch. null = not in jam mode.
  const [jam, setJam] = useState<{ pattern: bigint; synthData: bigint; name?: string } | null>(null)
  // Rent duration for a jam commit. Matches the main flow's per-cell default
  // (16) and cap (MAX_TOGGLE_LOOPS = 32); same numeric control as the row tools.
  const [jamDuration, setJamDuration] = useState<number>(DEFAULT_TOGGLE_LOOPS)
  // "Connect first" nudge (shipping sequence Part 1). A dismissible banner shown
  // to a not-yet-connected visitor on the live grid, prompting a wallet connect
  // — the cheapest action that unlocks pressing/recording. Dismissal is held in
  // sessionStorage so it stays gone for the tab session but reappears on a fresh
  // visit (the nudge is the cold-start growth lever — we don't want it killed
  // forever by one stray click).
  const [connectNudgeDismissed, setConnectNudgeDismissed] = useState<boolean>(
    () => {
      try {
        return sessionStorage.getItem(CONNECT_NUDGE_DISMISSED) === '1'
      } catch {
        return false
      }
    },
  )
  const dismissConnectNudge = useCallback(() => {
    setConnectNudgeDismissed(true)
    try {
      sessionStorage.setItem(CONNECT_NUDGE_DISMISSED, '1')
    } catch {
      /* private mode / storage disabled — dismissal just won't persist */
    }
  }, [])
  const [shareSeriesId, setShareSeriesId] = useState<bigint | null>(null)
  const [libraryRefresh, setLibraryRefresh] = useState(0)
  const [pressingSeriesId, setPressingSeriesId] = useState<bigint | null>(null)
  const [claimingSeriesId, setClaimingSeriesId] = useState<bigint | null>(null)
  // Click → confirmation modal → confirm-button calls the real press handler.
  // One state covers both press paths (Edition #1 of a new loop, Edition #N of
  // an existing series); the bound `onConfirm` is what differs.
  const [pressConfirm, setPressConfirm] = useState<
    | { edition: number; price: bigint; onConfirm: () => void }
    | null
  >(null)
  // Last pitch the user picked on the synth keyboard. Persisted across
  // popover open/close AND used as the fallback when a synth cell is
  // double-clicked directly (no popover): without this, an empty synth cell
  // re-toggles at pitch 0 (MIDI 0 = C-1, basically silent on laptop speakers).
  const [lastSynthPitch, setLastSynthPitch] = useState<number>(SYNTH_PITCH_DEFAULT)

  const smartAddress = (smartWalletClient?.account?.address ?? null) as `0x${string}` | null

  // Step 4 — "fast mode": once armed, cell toggles are signed by an in-browser
  // session key and skip the Privy round-trip. record/press stay on Privy.
  const session = useSessionKey(smartAddress)

  // A short per-wallet memory of the cells you've rented — backs the renew strip.
  const { history, remember } = useMyCells(smartAddress)

  const playbackRef = useRef<LoopRecord | null>(null)
  playbackRef.current = playback

  // Wallet + contract-pricing state. The grid itself is event-streamed, so this
  // poll only covers balance / allowance / prices.
  const refreshWallet = useCallback(async () => {
    try {
      const [base, rent] = await Promise.all([
        publicClient.readContract({ address: config.loopclubAddress, abi: loopclubAbi, functionName: 'basePrice' }),
        publicClient.readContract({ address: config.loopclubAddress, abi: loopclubAbi, functionName: 'rentPerLoop' }),
      ])
      setBasePrice(base as bigint)
      setRentPerLoop(rent as bigint)

      if (smartAddress) {
        const [bal, allow] = await Promise.all([
          publicClient.readContract({
            address: config.paymentTokenAddress,
            abi: usdmAbi,
            functionName: 'balanceOf',
            args: [smartAddress],
          }),
          publicClient.readContract({
            address: config.paymentTokenAddress,
            abi: usdmAbi,
            functionName: 'allowance',
            args: [smartAddress, config.loopclubAddress],
          }),
        ])
        setUsdmBalance(bal as bigint)
        setAllowance(allow as bigint)
        setBalanceLoaded(true)
      }
    } catch (e) {
      console.error('wallet refresh failed', e)
    }
  }, [smartAddress])

  useEffect(() => {
    refreshWallet()
    const id = setInterval(refreshWallet, WALLET_POLL_MS)
    return () => clearInterval(id)
  }, [refreshWallet])

  // After Privy login, the smart wallet client is provisioned asynchronously
  // — `smartAddress` flips from null to a real address somewhere in the next
  // few seconds. The 5s poll above can miss that window, leaving the chip
  // stuck at "0 USDm" until the user reloads. Fire a short burst of catch-up
  // reads so the balance arrives within ~1s of the address resolving.
  useEffect(() => {
    if (!authenticated) return
    const delays = [400, 1200, 3000, 6000, 10000]
    const ids = delays.map((ms) => setTimeout(() => void refreshWallet(), ms))
    return () => ids.forEach(clearTimeout)
  }, [authenticated, refreshWallet])

  // A new (or cleared) smart wallet means the cached balance is stale — drop
  // the loaded flag so the pre-flight guards wait for a fresh read.
  useEffect(() => {
    setBalanceLoaded(false)
  }, [smartAddress])

  // Feed the audio engine the live grid whenever it changes (unless replaying a
  // loop or previewing a jam — both drive the engine via setSnapshot instead).
  useEffect(() => {
    if (!playback && !jam) setLiveState(grid.pattern, grid.synthData)
  }, [grid.pattern, grid.synthData, playback, jam])

  useEffect(() => {
    onStep((step) => setPlayingStep(step))
  }, [])

  // Visual-only playhead ticker. Browsers won't let us resume the
  // AudioContext until the first user gesture, but we can still march the
  // playhead across the grid so the page feels alive on cold load. Runs
  // while audio is "on" but the user hasn't interacted yet; once they do,
  // startAudio() takes over and overrides setPlayingStep via onStep().
  useEffect(() => {
    if (hasGestured || !audioOn) return
    const stepMs = (LOOP_DURATION_SECONDS * 1000) / STEPS
    const start = performance.now()
    let raf = 0
    const tick = () => {
      const elapsed = performance.now() - start
      setPlayingStep(Math.floor(elapsed / stepMs) % STEPS)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [hasGestured, audioOn])

  // Keep the audio engine in sync with the audioOn UI flag. Lets the rest
  // of the app drive playback by flipping audioOn (Stop/Play deck button,
  // enterPlayback) without each path knowing how to talk to Tone.js.
  // Gated on hasGestured so the autoplay path waits until the AudioContext
  // can actually be resumed.
  useEffect(() => {
    if (audioOn && hasGestured) void startAudio()
    else if (!audioOn) stopAudio()
  }, [audioOn, hasGestured])

  // Refs let the document-level gesture handler (registered once at mount)
  // see the latest audioOn value without re-binding on every flip.
  const audioOnRef = useRef(audioOn)
  audioOnRef.current = audioOn
  const hasGesturedRef = useRef(hasGestured)
  hasGesturedRef.current = hasGestured
  // True only for the brief window between the first user gesture (which
  // unlocks + starts the AudioContext) and the click that rides along with
  // it. The deck button reads this in onAudioToggle to swallow that one
  // click — so tapping Play/Stop as your very first action doesn't
  // start-then-immediately-stop the engine. See onAudioToggle for the bug
  // this kills ("autoplay on but silent — I had to Stop then Play").
  const armedByGestureRef = useRef(false)

  // Catch the first pointer / key / touch event and (a) flip hasGestured
  // for any later UI that depends on it and (b) call startAudio() right
  // here, inside the gesture's user-activation window. We don't wait for
  // the state-update → effect cycle above — Safari/iOS can lose activation
  // between the click and the microtask that runs the effect, leaving the
  // AudioContext suspended and the sequencer ticking against a stalled
  // clock. Calling startAudio() synchronously in the handler guarantees
  // Tone.start() runs while the activation is still live.
  useEffect(() => {
    if (hasGesturedRef.current) return
    const onFirstGesture = () => {
      if (hasGesturedRef.current) return
      hasGesturedRef.current = true
      setHasGestured(true)
      if (audioOnRef.current) {
        void startAudio()
        // This same physical interaction also fires a `click`. If it landed
        // on the deck button, that click would otherwise toggle audioOn back
        // off (it's already true) — start-then-stop. Arm the swallow, then
        // disarm on the very next click *after* React's handlers have run
        // (the document listener sits above React's root, so onAudioToggle
        // sees it armed first). A gesture that lands elsewhere disarms here
        // so a later, deliberate Stop is never swallowed.
        armedByGestureRef.current = true
        document.addEventListener(
          'click',
          () => {
            armedByGestureRef.current = false
          },
          { once: true },
        )
      }
    }
    document.addEventListener('pointerdown', onFirstGesture, { once: true })
    document.addEventListener('keydown', onFirstGesture, { once: true })
    document.addEventListener('touchstart', onFirstGesture, { once: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', onFirstGesture)
      document.removeEventListener('keydown', onFirstGesture)
      document.removeEventListener('touchstart', onFirstGesture)
    }
  }, [])

  // On first load, if URL has ?loop=<seriesId>, auto-load + enter playback for that series.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('loop')
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const seriesId = BigInt(id)
        const [info, nextPrice] = await Promise.all([
          publicClient.readContract({
            address: config.loopclubAddress,
            abi: loopclubAbi,
            functionName: 'seriesInfo',
            args: [seriesId],
          }),
          publicClient
            .readContract({
              address: config.loopclubAddress,
              abi: loopclubAbi,
              functionName: 'pressPriceFor',
              args: [seriesId],
            })
            .catch(() => 0n),
        ])
        if (cancelled) return
        const [pat, synth, mintedAtLoop, nextEdition, , , , holders, cellsPerHolder] = info as readonly [
          bigint,
          bigint,
          bigint,
          number,
          number,
          number,
          number,
          readonly `0x${string}`[],
          readonly number[],
        ]
        const record: LoopRecord = {
          seriesId,
          tokenId: seriesId,
          pattern: pat,
          synthData: synth,
          mintedAtLoop,
          holders,
          cellsPerHolder,
          nextEdition: Number(nextEdition),
          nextPressPrice: nextPrice as bigint,
          owner: null,
        }
        enterPlayback(record)
      } catch (e) {
        console.warn('share-url load failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On first load, if URL has ?jam=<payload>, decode it (loopgen) and enter the
  // jam preview. The grid shows the proposed loop in track colours; the audio
  // engine plays it via setSnapshot. Hard-validated input — a malformed link is
  // ignored and we fall through to a normal live load (never white-screen).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('jam')
    if (!raw) return
    try {
      const wire = fromLink(raw)
      setJam({ pattern: wire.pattern, synthData: wire.synthData })
      setSnapshot(wire.pattern, wire.synthData)
      setAudioOn(true)
    } catch (e) {
      // LinkError = expected for a bad/old payload; anything else is a real bug.
      if (!(e instanceof LinkError)) console.warn('jam link load failed', e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flash = (msg: string, isError = false) => {
    if (isError) setError(msg)
    else setBusy(msg)
    setTimeout(() => {
      if (isError) setError(null)
      else setBusy(null)
    }, 4000)
  }

  // Build a call list for paid actions, prepending a one-time max USDm approval
  // when the smart wallet hasn't yet authorised the loopclub contract to pull
  // payment. Everything lands in a single UserOperation, so the user signs once
  // — and a fresh wallet can press/record/fill without a separate step.
  const withApprovalCalls = (price: bigint, actions: Call[]): Call[] => {
    if (allowance >= price) return actions
    return [
      {
        to: config.paymentTokenAddress,
        data: encodeFunctionData({
          abi: usdmAbi,
          functionName: 'approve',
          args: [config.loopclubAddress, maxUint256],
        }),
      },
      ...actions,
    ]
  }
  const withApproval = (price: bigint, action: Call): Call[] => withApprovalCalls(price, [action])

  const onToggle = (cellId: number, durationLoops: number, pitchIdx: number) => {
    if (!smartWalletClient || !smartAddress) return

    // Renting a cell pulls USDm via toggle() → safeTransferFrom, so it needs the
    // same one-time approval the press/record flows do — without it the call
    // reverts with ERC20InsufficientAllowance during paymaster simulation.
    const cost = rentPerLoop * BigInt(durationLoops)
    // Only enforce the balance guard once a real balance has loaded — otherwise
    // the placeholder 0n blocks every rent during the first poll. If the read
    // hasn't landed yet we let the tx through; it reverts cleanly if truly short.
    if (balanceLoaded && usdmBalance < cost) {
      flash(
        `Need ${formatUnits(cost, 18)} USDm to rent (have ${formatUnits(usdmBalance, 18).slice(0, 6)})`,
        true,
      )
      return
    }

    setOpenCell(null)
    // Optimistic paint is owned by handleCellTier (so a double-click can pulse
    // purple ~420ms before this commit fires); only paint here if the caller
    // hasn't already lit the cell — e.g. an explicit popover-button click.
    const c = grid.cells[cellId]
    const alreadyOptimistic =
      c?.pending && c.owner?.toLowerCase() === smartAddress.toLowerCase()
    if (!alreadyOptimistic) {
      grid.applyOptimistic(cellId, smartAddress, durationLoops, pitchIdx)
    }
    remember([cellId])
    flash(`Renting cell ${cellId} for ${durationLoops}× ${LOOP_DURATION_SECONDS}s…`)

    const calls = withApproval(cost, {
      to: config.loopclubAddress,
      data: encodeFunctionData({
        abi: loopclubAbi,
        functionName: 'toggle',
        args: [cellId, durationLoops, pitchIdx],
      }),
    })

    // Fast path: when fast mode is armed and the toggle is a single call
    // (allowance already maxed, no approve to batch), sign it locally with the
    // session key — no Privy round-trip. When an approval has to ride along
    // (calls.length === 2) we fall back to the Privy client, which sets the
    // max-uint256 allowance; every later toggle then takes the fast path.
    const fast = session.armed && calls.length === 1
    const submit: Promise<`0x${string}`> = fast
      ? session.send(calls[0])
      : smartWalletClient.sendTransaction({ calls }, { uiOptions: { showWalletUIs: false } })
    submit
      .then(async (txHash) => {
        try {
          await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
        } catch {
          // receipt wait is best-effort — the CellRented event also confirms it
        }
        void grid.refreshCell(cellId)
        void refreshWallet()
      })
      .catch((e: unknown) => {
        flash((e as Error).message ?? 'rent failed', true)
        // Roll the optimistic cell back to on-chain truth.
        void grid.refreshCell(cellId)
        void refreshWallet()
      })
  }

  // Rent many cells in one batched UserOp — backs both row fills and renew.
  // Each cell is a toggle() call; the batch is atomic, so if a player snipes a
  // target between here and mining the whole batch reverts (rare — then retry).
  // Callers are expected to pre-filter cells already held live by someone else.
  // `pitchMap` supplies synth pitches for cells that aren't on the live grid yet
  // (a jammed loop): cellId → 7-bit MIDI note. Falls back to the live grid's
  // stored pitch when absent, so row-fill / renew callers pass nothing.
  const rentBatch = async (
    cellIds: number[],
    duration: number,
    verb: string,
    pitchMap?: Map<number, number>,
  ) => {
    if (!smartWalletClient || !smartAddress || cellIds.length === 0) return

    const cost = rentPerLoop * BigInt(duration) * BigInt(cellIds.length)
    if (balanceLoaded && usdmBalance < cost) {
      flash(
        `Need ${formatUnits(cost, 18)} USDm (have ${formatUnits(usdmBalance, 18).slice(0, 6)})`,
        true,
      )
      return
    }

    const pitchOf = (id: number) =>
      pitchMap?.get(id) ?? (id >= SYNTH_CELL_START ? (grid.cells[id]?.pitch ?? 0) : 0)

    // Light every cell instantly — pending until the batch confirms.
    for (const id of cellIds) grid.applyOptimistic(id, smartAddress, duration, pitchOf(id))
    remember(cellIds)
    flash(`${verb} ${cellIds.length} cell${cellIds.length === 1 ? '' : 's'}…`)

    const actions: Call[] = cellIds.map((id) => ({
      to: config.loopclubAddress,
      data: encodeFunctionData({
        abi: loopclubAbi,
        functionName: 'toggle',
        args: [id, duration, pitchOf(id)],
      }),
    }))

    try {
      const txHash = await smartWalletClient.sendTransaction(
        { calls: withApprovalCalls(cost, actions) },
        { uiOptions: { showWalletUIs: false } },
      )
      await publicClient
        .waitForTransactionReceipt({ hash: txHash as `0x${string}` })
        .catch(() => {})
    } catch (e: unknown) {
      flash((e as Error).message ?? `${verb.toLowerCase()} failed`, true)
    } finally {
      // Reconcile every touched cell against on-chain truth (confirm or roll back).
      for (const id of cellIds) void grid.refreshCell(id)
      void refreshWallet()
    }
  }

  // Fill a row from the RowToolsPopover — rents the chosen empty steps.
  const onFillRow = (cellIds: number[], duration: number) => {
    setOpenRow(null)
    void rentBatch(cellIds, duration, 'Filling')
  }

  // Renew from the RenewStrip — re-rents your expired / expiring cells.
  const onRenew = (cellIds: number[], duration: number) => {
    void rentBatch(cellIds, duration, 'Renewing')
  }

  const handleRowLabelClick = (track: number, rect: DOMRect) => {
    setOpenRow({ track, rect })
  }

  // Press copy #1 of a brand-new loop — calls record().
  const onRecord = async () => {
    if (!smartWalletClient) return
    if (grid.pattern === 0n) {
      flash('Grid is empty — toggle some cells first', true)
      return
    }
    if (balanceLoaded && usdmBalance < basePrice) {
      flash(`Need ${formatUnits(basePrice, 18)} USDm to press (have ${formatUnits(usdmBalance, 18).slice(0, 6)})`, true)
      return
    }
    try {
      setBusy('Pressing copy #1…')
      const calls = withApproval(basePrice, {
        to: config.loopclubAddress,
        data: encodeFunctionData({ abi: loopclubAbi, functionName: 'record', args: [] }),
      })
      const txHash = await smartWalletClient.sendTransaction(
        { calls },
        { uiOptions: { showWalletUIs: false } },
      )

      let newSeriesId: bigint | null = null
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== config.loopclubAddress.toLowerCase()) continue
          try {
            const decoded = decodeEventLog({ abi: loopclubAbi, data: log.data, topics: log.topics })
            if (decoded.eventName === 'SeriesRecorded') {
              newSeriesId = (decoded.args as { seriesId: bigint }).seriesId
              break
            }
          } catch {
            // not our event
          }
        }
      } catch (e) {
        console.warn('receipt parse failed', e)
      }

      setBusy(null)
      if (newSeriesId !== null) setShareSeriesId(newSeriesId)
      else flash('Recorded!')
      setLibraryRefresh((n) => n + 1)
      refreshWallet()
    } catch (e: unknown) {
      flash((e as Error).message ?? 'record failed', true)
    }
  }

  // Re-pull a series from chain and, if it's the one currently in playback,
  // update the snapshot so the CTA banner shows the new next-edition + price.
  const refreshPlayback = useCallback(async (seriesId: bigint) => {
    try {
      const [info, nextPrice] = await Promise.all([
        publicClient.readContract({
          address: config.loopclubAddress,
          abi: loopclubAbi,
          functionName: 'seriesInfo',
          args: [seriesId],
        }),
        publicClient
          .readContract({
            address: config.loopclubAddress,
            abi: loopclubAbi,
            functionName: 'pressPriceFor',
            args: [seriesId],
          })
          .catch(() => 0n),
      ])
      const [pat, synth, mintedAtLoop, nextEdition, , , , holders, cellsPerHolder] = info as readonly [
        bigint,
        bigint,
        bigint,
        number,
        number,
        number,
        number,
        readonly `0x${string}`[],
        readonly number[],
      ]
      setPlayback((prev) =>
        prev && prev.seriesId === seriesId
          ? {
              ...prev,
              pattern: pat,
              synthData: synth,
              mintedAtLoop,
              holders,
              cellsPerHolder,
              nextEdition: Number(nextEdition),
              nextPressPrice: nextPrice as bigint,
            }
          : prev,
      )
    } catch (e) {
      console.warn('playback refresh failed', e)
    }
  }, [])

  // Press copy #N of an existing loop — calls press(seriesId).
  const onPressSeries = async (record: LoopRecord) => {
    if (!smartWalletClient) return
    if (balanceLoaded && usdmBalance < record.nextPressPrice) {
      flash(
        `Need ${formatUnits(record.nextPressPrice, 18)} USDm to press (have ${formatUnits(usdmBalance, 18).slice(0, 6)})`,
        true,
      )
      return
    }
    try {
      setPressingSeriesId(record.seriesId)
      setBusy(`Pressing copy #${record.nextEdition}…`)
      const calls = withApproval(record.nextPressPrice, {
        to: config.loopclubAddress,
        data: encodeFunctionData({
          abi: loopclubAbi,
          functionName: 'press',
          args: [record.seriesId],
        }),
      })
      await smartWalletClient.sendTransaction(
        { calls },
        { uiOptions: { showWalletUIs: false } },
      )
      flash(`Pressed copy #${record.nextEdition} of loop #${record.seriesId}`)
      if (playbackRef.current?.seriesId === record.seriesId) {
        void refreshPlayback(record.seriesId)
      }
      setLibraryRefresh((n) => n + 1)
      refreshWallet()
    } catch (e: unknown) {
      flash((e as Error).message ?? 'press failed', true)
    } finally {
      setPressingSeriesId(null)
    }
  }

  // Claim accrued resale royalties for a series the user co-created (held cells in).
  const onClaimRoyalty = async (record: LoopRecord) => {
    if (!smartWalletClient) return
    try {
      setClaimingSeriesId(record.seriesId)
      setBusy(`Claiming royalties for loop #${record.seriesId}…`)
      await smartWalletClient.sendTransaction(
        {
          to: config.loopclubAddress,
          data: encodeFunctionData({
            abi: loopclubAbi,
            functionName: 'claimRoyalty',
            args: [record.seriesId],
          }),
          chain: megaethMainnet,
        },
        { uiOptions: { showWalletUIs: false } },
      )
      flash(`Claimed royalties for loop #${record.seriesId}`)
      setLibraryRefresh((n) => n + 1)
      refreshWallet()
    } catch (e: unknown) {
      flash((e as Error).message ?? 'claim failed', true)
    } finally {
      setClaimingSeriesId(null)
    }
  }

  const enterPlayback = (record: LoopRecord) => {
    setPlayback(record)
    setSnapshot(record.pattern, record.synthData)
    setAudioOn(true)
  }

  const exitPlayback = () => {
    setPlayback(null)
    setSnapshot(null, null)
  }

  // Leave jam preview → back to the live grid, audio follows live state again.
  const exitJam = () => {
    setJam(null)
    setSnapshot(null, null)
  }

  // Commit a jammed loop: rent the free cells through the EXISTING batch path
  // (same as a row fill), carrying the jam's synth pitches since those cells
  // aren't on the live grid yet. Then drop back to the live grid, where the
  // freshly-rented cells now appear from the chain.
  const commitJam = () => {
    if (!jam || jamFree.length === 0) return
    void rentBatch(jamFree, jamDuration, 'Jamming', synthPitches(jam)).then(exitJam)
  }

  const onAudioToggle = () => {
    // First interaction on a fresh load (incl. a ?jam= autoplay): audioOn is
    // already true and the playhead is marching silently, waiting for a gesture
    // to unlock the AudioContext. The document-level gesture handler already
    // unlocked + started the engine on the pointerdown that precedes this
    // click and armed armedByGestureRef. Swallow this one click so it doesn't
    // flip audioOn→false and start-then-stop the engine. (That was the
    // "autoplay on but silent — had to Stop then Play" bug.)
    if (armedByGestureRef.current) {
      armedByGestureRef.current = false
      return
    }
    // Fallback: a gesture path that somehow didn't start the engine (e.g.
    // audio was off). Unlock + start in-gesture, never stop.
    if (!hasGestured) {
      setHasGestured(true)
      setAudioOn(true)
      void startAudio()
      return
    }
    // The audioOn-sync useEffect drives the actual engine; this just
    // flips the visible flag.
    setAudioOn((on) => !on)
  }

  // Resolve a cell-tier intent. Single source of truth for try / toggle / max —
  // both the grid's gesture dispatch (1/2/3 clicks) and the popover's tier rows
  // funnel through this. `pitchOverride` lets the popover supply a user-chosen
  // pitch when the synth row is up; everything else falls back to the cell's
  // current stored pitch (so a re-toggle preserves the existing note).
  //
  // The phase split is what makes a double-click feel responsive: 'preview'
  // fires the instant a 2-click is detected (~420ms before commit) and just
  // paints the optimistic state. 'commit' submits the tx. A 3-click skips the
  // preview phase and commits 'max' directly — the optimistic from the prior
  // 'toggle' preview keeps the cell purple-pulsing until the tx confirms.
  const handleCellTier = useCallback(
    (id: number, tier: CellTier, phase: ClickPhase, pitchOverride?: number) => {
      // Synth-cell fallback: if no override and the cell is empty (no current
      // owner OR expired), use the last key the user picked instead of the raw
      // stored pitch — a brand-new synth cell stores 0, which is MIDI C-1 and
      // basically inaudible. Re-rents on a cell you already own keep the
      // existing pitch so the rhythm pattern doesn't flip notes under you.
      // Applies to all tiers (try / toggle / max) so a first-time single click
      // auditions at C3 too, not at the inaudible C-1.
      const cell = grid.cells[id]
      const isSynthCell = id >= SYNTH_CELL_START
      const cellIsEmpty = !cell?.owner || (cell?.expiryLoop ?? 0) <= grid.currentLoop
      const synthFallback = isSynthCell && cellIsEmpty ? lastSynthPitch : (cell?.pitch ?? 0)
      const pitch = pitchOverride ?? synthFallback

      if (tier === 'try') {
        void previewCell(id, pitch)
        return
      }
      // Only LIVE rents block a toggle. cellOwner stays set on-chain after a
      // rent expires (the contract never zeroes it), so `cell.owner` can be a
      // stale address whose lease already lapsed — `cellIsEmpty` is the
      // expiry-aware truth, mirroring the contract's `expiry > nowLoop` guard.
      // Without the `!cellIsEmpty` gate, every expired-but-previously-rented
      // cell (e.g. a whole synth row left over from an earlier loop) is wrongly
      // treated as someone else's and can never be re-rented.
      const owner = cell?.owner ?? null
      const isOccupied =
        !cellIsEmpty &&
        owner &&
        smartAddress &&
        owner.toLowerCase() !== smartAddress.toLowerCase()
      if (isOccupied) return // can't toggle someone else's *live* cell

      const loops = tier === 'max' ? MAX_TOGGLE_LOOPS : DEFAULT_TOGGLE_LOOPS

      if (phase === 'preview') {
        // Optimistic-paint only; the tx waits for the commit phase in case the
        // gesture escalates to a triple-click 'max'.
        if (!smartAddress) return
        grid.applyOptimistic(id, smartAddress, loops, pitch)
        return
      }
      // commit — submit the tx. If a preview already painted the cell pending
      // (the common 2-click path), onToggle won't repaint; if this is a direct
      // popover-button click with no preview, onToggle paints before sending.
      onToggle(id, loops, pitch)
    },
    // onToggle is intentionally captured from closure; grid.cells changes every
    // tick but we want the latest value at click time, which the closure gives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [smartAddress, grid.cells, lastSynthPitch],
  )

  // 500ms hover-hold opens the popover — discovery surface for the gesture.
  const handleCellHover = (id: number, rect: DOMRect, status: CellStatus) => {
    if (status === 'occupied') {
      const c = grid.cells[id]
      if (c?.owner) {
        setOpenCell({
          id,
          rect,
          occupied: { who: c.owner, loopsLeft: c.expiryLoop - grid.currentLoop },
        })
        return
      }
    }
    setOpenCell({ id, rect })
  }

  const userEmail = user?.email?.address ?? user?.google?.email ?? null
  // Recording presses the LIVE grid — suspended while previewing a jam too.
  const canRecord =
    authenticated && smartAddress && grid.pattern !== 0n && !playback && !jam

  // Jam-preview derived state. A proposed cell is "taken" only if someone else
  // holds it live right now; everything else is free to rent (cells the user
  // already holds re-rent harmlessly, extending them).
  const jamCells = jam ? litCells(jam) : []
  const jamTaken = jam
    ? jamCells.filter((id) => {
        const c = grid.cells[id]
        const owner = c?.owner ?? null
        return Boolean(
          owner &&
            smartAddress &&
            owner.toLowerCase() !== smartAddress.toLowerCase() &&
            (c?.expiryLoop ?? 0) > grid.currentLoop,
        )
      })
    : []
  const jamTakenSet = new Set(jamTaken)
  const jamFree = jamCells.filter((id) => !jamTakenSet.has(id))
  const jamCost = rentPerLoop * BigInt(jamDuration) * BigInt(jamFree.length)

  const displayPattern = jam ? jam.pattern : playback ? playback.pattern : grid.pattern
  const displaySynthData = jam ? jam.synthData : playback ? playback.synthData : grid.synthData

  // "Connect first" nudge — shown to a not-yet-connected visitor on the LIVE
  // grid (never over a playback or jam, which carry their own connect CTA).
  const showConnectNudge = ready && !authenticated && !playback && !jam && !connectNudgeDismissed
  // Liveness line for that nudge. Once the cold-start bot ships (Part 2) and
  // VITE_LOOPCLUB_BOT_LIVE=true, name the bot; until then report the real count
  // of cells lit on chain right now so the claim is always true. Both states
  // glow green; a truly empty grid drops to an amber "be the first" prompt.
  const liveCellCount = litCells({ pattern: grid.pattern, synthData: grid.synthData }).length
  const gridIsLive = config.botLive || liveCellCount > 0
  const connectNudgeNote = config.botLive
    ? 'loopbot is jamming the grid live right now'
    : liveCellCount > 0
      ? `${liveCellCount} cell${liveCellCount === 1 ? '' : 's'} jamming on the grid right now`
      : 'the grid is quiet — be the first to lay down a beat'

  const basePriceStr = fmtUsdm(basePrice)

  return (
    <div className="app">
      <MobileHint />
      <header className="header">
        <div className="header-left">
          <a className="wordmark-link" href="/" aria-label="loopclub home">
            <img className="wordmark" src={logoUrl} alt="loop club" />
          </a>
          <button
            className="jam-claude-btn"
            onClick={() => setShowJamHelp(true)}
            title="Build loops by chatting with Claude"
          >
            ✦ Jam with Claude
          </button>
        </div>
        <div className="right">
          <div className="deck-controls" role="group" aria-label="Deck">
            <button className="deck-btn" onClick={onAudioToggle}>
              {/* Honest label: the AudioContext can't make sound until the
                  first gesture, so read "▶ Play" until the engine is actually
                  running (audioOn AND gestured). Keeps the homepage and a
                  ?jam= deep link identical — both show Play, march the
                  playhead, and start sound on the first tap. */}
              <span className="deck-label">{audioOn && hasGestured ? '◼ Stop' : '▶ Play'}</span>
            </button>
            {authenticated && (
              <button
                className="deck-btn press"
                onClick={() =>
                  setPressConfirm({ edition: 1, price: basePrice, onConfirm: onRecord })
                }
                disabled={!canRecord || busy?.startsWith('Pressing')}
                title={
                  playback
                    ? 'Exit playback to record the live grid'
                    : grid.pattern === 0n
                      ? 'Toggle some cells first'
                      : `Press Edition #1 — ${basePriceStr} USDm`
                }
              >
                <span className="deck-label">
                  {busy === 'Pressing copy #1…' ? 'Pressing…' : '✦ Press Edition #1'}
                </span>
              </button>
            )}
          </div>
          {authenticated && <FastMode session={session} ready={!!smartAddress} />}
          {!ready ? null : !authenticated ? (
            <button className="btn-chrome connect-btn" onClick={login}>
              Connect
            </button>
          ) : (
            <div className="account-group">
              {/* Funds only — the figure you act on. Full address lives in the
                  hover title and the wallet modal; the bar must stay one line. */}
              <span className="balance" title={smartAddress ?? 'resolving wallet…'}>
                <span className="balance-funds">
                  {smartAddress ? `${formatUnits(usdmBalance, 18).slice(0, 6)} USDm` : '…'}
                </span>
              </span>
              <button
                className="btn wallet-btn"
                onClick={() => setShowFund(true)}
                title="Wallet — fund or disconnect"
                aria-label="My wallet — fund or disconnect"
                disabled={!smartAddress}
              >
                ▾
              </button>
            </div>
          )}
        </div>
      </header>

      {showConnectNudge && (
        <div className="playback-banner connect-banner">
          <div className="pb-status">
            <span className={`connect-live${gridIsLive ? '' : ' quiet'}`}>
              <span className="connect-live-dot" />
              {connectNudgeNote}
            </span>
            <button
              className="connect-dismiss"
              onClick={dismissConnectNudge}
              aria-label="Dismiss"
              title="Dismiss this prompt"
            >
              ✕
            </button>
          </div>
          <div className="pb-cta">
            <div className="pb-cta-copy">
              <strong className="pb-headline">✦ Connect to jam on the live grid</strong>
              <span className="pb-sub">
                Auditioning is free — tap any cell to hear it. Connect your wallet to rent cells, lay
                down a beat, and press it on chain as your own NFT.
              </span>
            </div>
            <button className="btn-chrome pb-press" onClick={login}>
              Connect wallet
            </button>
          </div>
        </div>
      )}

      {playback && (
        <div className="playback-banner">
          <div className="pb-status">
            <span>
              ▶ Playing loop <strong>#{playback.seriesId.toString()}</strong> ·{' '}
              {playback.holders.length} contributor{playback.holders.length === 1 ? '' : 's'} ·{' '}
              {playback.nextEdition - 1} edition{playback.nextEdition - 1 === 1 ? '' : 's'} pressed
            </span>
            <button onClick={exitPlayback}>◼ back to live jam</button>
          </div>
          <div className="pb-cta">
            <div className="pb-cta-copy">
              <strong className="pb-headline">✦ Want to make this loop yours?</strong>
              <span className="pb-sub">
                Press Edition #{playback.nextEdition} and mint your own NFT of this loop. Grab it while
                it's hot — each new edition costs more than the last.
              </span>
            </div>
            {!authenticated ? (
              <button className="btn-chrome pb-press" onClick={login}>
                Connect to press
              </button>
            ) : (
              <button
                className="btn-hot pb-press"
                onClick={() =>
                  setPressConfirm({
                    edition: playback.nextEdition,
                    price: playback.nextPressPrice,
                    onConfirm: () => onPressSeries(playback),
                  })
                }
                disabled={pressingSeriesId === playback.seriesId}
              >
                {pressingSeriesId === playback.seriesId
                  ? 'Pressing…'
                  : `✦ Press Edition #${playback.nextEdition}${
                      playback.nextPressPrice > 0n ? ` · ${fmtUsdm(playback.nextPressPrice)} USDm` : ''
                    }`}
              </button>
            )}
          </div>
        </div>
      )}

      {jam && (
        <div className="playback-banner jam-banner">
          <div className="pb-status">
            <span>
              ✦ Jammed with Claude{jam.name ? ` — "${jam.name}"` : ''} ·{' '}
              <strong>{jamFree.length}</strong> of {jamCells.length} cell
              {jamCells.length === 1 ? '' : 's'} free right now
            </span>
            <button onClick={exitJam}>◼ back to live jam</button>
          </div>
          <div className="pb-cta">
            <div className="pb-cta-copy">
              <span className="pb-sub">
                Audition it free. Rent the open cell{jamFree.length === 1 ? '' : 's'} to press this
                loop onto the live grid.
              </span>
              <label className="popover-duration">
                loops
                <input
                  type="number"
                  min={1}
                  max={MAX_TOGGLE_LOOPS}
                  value={jamDuration}
                  onChange={(e) =>
                    setJamDuration(Math.max(1, Math.min(MAX_TOGGLE_LOOPS, Number(e.target.value) || 1)))
                  }
                />
              </label>
            </div>
            {!authenticated ? (
              <button className="btn-chrome pb-press" onClick={login}>
                Connect to rent
              </button>
            ) : (
              <button
                className="btn-chrome pb-press"
                onClick={commitJam}
                disabled={jamFree.length === 0 || Boolean(busy)}
              >
                {jamFree.length === 0
                  ? 'All cells taken'
                  : `✦ Rent ${jamFree.length} cell${jamFree.length === 1 ? '' : 's'} · ${fmtUsdm(jamCost)} USDm`}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid-wrap">
        <Grid
          pattern={displayPattern}
          synthData={displaySynthData}
          playingStep={playingStep}
          onCellTier={playback || jam ? undefined : handleCellTier}
          onCellHover={playback || jam ? undefined : handleCellHover}
          cells={playback || jam ? undefined : grid.cells}
          myAddress={smartAddress}
          currentLoop={grid.currentLoop}
          lastRent={playback || jam ? null : grid.lastRent}
          onRowLabelClick={playback || jam || !authenticated ? undefined : handleRowLabelClick}
          previewCells={jam ? jamFree : playback ? null : previewCells}
          conflictCells={jam ? jamTaken : null}
        />
      </div>

      <div className="grid-status">
        {!playback ? (
          <ContributorStrip cells={grid.cells} currentLoop={grid.currentLoop} myAddress={smartAddress} />
        ) : (
          <span />
        )}
        <SyncBadge blockNumber={grid.blockNumber} />
        <span className="holo-sticker" aria-hidden="true">
          est. 2026 · onchain
        </span>
      </div>

      {!playback && authenticated && smartAddress && (
        <RenewStrip
          history={history}
          cells={grid.cells}
          currentLoop={grid.currentLoop}
          myAddress={smartAddress}
          rentPerLoop={rentPerLoop}
          busy={Boolean(busy)}
          onRenew={onRenew}
          onPreview={setPreviewCells}
        />
      )}

      <div className="controls">
        <span className="muted">
          {countCells(displayPattern)} cells {playback ? 'in snapshot' : 'live'}
          {!playback && ` · ${usingWebSocket ? 'streaming ⚡' : 'live updates'}`}
        </span>
      </div>

      <Library
        smartAddress={smartAddress}
        playingTokenId={playback?.seriesId ?? null}
        playingStep={playingStep}
        onPlay={enterPlayback}
        onStop={exitPlayback}
        onClaimRoyalty={onClaimRoyalty}
        claimingSeriesId={claimingSeriesId}
        refreshTick={libraryRefresh}
      />

      {openCell !== null && !playback && (
        <CellPopover
          cellId={openCell.id}
          anchorRect={openCell.rect}
          occupied={openCell.occupied}
          initialPitch={lastSynthPitch}
          onPitchChange={setLastSynthPitch}
          onClose={() => setOpenCell(null)}
          onTier={(tier, pitch, phase) => {
            // Whatever pitch the gesture ended on becomes the next default —
            // covers the case where the user double-clicks a key directly
            // (which bypasses onSelect but still commits at `pitch`).
            setLastSynthPitch(pitch)
            handleCellTier(openCell.id, tier, phase, pitch)
            // Close ONLY on commit, not preview. The previous "close on
            // preview" path felt snappier but unmounted the keyboard before
            // its useClickTier timer could fire the deferred toggle commit —
            // so a double-click on a key would audition + paint optimistic,
            // then never actually rent the cell. Closing on commit lets the
            // commit phase land first; preview's optimistic paint still
            // appears in the grid through `applyOptimistic`.
            if (tier !== 'try' && phase === 'commit') setOpenCell(null)
          }}
        />
      )}

      {openRow !== null && !playback && (
        <RowToolsPopover
          track={openRow.track}
          anchorRect={openRow.rect}
          cells={grid.cells}
          currentLoop={grid.currentLoop}
          rentPerLoop={rentPerLoop}
          onClose={() => {
            setOpenRow(null)
            setPreviewCells(null)
          }}
          onApply={onFillRow}
          onPreview={setPreviewCells}
        />
      )}

      {shareSeriesId !== null && (
        <ShareModal seriesId={shareSeriesId} onClose={() => setShareSeriesId(null)} />
      )}

      {showFund && smartAddress && (
        <FundModal
          address={smartAddress}
          usdmBalance={usdmBalance}
          onClose={() => setShowFund(false)}
          onDisconnect={() => {
            setShowFund(false)
            logout()
          }}
        />
      )}

      {pressConfirm && (
        <PressConfirmModal
          edition={pressConfirm.edition}
          price={pressConfirm.price}
          onConfirm={() => {
            const run = pressConfirm.onConfirm
            setPressConfirm(null)
            run()
          }}
          onCancel={() => setPressConfirm(null)}
        />
      )}

      {showJamHelp && <JamWithClaudeModal onClose={() => setShowJamHelp(false)} />}

      {error && <div className="toast error">{error}</div>}
      {!error && busy && <div className="toast">{busy}</div>}
      {!authenticated && ready && (
        <div className="muted" style={{ textAlign: 'center', paddingTop: '2rem' }}>
          Connect to rent cells. {userEmail ? `signed in as ${userEmail}` : ''}
        </div>
      )}
    </div>
  )
}

// Live MegaETH block the grid is synced to — a heartbeat that reframes the grid
// as shared global state. The dot replays its pulse on every new block.
function SyncBadge({ blockNumber }: { blockNumber: number }) {
  if (!blockNumber) {
    return (
      <span className="sync-badge connecting" title="Connecting to MegaETH…">
        <span className="sync-dot" />
        MegaETH syncing…
      </span>
    )
  }
  return (
    <span className="sync-badge" title="The live grid is synced to this MegaETH block">
      <span className="sync-dot" key={blockNumber} />
      MegaETH block #{blockNumber.toLocaleString('en-US')}
    </span>
  )
}

// "Fast mode" control — arms / shows / disarms the session key (Step 4). Hidden
// entirely when the feature flag is off. The address guard in sessionKey.ts
// means the worst a misconfigured session can do is fall back to Privy.
function FastMode({ session, ready }: { session: SessionKey; ready: boolean }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (session.status !== 'armed') return
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [session.status])

  if (session.status === 'disabled' || session.status === 'restoring' || !ready) return null

  if (session.status === 'armed' && session.expiresAt) {
    const mins = Math.max(0, Math.round((session.expiresAt - Date.now()) / 60_000))
    return (
      <span className="fastmode-badge" title="Cell toggles are signed locally — no wallet round-trip">
        <span className="fastmode-bolt">⚡</span>
        fast · {mins}m
        <button className="fastmode-off" onClick={session.disarm} title="Turn off fast mode">
          ✕
        </button>
      </span>
    )
  }

  if (session.status === 'arming') {
    return (
      <button className="fastmode-btn" disabled>
        ⚡ arming…
      </button>
    )
  }

  if (session.status === 'mismatch') {
    return (
      <span className="fastmode-badge unavailable" title={session.errorMsg ?? ''}>
        ⚡ unavailable
      </span>
    )
  }

  // idle | error
  return (
    <button
      className="fastmode-btn"
      onClick={session.arm}
      title={
        session.status === 'error'
          ? session.errorMsg ?? 'Retry enabling fast mode'
          : 'Sign once — then cell toggles are instant, with no wallet popups'
      }
    >
      ⚡ {session.status === 'error' ? 'retry fast mode' : 'enable fast mode'}
    </button>
  )
}

function ShareModal({ seriesId, onClose }: { seriesId: bigint; onClose: () => void }) {
  const url = `${window.location.origin}${window.location.pathname}?loop=${seriesId.toString()}`
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Loop #{seriesId.toString()} recorded ✦</h3>
        <p className="muted">Your loop is live on chain. Share it — anyone can press the next copy.</p>
        <div className="share-url">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn-chrome" onClick={copy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div className="row">
          <button onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  )
}

// Wallet modal — fund the smart wallet and (per the new account-group) sign out.
// Opened from the header ▾ wallet button.
function FundModal({
  address,
  usdmBalance,
  onClose,
  onDisconnect,
}: {
  address: `0x${string}`
  usdmBalance: bigint
  onClose: () => void
  onDisconnect: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Fund my wallet</h3>
        <p className="muted">
          Send USDm on MegaETH Mainnet to your smart-wallet address below — it bankrolls cell rent and
          presses. You currently hold {formatUnits(usdmBalance, 18).slice(0, 6)} USDm.
        </p>
        <div className="share-url">
          <input readOnly value={address} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn-chrome" onClick={copy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="muted">Deposits land in a few seconds. Reopen this any time via the ▾ button in the bar.</p>
        <div className="row wallet-modal-actions">
          <button className="disconnect" onClick={onDisconnect}>
            Disconnect
          </button>
          <button onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  )
}

// A read-only value + one-click Copy, styled as the design system's share-url
// row. Each instance owns its own "Copied!" flash so several can sit in one
// modal (connector name, URL, install command) without sharing state.
function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked — the field stays selected for a manual copy.
    }
  }
  return (
    <div className="share-url">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button className="btn-chrome" onClick={copy}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

// "Jam with Claude" — first-run onboarding for the loopclub MCP. Two paths:
//   • Claude.ai / Desktop (default): deep-link straight into Claude's
//     "Add custom connector" modal (the /customize/connectors?modal= URL — the
//     old /settings/connectors page is now a dead-end that just says "moved to
//     Customize") and paste the hosted MCP URL — zero local install.
//   • Claude Code: the one-line `claude mcp add` install.
// Either way the user describes a beat, Claude calls build_loop, and the ?jam=
// link it returns opens straight into this app. No keys leave the chat.
function JamWithClaudeModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'cloud' | 'cli'>('cloud')
  const cliCmd = 'claude mcp add loopclub -- npx -y loopclub-mcp'
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal jam-help" onClick={(e) => e.stopPropagation()}>
        <h3>✦ Jam with Claude</h3>
        <p>
          Describe a beat to Claude — “dark techno, four-on-the-floor kick, off-beat hats, a low synth
          drone.” It composes the loop and hands you a link that opens right here, pre-loaded and ready
          to audition. You rent the cells; Claude never touches your wallet.
        </p>

        <div className="jam-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'cloud'}
            className={tab === 'cloud' ? 'active' : ''}
            onClick={() => setTab('cloud')}
          >
            Claude.ai · Desktop
          </button>
          <button
            role="tab"
            aria-selected={tab === 'cli'}
            className={tab === 'cli' ? 'active' : ''}
            onClick={() => setTab('cli')}
          >
            Claude Code
          </button>
        </div>

        {tab === 'cloud' ? (
          <ol className="jam-steps">
            <li>
              <strong>Open the “Add custom connector” dialog</strong> in a new tab:
              <div className="row jam-open-row">
                <a
                  className="btn-chrome"
                  href="https://claude.ai/customize/connectors?modal=add-custom-connector"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Claude connectors ↗
                </a>
              </div>
              <span className="muted">Custom connectors need a Claude Pro or Max plan.</span>
            </li>
            <li>
              <strong>Paste the connector details</strong> — in the dialog that opens, fill in:
              <span className="muted">Name</span>
              <CopyField value="loopclub" label="Connector name" />
              <span className="muted">Remote MCP URL</span>
              <CopyField value={config.mcpUrl} label="Connector URL" />
            </li>
            <li>
              <strong>Ask Claude to jam</strong> — “jam me a house loop at 124 bpm.” It calls{' '}
              <code>build_loop</code> and replies with a link.
            </li>
            <li>
              <strong>Open the link.</strong> The loop loads here as a free preview; rent the open cells
              to press it onto the live grid.
            </li>
          </ol>
        ) : (
          <ol className="jam-steps">
            <li>
              <strong>Add the loopclub server</strong> once, from your terminal:
              <CopyField value={cliCmd} label="Install command" />
              <span className="muted">
                Claude Desktop: add it under <code>mcpServers</code> in{' '}
                <code>claude_desktop_config.json</code>.
              </span>
            </li>
            <li>
              <strong>Ask Claude to jam</strong> — “jam me a house loop at 124 bpm” — or use the built-in{' '}
              <code>/jam</code> prompt the server ships.
            </li>
            <li>
              <strong>Open the link</strong> Claude returns. The loop loads here as a free preview; rent
              the open cells to press it onto the live grid.
            </li>
          </ol>
        )}

        <p className="muted">
          Full setup &amp; the tools Claude can call:{' '}
          <a href="https://github.com/mintcloud/loopclub/tree/main/mcp" target="_blank" rel="noreferrer">
            loopclub-mcp readme ↗
          </a>
        </p>
        <div className="row">
          <button className="btn-chrome" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

// Press confirmation — gate Edition #N before the on-chain call so the price,
// the bonding-curve mechanic and the resale upside are stated once, clearly,
// instead of being squeezed into a chrome pad's footer.
function PressConfirmModal({
  edition,
  price,
  onConfirm,
  onCancel,
}: {
  edition: number
  price: bigint
  onConfirm: () => void
  onCancel: () => void
}) {
  const priceStr = price > 0n ? fmtUsdm(price) : null
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal press-confirm" onClick={(e) => e.stopPropagation()}>
        <h3>
          Press Edition #{edition}
          {priceStr && <> — {priceStr} USDm</>}
        </h3>
        <p>You'll mint Edition #{edition} of this loop as an NFT, owned by your smart wallet.</p>
        <p>
          Each press of a loop costs more than the last — that's the bonding curve. Edition #
          {edition + 1} will cost more than this one, and so on. Pressing earlier means a cheaper entry on
          the curve.
        </p>
        <p>
          Editions are NFTs you can transfer or resell. If the loop catches on, holding an earlier edition
          can pay off on resale.
        </p>
        <div className="row">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn-chrome" onClick={onConfirm}>
            ✦ Press Edition #{edition}
          </button>
        </div>
      </div>
    </div>
  )
}

// Format a USDm wei amount as a compact decimal string (no trailing zeros).
function fmtUsdm(wei: bigint): string {
  const s = formatUnits(wei, 18)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

function countCells(pattern: bigint): number {
  let v = pattern
  let n = 0
  while (v) {
    if (v & 1n) n++
    v >>= 1n
  }
  return n
}

// "Save to Home Screen / rotate" hint — phone-portrait only, dismissable.
// The 16-step grid is inherently wide; rather than squashing cells until
// they're untappable we let the grid scroll horizontally AND tell first-time
// mobile visitors about the two workarounds (landscape, install as PWA).
// CSS hides this block on tablets+ and in landscape — the storage check just
// stops it from re-appearing after a dismiss on the phones that show it.
const HINT_DISMISS_KEY = 'loopclub:mobile-hint:dismissed'
function MobileHint() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(HINT_DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  if (dismissed) return null
  const onDismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(HINT_DISMISS_KEY, '1')
    } catch {
      // private mode / storage disabled — fine, just hides for this session
    }
  }
  return (
    <div className="mobile-hint" role="note" aria-label="Mobile tip">
      <span className="mh-icon" aria-hidden="true">⤢</span>
      <span className="mh-copy">
        <strong>Best on landscape</strong> — rotate your phone, or add loopclub to your Home
        Screen for full-screen mode. Scroll the grid sideways to see every step.
      </span>
      <button className="mh-x" onClick={onDismiss} aria-label="Dismiss tip">
        ✕
      </button>
    </div>
  )
}
