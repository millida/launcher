import type { ModFile } from '../ipc/commands'

/** Моды демо-сборки (?preview, только DEV): экран сборки виден целиком без ядра. */
const NOW = Math.floor(Date.now() / 1000)
let order = 0
const m = (title: string, id: string, ver: string, icon: string, desc: string, enabled = true, author = ''): ModFile => ({
  added: NOW - 86400 * 3 + order++ * 600,
  author: author || undefined,
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
  m('Sodium', 'AANobbMI', '0.6.13', '295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp', 'Самый быстрый движок отрисовки', true, 'jellysquid3'),
  m('Fabric API', 'P7dR8mSH', '0.116.6', 'icon.png', 'Основа для модов Fabric', true, 'modmuss50'),
  m('Lithium', 'gvQqBUqZ', '0.15.0', 'bcc8686c13af0143adf4285d741256af824f70b7_96.webp', 'Ускоряет логику игры', true, 'jellysquid3'),
  m('AppleSkin', 'EsAfCjCV', '3.0.6', 'icon.png', 'Сытость и насыщение на экране', false, 'squeek502'),
  m('Cloth Config API', '9s6osm5g', '15.0.140', 'icon.png', 'Библиотека настроек для модов', true, 'shedaniel'),
  m('Mod Menu', 'mOgUt4GM', '11.0.3', 'icon.png', 'Список модов в главном меню', true, 'Prospector'),
  m('FerriteCore', 'uXXizFIs', '7.0.2', 'icon.png', 'Меньше памяти — меньше фризов', true, 'malte0811'),
  m('Iris Shaders', 'YL57xq9U', '1.8.8', 'icon.png', 'Шейдеры вместе с Sodium', true, 'coderbot'),
  m('Entity Culling', 'NNAgCjsB', '1.7.2', 'icon.png', 'Не рисует то, что за стеной', true, 'tr7zw'),
  { ...m('Xaero\'s Minimap', '1bokaNcj', '25.0.0', 'icon.png', 'Мини-карта в углу экрана', true, 'xaero96'), added: NOW - 120 },
]
