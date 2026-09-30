import { useEffect } from 'react'
import { CatalogNotice } from './CatalogShell'
import { RowSkeleton, SiteGalleryCard } from './SiteRow'
import { sectionBySlug } from './site'
import type { SiteCard } from './site'
import { sectionOfType } from './paid'
import type { Purchase, Pricing } from './paid'
import { loadPurchases, usePaid } from './paidStore'
import { hasMillidaAccount } from '../../lib/api'
import { openModal } from '../../state/ui'

/*
 * «Покупки» — всё купленное в каталоге Millida (`/catalog/purchases/me`):
 * поставить заново в любую сборку теми же кнопками, что в ленте.
 */

function cardOf(p: Purchase, section: string): SiteCard {
  return {
    slug: p.slug,
    section,
    title: p.title,
    summary: '',
    cover: null,
    icon: p.iconUrl,
    side: null,
    // Платная сборка ставится только лаунчером — своим путём, по доступу.
    launcherOnly: p.type === 'MODPACK',
    author: null,
    downloads: null,
    versions: [],
    loaders: [],
    categories: [],
    publishedAt: null,
    updatedAt: null,
    pricing: (p.kind === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : 'ONE_TIME') as Pricing,
    priceKopecks: p.amountKopecks || 1,
  }
}

export function PurchasesPane({ onOpenPack }: { onOpenPack?: (slug: string) => boolean | void }) {
  const rows = usePaid((s) => s.purchases)
  const failed = usePaid((s) => s.purchasesFailed)
  const signed = hasMillidaAccount()
  useEffect(() => {
    if (signed) void loadPurchases()
  }, [signed])
  if (!signed)
    return (
      <CatalogNotice
        note={{ icon: 'i-wallet', title: 'Покупки — в аккаунте Millida', action: { label: 'Войти', primary: true, onClick: () => openModal('accModal') } }}
      />
    )
  if (failed && !(rows && rows.length))
    return (
      <CatalogNotice note={{ icon: 'i-alert', title: 'Покупки не загрузились', action: { label: 'Повторить', primary: true, icon: 'i-restart', onClick: () => void loadPurchases() } }} />
    )
  if (rows === null)
    return (
      <div className="mr-galgrid">
        <RowSkeleton gallery n={3} />
      </div>
    )
  if (!rows.length) return <CatalogNotice note={{ icon: 'i-inbox', title: 'Покупок пока нет' }} />
  return (
    <div className="mr-main cat-purchases">
      <header className="mr-head">
        <h1 className="mr-h1">Мои покупки</h1>
      </header>
      <div className="mr-galgrid">
        {rows.map((p, i) => {
          const section = sectionOfType(p.type)!
          return <SiteGalleryCard key={p.slug} card={cardOf(p, section)} sec={sectionBySlug(section)} pos={i} onOpenPack={onOpenPack} />
        })}
      </div>
    </div>
  )
}
