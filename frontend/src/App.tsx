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
import { config, megaethMainnet, LOOP_DURATION_SECONDS, SYNTH_CELL_START } from './config'
import { loopchainAbi, usdmAbi } from './abi'
import { publicClient, usingWebSocket } from './viemClient'
import { useLiveGrid } from './useLiveGrid'
import { useSessionKey, type SessionKey } from './useSessionKey'
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
  const [audioOn, setAudioOn] = useState(false)
  // Audition mode: while on, clicking any cell plays its voice once — no
  // popover, no rent, no transaction. Lets you hear a sound before you buy it.
  const [auditionMode, setAuditionMode] = useState(false)
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
  const fundPromptedRef = useRef(false)

  // Wallet + contract-pricing state. The grid itself is event-streamed, so this
  // poll only covers balance / allowance / prices.
  const refreshWallet = useCallback(async () => {
    try {
      const [base, rent] = await Promise.all([
        publicClient.readContract({ address: config.loopchainAddress, abi: loopchainAbi, functionName: 'basePrice' }),
        publicClient.readContract({ address: config.loopchainAddress, abi: loopchainAbi, functionName: 'rentPerLoop' }),
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
            args: [smartAddress, config.loopchainAddress],
          }),
        ])
        setUsdmBalance(bal as bigint)
        setAllowance(allow as bigint)
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

  // Feed the audio engine the live grid whenever it changes (unless replaying a loop).
  useEffect(() => {
    if (!playback) setLiveState(grid.pattern, grid.synthData)
  }, [grid.pattern, grid.synthData, playback])

  useEffect(() => {
    onStep((step) => setPlayingStep(step))
  }, [])

  // Toggling audition mid-edit is a quiet UX trap — popovers and hover-previews
  // are edit affordances, so they get dismissed when the user enters audition.
  useEffect(() => {
    if (!auditionMode) return
    setOpenCell(null)
    setOpenRow(null)
    setPreviewCells(null)
  }, [auditionMode])

  // Once the smart wallet resolves after connect, surface the deposit address so
  // the user can copy it and fund the account fast. Shown once per connect.
  useEffect(() => {
    if (!authenticated) {
      fundPromptedRef.current = false
      return
    }
    if (smartAddress && !fundPromptedRef.current) {
      fundPromptedRef.current = true
      setShowFund(true)
    }
  }, [authenticated, smartAddress])

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
            address: config.loopchainAddress,
            abi: loopchainAbi,
            functionName: 'seriesInfo',
            args: [seriesId],
          }),
          publicClient
            .readContract({
              address: config.loopchainAddress,
              abi: loopchainAbi,
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
  // when the smart wallet hasn't yet authorised the Loopchain contract to pull
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
          args: [config.loopchainAddress, maxUint256],
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
    if (usdmBalance < cost) {
      flash(
        `Need ${formatUnits(cost, 18)} USDm to rent (have ${formatUnits(usdmBalance, 18).slice(0, 6)})`,
        true,
      )
      return
    }

    setOpenCell(null)
    // Light the cell instantly — marked pending until the tx confirms on chain.
    grid.applyOptimistic(cellId, smartAddress, durationLoops, pitchIdx)
    remember([cellId])
    flash(`Renting cell ${cellId} for ${durationLoops}× ${LOOP_DURATION_SECONDS}s…`)

    const calls = withApproval(cost, {
      to: config.loopchainAddress,
      data: encodeFunctionData({
        abi: loopchainAbi,
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
    if (usdmBalance < cost) {
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
      to: config.loopchainAddress,
      data: encodeFunctionData({
        abi: loopchainAbi,
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
    if (usdmBalance < basePrice) {
      flash(`Need ${formatUnits(basePrice, 18)} USDm to press (have ${formatUnits(usdmBalance, 18).slice(0, 6)})`, true)
      return
    }
    try {
      setBusy('Pressing copy #1…')
      const calls = withApproval(basePrice, {
        to: config.loopchainAddress,
        data: encodeFunctionData({ abi: loopchainAbi, functionName: 'record', args: [] }),
      })
      const txHash = await smartWalletClient.sendTransaction(
        { calls },
        { uiOptions: { showWalletUIs: false } },
      )

      let newSeriesId: bigint | null = null
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== config.loopchainAddress.toLowerCase()) continue
          try {
            const decoded = decodeEventLog({ abi: loopchainAbi, data: log.data, topics: log.topics })
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
          address: config.loopchainAddress,
          abi: loopchainAbi,
          functionName: 'seriesInfo',
          args: [seriesId],
        }),
        publicClient
          .readContract({
            address: config.loopchainAddress,
            abi: loopchainAbi,
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
    if (usdmBalance < record.nextPressPrice) {
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
        to: config.loopchainAddress,
        data: encodeFunctionData({
          abi: loopchainAbi,
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
          to: config.loopchainAddress,
          data: encodeFunctionData({
            abi: loopchainAbi,
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
    if (!audioRunning()) {
      void startAudio().then(() => setAudioOn(true))
    }
  }

  const exitPlayback = () => {
    setPlayback(null)
    setSnapshot(null, null)
  }

  const onAudioToggle = async () => {
    if (audioRunning()) {
      stopAudio()
      setAudioOn(false)
    } else {
      await startAudio()
      setAudioOn(true)
    }
  }

  // Route a grid click: in audition mode, just play the cell's sound. Otherwise
  // a cell held by someone else opens a read-only info card; free / own cells
  // open the toggle popover.
  const handleCellClick = (id: number, rect: DOMRect, status: CellStatus) => {
    if (auditionMode) {
      void previewCell(id, grid.cells[id]?.pitch ?? 0)
      return
    }
    if (status === 'occupied') {
      const c = grid.cells[id]
      if (c.owner) {
        setOpenCell({ id, rect, occupied: { who: c.owner, loopsLeft: c.expiryLoop - grid.currentLoop } })
        return
      }
    }
    setOpenCell({ id, rect })
  }

  const userEmail = user?.email?.address ?? user?.google?.email ?? null
  // Audition mode is read-only: while it's on, every edit-flow button is
  // disabled so the UI matches the "I'm just trying sounds" mental model.
  const canRecord =
    authenticated && smartAddress && grid.pattern !== 0n && !playback && !auditionMode

  const displayPattern = playback ? playback.pattern : grid.pattern
  const displaySynthData = playback ? playback.synthData : grid.synthData

  const basePriceStr = fmtUsdm(basePrice)

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>Loopchain</h1>
          <SyncBadge blockNumber={grid.blockNumber} />
        </div>
        <div className="right">
          <button onClick={onAudioToggle}>{audioOn ? '◼ stop' : '▶ play'}</button>
          <button
            className={auditionMode ? 'primary' : ''}
            onClick={() => setAuditionMode((v) => !v)}
            title="Audition — click any cell to hear its sound. No rent, no transaction."
          >
            🔊 audition
          </button>
          {authenticated && (
            <button
              className={canRecord ? 'primary' : ''}
              onClick={onRecord}
              disabled={!canRecord || busy?.startsWith('Pressing')}
              title={
                auditionMode
                  ? 'Exit audition to record the live grid'
                  : playback
                    ? 'Exit playback to record the live grid'
                    : grid.pattern === 0n
                      ? 'Toggle some cells first'
                      : `Press copy #1 — ${basePriceStr} USDm`
              }
            >
              {busy === 'Pressing copy #1…' ? 'Pressing…' : `✦ press copy #1 · ${basePriceStr} USDm`}
            </button>
          )}
          {authenticated && <FastMode session={session} ready={!!smartAddress} />}
          {!ready ? null : !authenticated ? (
            <button className="primary" onClick={login}>
              Connect
            </button>
          ) : (
            <>
              <span className="balance">
                {smartAddress ? `${smartAddress.slice(0, 6)}…${smartAddress.slice(-4)}` : '…'}
                {' · '}
                {formatUnits(usdmBalance, 18).slice(0, 6)} USDm
              </span>
              <button onClick={() => setShowFund(true)} title="Show your deposit address" disabled={!smartAddress}>
                ⊕ fund
              </button>
              <button onClick={logout}>logout</button>
            </>
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
              <button className="primary pb-press" onClick={login}>
                Connect to press
              </button>
            ) : (
              <button
                className="hot pb-press"
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

      <Grid
        pattern={displayPattern}
        synthData={displaySynthData}
        playingStep={playingStep}
        onCellClick={playback ? () => undefined : handleCellClick}
        cells={playback ? undefined : grid.cells}
        myAddress={smartAddress}
        currentLoop={grid.currentLoop}
        lastRent={playback ? null : grid.lastRent}
        auditionMode={!playback && auditionMode}
        onRowLabelClick={playback || !authenticated ? undefined : handleRowLabelClick}
        previewCells={playback ? null : previewCells}
      />

      {!playback && (
        <ContributorStrip cells={grid.cells} currentLoop={grid.currentLoop} myAddress={smartAddress} />
      )}

      {!playback && authenticated && smartAddress && (
        <RenewStrip
          history={history}
          cells={grid.cells}
          currentLoop={grid.currentLoop}
          myAddress={smartAddress}
          rentPerLoop={rentPerLoop}
          busy={Boolean(busy) || auditionMode}
          onRenew={onRenew}
          onPreview={setPreviewCells}
        />
      )}

      <div className="controls">
        <span className="muted">
          {countCells(displayPattern)} cells {playback ? 'in snapshot' : 'live'}
          {!playback && ` · ${usingWebSocket ? 'streaming ⚡' : 'live updates'}`}
        </span>
        <span className="muted">
          chain {config.chainId} ·{' '}
          <a href={`${config.explorerUrl}/address/${config.loopchainAddress}`} target="_blank" rel="noreferrer">
            contract
          </a>
        </span>
      </div>

      <Library
        smartAddress={smartAddress}
        playingTokenId={playback?.seriesId ?? null}
        playingStep={playingStep}
        onPlay={enterPlayback}
        onStop={exitPlayback}
        onPress={onPressSeries}
        pressingSeriesId={pressingSeriesId}
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
          onSubmit={(duration, pitch) => onToggle(openCell.id, duration, pitch)}
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
        <FundModal address={smartAddress} usdmBalance={usdmBalance} onClose={() => setShowFund(false)} />
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
        syncing…
      </span>
    )
  }
  return (
    <span className="sync-badge" title="The live grid is synced to this MegaETH block">
      <span className="sync-dot" key={blockNumber} />
      block #{blockNumber.toLocaleString('en-US')}
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
          <button className="primary" onClick={copy}>
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

// Deposit-address modal — pops on first connect and re-openable via the header "fund" button.
function FundModal({
  address,
  usdmBalance,
  onClose,
}: {
  address: `0x${string}`
  usdmBalance: bigint
  onClose: () => void
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
        <h3>Fund your wallet ⊕</h3>
        <p className="muted">
          Send USDm on MegaETH Mainnet to your smart-wallet address below — it bankrolls cell rent and
          presses. You currently hold {formatUnits(usdmBalance, 18).slice(0, 6)} USDm.
        </p>
        <div className="share-url">
          <input readOnly value={address} onFocus={(e) => e.currentTarget.select()} />
          <button className="primary" onClick={copy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="muted">Deposits land in a few seconds. Reopen this any time via the “⊕ fund” button.</p>
        <div className="row">
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
