import type { ModFile } from '../ipc/commands'

/** Моды демо-сборки (?preview, только DEV): экран сборки виден целиком без ядра. */
const m = (title: string, id: string, ver: string, icon: string, desc: string, enabled = true): ModFile => ({
  name: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + ver + '.jar',
  enabled,
  project_id: id,
  version_number: ver,
  title,
  icon_url: 'https://cdn.modrinth.com/data/' + id + '/' + icon,
  description: desc,
  mc: '1.21.1',
  loader: 'fabric',
  size: 1_200_000,
  scanned: true,
})

export const DEMO_MODS: ModFile[] = [
  m('Sodium', 'AANobbMI', '0.6.13', '295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp', 'Самый быстрый движок отрисовки'),
  m('Fabric API', 'P7dR8mSH', '0.116.6', 'icon.png', 'Основа для модов Fabric'),
  m('Lithium', 'gvQqBUqZ', '0.15.0', 'bcc8686c13af0143adf4285d741256af824f70b7_96.webp', 'Ускоряет логику игры'),
  m('AppleSkin', 'EsAfCjCV', '3.0.6', 'icon.png', 'Сытость и насыщение на экране', false),
]
