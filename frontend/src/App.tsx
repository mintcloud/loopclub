import { useEffect, useState, useCallback, useRef } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets'
import { encodeFunctionData, formatUnits, maxUint256, decodeEventLog } from 'viem'
import { Grid } from './Grid'
import { CellPopover } from './CellPopover'
import { Library, type LoopRecord } from './Library'
import { config, megaethMainnet, LOOP_DURATION_SECONDS, SYNTH_CELL_START } from './config'
import { loopchainAbi, usdmAbi } from './abi'
import { publicClient } from './viemClient'
import { startAudio, stopAudio, audioRunning, setLiveState, setSnapshot, onStep } from './audio'

const POLL_MS = 2000

export function App() {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const { client: smartWalletClient } = useSmartWallets()

  const [pattern, setPattern] = useState<bigint>(0n)
  const [pitches, setPitches] = useState<bigint>(0n)
  const [usdmBalance, setUsdmBalance] = useState<bigint>(0n)
  const [allowance, setAllowance] = useState<bigint>(0n)
  const [basePrice, setBasePrice] = useState<bigint>(1n * 10n ** 18n) // default 1 USDm; refreshed from chain
  const [openCell, setOpenCell] = useState<{ id: number; rect: DOMRect } | null>(null)
  const [showFund, setShowFund] = useState(false)
  const [playingStep, setPlayingStep] = useState<number>(-1)
  const [audioOn, setAudioOn] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playback, setPlayback] = useState<LoopRecord | null>(null)
  const [shareSeriesId, setShareSeriesId] = useState<bigint | null>(null)
  const [libraryRefresh, setLibraryRefresh] = useState(0)
  const [pressingSeriesId, setPressingSeriesId] = useState<bigint | null>(null)
  const [claimingSeriesId, setClaimingSeriesId] = useState<bigint | null>(null)

  const smartAddress = (smartWalletClient?.account?.address ?? null) as `0x${string}` | null
  const playbackRef = useRef<LoopRecord | null>(null)
  playbackRef.current = playback
  const fundPromptedRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [p, ps, base] = await Promise.all([
        publicClient.readContract({ address: config.loopchainAddress, abi: loopchainAbi, functionName: 'livePattern' }),
        publicClient.readContract({ address: config.loopchainAddress, abi: loopchainAbi, functionName: 'livePitches' }),
        publicClient.readContract({ address: config.loopchainAddress, abi: loopchainAbi, functionName: 'basePrice' }),
      ])
      setPattern(p as bigint)
      setPitches(ps as bigint)
      setBasePrice(base as bigint)
      setLiveState(p as bigint, ps as bigint)

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
      console.error('refresh failed', e)
    }
  }, [smartAddress])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    onStep((step) => setPlayingStep(step))
  }, [])

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
        const [pat, pit, mintedAtLoop, nextEdition, holders, cellsPerHolder] = info as readonly [
          bigint,
          bigint,
          bigint,
          number,
          readonly `0x${string}`[],
          readonly number[],
        ]
        const record: LoopRecord = {
          seriesId,
          tokenId: seriesId,
          pattern: pat,
          pitches: pit,
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

  // Build the call list for a paid action, prepending a one-time max USDm
  // approval when the smart wallet hasn't yet authorised the Loopchain contract
  // to pull payment. Both calls land in a single UserOperation, so the user
  // signs once — and a fresh wallet can press/record without a separate step.
  const withApproval = (
    price: bigint,
    action: { to: `0x${string}`; data: `0x${string}` },
  ): { to: `0x${string}`; data: `0x${string}` }[] => {
    const calls: { to: `0x${string}`; data: `0x${string}` }[] = []
    if (allowance < price) {
      calls.push({
        to: config.paymentTokenAddress,
        data: encodeFunctionData({
          abi: usdmAbi,
          functionName: 'approve',
          args: [config.loopchainAddress, maxUint256],
        }),
      })
    }
    calls.push(action)
    return calls
  }

  const onToggle = (cellId: number, durationLoops: number, pitchIdx: number) => {
    if (!smartWalletClient) return

    setOpenCell(null)
    const bit = 1n << BigInt(cellId)
    const optimisticPattern = pattern | bit
    let optimisticPitches = pitches
    if (cellId >= SYNTH_CELL_START) {
      const offset = cellId - SYNTH_CELL_START
      const mask = ~(0x7n << BigInt(offset * 3))
      optimisticPitches = (pitches & mask) | (BigInt(pitchIdx & 0x7) << BigInt(offset * 3))
      setPitches(optimisticPitches)
    }
    setPattern(optimisticPattern)
    if (!playbackRef.current) setLiveState(optimisticPattern, optimisticPitches)
    flash(`Cell ${cellId} on for ${durationLoops}× ${LOOP_DURATION_SECONDS}s`)

    smartWalletClient
      .sendTransaction(
        {
          to: config.loopchainAddress,
          data: encodeFunctionData({
            abi: loopchainAbi,
            functionName: 'toggle',
            args: [cellId, durationLoops, pitchIdx],
          }),
          chain: megaethMainnet,
        },
        { uiOptions: { showWalletUIs: false } },
      )
      .then(() => refresh())
      .catch((e: unknown) => {
        flash((e as Error).message ?? 'toggle failed', true)
        refresh()
      })
  }

  // Press copy #1 of a brand-new loop — calls record().
  const onRecord = async () => {
    if (!smartWalletClient) return
    if (pattern === 0n) {
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
      refresh()
    } catch (e: unknown) {
      flash((e as Error).message ?? 'record failed', true)
    }
  }

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
      setLibraryRefresh((n) => n + 1)
      refresh()
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
      refresh()
    } catch (e: unknown) {
      flash((e as Error).message ?? 'claim failed', true)
    } finally {
      setClaimingSeriesId(null)
    }
  }

  const enterPlayback = (record: LoopRecord) => {
    setPlayback(record)
    setSnapshot(record.pattern, record.pitches)
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

  const userEmail = user?.email?.address ?? user?.google?.email ?? null
  const canRecord = authenticated && smartAddress && pattern !== 0n && !playback

  const displayPattern = playback ? playback.pattern : pattern
  const displayPitches = playback ? playback.pitches : pitches

  const basePriceStr = formatUnits(basePrice, 18).replace(/\.?0+$/, '')

  return (
    <div className="app">
      <header className="header">
        <h1>Loopchain</h1>
        <div className="right">
          <button onClick={onAudioToggle}>{audioOn ? '◼ stop' : '▶ play'}</button>
          {authenticated && (
            <button
              className={canRecord ? 'primary' : ''}
              onClick={onRecord}
              disabled={!canRecord || busy?.startsWith('Pressing')}
              title={
                playback
                  ? 'Exit playback to record the live grid'
                  : pattern === 0n
                    ? 'Toggle some cells first'
                    : `Press copy #1 — ${basePriceStr} USDm`
              }
            >
              {busy === 'Pressing copy #1…' ? 'Pressing…' : `✦ press copy #1 · ${basePriceStr} USDm`}
            </button>
          )}
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
          <span>
            ▶ Playing loop <strong>#{playback.seriesId.toString()}</strong> · {playback.holders.length} contrib ·{' '}
            {playback.nextEdition - 1}× pressed · next press {formatUnits(playback.nextPressPrice, 18).slice(0, 6)} USDm
          </span>
          <button className="primary" onClick={exitPlayback}>
            ◼ back to live jam
          </button>
        </div>
      )}

      <Grid
        pattern={displayPattern}
        pitches={displayPitches}
        playingStep={playingStep}
        onCellClick={playback ? () => undefined : (id, rect) => setOpenCell({ id, rect })}
      />

      <div className="controls">
        <span className="muted">
          {countCells(displayPattern)} cells {playback ? 'in snapshot' : 'live'} · poll every {POLL_MS / 1000}s
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
          onClose={() => setOpenCell(null)}
          onSubmit={(duration, pitch) => onToggle(openCell.id, duration, pitch)}
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

function countCells(pattern: bigint): number {
  let v = pattern
  let n = 0
  while (v) {
    if (v & 1n) n++
    v >>= 1n
  }
  return n
}
