import { useEffect, useState, useCallback, useRef } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets'
import { encodeFunctionData, formatUnits, maxUint256, decodeEventLog } from 'viem'
import { Grid } from './Grid'
import { ToggleModal } from './ToggleModal'
import { Library, type LoopRecord } from './Library'
import { config, megaethMainnet, LOOP_DURATION_SECONDS, SYNTH_CELL_START } from './config'
import { loopchainAbi, usdmAbi } from './abi'
import { publicClient } from './viemClient'
import { startAudio, stopAudio, audioRunning, setLiveState, setSnapshot, onStep } from './audio'

const POLL_MS = 2000
const MINT_PRICE = 4n * 10n ** 18n // 4 USDm

export function App() {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const { client: smartWalletClient } = useSmartWallets()

  const [pattern, setPattern] = useState<bigint>(0n)
  const [pitches, setPitches] = useState<bigint>(0n)
  const [usdmBalance, setUsdmBalance] = useState<bigint>(0n)
  const [allowance, setAllowance] = useState<bigint>(0n)
  const [openCellId, setOpenCellId] = useState<number | null>(null)
  const [playingStep, setPlayingStep] = useState<number>(-1)
  const [audioOn, setAudioOn] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playback, setPlayback] = useState<LoopRecord | null>(null)
  const [shareTokenId, setShareTokenId] = useState<bigint | null>(null)
  const [libraryRefresh, setLibraryRefresh] = useState(0)

  const smartAddress = (smartWalletClient?.account?.address ?? null) as `0x${string}` | null
  const playbackRef = useRef<LoopRecord | null>(null)
  playbackRef.current = playback

  const refresh = useCallback(async () => {
    try {
      const [p, ps] = await Promise.all([
        publicClient.readContract({ address: config.loopchainAddress, abi: loopchainAbi, functionName: 'livePattern' }),
        publicClient.readContract({ address: config.loopchainAddress, abi: loopchainAbi, functionName: 'livePitches' }),
      ])
      setPattern(p as bigint)
      setPitches(ps as bigint)
      // Always feed live state so audio can resume on exit-playback without a race.
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

  // On first load, if URL has ?loop=<id>, auto-load + enter playback mode for that token.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('loop')
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const tokenId = BigInt(id)
        const [loop, owner] = await Promise.all([
          publicClient.readContract({
            address: config.loopchainAddress,
            abi: loopchainAbi,
            functionName: 'loopOf',
            args: [tokenId],
          }),
          publicClient
            .readContract({
              address: config.loopchainAddress,
              abi: loopchainAbi,
              functionName: 'ownerOf',
              args: [tokenId],
            })
            .catch(() => null),
        ])
        if (cancelled) return
        const [pat, pit, mintedAtLoop, holders, cellsPerHolder] = loop as readonly [
          bigint,
          bigint,
          bigint,
          readonly `0x${string}`[],
          readonly number[],
        ]
        const record: LoopRecord = {
          tokenId,
          pattern: pat,
          pitches: pit,
          mintedAtLoop,
          holders,
          cellsPerHolder,
          owner: owner as `0x${string}` | null,
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

  const onApprove = async () => {
    if (!smartWalletClient) return
    try {
      setBusy('Approving…')
      await smartWalletClient.sendTransaction({
        to: config.paymentTokenAddress,
        data: encodeFunctionData({
          abi: usdmAbi,
          functionName: 'approve',
          args: [config.loopchainAddress, maxUint256],
        }),
        chain: megaethMainnet,
      })
      flash('Approved')
      refresh()
    } catch (e: unknown) {
      flash((e as Error).message ?? 'approve failed', true)
    }
  }

  const onToggle = (cellId: number, durationLoops: number, pitchIdx: number) => {
    if (!smartWalletClient) return

    setOpenCellId(null)
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

  const onSave = async () => {
    if (!smartWalletClient) return
    if (pattern === 0n) {
      flash('Grid is empty — toggle some cells first', true)
      return
    }
    if (usdmBalance < MINT_PRICE) {
      flash(`Need 4 USDm to save (have ${formatUnits(usdmBalance, 18).slice(0, 6)})`, true)
      return
    }
    try {
      setBusy('Saving loop…')
      const txHash = await smartWalletClient.sendTransaction(
        {
          to: config.loopchainAddress,
          data: encodeFunctionData({ abi: loopchainAbi, functionName: 'record', args: [] }),
          chain: megaethMainnet,
        },
        { uiOptions: { showWalletUIs: false } },
      )

      // Pull tokenId from RecordingMinted event in the receipt.
      let mintedId: bigint | null = null
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== config.loopchainAddress.toLowerCase()) continue
          try {
            const decoded = decodeEventLog({ abi: loopchainAbi, data: log.data, topics: log.topics })
            if (decoded.eventName === 'RecordingMinted') {
              mintedId = (decoded.args as { tokenId: bigint }).tokenId
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
      if (mintedId !== null) setShareTokenId(mintedId)
      else flash('Saved!')
      setLibraryRefresh((n) => n + 1)
      refresh()
    } catch (e: unknown) {
      flash((e as Error).message ?? 'save failed', true)
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

  const needsApproval = authenticated && smartAddress && allowance < MINT_PRICE
  const userEmail = user?.email?.address ?? user?.google?.email ?? null
  const canSave = authenticated && smartAddress && pattern !== 0n && !needsApproval && !playback

  // What the main grid renders: live state when jamming, snapshot when playing back.
  const displayPattern = playback ? playback.pattern : pattern
  const displayPitches = playback ? playback.pitches : pitches

  return (
    <div className="app">
      <header className="header">
        <h1>Loopchain</h1>
        <div className="right">
          <button onClick={onAudioToggle}>{audioOn ? '◼ stop' : '▶ play'}</button>
          {authenticated && (
            <button
              className={canSave ? 'primary' : ''}
              onClick={onSave}
              disabled={!canSave || busy === 'Saving loop…'}
              title={
                playback
                  ? 'Exit playback to save the live grid'
                  : pattern === 0n
                    ? 'Toggle some cells first'
                    : `Mint current loop as NFT (${formatUnits(MINT_PRICE, 18)} USDm)`
              }
            >
              {busy === 'Saving loop…' ? 'Saving…' : '✦ save loop'}
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
              {needsApproval && (
                <button className="primary" onClick={onApprove}>
                  approve
                </button>
              )}
              <button onClick={logout}>logout</button>
            </>
          )}
        </div>
      </header>

      {playback && (
        <div className="playback-banner">
          <span>
            ▶ Playing loop <strong>#{playback.tokenId.toString()}</strong> · {playback.holders.length} contrib · minted
            at loop {playback.mintedAtLoop.toString()}
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
        onCellClick={playback ? () => undefined : setOpenCellId}
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
        playingTokenId={playback?.tokenId ?? null}
        playingStep={playingStep}
        onPlay={enterPlayback}
        onStop={exitPlayback}
        refreshTick={libraryRefresh}
      />

      {openCellId !== null && !playback && (
        <ToggleModal
          cellId={openCellId}
          onClose={() => setOpenCellId(null)}
          onSubmit={(duration, pitch) => onToggle(openCellId, duration, pitch)}
        />
      )}

      {shareTokenId !== null && (
        <ShareModal tokenId={shareTokenId} onClose={() => setShareTokenId(null)} />
      )}

      {error && <div className="toast error">{error}</div>}
      {!error && busy && <div className="toast">{busy}</div>}
      {!authenticated && ready && (
        <div className="muted" style={{ textAlign: 'center', paddingTop: '2rem' }}>
          Connect to rent cells. {userEmail ? `signed in as ${userEmail}` : ''}
        </div>
      )}

      {authenticated && (
        <pre
          style={{
            position: 'fixed',
            bottom: 8,
            left: 8,
            maxWidth: '40vw',
            maxHeight: '40vh',
            overflow: 'auto',
            background: 'rgba(0,0,0,0.7)',
            border: '1px solid #444',
            color: '#0f0',
            font: '10px ui-monospace, monospace',
            padding: 8,
            zIndex: 999,
            whiteSpace: 'pre-wrap',
          }}
        >
{`privyAppId=${config.privyAppId ?? 'MISSING'}
ready=${ready}
authenticated=${authenticated}
smartWalletClient=${smartWalletClient ? 'present' : 'UNDEFINED'}
smartAddress=${smartAddress ?? 'null'}
chain=${config.chainId}
playback=${playback ? `#${playback.tokenId}` : 'null'}
linkedAccounts=
${JSON.stringify(
  user?.linkedAccounts?.map((a: any) => ({
    type: a.type,
    address: a.address,
    chainType: a.chainType,
    walletClientType: a.walletClientType,
    smartWalletType: a.smartWalletType,
  })),
  null,
  2,
)}`}
        </pre>
      )}
    </div>
  )
}

function ShareModal({ tokenId, onClose }: { tokenId: bigint; onClose: () => void }) {
  const url = `${window.location.origin}${window.location.pathname}?loop=${tokenId.toString()}`
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
        <h3>Loop #{tokenId.toString()} saved ✦</h3>
        <p className="muted">Your loop is live on chain. Share it:</p>
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

function countCells(pattern: bigint): number {
  let v = pattern
  let n = 0
  while (v) {
    if (v & 1n) n++
    v >>= 1n
  }
  return n
}
