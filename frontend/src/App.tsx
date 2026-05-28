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
  SYNTH_CELL_START,
  DEFAULT_TOGGLE_LOOPS,
  MAX_TOGGLE_LOOPS,
  type CellTier,
} from './config'
import { loopclubAbi, usdmAbi } from './abi'
import { publicClient, usingWebSocket } from './viemClient'
import logoUrl from '../../design-system/assets/loopclub-logo.png'
import { useLiveGrid } from './useLiveGrid'
import { useSessionKey, type SessionKey } from './useSessionKey'
import type { ClickPhase } from './useClickTier'
import { startAudio, stopAudio, audioRunning, setLiveState, setSnapshot, onStep, previewCell } from './audio'

// The live grid streams from chain events; only wallet/price state is polled.
const WALLET_POLL_MS = 5000

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
  const [playingStep, setPlayingStep] = useState<number>(-1)
  // Auto-on: the app opens with audio engaged so the playhead and cells
  // start moving the instant the AudioContext can resume (which happens on
  // the user's first interaction — see the gesture useEffect below).
  const [audioOn, setAudioOn] = useState(true)
  // Cells a tools popover (row fill / renew) is previewing — drawn on the grid
  // with a "will-be-activated" highlight so the click target is visible.
  const [previewCells, setPreviewCells] = useState<number[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playback, setPlayback] = useState<LoopRecord | null>(null)
  const [shareSeriesId, setShareSeriesId] = useState<bigint | null>(null)
  const [libraryRefresh, setLibraryRefresh] = useState(0)
  const [pressingSeriesId, setPressingSeriesId] = useState<bigint | null>(null)
  const [claimingSeriesId, setClaimingSeriesId] = useState<bigint | null>(null)

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

  // A new (or cleared) smart wallet means the cached balance is stale — drop
  // the loaded flag so the pre-flight guards wait for a fresh read.
  useEffect(() => {
    setBalanceLoaded(false)
  }, [smartAddress])

  // Feed the audio engine the live grid whenever it changes (unless replaying a loop).
  useEffect(() => {
    if (!playback) setLiveState(grid.pattern, grid.synthData)
  }, [grid.pattern, grid.synthData, playback])

  useEffect(() => {
    onStep((step) => setPlayingStep(step))
  }, [])

  // Keep the audio engine in sync with the audioOn UI flag. Lets the rest
  // of the app drive playback by flipping audioOn (autoplay on mount,
  // Stop/Play deck button, enterPlayback) without each path knowing how
  // to talk to the Tone.js engine.
  useEffect(() => {
    if (audioOn) void startAudio()
    else stopAudio()
  }, [audioOn])

  // Browsers gate the AudioContext on a user gesture, so the queued
  // startAudio() above stays suspended until the user interacts. Catch the
  // first pointer / key / touch event and call startAudio() again from
  // inside that handler — it's the gesture itself that resumes the context
  // and engages the sequencer that was already armed.
  useEffect(() => {
    const onFirstGesture = () => {
      if (audioOn && !audioRunning()) void startAudio()
    }
    document.addEventListener('pointerdown', onFirstGesture, { once: true })
    document.addEventListener('keydown', onFirstGesture, { once: true })
    document.addEventListener('touchstart', onFirstGesture, { once: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', onFirstGesture)
      document.removeEventListener('keydown', onFirstGesture)
      document.removeEventListener('touchstart', onFirstGesture)
    }
    // Armed once on mount — the handler captures the initial audioOn=true.
    // If the user toggles Stop before their first gesture lands, the
    // audioOn sync effect above stops the engine again on the next render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const rentBatch = async (cellIds: number[], duration: number, verb: string) => {
    if (!smartWalletClient || !smartAddress || cellIds.length === 0) return

    const cost = rentPerLoop * BigInt(duration) * BigInt(cellIds.length)
    if (balanceLoaded && usdmBalance < cost) {
      flash(
        `Need ${formatUnits(cost, 18)} USDm (have ${formatUnits(usdmBalance, 18).slice(0, 6)})`,
        true,
      )
      return
    }

    const pitchOf = (id: number) => (id >= SYNTH_CELL_START ? (grid.cells[id]?.pitch ?? 0) : 0)

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

  const onAudioToggle = () => {
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
      if (tier === 'try') {
        void previewCell(id, pitchOverride ?? grid.cells[id]?.pitch ?? 0)
        return
      }
      const cell = grid.cells[id]
      const owner = cell?.owner ?? null
      const isOccupied =
        owner && smartAddress && owner.toLowerCase() !== smartAddress.toLowerCase()
      if (isOccupied) return // can't toggle someone else's cell

      const loops = tier === 'max' ? MAX_TOGGLE_LOOPS : DEFAULT_TOGGLE_LOOPS
      const pitch = pitchOverride ?? cell?.pitch ?? 0

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
    [smartAddress, grid.cells],
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
  const canRecord =
    authenticated && smartAddress && grid.pattern !== 0n && !playback

  const displayPattern = playback ? playback.pattern : grid.pattern
  const displaySynthData = playback ? playback.synthData : grid.synthData

  const basePriceStr = fmtUsdm(basePrice)

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <a className="wordmark-link" href="/" aria-label="loopclub home">
            <img className="wordmark" src={logoUrl} alt="loop club" />
          </a>
        </div>
        <div className="right">
          <div className="deck-controls" role="group" aria-label="Deck">
            <button className="deck-btn" onClick={onAudioToggle}>
              <span className="deck-label">{audioOn ? '◼ Stop' : '▶ Play'}</span>
            </button>
            {authenticated && (
              <button
                className="deck-btn press"
                onClick={onRecord}
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
                <span className="deck-sub">{basePriceStr} USDm</span>
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
              <span className="balance">
                {smartAddress ? `${smartAddress.slice(0, 6)}…${smartAddress.slice(-4)}` : '…'}
                {' · '}
                {formatUnits(usdmBalance, 18).slice(0, 6)} USDm
              </span>
              <button
                className="btn wallet-btn"
                onClick={() => setShowFund(true)}
                title="Wallet — fund or disconnect"
                disabled={!smartAddress}
              >
                ⊕ My wallet
              </button>
            </div>
          )}
        </div>
      </header>

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
                onClick={() => onPressSeries(playback)}
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

      <div className="grid-wrap">
        <Grid
          pattern={displayPattern}
          synthData={displaySynthData}
          playingStep={playingStep}
          onCellTier={playback ? undefined : handleCellTier}
          onCellHover={playback ? undefined : handleCellHover}
          cells={playback ? undefined : grid.cells}
          myAddress={smartAddress}
          currentLoop={grid.currentLoop}
          lastRent={playback ? null : grid.lastRent}
          onRowLabelClick={playback || !authenticated ? undefined : handleRowLabelClick}
          previewCells={playback ? null : previewCells}
        />
      </div>

      <div className="grid-status">
        {!playback ? (
          <ContributorStrip cells={grid.cells} currentLoop={grid.currentLoop} myAddress={smartAddress} />
        ) : (
          <span />
        )}
        <SyncBadge blockNumber={grid.blockNumber} />
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
          onClose={() => setOpenCell(null)}
          onTier={(tier, pitch, phase) => {
            handleCellTier(openCell.id, tier, phase, pitch)
            // Try keeps the popover open so you can audition repeatedly; toggle
            // and max commit a rent, so dismiss to clear the affordance. Close
            // on either phase — closing on 'preview' makes the keyboard's
            // double-click feel snappy (popover disappears the instant the
            // optimistic paint lands).
            if (tier !== 'try') setOpenCell(null)
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
        fast mode · {mins}m
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
// Opened from the header "⊕ My wallet" button.
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
        <h3>My wallet ⊕</h3>
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
        <p className="muted">Deposits land in a few seconds. Reopen this any time via the “⊕ My wallet” button.</p>
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
