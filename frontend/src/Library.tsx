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
  synthData: bigint
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
  onClaimRoyalty: (record: LoopRecord) => void
  claimingSeriesId: bigint | null
  refreshTick: number
}

/** Royalty position for one series, from the connected wallet's point of view. */
interface RoyaltyPosition {
  deposited: bigint // total resale royalty pooled for the series
  claimable: bigint // amount this wallet can claim right now
}

/** One edition NFT the connected wallet holds (edition #1 = the recorder's original press). */
interface OwnedEdition {
  tokenId: bigint
  edition: number
}

export function Library({
  smartAddress,
  playingTokenId,
  playingStep,
  onPlay,
  onStop,
  onClaimRoyalty,
  claimingSeriesId,
  refreshTick,
}: LibraryProps) {
  const [records, setRecords] = useState<LoopRecord[]>([])
  const [royalty, setRoyalty] = useState<Record<string, RoyaltyPosition>>({})
  const [owned, setOwned] = useState<Record<string, OwnedEdition[]>>({})
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
          const [pattern, synthData, mintedAtLoop, nextEdition, , , , holders, cellsPerHolder] =
            info as readonly [
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
            synthData,
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

  // Resale royalties are series-keyed and pull-claimed. There's no single view for
  // "what can I claim", so derive it: claimable = deposited × myCells / cellCount − claimed.
  // Only the series the connected wallet co-created can ever pay out, so fetch just those.
  useEffect(() => {
    const me = smartAddress?.toLowerCase()
    if (!me || records.length === 0) {
      setRoyalty({})
      return
    }
    let cancelled = false
    ;(async () => {
      const mine = records.filter((r) => r.holders.some((h) => h.toLowerCase() === me))
      try {
        const entries = await Promise.all(
          mine.map(async (r) => {
            const [deposited, claimed] = await Promise.all([
              publicClient.readContract({
                address: config.loopchainAddress,
                abi: loopchainAbi,
                functionName: 'royaltyDepositedSeries',
                args: [r.seriesId],
              }) as Promise<bigint>,
              publicClient.readContract({
                address: config.loopchainAddress,
                abi: loopchainAbi,
                functionName: 'royaltyClaimedSeries',
                args: [r.seriesId, smartAddress as `0x${string}`],
              }) as Promise<bigint>,
            ])
            const idx = r.holders.findIndex((h) => h.toLowerCase() === me)
            const myCells = BigInt(r.cellsPerHolder[idx] ?? 0)
            const cellCount = popcount(r.pattern)
            const entitled = cellCount > 0n ? (deposited * myCells) / cellCount : 0n
            const claimable = entitled > claimed ? entitled - claimed : 0n
            return [r.seriesId.toString(), { deposited, claimable }] as const
          }),
        )
        if (!cancelled) setRoyalty(Object.fromEntries(entries))
      } catch (e) {
        console.error('royalty load failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [records, smartAddress, refreshTick])

  // Which loop editions the connected wallet currently holds as NFTs, keyed by
  // seriesId. Walk every minted token (nextTokenId is the upper bound) and keep
  // the ones owned by this wallet — reflects live ownership, transfers included.
  // Re-runs on connect and after the wallet's own record/press (refreshTick).
  useEffect(() => {
    const me = smartAddress?.toLowerCase()
    if (!me) {
      setOwned({})
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const nextTokenId = (await publicClient.readContract({
          address: config.loopchainAddress,
          abi: loopchainAbi,
          functionName: 'nextTokenId',
        })) as bigint
        const totalTokens = Number(nextTokenId - 1n)
        if (totalTokens <= 0) {
          if (!cancelled) setOwned({})
          return
        }
        const tokenIds = Array.from({ length: totalTokens }, (_, i) => BigInt(i + 1))
        const rows = await Promise.all(
          tokenIds.map(async (tid) => {
            const [tokenOwner, seriesId, edition] = await Promise.all([
              publicClient.readContract({
                address: config.loopchainAddress,
                abi: loopchainAbi,
                functionName: 'ownerOf',
                args: [tid],
              }) as Promise<`0x${string}`>,
              publicClient.readContract({
                address: config.loopchainAddress,
                abi: loopchainAbi,
                functionName: 'seriesOf',
                args: [tid],
              }) as Promise<bigint>,
              publicClient.readContract({
                address: config.loopchainAddress,
                abi: loopchainAbi,
                functionName: 'editionOf',
                args: [tid],
              }) as Promise<number>,
            ])
            return { tokenId: tid, owner: tokenOwner.toLowerCase(), seriesId, edition: Number(edition) }
          }),
        )
        if (cancelled) return
        const map: Record<string, OwnedEdition[]> = {}
        for (const row of rows) {
          if (row.owner !== me) continue
          const key = row.seriesId.toString()
          ;(map[key] ??= []).push({ tokenId: row.tokenId, edition: row.edition })
        }
        for (const key of Object.keys(map)) map[key].sort((a, b) => a.edition - b.edition)
        setOwned(map)
      } catch (e) {
        console.error('ownership load failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [smartAddress, refreshTick])

  const filtered = useMemo(() => {
    const me = smartAddress?.toLowerCase()
    let arr = records.slice()
    if (tab === 'recent') {
      arr.sort((a, b) => Number(b.mintedAtLoop - a.mintedAtLoop) || Number(b.seriesId - a.seriesId))
    } else if (tab === 'collab') {
      arr.sort((a, b) => b.holders.length - a.holders.length || Number(b.seriesId - a.seriesId))
    } else {
      // "My Loops" — loops the wallet contributed a cell to OR holds an edition of.
      arr = arr.filter((r) => {
        if (!me) return false
        const contributed = r.holders.some((h) => h.toLowerCase() === me)
        const holdsEdition = (owned[r.seriesId.toString()]?.length ?? 0) > 0
        return contributed || holdsEdition
      })
      arr.sort((a, b) => Number(b.mintedAtLoop - a.mintedAtLoop) || Number(b.seriesId - a.seriesId))
    }
    return arr
  }, [records, tab, smartAddress, owned])

  const me = smartAddress?.toLowerCase()

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
            title={smartAddress ? '' : 'connect to see loops you created, pressed or contributed to'}
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
              ? "No loops yet — press an edition or rent a cell and you'll see it here."
              : 'No loops match.'}
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((r) => {
            const isPlaying = playingTokenId === r.seriesId
            const editionsMinted = r.nextEdition - 1
            const isClaiming = claimingSeriesId === r.seriesId
            const priceStr = formatPrice(r.nextPressPrice)
            const roy = royalty[r.seriesId.toString()]
            // The connected wallet's relationship to this loop.
            const myEditions = owned[r.seriesId.toString()] ?? []
            const isOwner = myEditions.length > 0
            const isContributor = !!me && r.holders.some((h) => h.toLowerCase() === me)
            const topEdition = isOwner ? myEditions[0] : null // lowest edition held
            const cardClass = [
              'loop-card',
              isPlaying ? 'playing' : '',
              isOwner ? 'role-owned' : isContributor ? 'role-contrib' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <div key={r.seriesId.toString()} className={cardClass}>
                <div className="loop-card-head">
                  <span className="token-id">loop #{r.seriesId.toString()}</span>
                  <span className="muted">
                    {editionsMinted}× pressed · {r.holders.length} contrib
                  </span>
                </div>
                {(isOwner || isContributor) && (
                  <div className="role-badges">
                    {isOwner && topEdition && (
                      <span
                        className="role-badge owned"
                        title={
                          myEditions.length === 1
                            ? `You hold edition #${topEdition.edition}${
                                topEdition.edition === 1 ? ' — the original press' : ''
                              } of this loop`
                            : `You hold ${myEditions.length} editions of this loop: ${myEditions
                                .map((e) => `#${e.edition}`)
                                .join(', ')}`
                        }
                      >
                        ✦ edition #{topEdition.edition}
                        {myEditions.length > 1 ? ` +${myEditions.length - 1}` : ''}
                      </span>
                    )}
                    {isContributor && (
                      <span
                        className="role-badge contrib"
                        title="You rented a cell that became part of this loop"
                      >
                        ♪ contributor
                      </span>
                    )}
                  </div>
                )}
                <MiniGrid pattern={r.pattern} synthData={r.synthData} playingStep={isPlaying ? playingStep : -1} />
                <div className="loop-card-foot">
                  <span className="muted owner">
                    next press {priceStr} USDm
                    {roy && roy.deposited > 0n && ` · ♪ ${formatPrice(roy.deposited)} royalties`}
                  </span>
                  <div className="card-actions">
                    {isPlaying ? (
                      <button onClick={onStop}>◼ stop</button>
                    ) : (
                      <button onClick={() => onPlay(r)}>▶ play</button>
                    )}
                    {roy && roy.claimable > 0n && (
                      <button
                        onClick={() => onClaimRoyalty(r)}
                        disabled={isClaiming}
                        title={`Claim your royalty share of loop #${r.seriesId.toString()}`}
                      >
                        {isClaiming ? 'claiming…' : `♪ claim ${formatPrice(roy.claimable)}`}
                      </button>
                    )}
                    {isOwner && topEdition && (
                      <a
                        className="nft-link"
                        href={`${config.explorerUrl}/token/${config.loopchainAddress}/instance/${topEdition.tokenId.toString()}`}
                        target="_blank"
                        rel="noreferrer"
                        title={`View your Edition #${topEdition.edition} NFT on Blockscout`}
                      >
                        ↗ See Edition NFT
                      </a>
                    )}
                    <ShareButton record={r} editionsMinted={editionsMinted} />
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

function shareLink(seriesId: bigint): string {
  return `${window.location.origin}${window.location.pathname}?loop=${seriesId.toString()}`
}

function ShareButton({ record, editionsMinted }: { record: LoopRecord; editionsMinted: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} title="share this loop">
        ↗ share
      </button>
      {open && (
        <SharePopover
          record={record}
          editionsMinted={editionsMinted}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function SharePopover({
  record,
  editionsMinted,
  onClose,
}: {
  record: LoopRecord
  editionsMinted: number
  onClose: () => void
}) {
  const url = shareLink(record.seriesId)
  const tweet = `loop #${record.seriesId.toString()} on loopclub — ${record.holders.length} contributor${record.holders.length === 1 ? '' : 's'}, ${editionsMinted} edition${editionsMinted === 1 ? '' : 's'} pressed. press your own:`
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('copy share link', url)
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-head">
          <h3>
            <span className="token-id">loop #{record.seriesId.toString()}</span>
          </h3>
          <button className="popover-x" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <p className="muted">
          {record.holders.length} contributor{record.holders.length === 1 ? '' : 's'} ·{' '}
          {editionsMinted} edition{editionsMinted === 1 ? '' : 's'} pressed
        </p>
        <div className="share-preview">
          <MiniGrid pattern={record.pattern} synthData={record.synthData} />
        </div>
        <div className="share-url">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn-chrome" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
        </div>
        <div className="row share-actions">
          <a href={twitterUrl} target="_blank" rel="noreferrer" className="share-action">
            𝕏 Share on X
          </a>
          <a href={url} target="_blank" rel="noreferrer" className="share-action">
            ↗ Open in new tab
          </a>
        </div>
      </div>
    </div>
  )
}

/** Count set bits in the 144-bit pattern — the number of filled cells in a loop. */
function popcount(v: bigint): bigint {
  let n = 0n
  let x = v
  while (x > 0n) {
    n += x & 1n
    x >>= 1n
  }
  return n
}
