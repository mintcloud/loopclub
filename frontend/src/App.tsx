import { useEffect, useState, useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets'
import { encodeFunctionData, formatUnits, maxUint256 } from 'viem'
import { Grid } from './Grid'
import { ToggleModal } from './ToggleModal'
import { config, megaethMainnet, LOOP_DURATION_SECONDS } from './config'
import { loopchainAbi, usdmAbi } from './abi'
import { publicClient } from './viemClient'
import { startAudio, stopAudio, audioRunning, setLiveState, onStep } from './audio'

const POLL_MS = 2000

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

  const smartAddress = (smartWalletClient?.account?.address ?? null) as `0x${string}` | null

  const refresh = useCallback(async () => {
    try {
      const [p, ps] = await Promise.all([
        publicClient.readContract({ address: config.loopchainAddress, abi: loopchainAbi, functionName: 'livePattern' }),
        publicClient.readContract({ address: config.loopchainAddress, abi: loopchainAbi, functionName: 'livePitches' }),
      ])
      setPattern(p as bigint)
      setPitches(ps as bigint)
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

  const onToggle = async (cellId: number, durationLoops: number, pitchIdx: number) => {
    if (!smartWalletClient) return
    try {
      setBusy('Toggling cell…')
      await smartWalletClient.sendTransaction({
        to: config.loopchainAddress,
        data: encodeFunctionData({
          abi: loopchainAbi,
          functionName: 'toggle',
          args: [cellId, durationLoops, pitchIdx],
        }),
        chain: megaethMainnet,
      })
      flash(`Cell ${cellId} on for ${durationLoops}× ${LOOP_DURATION_SECONDS}s`)
      setOpenCellId(null)
      refresh()
    } catch (e: unknown) {
      flash((e as Error).message ?? 'toggle failed', true)
    }
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

  const needsApproval = authenticated && smartAddress && allowance < 1n * 10n ** 18n
  const userEmail = user?.email?.address ?? user?.google?.email ?? null

  return (
    <div className="app">
      <header className="header">
        <h1>Loopchain</h1>
        <div className="right">
          <button onClick={onAudioToggle}>{audioOn ? '◼ stop' : '▶ play'}</button>
          {!ready ? null : !authenticated ? (
            <button className="primary" onClick={login}>Connect</button>
          ) : (
            <>
              <span className="balance">
                {smartAddress ? `${smartAddress.slice(0, 6)}…${smartAddress.slice(-4)}` : '…'}
                {' · '}
                {formatUnits(usdmBalance, 18).slice(0, 6)} USDm
              </span>
              {needsApproval && <button className="primary" onClick={onApprove}>approve</button>}
              <button onClick={logout}>logout</button>
            </>
          )}
        </div>
      </header>

      <Grid pattern={pattern} pitches={pitches} playingStep={playingStep} onCellClick={setOpenCellId} />

      <div className="controls">
        <span className="muted">
          {countCells(pattern)} cells live · poll every {POLL_MS / 1000}s
        </span>
        <span className="muted">
          chain {config.chainId} ·{' '}
          <a href={`${config.explorerUrl}/address/${config.loopchainAddress}`} target="_blank" rel="noreferrer">
            contract
          </a>
        </span>
      </div>

      {openCellId !== null && (
        <ToggleModal
          cellId={openCellId}
          onClose={() => setOpenCellId(null)}
          onSubmit={(duration, pitch) => onToggle(openCellId, duration, pitch)}
        />
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

function countCells(pattern: bigint): number {
  let v = pattern
  let n = 0
  while (v) {
    if (v & 1n) n++
    v >>= 1n
  }
  return n
}
