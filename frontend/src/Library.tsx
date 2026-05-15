import { useEffect, useMemo, useState, useCallback } from 'react'
import { formatUnits } from 'viem'
import { config } from './config'
import { loopchainAbi } from './abi'
import { publicClient } from './viemClient'
import { MiniGrid } from './MiniGrid'

const POLL_MS = 5000

export interface LoopRecord {
  seriesId: bigint
  tokenId: bigint // edition #1 token, used for share links and as a stable identity for playback
  pattern: bigint
  pitches: bigint
  mintedAtLoop: bigint
  holders: readonly `0x${string}`[]
  cellsPerHolder: readonly number[]
  nextEdition: number
  nextPressPrice: bigint
  owner: `0x${string}` | null
}

type Tab = 'recent' | 'collab' | 'mine'

interface LibraryProps {
  smartAddress: `0x${string}` | null
  playingTokenId: bigint | null
  playingStep: number
  onPlay: (record: LoopRecord) => void
  onStop: () => void
  onPress: (record: LoopRecord) => void
  pressingSeriesId: bigint | null
  refreshTick: number
}

export function Library({
  smartAddress,
  playingTokenId,
  playingStep,
  onPlay,
  onStop,
  onPress,
  pressingSeriesId,
  refreshTick,
}: LibraryProps) {
  const [records, setRecords] = useState<LoopRecord[]>([])
  const [tab, setTab] = useState<Tab>('recent')
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const next = (await publicClient.readContract({
        address: config.loopchainAddress,
        abi: loopchainAbi,
        functionName: 'nextSeriesId',
      })) as bigint

      const total = Number(next - 1n)
      if (total <= 0) {
        setRecords([])
        return
      }

      const ids = Array.from({ length: total }, (_, i) => BigInt(i + 1))
      const fetched = await Promise.all(
        ids.map(async (sid) => {
          // First edition tokenId = 1-based sequential when series is created; we can't infer it cheaply,
          // so we look it up via the SeriesRecorded event ... but to keep things simple we just call
          // ownerOf on a best-guess (we don't actually need it for series-level UX; we'll set owner=null).
          const info = await publicClient.readContract({
            address: config.loopchainAddress,
            abi: loopchainAbi,
            functionName: 'seriesInfo',
            args: [sid],
          })
          const [pattern, pitches, mintedAtLoop, nextEdition, holders, cellsPerHolder] = info as readonly [
            bigint,
            bigint,
            bigint,
            number,
            readonly `0x${string}`[],
            readonly number[],
          ]
          const nextPressPrice = (await publicClient.readContract({
            address: config.loopchainAddress,
            abi: loopchainAbi,
            functionName: 'pressPriceFor',
            args: [sid],
          })) as bigint
          return {
            seriesId: sid,
            tokenId: sid, // placeholder; we use seriesId for share links instead
            pattern,
            pitches,
            mintedAtLoop,
            holders,
            cellsPerHolder,
            nextEdition: Number(nextEdition),
            nextPressPrice,
            owner: null,
          } satisfies LoopRecord
        }),
      )
      setRecords(fetched)
      setError(null)
    } catch (e) {
      console.error('library load failed', e)
      setError((e as Error).message ?? 'failed to load')
    }
  }, [])

  useEffect(() => {
    loadAll()
    const id = setInterval(loadAll, POLL_MS)
    return () => clearInterval(id)
  }, [loadAll, refreshTick])

  const filtered = useMemo(() => {
    const me = smartAddress?.toLowerCase()
    let arr = records.slice()
    if (tab === 'recent') {
      arr.sort((a, b) => Number(b.mintedAtLoop - a.mintedAtLoop) || Number(b.seriesId - a.seriesId))
    } else if (tab === 'collab') {
      arr.sort((a, b) => b.holders.length - a.holders.length || Number(b.seriesId - a.seriesId))
    } else {
      arr = arr.filter((r) => {
        if (!me) return false
        return r.holders.some((h) => h.toLowerCase() === me)
      })
      arr.sort((a, b) => Number(b.mintedAtLoop - a.mintedAtLoop) || Number(b.seriesId - a.seriesId))
    }
    return arr
  }, [records, tab, smartAddress])

  return (
    <div className="library">
      <div className="library-header">
        <h2>Library</h2>
        <div className="tabs">
          <button className={tab === 'recent' ? 'tab active' : 'tab'} onClick={() => setTab('recent')}>
            Recent
          </button>
          <button className={tab === 'collab' ? 'tab active' : 'tab'} onClick={() => setTab('collab')}>
            Most Collab
          </button>
          <button
            className={tab === 'mine' ? 'tab active' : 'tab'}
            onClick={() => setTab('mine')}
            disabled={!smartAddress}
            title={smartAddress ? '' : 'connect to filter loops you contributed to'}
          >
            My Loops
          </button>
        </div>
      </div>

      {error && <div className="muted error-line">library: {error}</div>}

      {filtered.length === 0 ? (
        <div className="library-empty muted">
          {records.length === 0
            ? 'No loops recorded yet — be the first.'
            : tab === 'mine'
              ? 'No loops you contributed to.'
              : 'No loops match.'}
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((r) => {
            const isPlaying = playingTokenId === r.seriesId
            const editionsMinted = r.nextEdition - 1
            const isPressing = pressingSeriesId === r.seriesId
            const priceStr = formatPrice(r.nextPressPrice)
            return (
              <div key={r.seriesId.toString()} className={isPlaying ? 'loop-card playing' : 'loop-card'}>
                <div className="loop-card-head">
                  <span className="token-id">loop #{r.seriesId.toString()}</span>
                  <span className="muted">
                    {editionsMinted}× pressed · {r.holders.length} contrib
                  </span>
                </div>
                <MiniGrid pattern={r.pattern} pitches={r.pitches} playingStep={isPlaying ? playingStep : -1} />
                <div className="loop-card-foot">
                  <span className="muted owner">next press {priceStr} USDm</span>
                  <div className="card-actions">
                    {isPlaying ? (
                      <button onClick={onStop}>◼ stop</button>
                    ) : (
                      <button onClick={() => onPlay(r)}>▶ play</button>
                    )}
                    <button
                      className="primary"
                      onClick={() => onPress(r)}
                      disabled={isPressing}
                      title={`Press copy #${r.nextEdition} of loop #${r.seriesId.toString()}`}
                    >
                      {isPressing ? 'pressing…' : `✦ press #${r.nextEdition} · ${priceStr}`}
                    </button>
                    <button onClick={() => copyShareLink(r.seriesId)} title="copy share link">
                      ↗ share
                    </button>
                    <a
                      href={`${config.explorerUrl}/address/${config.loopchainAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      title="view contract on blockscout"
                    >
                      ↗
                    </a>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatPrice(wei: bigint): string {
  const s = formatUnits(wei, 18)
  // trim trailing zeros and decimals
  if (!s.includes('.')) return s
  const [intPart, decPart] = s.split('.')
  const trimmed = decPart.replace(/0+$/, '')
  return trimmed.length === 0 ? intPart : `${intPart}.${trimmed.slice(0, 2)}`
}

function copyShareLink(seriesId: bigint) {
  const url = `${window.location.origin}${window.location.pathname}?loop=${seriesId.toString()}`
  navigator.clipboard?.writeText(url).catch(() => void 0)
}
