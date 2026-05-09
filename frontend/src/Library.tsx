import { useEffect, useMemo, useState, useCallback } from 'react'
import { config } from './config'
import { loopchainAbi } from './abi'
import { publicClient } from './viemClient'
import { MiniGrid } from './MiniGrid'

const POLL_MS = 5000

export interface LoopRecord {
  tokenId: bigint
  pattern: bigint
  pitches: bigint
  mintedAtLoop: bigint
  holders: readonly `0x${string}`[]
  cellsPerHolder: readonly number[]
  owner: `0x${string}` | null
}

type Tab = 'recent' | 'collab' | 'mine'

interface LibraryProps {
  smartAddress: `0x${string}` | null
  playingTokenId: bigint | null
  playingStep: number
  onPlay: (record: LoopRecord) => void
  onStop: () => void
  refreshTick: number
}

export function Library({ smartAddress, playingTokenId, playingStep, onPlay, onStop, refreshTick }: LibraryProps) {
  const [records, setRecords] = useState<LoopRecord[]>([])
  const [tab, setTab] = useState<Tab>('recent')
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const next = (await publicClient.readContract({
        address: config.loopchainAddress,
        abi: loopchainAbi,
        functionName: 'nextTokenId',
      })) as bigint

      const total = Number(next - 1n)
      if (total <= 0) {
        setRecords([])
        return
      }

      const ids = Array.from({ length: total }, (_, i) => BigInt(i + 1))
      const fetched = await Promise.all(
        ids.map(async (id) => {
          const [loop, owner] = await Promise.all([
            publicClient.readContract({
              address: config.loopchainAddress,
              abi: loopchainAbi,
              functionName: 'loopOf',
              args: [id],
            }),
            publicClient
              .readContract({
                address: config.loopchainAddress,
                abi: loopchainAbi,
                functionName: 'ownerOf',
                args: [id],
              })
              .catch(() => null),
          ])
          const [pattern, pitches, mintedAtLoop, holders, cellsPerHolder] = loop as readonly [
            bigint,
            bigint,
            bigint,
            readonly `0x${string}`[],
            readonly number[],
          ]
          return {
            tokenId: id,
            pattern,
            pitches,
            mintedAtLoop,
            holders,
            cellsPerHolder,
            owner: owner as `0x${string}` | null,
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
      arr.sort((a, b) => Number(b.mintedAtLoop - a.mintedAtLoop) || Number(b.tokenId - a.tokenId))
    } else if (tab === 'collab') {
      arr.sort((a, b) => b.holders.length - a.holders.length || Number(b.tokenId - a.tokenId))
    } else {
      arr = arr.filter((r) => {
        if (!me) return false
        if (r.owner && r.owner.toLowerCase() === me) return true
        return r.holders.some((h) => h.toLowerCase() === me)
      })
      arr.sort((a, b) => Number(b.mintedAtLoop - a.mintedAtLoop) || Number(b.tokenId - a.tokenId))
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
            title={smartAddress ? '' : 'connect to filter your loops'}
          >
            My Loops
          </button>
        </div>
      </div>

      {error && <div className="muted error-line">library: {error}</div>}

      {filtered.length === 0 ? (
        <div className="library-empty muted">
          {records.length === 0
            ? 'No loops minted yet — be the first.'
            : tab === 'mine'
              ? 'No loops you own or contributed to.'
              : 'No loops match.'}
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((r) => {
            const isPlaying = playingTokenId === r.tokenId
            return (
              <div key={r.tokenId.toString()} className={isPlaying ? 'loop-card playing' : 'loop-card'}>
                <div className="loop-card-head">
                  <span className="token-id">#{r.tokenId.toString()}</span>
                  <span className="muted">{r.holders.length} contrib</span>
                </div>
                <MiniGrid pattern={r.pattern} pitches={r.pitches} playingStep={isPlaying ? playingStep : -1} />
                <div className="loop-card-foot">
                  <span className="muted owner">{r.owner ? short(r.owner) : '—'}</span>
                  <div className="card-actions">
                    {isPlaying ? (
                      <button onClick={onStop}>◼ stop</button>
                    ) : (
                      <button onClick={() => onPlay(r)}>▶ play</button>
                    )}
                    <button onClick={() => copyShareLink(r.tokenId)} title="copy share link">
                      ↗ share
                    </button>
                    <a
                      href={`${config.explorerUrl}/token/${config.loopchainAddress}/instance/${r.tokenId.toString()}`}
                      target="_blank"
                      rel="noreferrer"
                      title="view on blockscout"
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

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function copyShareLink(tokenId: bigint) {
  const url = `${window.location.origin}${window.location.pathname}?loop=${tokenId.toString()}`
  navigator.clipboard?.writeText(url).catch(() => void 0)
}
